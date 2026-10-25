"""Code execution is intentionally unavailable until a verified OS sandbox exists.

The previous implementation launched user programs with the Local Engine's UID,
environment and host filesystem. A timeout and temporary working directory do not
provide a security boundary. Keep this module fail-closed on every platform.
"""


def available_languages() -> dict:
    return {"available": False, "sandbox": None, "reason": "A verified rootless sandbox is not configured."}


def execute(language: str, source: str, stdin: str = "", timeout: int = 8) -> dict:
    raise RuntimeError(
        "Code execution is unavailable until a verified rootless sandbox with "
        "CPU, memory, process, network and bounded-output limits is installed."
    )
