# AI API Documentation

All endpoints are under `/api/v1`, require the existing bearer access token, and use the authenticated principal as the only user identity.

## `GET /ai/status`

Returns `{ "data": { "available": boolean, "provider": "ollama", "model": string, "message"?: string } }`.

## `POST /ai/chat`

Request: `{ "message": "Add ₹1,200 for dinner in Goa Trip" }` (1–4000 characters).

Request may include a user-owned `conversation_id` to continue a thread. Response data includes `message`, `intent`, `conversation_id`, optional `missing_fields`, `clarification_options`, and live `data` for read requests. A financial proposal includes `pending_action_id`, `action_preview`, and `confirmation_required: true`. The preview is server calculated and identifies the group, description, amount, currency, payer/recipient, participants and shares or settlement direction.

## Conversations

- `GET /ai/conversations`: recent conversations for the caller.
- `GET /ai/conversations/{conversation_id}`: messages and action status for a conversation owned by the caller.

Conversation and pending-action IDs are always ownership checked.

## `POST /ai/voice/transcribe`

Multipart field `file` with WAV, MP3, MP4, WebM, OGG, AAC, or FLAC (25 MB maximum). Returns transcript text, detected language, and duration. The client must let the user edit the transcript and send it through `/ai/chat`.

## `POST /ai/actions/{action_id}/confirm`

Executes a pending action for its owner and returns `data.status`, verified persisted `data.result`, and `data.duplicate`. Repeating a completed confirmation returns the persisted result without a second expense.

## `POST /ai/actions/{action_id}/cancel`

Cancels a pending action for its owner. Other users receive 404. Expired, cancelled, and executed actions cannot be executed again.

## Errors

401 for missing or invalid authentication; 404 for a conversation/action not owned by the caller; 409 for expired, unauthorized, or invalid action state; 413/415/422 for invalid voice uploads; 503 for local model or transcription failures. Technical exception details are logged server-side and omitted from responses.
