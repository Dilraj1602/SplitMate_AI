import logging
import json
from datetime import UTC, datetime
from uuid import UUID

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile, status
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session
from starlette.concurrency import run_in_threadpool

from backend.app.dependencies import get_current_user, get_db
from backend.app.models import AIConversation, AIMessage, AIPendingAction, User
from backend.app.services.ai import build_graph, check_ollama, execute_pending, transcribe_audio

router = APIRouter(prefix="/ai", tags=["AI assistant"])
log = logging.getLogger(__name__)


class ChatRequest(BaseModel):
    message: str = Field(min_length=1, max_length=4000)
    conversation_id: UUID | None = None


@router.post("/voice/transcribe")
async def voice_transcribe(file: UploadFile = File(...), _user: User = Depends(get_current_user)):
    allowed = {"audio/wav", "audio/x-wav", "audio/mpeg", "audio/mp4", "audio/webm", "audio/ogg", "audio/aac", "audio/flac"}
    if (file.content_type or "").split(";", 1)[0].strip().lower() not in allowed:
        raise HTTPException(status.HTTP_415_UNSUPPORTED_MEDIA_TYPE, "Upload a WAV, MP3, MP4, WebM, OGG, AAC, or FLAC recording.")
    audio = await file.read(25 * 1024 * 1024 + 1)
    if not audio:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "The audio recording is empty.")
    if len(audio) > 25 * 1024 * 1024:
        raise HTTPException(status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, "The recording must be 25 MB or smaller.")
    try:
        result = await run_in_threadpool(transcribe_audio, audio)
        return {"data": result}
    except ValueError as exc:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, str(exc)) from exc
    except Exception as exc:
        log.warning("Local voice transcription failed for user %s: %s", _user.id, type(exc).__name__)
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, "Local transcription is unavailable. Check the Whisper model setup and try again.") from exc


@router.get("/status")
def status_check(_user: User = Depends(get_current_user)):
    return {"data": check_ollama()}


@router.post("/chat")
def chat(payload: ChatRequest, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    conversation = db.get(AIConversation, payload.conversation_id) if payload.conversation_id else None
    if payload.conversation_id and (not conversation or conversation.user_id != user.id):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Conversation not found.")
    if not conversation:
        conversation = AIConversation(user_id=user.id, title=payload.message.strip()[:120] or "New conversation", context="{}")
        db.add(conversation); db.commit(); db.refresh(conversation)
    history_rows = db.scalars(select(AIMessage).where(AIMessage.conversation_id == conversation.id).order_by(AIMessage.created_at.desc()).limit(8)).all()
    history = [{"role": row.role, "content": row.content} for row in reversed(history_rows)]
    try: clarification_context = json.loads(conversation.context or "{}")
    except (TypeError, json.JSONDecodeError): clarification_context = {}
    db.add(AIMessage(conversation_id=conversation.id, role="user", content=payload.message.strip()))
    db.commit()
    try:
        output = build_graph(db, history, conversation.id, clarification_context).invoke({"user_text": payload.message.strip(), "authenticated_user_id": str(user.id)})
        response = output["response"]
        db.add(AIMessage(conversation_id=conversation.id, role="assistant", content=json.dumps(response, ensure_ascii=False)))
        conversation.context = json.dumps({
            "last_intent": response.get("intent") if response.get("missing_fields") else None,
            "missing_fields": response.get("missing_fields", []),
            "last_arguments": output.get("parsed") if response.get("missing_fields") else None,
        })
        conversation.updated_at = datetime.now(UTC)
        db.commit()
        return {"data": {**response, "conversation_id": str(conversation.id)}}
    except Exception as exc:
        db.rollback()
        db.add(AIMessage(conversation_id=conversation.id, role="assistant", content=json.dumps({"message": "Local AI is unavailable or could not understand that request."})))
        db.commit()
        log.warning("AI request failed for user %s: %s", user.id, type(exc).__name__)
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, "Local AI is unavailable or could not understand that request. Please try again shortly.") from exc


@router.get("/conversations")
def list_conversations(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    rows = db.scalars(select(AIConversation).where(AIConversation.user_id == user.id).order_by(AIConversation.updated_at.desc()).limit(50)).all()
    return {"data": [{"id": str(item.id), "title": item.title, "updated_at": item.updated_at.isoformat()} for item in rows]}


@router.get("/conversations/{conversation_id}")
def get_conversation(conversation_id: UUID, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    conversation = db.scalar(select(AIConversation).where(AIConversation.id == conversation_id, AIConversation.user_id == user.id))
    if not conversation: raise HTTPException(status.HTTP_404_NOT_FOUND, "Conversation not found.")
    messages = db.scalars(select(AIMessage).where(AIMessage.conversation_id == conversation.id).order_by(AIMessage.created_at)).all()
    actions = db.scalars(select(AIPendingAction).where(AIPendingAction.conversation_id == conversation.id, AIPendingAction.user_id == user.id)).all()
    return {"data": {"id": str(conversation.id), "title": conversation.title,
        "messages": [{"role": m.role, "content": m.content, "created_at": m.created_at.isoformat()} for m in messages],
        "actions": [{"id": str(action.id), "status": action.status} for action in actions]}}


@router.post("/actions/{action_id}/confirm")
def confirm(action_id: UUID, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    try:
        result = execute_pending(db, action_id=action_id, user_id=user.id)
        action = db.get(AIPendingAction, action_id)
        if action and action.conversation_id:
            db.add(AIMessage(conversation_id=action.conversation_id, role="assistant", content=json.dumps({"message": "Confirmed action result.", "execution_result": result})))
            db.commit()
        return {"data": result}
    except ValueError as exc:
        if str(exc) == "Pending action not found.":
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Pending action not found.") from exc
        raise HTTPException(status.HTTP_409_CONFLICT, str(exc)) from exc
    except Exception as exc:
        db.rollback()
        log.exception("AI action confirmation failed for user %s", user.id)
        raise HTTPException(status.HTTP_409_CONFLICT, "The action could not be completed. Review the details and try again.") from exc


@router.post("/actions/{action_id}/cancel")
def cancel(action_id: UUID, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    action = db.scalar(select(AIPendingAction).where(AIPendingAction.id == action_id, AIPendingAction.user_id == user.id))
    if not action: raise HTTPException(status.HTTP_404_NOT_FOUND, "Pending action not found.")
    if action.status == "pending":
        action.status = "cancelled"
        if action.conversation_id:
            db.add(AIMessage(conversation_id=action.conversation_id, role="assistant", content=json.dumps({"message": "The pending action was cancelled."})))
        db.commit()
    return {"data": {"status": action.status}}
