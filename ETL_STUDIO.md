# ETL Studio — Apache Hop bridge

Omni Suite's ETL Studio connects to Apache Hop Server to discover and run `.hpl` pipelines. Pipeline authoring stays in Apache Hop.

## Requirements

- Start the Omni Local Engine.
- Run Hop Server on `127.0.0.1:8081` with `./hop-server.sh 127.0.0.1 8081` on macOS/Linux or `hop-server.bat` on Windows.
- Put pipeline files under `~/OmniETL/projects`.

## Panel usage

- **Check Connection** calls `GET /hop/status/?json=Y`.
- **Refresh Pipelines** discovers up to 500 `.hpl` files in the projects folder.
- **Run Pipeline** calls `GET /hop/execPipeline?pipeline=<abs path>&json=Y`.

## Local Engine API

These routes require the engine token and an allowed origin:

- `GET /api/etl/hop/projects`
- `POST /api/etl/hop/status` with `{ "username": "...", "password": "..." }`
- `POST /api/etl/hop/run` with `{ "username": "...", "password": "...", "path": "relative/path.hpl" }`

Set `OMNI_ETL_TIMEOUT` to adjust the execution timeout. It defaults to 3600 seconds and has a minimum of 30 seconds.

## Security

The engine uses a fixed loopback Hop URL. The `path` value must be relative, contain no backslashes, resolve inside the projects folder, and end in `.hpl`; paths that escape through symlinks are rejected. Basic-auth credentials are not stored. Hop pipelines can run shell actions, so keep only trusted pipelines in the projects folder.
