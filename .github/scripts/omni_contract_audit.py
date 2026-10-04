#!/usr/bin/env python3
"""Static contract audit for Omni Suite's browser/local capability model."""
from pathlib import Path
import re

ROOT=Path(__file__).resolve().parents[2]
index=(ROOT/"index.html").read_text(encoding="utf-8")
server=(ROOT/"omni_local_server.py").read_text(encoding="utf-8")
data=(ROOT/"omni_data_engine.py").read_text(encoding="utf-8")
platform=(ROOT/"omni_platform.py").read_text(encoding="utf-8")

required_panels=["tabDatabaseStudio","tabDataClean","tabBatchLab","tabLocalDoctor"]
required_ops=["doctor","capability","privacy_scan","data_clean","batch_convert","database_tables","database_query"]
required_handlers=["cleanBtn","privacyBtn","batchRunBtn","batchRetryBtn","batchDownloadBtn","doctorBtn"]
for handler in required_handlers:
    assert handler in index, f"Missing client handler/control reference: {handler}"
assert "job_op" in server and 'delegated_op=str(payload.get("job_op") or payload.get("operation") or "data_convert")' in server, "Batch operation dispatch contract is missing"

for p in required_panels:
    assert f'id="{p}"' in index, f"Missing UI panel: {p}"
for op in required_ops:
    assert f'if op == "{op}":' in server, f"Missing Local Engine operation: {op}"
for fn in ["doctor","capability","privacy_scan","clean_dataframe","database_query","database_tables","batch_manifest"]:
    assert f"def {fn}" in platform, f"Missing platform service: {fn}"

targets=["csv","tsv","json","jsonl","yaml","xml","html","md","xlsx","ods","hdf5","parquet","feather","orc","avro","sqlite","duckdb","sql","msgpack","jsonschema"]
write_section=data[data.index("def write_data"):data.index("def blob_convert") if "def blob_convert" in data else len(data)]
missing=[t for t in targets if t not in write_section]
assert not missing, "Advertised Data Studio targets without writer references: "+", ".join(missing)

assert "pandoc" in server.lower(), "Pandoc is not represented in Local Engine native tools"
assert "requirements-extended.txt" in (ROOT/"install_windows.ps1").read_text(encoding="utf-8"), "Windows installer does not install extended stack"
assert "requirements-extended.txt" in (ROOT/"install_system_tools.command").read_text(encoding="utf-8"), "Unix installer does not install extended stack"
print("Omni contract audit: PASS")
print(f"Panels checked: {len(required_panels)} | Local operations checked: {len(required_ops)} | Data targets checked: {len(targets)}")

assert 'data-tab="tabDiagnostics"' in index, "Diagnostics panel has no navigation tile"
batch_match=re.search(r'<select[^>]*id="batchTarget"[^>]*>(.*?)</select>',index,re.S)
assert batch_match and re.findall(r'<option[^>]*value="([^"]+)"',batch_match.group(1)), "Batch target options must have explicit values"
ocr_match=re.search(r'<select[^>]*id="ocrLanguage"[^>]*>(.*?)</select>',index,re.S)
ocr_values=re.findall(r'<option[^>]*value="([^"]+)"',ocr_match.group(1)) if ocr_match else []
assert len(ocr_values)==len(set(ocr_values)), "OCR language options contain duplicate values"
