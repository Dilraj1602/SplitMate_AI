# AI Architecture

## Workflow

The authenticated React assistant sends typed text or an editable local voice transcription to `POST /api/v1/ai/chat`. FastAPI resolves the caller from the existing bearer token. LangGraph nodes resolve user context, classify intent, extract intent-specific Pydantic arguments through LangChain `ChatOllama`, and fulfill the request through authorized database services. Identity never comes from model output.

Supported intents include expense create/update/void, settlement create/record-received, group and personal balances, recent expenses, help retrieval, clarification, and unsupported actions. Live financial information comes from SQL queries scoped by active membership. The model does not generate SQL or call arbitrary tools.

## Financial actions

Groups, members, expenses, and settlement relationships are resolved against caller-authorized database rows. The app’s existing split calculations, expense persistence, update/void services, settlement proposal rules, balance calculations, and recipient confirmation workflow are reused. Received payments can be recorded by the recipient after explicit preview confirmation and outstanding-balance validation. All mutations first create a ten-minute user-owned pending action. The backend-calculated preview is persisted. Confirmation revalidates access and business rules and is idempotent; cancellation is owner-scoped.

## Model and resilience

`AI_PROVIDER`, Ollama URL/model, temperature, timeout, retries, and `WHISPER_MODEL` are configurable. Ollama uses structured output rather than native tool calling. `/api/v1/ai/status` checks live inference. The non-AI application remains available if Ollama is down; AI routes return a safe availability error.

## Conversation and clarification state

Conversations and messages are stored with owner foreign keys. The graph receives only a short recent window plus the persisted last clarification draft. Pending actions are stored separately, expire, and cannot be accessed by another user. The model can carry forward a draft when the user answers a clarification; server-side merge retains previously validated explicit facts if extraction omits them.

## Voice

`POST /api/v1/ai/voice/transcribe` uses Faster Whisper on CPU with the configured local Whisper model. Audio is capped at 25 MB. The UI shows recording state and places the transcript in the editable message field. Typed and transcribed messages use the same LangGraph workflow; transcription never executes a financial operation.

## RAG

Help and product questions use a small allowlisted corpus of project documentation. Documents are chunked by paragraph and ranked locally by lexical term overlap, then relevant excerpts are passed to Ollama for a source-cited answer. The corpus refreshes from disk on each retrieval, so updates need no vector-index migration. Live expenses, balances, and settlements bypass RAG and use authorized SQL. No vector database or embeddings are needed for this small corpus.
