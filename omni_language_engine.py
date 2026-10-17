"""Omni Language Engine — isolated multilingual model runtime.

This module is separate from the Omni Assistant/RAG stack.
It owns translation and transliteration models only.
It performs no network access at inference time.
"""
from __future__ import annotations
import os
import re
import threading
from pathlib import Path

ROOT = Path(__file__).resolve().parent
MODEL_ROOT = Path(os.environ.get("OMNI_LANGUAGE_MODEL_ROOT", ROOT / "language-models"))
LANGUAGE_CONFIG = {
    "translation": {
        "en_indic": os.environ.get("OMNI_IT2_EN_INDIC_MODEL", str(MODEL_ROOT / "indictrans2-en-indic-dist-200M")),
        "indic_en": os.environ.get("OMNI_IT2_INDIC_EN_MODEL", str(MODEL_ROOT / "indictrans2-indic-en-dist-200M")),
        "indic_indic": os.environ.get("OMNI_IT2_INDIC_INDIC_MODEL", str(MODEL_ROOT / "indictrans2-indic-indic-dist-320M")),
    },
    "transliteration": {
        "root": os.environ.get("OMNI_INDICXLIT_MODEL_ROOT", str(MODEL_ROOT / "indicxlit")),
    },
}
INDIC_TAGS = {
    "asm":"asm_Beng","bn":"ben_Beng","brx":"brx_Deva","doi":"doi_Deva",
    "en":"eng_Latn","eng":"eng_Latn","gu":"guj_Gujr","hi":"hin_Deva",
    "kn":"kan_Knda","gom":"gom_Deva","mai":"mai_Deva","ml":"mal_Mlym",
    "mr":"mar_Deva","mni":"mni_Mtei","ne":"npi_Deva","npi":"npi_Deva",
    "or":"ory_Orya","ori":"ory_Orya","pa":"pan_Guru","pan":"pan_Guru",
    "sa":"san_Deva","san":"san_Deva","sat":"sat_Olck","si":"sin_Sinh",
    "sd":"snd_Arab","ta":"tam_Taml","te":"tel_Telu","ur":"urd_Arab",
    "urd":"urd_Arab","kas":"kas_Arab","ks":"kas_Arab","snd":"snd_Arab",
    "as":"asm_Beng"
}
_lock = threading.RLock()
_translation_cache = {}
_xlit_cache = {}

def _norm(code): return str(code or "").strip().replace("-", "_").lower()
def _tag(code):
    value = _norm(code)
    if value in INDIC_TAGS: return INDIC_TAGS[value]
    if "_" in value: return value
    raise ValueError("Unsupported IndicTrans2 language code: " + str(code))
def _exists(path):
    p = Path(path)
    return p.exists() and any(p.iterdir())

def _route(source, target):
    src, tgt = _tag(source), _tag(target)
    if src == tgt: return "identity", ""
    if src == "eng_Latn": return "en_indic", tgt
    if tgt == "eng_Latn": return "indic_en", src
    return "indic_indic", tgt

def _load_translation(route):
    with _lock:
        if route in _translation_cache: return _translation_cache[route]
        try:
            import torch
            from transformers import AutoModelForSeq2SeqLM, AutoTokenizer
        except Exception as exc:
            raise RuntimeError("Omni Language Engine translation dependencies are missing. Install requirements-language.txt.") from exc
        path = LANGUAGE_CONFIG["translation"][route]
        if not _exists(path):
            raise RuntimeError("Omni Language Engine model is not installed: " + path)
        tokenizer = AutoTokenizer.from_pretrained(path, trust_remote_code=True, local_files_only=True)
        model = AutoModelForSeq2SeqLM.from_pretrained(path, trust_remote_code=True, local_files_only=True)
        device = "cuda" if torch.cuda.is_available() else "cpu"
        model = model.to(device).eval()
        _translation_cache[route] = (tokenizer, model, device)
        return _translation_cache[route]

_SENTENCE_END = re.compile(r"(?<=[.!?\u0964\u0965\u06d4])\s+")

def _segments(paragraph, limit=400):
    """Split one paragraph into sentence-sized pieces (IndicTrans2 truncates at 256 tokens)."""
    out, current = [], ""
    for sentence in _SENTENCE_END.split(paragraph):
        while len(sentence) > limit:
            cut = sentence.rfind(" ", 0, limit)
            if cut < limit // 2: cut = limit
            if current.strip(): out.append(current.strip()); current = ""
            out.append(sentence[:cut].strip()); sentence = sentence[cut:]
        if len((current + " " + sentence).strip()) > limit:
            if current.strip(): out.append(current.strip())
            current = sentence
        else:
            current = (current + " " + sentence).strip() if current else sentence
    if current.strip(): out.append(current.strip())
    return [x for x in out if x]

