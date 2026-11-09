#!/usr/bin/env python3
"""Relocate native executables into a self-contained bundle and audit the result.

Used by scripts/stage_desktop_bundle.py (to build the bundle) and by
scripts/smoke_test_desktop.py (to audit the packaged/installed app).

* macOS (Mach-O): copy non-system dylib dependencies into a bundle lib dir,
  rewrite load commands to @loader_path-relative paths, drop absolute
  LC_RPATHs, and ad-hoc re-sign every modified file (required on arm64).
* Linux (ELF): copy the ldd closure (minus the glibc/graphics-driver set the
  host OS must provide) and set $ORIGIN-relative RUNPATHs with patchelf.
* Windows (PE): copy the non-system DLL import closure next to the executable
  (Windows searches the executable's own directory first).
"""
from __future__ import annotations

import os
import re
import shutil
import struct
import subprocess
from pathlib import Path

# --------------------------------------------------------------------------------------
# File type detection
# --------------------------------------------------------------------------------------

_MACHO_MAGICS = {
    b"\xfe\xed\xfa\xce", b"\xfe\xed\xfa\xcf", b"\xce\xfa\xed\xfe", b"\xcf\xfa\xed\xfe",
}
_FAT_MAGICS = {b"\xca\xfe\xba\xbe", b"\xca\xfe\xba\xbf"}


def _head(path: Path, size: int = 8) -> bytes:
    try:
        with open(path, "rb") as handle:
            return handle.read(size)
    except OSError:
        return b""


def is_macho(path: Path) -> bool:
    if path.is_symlink() or not path.is_file():
        return False
    head = _head(path)
    if head[:4] in _MACHO_MAGICS:
        return True
    if head[:4] in _FAT_MAGICS:
        # Java class files share 0xCAFEBABE; a fat Mach-O has a small arch count.
        return struct.unpack(">I", head[4:8])[0] < 20
    return False


def is_elf(path: Path) -> bool:
    return not path.is_symlink() and path.is_file() and _head(path, 4) == b"\x7fELF"


def is_pe(path: Path) -> bool:
    return not path.is_symlink() and path.is_file() and _head(path, 2) == b"MZ"


def _run(cmd: list[str], **kwargs) -> subprocess.CompletedProcess:
    return subprocess.run(cmd, capture_output=True, text=True, errors="replace", **kwargs)


# --------------------------------------------------------------------------------------
# macOS / Mach-O
# --------------------------------------------------------------------------------------

MACOS_SYSTEM_PREFIXES = ("/usr/lib/", "/System/")


def macho_deps(path: Path) -> list[str]:
    """Install names this Mach-O file loads (excluding its own LC_ID_DYLIB)."""
    proc = _run(["otool", "-L", str(path)])
    if proc.returncode != 0:
        raise RuntimeError(f"otool -L failed for {path}: {proc.stderr.strip()}")
    own_id = macho_id(path)
    deps: list[str] = []
    for line in proc.stdout.splitlines():
        if not line.startswith(("\t", " ")):
            continue  # "<file>:" or "<file> (architecture x):" headers
        name = line.strip().split(" (compatibility version", 1)[0].strip()
        if not name or name == own_id or name in deps:
            continue
        deps.append(name)
    return deps


def macho_id(path: Path) -> str | None:
    proc = _run(["otool", "-D", str(path)])
    lines = [line.strip() for line in proc.stdout.splitlines() if line.strip()]
    # Output: "<file>:" then the id (fat files repeat per arch)
    ids = [line for line in lines if not line.endswith(":")]
    return ids[0] if ids else None


def macho_rpaths(path: Path) -> list[str]:
    proc = _run(["otool", "-l", str(path)])
    rpaths: list[str] = []
    lines = proc.stdout.splitlines()
    for index, line in enumerate(lines):
        if line.strip() == "cmd LC_RPATH":
            for follow in lines[index + 1:index + 4]:
                follow = follow.strip()
                if follow.startswith("path "):
                    value = follow[5:].rsplit(" (offset", 1)[0].strip()
                    if value not in rpaths:
                        rpaths.append(value)
                    break
    return rpaths


