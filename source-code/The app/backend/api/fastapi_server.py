import json
import logging
from contextlib import asynccontextmanager
from typing import Any, Dict, List, Optional

from fastapi import FastAPI, HTTPException
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

from api.l6s_api_optimized import _json_default, get_brain_instance, process_request

logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Load the graph and models once at startup, so the first user does not wait.
    get_brain_instance()
    yield


app = FastAPI(title="L6S Python Engine", lifespan=lifespan)


class ChatRequest(BaseModel):
    message: str
    use_sidebar_values: bool = Field(default=False, alias="useSidebarValues")
    sidebar_scores: Optional[Dict[str, Any]] = Field(default=None, alias="sidebarScores")
    conversation_history: Optional[List[Dict[str, Any]]] = Field(
        default=None, alias="conversationHistory"
    )
    model_configuration: Optional[Dict[str, Any]] = Field(default=None, alias="modelConfig")
    language: Optional[str] = None


@app.get("/health")
def health():
    return {"status": "ok"}


@app.get("/usage")
def usage():
    from l6s_llm_manager import get_usage
    return get_usage()


@app.post("/api/chat")
def chat(request: ChatRequest):
    try:
        # process_request() was written for the command-line version: it expects
        # 'true'/'false' and JSON text, so convert the request to those formats.
        result = process_request(
            request.message,
            "true" if request.use_sidebar_values else "false",
            json.dumps(request.sidebar_scores) if request.sidebar_scores else None,
            json.dumps(request.conversation_history) if request.conversation_history else None,
            request.model_configuration,
            request.language,
        )
        return JSONResponse(content=json.loads(json.dumps(result, default=_json_default)))
    except Exception as error:
        logger.exception("Failed to process chat request")
        raise HTTPException(status_code=500, detail=str(error)) from error
