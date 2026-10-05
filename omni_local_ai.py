#!/usr/bin/env python3
"""Omni Suite local AI provider bridge.

No model is downloaded by Omni Suite. The browser talks only to the loopback
Local Engine, which discovers an already-running Ollama or LM Studio instance.
"""
from __future__ import annotations
import json
import os
import urllib.error
import urllib.request
from typing import Any

OLLAMA_URL = os.environ.get("OMNI_OLLAMA_URL", "http://127.0.0.1:11434").rstrip("/")
LMSTUDIO_URL = os.environ.get("OMNI_LMSTUDIO_URL", "http://127.0.0.1:1234").rstrip("/")
PROVIDER = os.environ.get("OMNI_AI_PROVIDER", "auto").strip().lower()
MODEL = os.environ.get("OMNI_AI_MODEL", "").strip()
EMBED_MODEL = os.environ.get("OMNI_AI_EMBED_MODEL", "").strip()
TIMEOUT = float(os.environ.get("OMNI_AI_TIMEOUT", "180"))

def _json_request(url: str, method: str = "GET", payload: dict[str, Any] | None = None, timeout: float = TIMEOUT):
    data = None
    headers = {"Accept": "application/json"}
    if payload is not None:
        data = json.dumps(payload).encode("utf-8")
        headers["Content-Type"] = "application/json"
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            raw = resp.read()
            return json.loads(raw.decode("utf-8") or "{}")
    except urllib.error.HTTPError as exc:
        body = exc.read().decode("utf-8", "replace")[:2000]
        raise RuntimeError(f"Local AI HTTP {exc.code}: {body}") from exc
    except (urllib.error.URLError, TimeoutError) as exc:
        raise RuntimeError(str(exc)) from exc

def _ollama_models():
    try:
        data = _json_request(OLLAMA_URL + "/api/tags", timeout=4)
        return [str(x.get("name")) for x in data.get("models", []) if x.get("name")]
    except Exception:
        return []

def _lmstudio_models():
    try:
        data = _json_request(LMSTUDIO_URL + "/v1/models", timeout=4)
        return [str(x.get("id")) for x in data.get("data", []) if x.get("id")]
    except Exception:
        return []

def status():
    ollama = _ollama_models()
    lmstudio = _lmstudio_models()
    configured = PROVIDER if PROVIDER in {"ollama", "lmstudio"} else "auto"
    if configured == "ollama":
        active = "ollama" if ollama else None
    elif configured == "lmstudio":
        active = "lmstudio" if lmstudio else None
    else:
        active = "ollama" if ollama else ("lmstudio" if lmstudio else None)
    models = ollama if active == "ollama" else (lmstudio if active == "lmstudio" else [])
    selected = MODEL if MODEL in models else (models[0] if models else None)
    return {
        "ok": True,
        "local_only": True,
        "provider": active,
        "configured_provider": configured,
        "ollama": {"url": OLLAMA_URL, "available": bool(ollama), "models": ollama},
        "lmstudio": {"url": LMSTUDIO_URL, "available": bool(lmstudio), "models": lmstudio},
        "models": models,
        "model": selected,
        "embedding_model": EMBED_MODEL or None,
        "message": "Connect Ollama or LM Studio locally. Omni Suite never downloads an AI model."
        if not active else f"Using local {active} model: {selected or 'default'}",
    }

def _provider():
    s = status()
    if not s["provider"]:
        raise RuntimeError(
            "No local AI provider detected. Start Ollama or LM Studio and load a local model."
        )
    return s["provider"], s["model"]

def _ollama_chat(prompt: str, system: str, model: str, max_tokens: int, temperature: float, images: list[str] | None = None):
    msg: dict[str, Any] = {"role": "user", "content": prompt}
    if images:
        msg["images"] = images
    payload = {
        "model": model,
        "messages": ([{"role": "system", "content": system}] if system else []) + [msg],
        "stream": False,
        "options": {"temperature": temperature, "num_predict": max_tokens},
    }
    data = _json_request(OLLAMA_URL + "/api/chat", "POST", payload)
    return str(data.get("message", {}).get("content", "")).strip()

def _lmstudio_chat(prompt: str, system: str, model: str, max_tokens: int, temperature: float, images: list[str] | None = None):
    content: Any = prompt
    if images:
        content = [{"type": "text", "text": prompt}]
        content.extend({"type": "image_url", "image_url": {"url": x}} for x in images)
    messages = ([{"role": "system", "content": system}] if system else []) + [{"role": "user", "content": content}]
    data = _json_request(
        LMSTUDIO_URL + "/v1/chat/completions",
        "POST",
        {"model": model, "messages": messages, "temperature": temperature, "max_tokens": max_tokens, "stream": False},
    )
    return str(data.get("choices", [{}])[0].get("message", {}).get("content", "")).strip()

def chat(prompt: str, system: str = "", model: str | None = None, max_tokens: int = 256,
         temperature: float = 0.2, images: list[str] | None = None):
    provider, detected = _provider()
    selected = model or detected
    if not selected:
        raise RuntimeError("A local AI model is not loaded in the selected provider.")
    if provider == "ollama":
        answer = _ollama_chat(prompt, system, selected, max_tokens, temperature, images)
    else:
        answer = _lmstudio_chat(prompt, system, selected, max_tokens, temperature, images)
    if not answer:
        raise RuntimeError("The local AI provider returned an empty response.")
    return {"ok": True, "provider": provider, "model": selected, "local_only": True, "text": answer}

def embed(texts: list[str], model: str | None = None):
    provider, detected = _provider()
    selected = model or EMBED_MODEL
    if provider == "ollama":
        if not selected:
            # Ollama can use a normal embedding model if explicitly configured.
            raise RuntimeError("Set OMNI_AI_EMBED_MODEL to an Ollama embedding model (for example nomic-embed-text).")
        data = _json_request(OLLAMA_URL + "/api/embed", "POST", {"model": selected, "input": texts})
        vectors = data.get("embeddings") or []
    else:
        if not selected:
            selected = detected
        data = _json_request(LMSTUDIO_URL + "/v1/embeddings", "POST", {"model": selected, "input": texts})
        vectors = [x.get("embedding") for x in data.get("data", [])]
    if not vectors:
        raise RuntimeError("The local AI provider returned no embeddings.")
    return {"ok": True, "provider": provider, "model": selected, "local_only": True, "embeddings": vectors}

def generate(prompt: str, system: str = "", model: str | None = None, max_tokens: int = 256,
             temperature: float = 0.2, images: list[str] | None = None):
    return chat(prompt, system, model, max_tokens, temperature, images)
