"""Reference security primitives for Omni Suite remediation V2.

Not a drop-in replacement for the Omni application: integrate and test the call sites.
Uses Python standard library so core tests can run without network dependencies.
"""
from __future__ import annotations

import hashlib
import hmac
import http.client
import ipaddress
import os
import re
import secrets
import socket
import sqlite3
import ssl
import stat
import tempfile
import time
from decimal import Decimal, InvalidOperation
from pathlib import Path
from urllib.parse import parse_qs, quote, urlencode, urljoin, urlsplit

MAX_SQL_ROWS = 1000
MAX_SQL_CELL_BYTES = 1_000_000
MAX_SQL_RESPONSE_BYTES = 5_000_000


def parse_local_authority(value: str, expected_port: int) -> bool:
    """Host header must have valid URL authority syntax and loopback hostname."""
    if not value or any(c in value for c in "@/#?\\\r\n\t "):
        return False
    try:
        p = urlsplit("http://" + value)
        if p.username or p.password or p.path or p.query or p.fragment:
            return False
        if p.port != expected_port:
            return False
        return (p.hostname or "").lower() in {"localhost", "127.0.0.1", "::1"}
    except ValueError:
        return False


def validate_db_destination(url: str, sqlite_root: Path | None = None,
                            exact_hosts: set[str] | None = None) -> tuple[str, Path | str]:
    """Require local SQLite path confinement OR explicit remote host registration.

    Networking-layer egress protections are still REQUIRED for remote DB engines.
    """
    p = urlsplit(url)
    if p.scheme == "sqlite":
        if p.netloc and p.netloc not in {"", "localhost"}:
            raise ValueError("Remote SQLite paths are unsupported")
        if p.query or p.fragment or not p.path or p.path == "/:memory:":
            raise ValueError("SQLite database must be an existing local file")
        if sqlite_root is None:
            raise ValueError("OMNI_ALLOWED_SQLITE_DIR must be configured")
        root = sqlite_root.resolve(strict=True)
        candidate = Path(p.path)
        if candidate.is_symlink():
            raise ValueError("SQLite database symlinks are not supported")
        db = candidate.resolve(strict=True)
        if not db.is_file() or not db.is_relative_to(root):
            raise ValueError("SQLite database is outside the authorized directory")
        return "sqlite", db
    permitted = {"postgresql", "mysql", "mariadb"}
    if p.scheme not in permitted or not p.hostname or not p.port or p.fragment:
        raise ValueError("Remote database driver, host, and port must be registered")
    allowed = {h.rstrip(".").lower() for h in (exact_hosts or set())}
    host = p.hostname.rstrip(".").lower()
    if not allowed or host not in allowed:
        raise ValueError("Database host has no explicit grant")
    if not (1 <= p.port <= 65535):
        raise ValueError("Database port out of range")
    return p.scheme, host


def read_sqlite_only(database_file: Path, sql: str, params: dict | tuple = (),
                     max_rows: int = MAX_SQL_ROWS, timeout: float = 2.0,
                     max_response_bytes: int = MAX_SQL_RESPONSE_BYTES) -> dict:
    """Defense in depth: read-only OS open + PRAGMA query_only + SQLite authorizer.

    This is for SQLite only. Other drivers require DB READ-ONLY USERS *and* a
    robust SQL AST allowlist; do not re-use a string-prefix check for other DBs.
    """
    if not isinstance(sql, str) or len(sql) > 100_000 or not re.match(r"^\s*(SELECT|WITH)\b", sql, re.I):
        raise ValueError("Only a single read-only SELECT or WITH query is permitted")
    if ";" in sql.strip().rstrip(";"):
        raise ValueError("Multiple statements are not permitted")
    if not (1 <= max_rows <= 10_000):
        raise ValueError("Invalid row limit")
    db = Path(database_file).resolve(strict=True)
    if not db.is_file():
        raise ValueError("Database does not exist")
    # sqlite3 URI mode=ro is supported by SQLite, including read-only filesystem objects.
    uri = db.as_uri() + "?mode=ro"
    start = time.monotonic()
    con = sqlite3.connect(uri, uri=True, timeout=timeout)
    try:
        con.enable_load_extension(False)
        con.execute("PRAGMA query_only=ON")
        con.execute("PRAGMA trusted_schema=OFF")
        deny = getattr(sqlite3, "SQLITE_DENY")
        allowed_ops = {
            sqlite3.SQLITE_SELECT, sqlite3.SQLITE_READ, sqlite3.SQLITE_FUNCTION
        }
        def authorizer(action: int, a: str | None, b: str | None, dbname: str | None, source: str | None) -> int:
            if action == sqlite3.SQLITE_FUNCTION and (b or a or "").lower() in {"load_extension", "writefile", "readfile"}:
                return deny
            return sqlite3.SQLITE_OK if action in allowed_ops else deny
        con.set_authorizer(authorizer)
        con.set_progress_handler(lambda: 1 if time.monotonic() - start > timeout else 0, 1000)
        cur = con.execute(sql, params)
        columns = [x[0] for x in (cur.description or ())]
        if not columns:
            raise ValueError("Query did not return a result set")
        rows = []
        bytes_used = 0
        batch = cur.fetchmany(max_rows + 1)
        for row in batch:
            if len(rows) >= max_rows:
                break
            item = {}
            for key, value in zip(columns, row):
                if isinstance(value, bytes):
                    value = {"blob_sha256": hashlib.sha256(value).hexdigest(), "bytes": len(value)}
                if isinstance(value, str) and len(value.encode("utf-8")) > MAX_SQL_CELL_BYTES:
                    raise ValueError("Result cell exceeds preview limit")
                bytes_used += len(str(value).encode("utf-8")) + len(key.encode("utf-8"))
                if bytes_used > max_response_bytes:
                    raise ValueError("Query response exceeds preview limit")
                item[key] = value
            rows.append(item)
        return {"columns": columns, "rows": rows, "row_count": len(rows), "truncated": len(batch) > max_rows}
    except sqlite3.DatabaseError as exc:
        raise ValueError("Read-only query rejected by SQLite policy") from exc
    finally:
        con.close()


