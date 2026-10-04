"""Command-line entry point for OmniConverter Studio."""
from __future__ import annotations
import argparse
import json
import runpy

def main():
    parser = argparse.ArgumentParser(prog="omni-engine", description="OmniConverter Studio Python SDK and Local Engine interface.")
    sub = parser.add_subparsers(dest="command")
    sub.add_parser("doctor", help="Inspect installed Python/native Local Engine capabilities.")
    sub.add_parser("version", help="Show the SDK version.")
    sub.add_parser("serve", help="Start the Omni Local Engine HTTP server.")
    args = parser.parse_args()

    if args.command == "version":
        from omni_sdk import __version__
        print(__version__)
    elif args.command == "doctor":
        from omni_platform import doctor
        print(json.dumps(doctor(), indent=2, default=str))
    elif args.command == "serve":
        runpy.run_module("omni_local_server", run_name="__main__")
    else:
        parser.print_help()

if __name__ == "__main__":
    main()