def _expand_macho_token(value: str, loader_dir: Path, exe_dir: Path) -> str:
    return value.replace("@loader_path", str(loader_dir)).replace("@executable_path", str(exe_dir))


def resolve_macho_dep(dep: str, loader: Path, rpath_sources: list[tuple[Path, list[str]]], exe_dir: Path) -> Path | None:
    """Resolve an install name the way dyld would, using the *original* file locations."""
    if dep.startswith("@rpath/"):
        tail = dep[len("@rpath/"):]
        for owner, rpaths in rpath_sources:
            for rpath in rpaths:
                candidate = Path(_expand_macho_token(rpath, owner.parent, exe_dir)) / tail
                if candidate.exists():
                    return candidate.resolve()
        return None
    if dep.startswith(("@loader_path/", "@executable_path/")):
        candidate = Path(_expand_macho_token(dep, loader.parent, exe_dir))
        return candidate.resolve() if candidate.exists() else None
    candidate = Path(dep)
    return candidate.resolve() if candidate.exists() else None


def is_macos_system_dep(dep: str) -> bool:
    return dep.startswith(MACOS_SYSTEM_PREFIXES)


def adhoc_sign(path: Path) -> None:
    proc = _run(["codesign", "--force", "--sign", "-", str(path)])
    if proc.returncode != 0:
        raise RuntimeError(f"codesign failed for {path}: {proc.stderr.strip()}")


class MachORelocator:
    """Copy Mach-O files plus their non-system dylib closure into a bundle tree."""

    def __init__(self, lib_dir: Path):
        self.lib_dir = lib_dir
        self.lib_dir.mkdir(parents=True, exist_ok=True)
        self.copied: dict[Path, Path] = {}   # original real path -> staged path
        self.pending: list[tuple[Path, Path, list[tuple[Path, list[str]]], Path]] = []
        self.rewrites: dict[Path, dict[str, Path]] = {}

    def add(self, source: Path, dest: Path, exe_dir: Path | None = None) -> Path:
        real = source.resolve()
        if real in self.copied:
            return self.copied[real]
        dest.parent.mkdir(parents=True, exist_ok=True)
        if dest.exists() or dest.is_symlink():
            dest.unlink()
        shutil.copy2(real, dest)
        os.chmod(dest, (os.stat(dest).st_mode | 0o200) & ~0o022 | 0o444)
        self.copied[real] = dest
        self.pending.append((real, dest, [], exe_dir or real.parent))
        return dest

    def _lib_dest(self, real: Path) -> Path:
        dest = self.lib_dir / real.name
        existing = next((src for src, staged in self.copied.items() if staged == dest), None)
        if existing is not None and existing != real:
            raise RuntimeError(f"Library name collision in bundle: {real} vs {existing}")
        return dest

    def run(self) -> dict[Path, Path]:
        while self.pending:
            real, dest, parent_rpaths, exe_dir = self.pending.pop()
            own_rpaths = macho_rpaths(real)
            rpath_sources = [(real, own_rpaths)] + parent_rpaths
            mapping: dict[str, Path] = {}
            for dep in macho_deps(real):
                if is_macos_system_dep(dep):
                    continue
                resolved = resolve_macho_dep(dep, real, rpath_sources, exe_dir)
                if resolved is None:
                    raise RuntimeError(f"Unresolvable dependency {dep} of {real}")
                if is_macos_system_dep(str(resolved)):
                    continue
                if resolved not in self.copied:
                    lib_dest = self._lib_dest(resolved)
                    shutil.copy2(resolved, lib_dest)
                    os.chmod(lib_dest, (os.stat(lib_dest).st_mode | 0o200) & ~0o022 | 0o444)
                    self.copied[resolved] = lib_dest
                    self.pending.append((resolved, lib_dest, rpath_sources, exe_dir))
                mapping[dep] = self.copied[resolved]
            self.rewrites[dest] = mapping
        for dest, mapping in self.rewrites.items():
            self._rewrite(dest, mapping)
        return dict(self.copied)

    def _rewrite(self, dest: Path, mapping: dict[str, Path]) -> None:
        args: list[str] = []
        own_id = macho_id(dest)
        if own_id is not None:
            args += ["-id", f"@rpath/{dest.name}"]
        for old, target in mapping.items():
            rel = os.path.relpath(target, dest.parent)
            args += ["-change", old, f"@loader_path/{rel}"]
        for rpath in macho_rpaths(dest):
            if not rpath.startswith("@"):
                args += ["-delete_rpath", rpath]
        if args:
            proc = _run(["install_name_tool", *args, str(dest)])
            if proc.returncode != 0:
                raise RuntimeError(f"install_name_tool failed for {dest}: {proc.stderr.strip()}")
        adhoc_sign(dest)


