"""Public Python interface for OmniConverter Studio."""

from omni_data_engine import (
    SQL_DIALECTS, DATA_FORMATS, module_status, read_data,
    scientific_profile, scientific_convert, transpile_sql, schema,
)
from omni_platform import (
    doctor, capability, clean_dataframe, privacy_scan,
    database_query, database_tables, batch_manifest,
)

__version__ = "0.1.0"

def profile(path, fmt=None, table=None):
    """Profile a tabular/data file using the Omni Data Studio engine."""
    pd = read_data(path, fmt, table)
    columns = []
    for c in pd.columns:
        s = pd[c]
        columns.append({
            "name": str(c),
            "dtype": str(s.dtype),
            "nulls": int(s.isna().sum()),
            "unique": int(s.nunique(dropna=True)),
        })
    return {"rows": int(len(pd)), "columns": int(len(pd.columns)), "columns_detail": columns}

__all__ = [
    "__version__", "DATA_FORMATS", "SQL_DIALECTS", "module_status",
    "doctor", "capability", "read_data", "profile",
    "scientific_profile", "scientific_convert", "transpile_sql", "schema",
    "clean_dataframe", "privacy_scan", "database_query", "database_tables",
    "batch_manifest",
]
