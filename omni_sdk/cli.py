"""Command-line entry point for OmniConverter Studio."""
from __future__ import annotations
import argparse
import json
import os
import runpy
from pathlib import Path

def main():
    parser = argparse.ArgumentParser(prog="omni-engine", description="OmniConverter Studio Python SDK and Local Engine interface.")
    sub = parser.add_subparsers(dest="command")
    sub.add_parser("doctor", help="Inspect installed Python/native Local Engine capabilities.")
    sub.add_parser("version", help="Show the SDK version.")
    serve = sub.add_parser("serve", help="Start the Omni Local Engine HTTP server.")
    serve.add_argument("--ui", metavar="PATH", help="Folder containing index.html (a repository checkout). "
                       "Defaults to $OMNI_UI_ROOT, then the current directory. Without it the engine runs API-only.")
    args = parser.parse_args()

    if args.command == "version":
        from omni_sdk import __version__
        print(__version__)
    elif args.command == "doctor":
        from omni_platform import doctor
        print(json.dumps(doctor(), indent=2, default=str))
    elif args.command == "serve":
        ui = args.ui or os.environ.get("OMNI_UI_ROOT") or (os.getcwd() if Path("index.html").is_file() else "")
        if ui:
            if not (Path(ui) / "index.html").is_file():
                parser.error(f"--ui {ui!r} does not contain index.html")
            os.environ["OMNI_UI_ROOT"] = str(Path(ui).resolve())
        runpy.run_module("omni_local_server", run_name="__main__")
    else:
        parser.print_help()

if __name__ == "__main__":
    main()