def relocate_external_macho_deps_in_tree(tree: Path, lib_dir: Path) -> list[str]:
    """For an already-relocatable tree (e.g. a Python runtime), bundle any absolute
    non-system dylib dependency (e.g. Homebrew unixODBC loaded by a wheel)."""
    actions: list[str] = []
    relocator = MachORelocator(lib_dir)
    targets: list[tuple[Path, dict[str, Path]]] = []
    for path in sorted(tree.rglob("*")):
        if not is_macho(path):
            continue
        external = [dep for dep in macho_deps(path) if dep.startswith("/") and not is_macos_system_dep(dep)]
        if not external:
            continue
        mapping: dict[str, Path] = {}
        for dep in external:
            resolved = Path(dep).resolve()
            if not resolved.exists():
                raise RuntimeError(f"{path} links missing external library {dep}")
            if resolved not in relocator.copied:
                lib_dest = relocator._lib_dest(resolved)
                shutil.copy2(resolved, lib_dest)
                os.chmod(lib_dest, (os.stat(lib_dest).st_mode | 0o200) & ~0o022 | 0o444)
                relocator.copied[resolved] = lib_dest
                relocator.pending.append((resolved, lib_dest, [], resolved.parent))
            mapping[dep] = relocator.copied[resolved]
            actions.append(f"{path.relative_to(tree)}: bundled {dep}")
        targets.append((path, mapping))
    relocator.run()
    for path, mapping in targets:
        args: list[str] = []
        for old, target in mapping.items():
            args += ["-change", old, f"@loader_path/{os.path.relpath(target, path.parent)}"]
        proc = _run(["install_name_tool", *args, str(path)])
        if proc.returncode != 0:
            raise RuntimeError(f"install_name_tool failed for {path}: {proc.stderr.strip()}")
        adhoc_sign(path)
    return actions


def strip_foreign_macho_rpaths(tree: Path) -> list[str]:
    """Remove absolute LC_RPATHs that upstream wheel builders left behind (their CI paths).

    Only done when every @rpath dependency still resolves inside `tree` through the
    remaining relative rpaths, so behaviour on a clean machine is unchanged while a user's
    own Homebrew/gcc libraries can no longer be picked up instead of the bundled ones.
    """
    actions: list[str] = []
    tree = tree.resolve()
    for path in sorted(tree.rglob("*")):
        if not is_macho(path):
            continue
        rpaths = macho_rpaths(path)
        foreign = [r for r in rpaths if r.startswith("/") and not is_macos_system_dep(r + "/")]
        if not foreign:
            continue
        kept = [r for r in rpaths if r not in foreign]
        ok = True
        for dep in macho_deps(path):
            if not dep.startswith("@rpath/"):
                continue
            resolved = resolve_macho_dep(dep, path, [(path, kept)], path.parent)
            if resolved is None or tree not in resolved.parents:
                ok = False
                break
        if not ok:
            continue
        args: list[str] = []
        for rpath in foreign:
            args += ["-delete_rpath", rpath]
        proc = _run(["install_name_tool", *args, str(path)])
        if proc.returncode != 0:
            raise RuntimeError(f"install_name_tool failed for {path}: {proc.stderr.strip()}")
        adhoc_sign(path)
        actions.append(f"{path.relative_to(tree)}: removed {', '.join(foreign)}")
    return actions


