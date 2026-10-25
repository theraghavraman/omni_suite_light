from __future__ import annotations

import csv
import importlib.util
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import omni_data_engine as engine


class FakeDType:
    kind = "f"
    itemsize = 8

    def __str__(self):
        return "float64"


class DataEngineLimitTests(unittest.TestCase):
    def test_scientific_array_budget_is_per_array_and_aggregate(self):
        budget = [0]
        with patch.object(engine, "MAX_SCIENTIFIC_ARRAY_BYTES", 64), patch.object(
            engine, "MAX_SCIENTIFIC_TOTAL_BYTES", 24
        ):
            self.assertEqual(engine._guard_scientific_shape((2,), FakeDType(), budget), 16)
            with self.assertRaisesRegex(RuntimeError, "aggregate materialization"):
                engine._guard_scientific_shape((2,), FakeDType(), budget)
            with self.assertRaisesRegex(RuntimeError, "safe materialization"):
                engine._guard_scientific_shape((9,), FakeDType())
        with self.assertRaisesRegex(RuntimeError, "Variable-length"):
            engine._guard_scientific_shape((1,), type("ObjectDType", (), {"kind": "O", "itemsize": 8})())
        with self.assertRaisesRegex(RuntimeError, "Variable-length"):
            engine._guard_scientific_shape((1,), object())

    def test_scientific_metadata_is_bounded_before_encoding(self):
        with patch.object(engine, "MAX_SCIENTIFIC_METADATA_BYTES", 64):
            with self.assertRaisesRegex(RuntimeError, "metadata exceeds"):
                engine._scientific_attributes({"large": b"x" * 65})
            self.assertEqual(engine._scientific_attributes({"small": "ok"}), {"small": "ok"})

    @unittest.skipUnless(importlib.util.find_spec("numpy"), "NumPy is required by scientific readers")
    def test_scientific_profile_reads_metadata_without_materializing_arrays(self):
        class Variable:
            shape = (3,)
            dtype = FakeDType()
            dims = ("sample",)
            attrs = {}

            @property
            def values(self):
                raise AssertionError("metadata-only profile must not read the array")

        class Dataset:
            attrs = {}
            variables = {"signal": Variable()}

            def close(self):
                pass

        class Xarray:
            @staticmethod
            def open_dataset(*args, **kwargs):
                return Dataset()

        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "small.nc"
            path.write_bytes(b"metadata fixture")
            with patch.object(engine, "_mod", return_value=Xarray):
                profile = engine.scientific_profile(path)
        self.assertEqual(profile["variables"][0]["name"], "signal")
        self.assertEqual(profile["variables"][0]["shape"], [3])
        self.assertNotIn("data", profile["variables"][0])

    def test_blob_conversion_is_bounded_and_keeps_small_roundtrips(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            source = root / "input.bin"
            encoded = root / "output.hex"
            decoded = root / "roundtrip.bin"
            source.write_bytes(b"hi")
            with patch.object(engine, "MAX_BLOB_BYTES", 4), patch.object(engine, "MAX_BLOB_TEXT_BYTES", 8):
                engine.blob_convert(source, encoded, "binary", "hex")
                self.assertEqual(encoded.read_text(), "6869")
                engine.blob_convert(encoded, decoded, "hex", "binary")
                self.assertEqual(decoded.read_bytes(), b"hi")
                source.write_bytes(b"12345")
                with self.assertRaisesRegex(RuntimeError, "safety limit"):
                    engine.blob_convert(source, decoded, "binary", "hex")

    def test_text_csv_escapes_formulas_and_preserves_normal_lines(self):
        with tempfile.TemporaryDirectory() as tmp:
            source = Path(tmp) / "lines.txt"
            source.write_text("=1+1\n-12\nordinary text\n", encoding="utf-8")
            result = engine.text_lines(source, "csv")
        rows = list(csv.DictReader(result.splitlines()))
        self.assertTrue(rows[0]["text"].startswith("'"))
        self.assertEqual(rows[1]["text"], "-12")
        self.assertEqual(rows[2]["text"], "ordinary text")

    def test_text_conversion_rejects_excessive_line_count(self):
        with tempfile.TemporaryDirectory() as tmp:
            source = Path(tmp) / "many-lines.txt"
            source.write_text("a\nb\nc\n", encoding="utf-8")
            with patch.object(engine, "MAX_TEXT_CONVERSION_LINES", 2):
                with self.assertRaisesRegex(RuntimeError, "line-count limit"):
                    engine.text_lines(source, "jsonl")


if __name__ == "__main__":
    unittest.main()
