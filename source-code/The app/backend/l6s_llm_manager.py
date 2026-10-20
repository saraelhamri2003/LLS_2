import json
import os
import sys
import threading
from datetime import datetime, timedelta, timezone
import urllib.error
import urllib.request

# ---------------------------------------------------------------------------
# Question routing (Gemini). The choice is made with instant rules, never with
# another AI call.
#   Simple questions  -> light model (SIMPLE_MODEL), or the main model with
#                        thinking "low" if routing is switched off.
#   Complex questions -> main model (the one selected in the app) with full
#                        thinking.
# If one model is refused (e.g. daily quota reached), the other one answers.
# ---------------------------------------------------------------------------
COMPLEX_HINTS = (
    # English
    "analy", "strateg", "recommend", "compar", "improve", "reach", "why",
    "plan", "predict", "scenario", "optimi", "priorit", "roadmap", "diagnos",
    "what should", "how can i", "how do i", "how to get", "assess",
    # French
    "analys", "stratég", "recommand", "compar", "amélior", "atteindre",
    "pourquoi", "prédi", "scénario", "priori", "feuille de route",
    "que dois", "comment puis", "comment atteindre", "évalu",
)
SIMPLE_LEVEL = os.getenv("THINKING_LEVEL_SIMPLE", "low")
COMPLEX_LEVEL = os.getenv("THINKING_LEVEL_COMPLEX") or None  # None = model's full default

# Light model for simple questions (own free quota). Set SIMPLE_MODEL= (empty)
# in .env to switch routing off and use thinking levels on one model instead.
SIMPLE_MODEL = os.getenv("SIMPLE_MODEL", "gemini-3.5-flash-lite").strip()
# Fail fast when Google refuses (quota), so the other model can answer instead.
GEMINI_MAX_RETRIES = int(os.getenv("GEMINI_MAX_RETRIES", "1"))


# ---------------------------------------------------------------------------
# Daily usage counter (shown in the app's sidebar). Google's free daily quota
# resets at midnight Pacific time, so the counter uses the Pacific date.
# Limits can be changed in .env, e.g. LLM_DAILY_LIMITS=gemini-3.8-flash=20,gemini-3.5-flash-lite=500
# ---------------------------------------------------------------------------
USAGE_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data", "llm_usage.json")
_usage_lock = threading.Lock()


def _daily_limits():
    raw = os.getenv("LLM_DAILY_LIMITS", "gemini-3.8-flash=20,gemini-3.5-flash-lite=500")
    limits = {}
    for part in raw.split(","):
        if "=" in part:
            name, value = part.split("=", 1)
            try:
                limits[name.strip()] = int(value)
            except ValueError:
                pass
    return limits


def _pacific_today():
    try:
        from zoneinfo import ZoneInfo
        return datetime.now(ZoneInfo("America/Los_Angeles")).date().isoformat()
    except Exception:  # Windows without the tzdata package: use UTC-8
        return (datetime.now(timezone.utc) - timedelta(hours=8)).date().isoformat()


def _read_usage():
    try:
        with open(USAGE_FILE, "r", encoding="utf-8") as handle:
            data = json.load(handle)
    except Exception:
        data = {}
    if data.get("day") != _pacific_today():
        data = {"day": _pacific_today(), "counts": {}}
    data.setdefault("counts", {})
    return data


def record_usage(model_name):
    with _usage_lock:
        data = _read_usage()
        data["counts"][model_name] = data["counts"].get(model_name, 0) + 1
        try:
            with open(USAGE_FILE, "w", encoding="utf-8") as handle:
                json.dump(data, handle)
        except Exception as e:
            print(f"[LLM] could not save usage: {e}", file=sys.stderr)


def get_usage():
    with _usage_lock:
        data = _read_usage()
    limits = _daily_limits()
    names = list(dict.fromkeys(list(limits) + list(data["counts"])))
    return {
        "day": data["day"],
        "resets": "midnight Pacific time",
        "models": [
            {"model": name, "used": data["counts"].get(name, 0), "limit": limits.get(name)}
            for name in names
        ],
    }