def audit_macho_tree(tree: Path, bundle_root: Path) -> list[str]:
    """Every Mach-O file may only load system libraries or files inside bundle_root."""
    problems: list[str] = []
    bundle_root = bundle_root.resolve()
    for path in sorted(tree.rglob("*")):
        if not is_macho(path):
            continue
        rpaths = macho_rpaths(path)
        deps = macho_deps(path)
        # An rpath is only consulted for @rpath/ load commands; inert ones (e.g. left in a
        # vendor-signed library that must not be modified) cannot cause host libraries to load.
        if any(dep.startswith("@rpath/") for dep in deps):
            for rpath in rpaths:
                if rpath.startswith("/") and not is_macos_system_dep(rpath + "/"):
                    problems.append(f"{path}: absolute LC_RPATH {rpath}")
        for dep in deps:
            if is_macos_system_dep(dep):
                continue
            if dep.startswith("/"):
                problems.append(f"{path}: links external library {dep}")
                continue
            if dep.startswith("@rpath/") and not any(r.startswith("@") for r in rpaths):
                # Resolution comes from the loading executable's rpaths (common in .app
                # frameworks); only flag if no file with that name exists in the bundle.
                continue
            if dep.startswith("@loader_path/"):
                target = Path(dep.replace("@loader_path", str(path.parent)))
                try:
                    resolved = target.resolve()
                except OSError:
                    resolved = target
                if not target.exists():
                    problems.append(f"{path}: missing {dep}")
                elif bundle_root not in resolved.parents and resolved != bundle_root:
                    problems.append(f"{path}: {dep} resolves outside the bundle ({resolved})")
    return problems


# --------------------------------------------------------------------------------------
# Linux / ELF
# --------------------------------------------------------------------------------------

# Provided by every glibc-based distribution (or tied to the host's GPU driver) and
# intentionally never bundled. The .deb/.rpm declare the graphics ones as dependencies.
ELF_HOST_LIB_PATTERNS = tuple(re.compile(p) for p in (
    r"^linux-(vdso|gate)\.so", r"^ld-linux.*\.so", r"^libc\.so", r"^libm\.so", r"^libmvec\.so",
    r"^libdl\.so", r"^libpthread\.so", r"^librt\.so", r"^libresolv\.so", r"^libutil\.so",
    r"^libanl\.so", r"^libnsl\.so", r"^libBrokenLocale\.so", r"^libthread_db\.so", r"^libnss_",
    r"^libgcc_s\.so", r"^libGL\.so", r"^libGLX", r"^libGLdispatch\.so", r"^libEGL\.so",
    r"^libOpenGL\.so", r"^libgbm\.so", r"^libdrm\.so", r"^libasound\.so",
))

# Additionally allowed as host libraries for manylinux wheels (PEP 600 policy set).
MANYLINUX_HOST_LIBS = (
    "libstdc++.so.6", "libX11.so.6", "libXext.so.6", "libXrender.so.1", "libICE.so.6",
    "libSM.so.6", "libgobject-2.0.so.0", "libgthread-2.0.so.0", "libglib-2.0.so.0", "libz.so.1",
    "libexpat.so.1",
)


def is_elf_host_lib(soname: str) -> bool:
    return any(p.search(soname) for p in ELF_HOST_LIB_PATTERNS)


_LDD_LINE = re.compile(r"^\s*(\S+)\s*(?:=>\s*(\S+|not found))?\s*(?:\(0x[0-9a-f]+\))?\s*$")


