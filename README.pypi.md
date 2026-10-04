# OmniConverter Studio — Python SDK

OmniConverter Studio is the Python/data-engineering layer of the Omni Suite project.

## Install

Core SDK:

    pip install omni-converter-studio

Data and scientific formats:

    pip install "omni-converter-studio[data]"

Database, large-data, archive and media integrations:

    pip install "omni-converter-studio[extended]"

Everything:

    pip install "omni-converter-studio[full]"

Native programs such as FFmpeg, LibreOffice, Poppler, qpdf, ImageMagick, Tesseract and Calibre are not bundled in the wheel. Install them separately when a Local Engine operation requires them.

## Python API

### Profile data

    from omni_sdk import profile
    report = profile("sales.csv")
    print(report["rows"], report["columns"])

### Read data

    from omni_sdk import read_data
    df = read_data("sales.xlsx")

### Clean data

    from omni_sdk import clean_dataframe
    cleaned = clean_dataframe(df, ["drop_duplicates", "trim_strings", "lower_columns"])

### Privacy inspection

    from omni_sdk import privacy_scan
    result = privacy_scan("customer_export.csv")
    print(result["risk"], result["sha256"])

### SQL transpilation

    from omni_sdk import transpile_sql
    print(transpile_sql("SELECT * FROM customers LIMIT 10", "postgres", "oracle"))

### Scientific formats

    from omni_sdk import scientific_profile, scientific_convert
    print(scientific_profile("experiment.nc"))
    scientific_convert("experiment.nc", "experiment.json", target="json")

### Database discovery

    from omni_sdk import database_tables, database_query
    print(database_tables("sqlite:///warehouse.db"))
    print(database_query("sqlite:///warehouse.db", "SELECT * FROM customers LIMIT 20"))

Database Studio is read-only at the engine layer: mutating SQL is rejected.

## Local Engine CLI

    omni-engine doctor
    omni-engine version
    omni-engine serve

The CLI reuses the existing Omni Local Engine and its local security model.

## Architecture

    Omni Suite
       |
       +-- Browser UI / GitHub Pages
       |
       +-- Python SDK (PyPI)
       |
       +-- Local Engine
              |
              +-- Python data/scientific stack
              +-- Native tools

The PyPI package does not replace the public website. It makes the Python/data-engineering layer independently reusable.

## Version

Initial release: 0.1.0

## License

MIT — Copyright (c) 2026 Raghav Raman.

Project: https://github.com/theraghavraman/omni_suite_light