def bounded_stream_read(stream, max_bytes: int, chunk_size: int = 64 * 1024) -> bytes:
    """Never allow a caller to read an unbounded body into memory."""
    if max_bytes < 0:
        raise ValueError("Invalid limit")
    out = bytearray()
    while len(out) <= max_bytes:
        part = stream.read(min(chunk_size, max_bytes + 1 - len(out)))
        if not part:
            break
        out.extend(part)
    if len(out) > max_bytes:
        raise ValueError("Data exceeds permitted size")
    return bytes(out)


def atomic_stream_upload(stream, private_root: Path, declared_bytes: int,
                         max_bytes: int = 50 * 1024 * 1024,
                         suffix: str = ".upload") -> Path:
    """Unique file in private directory, no temp path reuse, cleanup on abort.

    Do not call with a directory shared with untrusted users; establish 0700
    permissions, request deadlines, and aggregate reservation *at the HTTP layer*.
    """
    if not 0 < declared_bytes <= max_bytes:
        raise ValueError("Invalid upload length")
    if not re.fullmatch(r"\.[A-Za-z0-9]{1,12}", suffix or ""):
        suffix = ".upload"
    private_root.mkdir(parents=True, mode=0o700, exist_ok=True)
    if private_root.is_symlink() or not private_root.is_dir():
        raise ValueError("Unsafe upload directory")
    if os.name != 'nt' and stat.S_IMODE(private_root.stat().st_mode) & 0o077:
        raise ValueError("Upload directory must not be accessible by other users")
    fd, tmp_name = tempfile.mkstemp(prefix="omni-", suffix=".part", dir=private_root)
    part = Path(tmp_name)
    final = private_root / (secrets.token_hex(18) + suffix.lower())
    try:
        with os.fdopen(fd, "wb", closefd=True) as target:
            remaining = declared_bytes
            while remaining:
                data = stream.read(min(64 * 1024, remaining))
                if not data:
                    raise ValueError("Interrupted upload")
                target.write(data)
                remaining -= len(data)
            target.flush()
            os.fsync(target.fileno())
        os.replace(part, final)
        return final
    finally:
        part.unlink(missing_ok=True)


def iter_archive_plain_files(root: Path, max_files: int = 5000,
                            max_bytes: int = 1_000_000_000):
    """Call after isolated extraction, BEFORE repackaging; reject links/devices."""
    root = root.resolve(strict=True)
    total = 0
    count = 0
    for current, dirs, files in os.walk(root, followlinks=False):
        for name in list(dirs) + files:
            p = Path(current) / name
            st = os.lstat(p)
            if stat.S_ISLNK(st.st_mode):
                raise ValueError("Archives containing symlinks are not supported")
            if not (stat.S_ISDIR(st.st_mode) or stat.S_ISREG(st.st_mode)):
                raise ValueError("Archives containing device/pipe/socket entries are unsupported")
            if stat.S_ISREG(st.st_mode):
                if st.st_nlink != 1:
                    raise ValueError("Hard-linked archive entries are unsupported")
                if not p.resolve(strict=True).is_relative_to(root):
                    raise ValueError("Archive entry escaped root")
                count += 1
                total += st.st_size
                if count > max_files or total > max_bytes:
                    raise ValueError("Archive exceeds expansion limit")
                yield p, p.relative_to(root).as_posix()