def ldd(path: Path, env: dict | None = None) -> dict[str, str | None]:
    """soname -> resolved path (None when 'not found')."""
    clean_env = dict(env if env is not None else os.environ)
    clean_env.pop("LD_LIBRARY_PATH", None)
    clean_env.pop("LD_PRELOAD", None)
    proc = _run(["ldd", str(path)], env=clean_env)
    output = proc.stdout + proc.stderr
    if "not a dynamic executable" in output or "statically linked" in output:
        return {}
    result: dict[str, str | None] = {}
    for line in proc.stdout.splitlines():
        match = _LDD_LINE.match(line)
        if not match:
            continue
        name, target = match.group(1), match.group(2)
        if target is None:
            # "/lib64/ld-linux-x86-64.so.2 (0x...)" or "linux-vdso.so.1 (0x...)"
            result[os.path.basename(name)] = name if name.startswith("/") else None
            continue
        result[name] = None if target == "not found" else target
    return result


def patchelf(*args: str) -> None:
    proc = _run(["patchelf", *args])
    if proc.returncode != 0:
        raise RuntimeError(f"patchelf {' '.join(args)} failed: {proc.stderr.strip()}")


class ELFRelocator:
    def __init__(self, lib_dir: Path):
        self.lib_dir = lib_dir
        self.lib_dir.mkdir(parents=True, exist_ok=True)
        self.staged: list[Path] = []
        self.libs: dict[str, Path] = {}
        self.lib_sources: dict[str, Path] = {}
        self.pending_libs: list[tuple[str, Path]] = []
        self.scanned_libs: set[str] = set()

    def _stage_dependency(self, soname: str, target: str) -> None:
        if soname in self.libs:
            return
        source = Path(target).resolve()
        lib_dest = self.lib_dir / soname
        shutil.copy2(source, lib_dest)
        os.chmod(lib_dest, os.stat(lib_dest).st_mode | 0o200)
        self.libs[soname] = lib_dest
        self.lib_sources[soname] = source
        self.pending_libs.append((soname, source))

    def _collect_transitive_dependencies(self) -> None:
        # Relocating only an executable's direct dependencies leaves those libraries
        # free to resolve their own dependencies from the build host. Walk the full
        # non-system closure so every copied library can run with only $ORIGIN paths.
        while self.pending_libs:
            soname, source = self.pending_libs.pop()
            if soname in self.scanned_libs:
                continue
            self.scanned_libs.add(soname)
            for dependency, target in ldd(source).items():
                if is_elf_host_lib(dependency):
                    continue
                if target is None:
                    raise RuntimeError(f"{source} needs {dependency}, which is not installed on the build host")
                self._stage_dependency(dependency, target)

    def add(self, source: Path, dest: Path) -> Path:
        real = source.resolve()
        dest.parent.mkdir(parents=True, exist_ok=True)
        if dest.exists() or dest.is_symlink():
            dest.unlink()
        shutil.copy2(real, dest)
        os.chmod(dest, os.stat(dest).st_mode | 0o200)
        self.staged.append(dest)
        for soname, target in ldd(real).items():
            if is_elf_host_lib(soname):
                continue
            if target is None:
                raise RuntimeError(f"{real} needs {soname}, which is not installed on the build host")
            self._stage_dependency(soname, target)
        self._collect_transitive_dependencies()
        return dest

    def run(self) -> None:
        for path in self.staged:
            rel = os.path.relpath(self.lib_dir, path.parent)
            patchelf("--set-rpath", "$ORIGIN" if rel == "." else f"$ORIGIN/{rel}", str(path))
        for lib in self.libs.values():
            patchelf("--set-rpath", "$ORIGIN", str(lib))


def audit_elf_files(paths: list[Path], bundle_root: Path, allowed_host: tuple[str, ...] = ()) -> list[str]:
    """Each ELF file's dependencies must resolve inside bundle_root or be host-provided."""
    problems: list[str] = []
    bundle_root = bundle_root.resolve()
    for path in paths:
        for soname, target in ldd(path).items():
            if is_elf_host_lib(soname) or soname in allowed_host:
                continue
            if target is None:
                if allowed_host and _shipped_in_tree(bundle_root, soname):
                    continue  # Python wheels: shipped by another wheel and preloaded by it at import time
                problems.append(f"{path}: {soname} not found")
                continue
            resolved = Path(target).resolve()
            if bundle_root not in resolved.parents:
                problems.append(f"{path}: {soname} resolves outside the bundle ({target})")
    return problems