def choose_thinking_level(message, uses_scores=False):
    text = (message or "").strip().lower()
    if uses_scores or len(text) > 180 or any(hint in text for hint in COMPLEX_HINTS):
        return COMPLEX_LEVEL
    return SIMPLE_LEVEL


class _OllamaHttpClient:
    def __init__(self, model, base_url, temperature):
        self.model = model
        self.base_url = (base_url or "http://127.0.0.1:11434").rstrip("/")
        self.temperature = temperature

    def invoke(self, prompt):
        payload = {
            "model": self.model,
            "prompt": prompt,
            "stream": False,
        }
        if self.temperature is not None:
            payload["options"] = {"temperature": self.temperature}

        data = json.dumps(payload).encode("utf-8")
        request = urllib.request.Request(
            f"{self.base_url}/api/generate",
            data=data,
            headers={"Content-Type": "application/json"},
            method="POST",
        )

        with urllib.request.urlopen(request, timeout=60) as response:
            body = response.read().decode("utf-8")
        result = json.loads(body)
        if "error" in result:
            raise RuntimeError(result["error"])
        return result.get("response", "")


class LLMManager:
    def __init__(
        self,
        local_model="llama3:8b",
        api_model="gemini-pro",
        temperature=0.3,
        api_key=None,
    ):
        self.local_model = local_model
        self.api_model = api_model
        self.temperature = temperature
        self.api_key = api_key
        self.thinking_level = None  # set per question by process_request

        self._local_llm = self._init_local()
        self._api_llm = self._init_api()
        self._simple_llm = self._init_simple_gemini()

        if self._local_llm:
            self.active = "local"
        elif self._api_llm:
            self.active = "api"
        else:
            self.active = "none"

    def is_available(self):
        return self._local_llm is not None or self._api_llm is not None

    def switch_to_local(self):
        if self._local_llm is None:
            return False
        self.active = "local"
        return True

    def switch_to_api(self):
        if self._api_llm is None:
            return False
        self.active = "api"
        return True

    def get_available_models(self):
        return {
            "local": {"available": self._local_llm is not None, "model": self.local_model},
            "api": {"available": self._api_llm is not None, "model": self.api_model},
            "active": self.active,
        }

    def get_active_model_info(self):
        if self.active == "local":
            return f"local:{self.local_model}"
        if self.active == "api":
            return f"api:{self.api_model}"
        return "none"

    @staticmethod
    def _text_of(result):
        content = getattr(result, "content", result)
        if isinstance(content, list):  # Gemini returns a list of parts
            content = "".join(
                part.get("text", "") if isinstance(part, dict) else str(part)
                for part in content
            )
        return str(content)

    def _is_simple_question(self):
        return bool(SIMPLE_LEVEL) and self.thinking_level == SIMPLE_LEVEL

    def _call_gemini(self, llm, model_name, prompt, thinking_level):
        if thinking_level:
            print(f"[LLM] {model_name} thinking={thinking_level}", file=sys.stderr)
            text = self._text_of(llm.invoke(prompt, thinking_level=thinking_level))
        else:
            print(f"[LLM] {model_name} thinking=default", file=sys.stderr)
            text = self._text_of(llm.invoke(prompt))
        record_usage(model_name)
        return text

    def _invoke_llm(self, llm, prompt):
        uses_gemini = llm is self._api_llm and "gemini" in (self.api_model or "").lower()
        if not uses_gemini:
            result = llm.invoke(prompt) if hasattr(llm, "invoke") else llm(prompt)
            return self._text_of(result)

        main = (self._api_llm, self.api_model, self.thinking_level)
        light = (self._simple_llm, SIMPLE_MODEL, None) if self._simple_llm is not None else None
        if self._is_simple_question() and light:
            attempts = [light, main]
        else:
            attempts = [main] + ([light] if light else [])

        last_error = None
        for client, name, level in attempts:
            try:
                return self._call_gemini(client, name, prompt, level)
            except Exception as e:  # quota reached, model busy...
                print(f"[LLM] {name} failed: {type(e).__name__}: {str(e)[:200]}", file=sys.stderr)
                last_error = e
        raise last_error

    def invoke(self, prompt):
        if self.active == "local":
            candidates = [("local", self._local_llm), ("api", self._api_llm)]
        elif self.active == "api":
            candidates = [("api", self._api_llm), ("local", self._local_llm)]
        else:
            candidates = [("local", self._local_llm), ("api", self._api_llm)]

        for name, llm in candidates:
            if llm is None:
                continue
            try:
                result_text = self._invoke_llm(llm, prompt)
                if name != self.active:
                    self.active = name
                return result_text
            except Exception:
                continue

        return self._fallback_response()

    def invoke_api_only(self, prompt):
        if self._api_llm is None:
            raise RuntimeError("API model is not available.")
        result_text = self._invoke_llm(self._api_llm, prompt)
        self.active = "api"
        return result_text

    def invoke_local_only(self, prompt):
        if self._local_llm is None:
            raise RuntimeError("Local model is not available.")
        result_text = self._invoke_llm(self._local_llm, prompt)
        self.active = "local"
        return result_text

    def _init_local(self):
        base_url = os.getenv("OLLAMA_BASE_URL", "http://127.0.0.1:11434").rstrip("/")
        kwargs = {"model": self.local_model, "temperature": self.temperature}
        if base_url:
            kwargs["base_url"] = base_url

        try:
            from langchain_community.llms import Ollama
            return Ollama(**kwargs)
        except Exception:
            return _OllamaHttpClient(self.local_model, base_url, self.temperature)

    def _init_api(self):
        api_model_lower = (self.api_model or "").lower()
        api_key = self.api_key

        if "gemini" in api_model_lower:
            try:
                from langchain_google_genai import ChatGoogleGenerativeAI
            except Exception:
                return None
            key = api_key or os.getenv("GOOGLE_API_KEY")
            try:
                return ChatGoogleGenerativeAI(
                    model=self.api_model,
                    temperature=self.temperature,
                    google_api_key=key,
                    max_retries=GEMINI_MAX_RETRIES,
                )
            except Exception:
                return None

        if "claude" in api_model_lower:
            try:
                from langchain_anthropic import ChatAnthropic
            except Exception:
                return None
            key = api_key or os.getenv("ANTHROPIC_API_KEY")
            try:
                return ChatAnthropic(
                    model=self.api_model,
                    temperature=self.temperature,
                    api_key=key,
                )
            except Exception:
                return None

        if any(token in api_model_lower for token in ("gpt", "openai", "codex", "vision", "audio")):
            try:
                from langchain_openai import ChatOpenAI
            except Exception:
                return None
            key = api_key or os.getenv("OPENAI_API_KEY")
            try:
                return ChatOpenAI(
                    model=self.api_model,
                    temperature=self.temperature,
                    api_key=key,
                )
            except Exception:
                return None

        return None

    def _init_simple_gemini(self):
        """Second Gemini client for simple questions (only when the main model is Gemini)."""
        if not SIMPLE_MODEL or self._api_llm is None:
            return None
        if "gemini" not in (self.api_model or "").lower() or SIMPLE_MODEL == self.api_model:
            return None
        try:
            from langchain_google_genai import ChatGoogleGenerativeAI
            return ChatGoogleGenerativeAI(
                model=SIMPLE_MODEL,
                temperature=self.temperature,
                google_api_key=self.api_key or os.getenv("GOOGLE_API_KEY"),
                max_retries=GEMINI_MAX_RETRIES,
            )
        except Exception:
            return None

    def _fallback_response(self):
        return (
            "LLM is not configured. Provide CSF values for predictions, or configure "
            "OLLAMA_BASE_URL or an API key for a supported model."
        )
