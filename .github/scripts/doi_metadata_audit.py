#!/usr/bin/env python3
"""Fail-closed consistency checks for Omni Suite citation and licensing metadata.

This validates repository metadata and notice coverage; it does not replace human
review of upstream license terms or legal advice.
"""
from __future__ import annotations

import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


def require(condition: bool, message: str) -> None:
    if not condition:
        raise SystemExit(f"[FAIL] {message}")
    print(f"[OK] {message}")


def field(text: str, key: str) -> str | None:
    match = re.search(rf"^{re.escape(key)}:\s*[\"']?([^\"'\n]+)", text, re.MULTILINE)
    return match.group(1).strip() if match else None


def main() -> int:
    zenodo = json.loads((ROOT / ".zenodo.json").read_text(encoding="utf-8"))
    package = json.loads((ROOT / "package.json").read_text(encoding="utf-8"))
    cff_text = (ROOT / "CITATION.cff").read_text(encoding="utf-8")
    license_text = (ROOT / "LICENSE").read_text(encoding="utf-8")
    notices = (ROOT / "THIRD_PARTY_NOTICES.md").read_text(encoding="utf-8").lower()
    changelog = (ROOT / "CHANGELOG.md").read_text(encoding="utf-8")

    cff_version = field(cff_text, "version")
    cff_license = field(cff_text, "license")
    cff_date = field(cff_text, "date-released")
    zenodo_version = str(zenodo.get("version", ""))
    package_version = str(package.get("version", ""))

    require(zenodo.get("upload_type") == "software", "Zenodo upload_type is software")
    require(zenodo.get("title") == "Omni Suite", "Zenodo title is Omni Suite")
    require(bool(zenodo.get("creators")) and zenodo["creators"][0].get("name") == "Raghav Raman",
            "Zenodo creator metadata is present")
    require(bool(zenodo.get("description", "").strip()), "Zenodo description is non-empty")
    require(zenodo.get("license") == "mit", "Zenodo license uses SPDX identifier 'mit'")
    require(zenodo.get("access_right") == "open", "Zenodo access_right is open")
    require(package_version == zenodo_version == cff_version == "1.0.0",
            "package, Zenodo and CITATION.cff versions agree at 1.0.0")
    require(cff_license == "MIT", "CITATION.cff declares the MIT SPDX license")
    require(cff_date == "2026-10-10", "CITATION.cff release date matches the 1.0.0 changelog date")
    require("## [1.0.0] - 2026-10-10" in changelog, "changelog contains the declared 1.0.0 release date")
    require("MIT License" in license_text and "Copyright (c) 2026 Raghav Raman" in license_text,
            "root LICENSE has MIT text and copyright attribution")

    identifiers = zenodo.get("related_identifiers", [])
    require(len(identifiers) >= 1 and all(
        item.get("identifier", "").startswith(("https://", "http://")) and item.get("relation")
        for item in identifiers
    ), "Zenodo related identifiers have valid URLs and relation values")

    expected_notice_entries = [
        "pdf.js", "jszip", "pdf-lib", "tesseract.js", "mammoth.js", "pptxgenjs",
        "exceljs", "fast-formula-parser", "@formulajs/formulajs", "dompurify",
        "mermaid", "dagre", "sheetjs community edition", "gemma terms of use",
        "deepseek license", "apache license 2.0", "sil open font license 1.1",
    ]
    missing = [name for name in expected_notice_entries if name not in notices]
    require(not missing, "third-party notices cover pinned browser dependencies and model license categories"
            + (f" (missing: {', '.join(missing)})" if missing else ""))

    print("[INFO] Metadata and notice-coverage checks passed. This is not a legal determination.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