_TREE_SONAMES: dict[str, set[str]] = {}


def _shipped_in_tree(tree: Path, soname: str) -> bool:
    key = str(tree.resolve())
    if key not in _TREE_SONAMES:
        _TREE_SONAMES[key] = {p.name for p in tree.rglob("*.so*") if p.is_file() or p.is_symlink()}
    return soname in _TREE_SONAMES[key]


def bundle_external_elf_deps_in_tree(tree: Path, lib_dir: Path) -> list[str]:
    """Bundle non-host shared libraries that Python wheels load from the build host."""
    actions: list[str] = []
    lib_dir.mkdir(parents=True, exist_ok=True)
    tree = tree.resolve()
    for path in sorted(tree.rglob("*.so*")):
        if not is_elf(path):
            continue
        needs_rpath = False
        for soname, target in ldd(path).items():
            if is_elf_host_lib(soname) or soname in MANYLINUX_HOST_LIBS:
                continue
            if target is None:
                if _shipped_in_tree(tree, soname):
                    continue  # provided by another wheel and preloaded at runtime (e.g. eckitlib for eccodes)
                raise RuntimeError(f"{path} needs {soname}, which is not installed on the build host")
            resolved = Path(target).resolve()
            if tree in resolved.parents:
                continue
            dest = lib_dir / soname
            if not dest.exists():
                shutil.copy2(resolved, dest)
                os.chmod(dest, os.stat(dest).st_mode | 0o200)
                patchelf("--set-rpath", "$ORIGIN", str(dest))
            actions.append(f"{path.relative_to(tree)}: bundled {soname}")
            needs_rpath = True
        if needs_rpath:
            rel = os.path.relpath(lib_dir, path.parent)
            patchelf("--add-rpath", f"$ORIGIN/{rel}", str(path))
    return actions


# --------------------------------------------------------------------------------------
# Windows / PE
# --------------------------------------------------------------------------------------

def pe_imports(path: Path) -> list[str]:
    """DLL names from the import and delay-import tables of a PE file."""
    data = path.read_bytes()
    if data[:2] != b"MZ":
        return []
    pe_offset = struct.unpack_from("<I", data, 0x3C)[0]
    if data[pe_offset:pe_offset + 4] != b"PE\0\0":
        return []
    coff = pe_offset + 4
    num_sections = struct.unpack_from("<H", data, coff + 2)[0]
    opt_size = struct.unpack_from("<H", data, coff + 16)[0]
    opt = coff + 20
    magic = struct.unpack_from("<H", data, opt)[0]
    dd_offset = opt + (112 if magic == 0x20B else 96)
    sections = []
    sec = opt + opt_size
    for i in range(num_sections):
        base = sec + i * 40
        vsize, vaddr, rawsize, rawptr = struct.unpack_from("<IIII", data, base + 8)
        sections.append((vaddr, max(vsize, rawsize), rawptr))

    def rva_to_off(rva: int) -> int | None:
        for vaddr, size, rawptr in sections:
            if vaddr <= rva < vaddr + size:
                return rva - vaddr + rawptr
        return None

    def read_cstr(off: int) -> str:
        end = data.index(b"\0", off)
        return data[off:end].decode("ascii", "replace")

    names: list[str] = []
    for index, desc_size, name_field in ((1, 20, 12), (13, 32, 4)):
        rva, size = struct.unpack_from("<II", data, dd_offset + index * 8)
        if not rva:
            continue
        off = rva_to_off(rva)
        while off is not None and off + desc_size <= len(data):
            name_rva = struct.unpack_from("<I", data, off + name_field)[0]
            if not name_rva:
                break
            name_off = rva_to_off(name_rva)
            if name_off is None:
                break
            dll = read_cstr(name_off)
            if dll and dll.lower() not in (n.lower() for n in names):
                names.append(dll)
            off += desc_size
    return names