def _translate_indictrans(text, source, target, max_new_tokens=512):
    route, target_tag = _route(source, target)
    if route == "identity": return text
    tokenizer, model, device = _load_translation(route)
    try:
        from IndicTransToolkit.processor import IndicProcessor
    except Exception as exc:
        raise RuntimeError("IndicTransToolkit is missing. Install requirements-language.txt.") from exc
    processor = IndicProcessor(inference=True)
    src_tag = _tag(source)
    paragraphs = str(text).replace("\r", "").split("\n")
    pieces = [(p, seg) for p, para in enumerate(paragraphs) for seg in _segments(para)]
    translated = [""] * len(pieces)
    for start in range(0, len(pieces), 8):
        batch = [seg for _, seg in pieces[start:start + 8]]
        pre = processor.preprocess_batch(batch, src_lang=src_tag, tgt_lang=target_tag)
        inputs = tokenizer(pre, padding="longest", truncation=True, return_tensors="pt").to(device)
        generated = model.generate(**inputs, max_length=max(32, min(int(max_new_tokens), 2048)), num_beams=4, early_stopping=True)
        decoded = tokenizer.batch_decode(generated, skip_special_tokens=True)
        post = processor.postprocess_batch(decoded, lang=target_tag)
        translated[start:start + len(post)] = post
    joined = [[] for _ in paragraphs]
    for (p, _), out in zip(pieces, translated):
        joined[p].append(str(out).strip())
    return "\n".join(" ".join(x) for x in joined).strip()

XLIT_TAGS = {
    "asm":"as", "as":"as", "bn":"bn", "brx":"brx", "gu":"gu", "hi":"hi",
    "kn":"kn", "ks":"ks", "kas":"ks", "gom":"gom", "mai":"mai", "ml":"ml",
    "mni":"mni", "mr":"mr", "ne":"ne", "or":"or", "pa":"pa", "sa":"sa",
    "sd":"sd", "si":"si", "ta":"ta", "te":"te", "ur":"ur"
}

def _load_xlit_native(src):
    key = "indic:" + src
    with _lock:
        if key not in _xlit_cache:
            from ai4bharat.transliteration import XlitEngine
            _xlit_cache[key] = XlitEngine(src_script_type="indic", beam_width=10, rescore=True)
        return _xlit_cache[key]

def _load_xlit_roman():
    with _lock:
        if "roman" not in _xlit_cache:
            from ai4bharat.transliteration import XlitEngine
            _xlit_cache["roman"] = XlitEngine(src_script_type="roman", beam_width=10, rescore=True)
        return _xlit_cache["roman"]

def transliterate(text, source, target="Latn", topk=4):
    value, src, tgt = str(text or "").strip(), _norm(source), _norm(target)
    if not value: raise ValueError("No text was supplied for transliteration.")
    # XlitEngine.translit_sentence() has no top-k option (that is translit_word); topk is accepted for API compatibility.
    if tgt in {"latn","latin","roman","en"}:
        lang = XLIT_TAGS.get(src)
        if not lang:
            raise ValueError("Indic → Roman transliteration needs an Indic source language; choose the language the text is written in.")
        engine = _load_xlit_native(lang)
        out = engine.translit_sentence(value, lang_code=lang)
        return {"text":out, "model":"IndicXlit", "direction":"indic-to-roman"}
    lang = XLIT_TAGS.get(tgt)
    if not lang:
        raise ValueError("Unsupported transliteration target script: " + str(target))
    engine = _load_xlit_roman()
    # Roman → Indic: the output script is the selected *target* language, not the source.
    out = engine.translit_sentence(value, lang_code=lang)
    return {"text":out, "model":"IndicXlit", "direction":"roman-to-indic"}

def translate(text, source, target, max_new_tokens=512):
    value = str(text or "").strip()
    if not value: raise ValueError("No text was supplied for translation.")
    return {"text":_translate_indictrans(value, source, target, max_new_tokens),
            "model":"IndicTrans2","source":_tag(source),"target":_tag(target)}

def capability():
    available = {"translation":[], "transliteration":[]}
    for route, path in LANGUAGE_CONFIG["translation"].items():
        if _exists(path): available["translation"].append(route)
    try:
        import ai4bharat.transliteration  # noqa: F401
        available["transliteration"].append("IndicXlit")
    except Exception:
        pass
    return available

def config():
    return {"engine":"Omni Language Engine","version":"1.0.0",
            "model_root":str(MODEL_ROOT),"models":LANGUAGE_CONFIG,
            "capabilities":capability(),"network_access":False,
            "isolated_from_assistant":True,"isolated_from_rag":True}