def csv_safe_value(value, spreadsheet: bool = True):
    """Neutralize text CSV/TSV cells that spreadsheets may treat as formulas."""
    if not spreadsheet or not isinstance(value, str):
        return value
    # Numeric negative values are kept only if their decimal grammar is complete.
    text = value.lstrip(" \t\r\n\x00")
    if text.startswith("-"):
        try:
            d = Decimal(text)
            if d.is_finite():
                return value
        except (InvalidOperation, ValueError):
            pass
    if re.match(r"^[\x00-\x20]*[=+@-]", value) or value.startswith(("\t", "\r", "\n")):
        return "'" + value
    return value


def sign_resource(secret: bytes, route: str, user_id: str, expires: int, method: str = "GET") -> str:
    if not secret or len(secret) < 32:
        raise ValueError("Use a dedicated 256-bit resource signing key")
    msg = f"{method.upper()}\n{route}\n{user_id}\n{int(expires)}".encode("utf-8")
    return hmac.new(secret, msg, hashlib.sha256).hexdigest()


def verify_resource(secret: bytes, route: str, user_id: str, expires: int,
                    signature: str, method: str = "GET", max_ttl: int = 300) -> bool:
    now = int(time.time())
    if expires < now or expires > now + max_ttl or not re.fullmatch("[a-f0-9]{64}", signature or ""):
        return False
    return hmac.compare_digest(sign_resource(secret, route, user_id, expires, method), signature)


class _PinnedHTTPS(http.client.HTTPSConnection):
    def __init__(self, hostname: str, pinned_ip: str, port: int, timeout: int):
        super().__init__(hostname, port, context=ssl.create_default_context(), timeout=timeout)
        self._pinned_ip = pinned_ip

    def connect(self):
        self.sock = socket.create_connection((self._pinned_ip, self.port), timeout=self.timeout)
        self.sock = self._context.wrap_socket(self.sock, server_hostname=self.host)


def _public_resolved_address(host: str, port: int) -> str:
    addresses = {info[4][0] for info in socket.getaddrinfo(host, port, type=socket.SOCK_STREAM)}
    if not addresses or any(not ipaddress.ip_address(ip).is_global for ip in addresses):
        raise ValueError("Host resolves to private/reserved IP address")
    return sorted(addresses)[0]


def bounded_public_https_get(url: str, host_allowlist: set[str], max_bytes=20_000_000,
                             redirect_limit=3, timeout=10) -> tuple[str, bytes]:
    """Per-hop HTTPS URL + DNS validation with DNS-pinned connections; memory-bounded.

    Intended for small preview/media-proxy payloads. For large media, stream to a
    private file with the same byte budget. Enforce upstream concurrency separately.
    """
    for _ in range(redirect_limit + 1):
        p = urlsplit(url)
        if (p.scheme != "https" or not p.hostname or p.username or p.password or
            p.port not in (None, 443) or p.fragment):
            raise ValueError("Only HTTPS on port 443 without credentials is allowed")
        host = p.hostname.rstrip('.').lower()
        if not any(host == name or host.endswith("." + name) for name in host_allowlist):
            raise ValueError("Host not in registered media CDN allowlist")
        ip = _public_resolved_address(host, 443)
        con = _PinnedHTTPS(host, ip, 443, timeout)
        try:
            path = (p.path or "/") + ("?" + p.query if p.query else "")
            con.request("GET", path, headers={"User-Agent": "Omni-SafeProxy/2", "Accept": "image/*,video/*,audio/*", "Connection": "close"})
            r = con.getresponse()
            if r.status in {301, 302, 303, 307, 308}:
                new = r.getheader("Location")
                if not new:
                    raise ValueError("Redirect without Location")
                url = urljoin(url, new)
                continue
            if r.status != 200:
                raise ValueError(f"Unexpected upstream status {r.status}")
            mime = r.getheader("Content-Type", "application/octet-stream").split(";", 1)[0].lower()
            if not (mime.startswith("image/") or mime.startswith("video/") or mime.startswith("audio/")):
                raise ValueError("Unsupported response MIME type")
            length = r.getheader("Content-Length")
            if length is not None and int(length) > max_bytes:
                raise ValueError("Upstream response is too large")
            body = bounded_stream_read(r, max_bytes)
            return mime, body
        finally:
            con.close()
    raise ValueError("Too many redirects")