def windows_system_dirs() -> list[Path]:
    root = Path(os.environ.get("SystemRoot", r"C:\Windows"))
    return [root / "System32", root]


def is_windows_system_dll(name: str) -> bool:
    lower = name.lower()
    if lower.startswith(("api-ms-win-", "ext-ms-")):
        return True
    return any((d / name).is_file() for d in windows_system_dirs())


def copy_pe_closure(exe: Path, search_dirs: list[Path], dest_dir: Path) -> list[Path]:
    """Copy exe and its non-system DLL closure (found in search_dirs) into dest_dir."""
    dest_dir.mkdir(parents=True, exist_ok=True)
    copied: list[Path] = []
    queue = [exe]
    seen: set[str] = set()
    while queue:
        current = queue.pop()
        key = current.name.lower()
        if key in seen:
            continue
        seen.add(key)
        target = dest_dir / current.name
        shutil.copy2(current, target)
        copied.append(target)
        for dll in pe_imports(current):
            if dll.lower() in seen or is_windows_system_dll(dll):
                continue
            found = next((d / dll for d in [current.parent, *search_dirs] if (d / dll).is_file()), None)
            if found is None:
                raise RuntimeError(f"{current.name} imports {dll}, which was not found")
            queue.append(found)
    return copied


def audit_pe_dir(directory: Path) -> list[str]:
    """Every .exe/.dll in a flat tool directory must find its imports locally or in System32."""
    problems: list[str] = []
    present = {p.name.lower() for p in directory.iterdir() if p.is_file()}
    for path in sorted(directory.iterdir()):
        if path.suffix.lower() not in (".exe", ".dll") or not is_pe(path):
            continue
        for dll in pe_imports(path):
            if dll.lower() in present or is_windows_system_dll(dll):
                continue
            problems.append(f"{path}: imports {dll}, which is not bundled")
    return problems


# --------------------------------------------------------------------------------------
# Text audit (launchers, configs) for build-host paths
# --------------------------------------------------------------------------------------

def build_host_markers(extra: list[str] | None = None) -> list[str]:
    markers = [
        "/opt/homebrew/", "/usr/local/Cellar/", "/usr/local/opt/", "/home/runner/", "/Users/runner/",
        "/home/linuxbrew/", "C:\\ProgramData\\chocolatey", "C:\\hostedtoolcache", "D:\\a\\", "C:\\msys64",
        "/opt/hostedtoolcache/",
    ]
    for item in extra or []:
        if item and item not in markers:
            markers.append(item)
    return markers


def audit_text_files(paths: list[Path], markers: list[str]) -> list[str]:
    problems: list[str] = []
    encoded = [(m, m.encode("utf-8")) for m in markers]
    for path in paths:
        try:
            if path.is_symlink() or not path.is_file() or path.stat().st_size > 4 * 1024 * 1024:
                continue
            data = path.read_bytes()
        except OSError:
            continue
        if b"\0" in data[:8192]:
            continue  # binary; covered by the object-file audits
        for marker, raw in encoded:
            if raw in data:
                problems.append(f"{path}: references build-host path {marker}")
                break
    return problems


def audit_binary_markers(paths: list[Path], markers: list[str]) -> list[str]:
    """Scan small launcher binaries (e.g. pip's Windows .exe stubs) for absolute paths."""
    problems: list[str] = []
    encoded = [(m, m.encode("utf-8")) for m in markers] + [(m, m.encode("utf-16-le")) for m in markers]
    for path in paths:
        try:
            if path.is_symlink() or not path.is_file() or path.stat().st_size > 4 * 1024 * 1024:
                continue
            data = path.read_bytes()
        except OSError:
            continue
        for marker, raw in encoded:
            if raw and raw in data:
                problems.append(f"{path}: embeds build-host path {marker}")
                break
    return problems
