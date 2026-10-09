# Redmark Forge ETL Studio — Apache Hop integration

This integration connects Redmark Forge to an Apache Hop Server running on the same computer. Apache Hop is a separate open-source runtime/designer; it is not bundled into the GitHub Pages frontend.

## What the first integration supports

- Checks the local Hop Server at `http://127.0.0.1:8081`.
- Lists `.hpl` pipeline files found under `~/OmniETL/projects` (macOS/Linux) or the equivalent home directory on Windows.
- Runs a selected pipeline through Hop Server's `/hop/execPipeline` endpoint.
- Opens Hop's server page and optional Hop Web UI in separate tabs.
- Routes API requests through the authenticated Omni Local Engine. The Hop host/port are fixed to loopback in the bridge; the browser cannot supply an arbitrary upstream URL.
- Requires a user click and confirmation before pipeline execution. Credentials are submitted for the request only and are not written by this bridge to disk.

## Requirements

- Current Apache Hop release and its Java runtime requirements. Consult the official installation guide: https://hop.apache.org/manual/latest/installation-configuration.html
- Omni Local Engine running from this repository.
- Hop Server listening on `127.0.0.1:8081`.
- The pipeline file must be readable by the Hop Server process.

## Start Hop Server

1. Download and extract Apache Hop from the official site: https://hop.apache.org/
2. Open a terminal in the extracted Hop folder.
3. Start the server bound to loopback only.

macOS/Linux:

```sh
./hop-server.sh 127.0.0.1 8081
```

Windows:

```bat
hop-server.bat 127.0.0.1 8081
```

The standard local Hop Server configuration commonly uses `cluster` as the username and password. Change these defaults for any environment beyond local testing. Enter the credentials configured on your Hop Server in ETL Studio.

For a graphical desktop designer, start `./hop-gui.sh` on macOS/Linux or `hop-gui.bat` on Windows. The optional Hop Web UI is a separate service; if you have configured it on port 8080, use **Open Hop Web Designer** in ETL Studio.

## Add a pipeline

Create a folder named `OmniETL/projects` in your home directory and save/copy your Apache Hop `.hpl` pipeline files there. The folder is created automatically when ETL Studio requests its project list. The bridge lists pipelines recursively, but does not generate Hop pipeline XML or replace Hop's own visual designer.

Refresh the pipeline list in ETL Studio, select a pipeline, and click **Run Pipeline**. Execution can write to the source/target systems configured inside the pipeline. Confirm that those connections and environment variables are correct before running.

## API and safety notes

- The bridge calls only `127.0.0.1:8081` and optional `127.0.0.1:8080`; it does not accept a user-supplied upstream hostname.
- Pipeline execution is restricted to `.hpl` files whose resolved paths remain inside `~/OmniETL/projects`.
- Hop Server runs a pipeline synchronously, so the bridge waits up to 3600 seconds for it to finish. Set the `OMNI_ETL_TIMEOUT` environment variable (in seconds) before starting the Local Engine to allow longer runs.
- Hop Server itself must remain bound to loopback for local use. Do not expose its HTTP port to an untrusted network.
- The Local Engine's existing origin/token checks protect the new endpoints. Hop credentials are sent to the local engine over loopback and then used for HTTP Basic authentication to Hop Server.
- This is an initial integration: pipeline authoring remains in Apache Hop; the Omni panel connects, discovers and runs existing pipeline files.
