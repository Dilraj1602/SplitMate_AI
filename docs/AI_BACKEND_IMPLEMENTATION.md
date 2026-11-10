# AI Backend Implementation

## Modules

- `backend/app/config.py`: environment-backed Ollama and AI settings.
- `backend/app/services/ai.py`: intent-specific Pydantic schemas, LangGraph context/classification/extraction/fulfillment nodes, authorized reads, documentation retrieval, local transcription, preview generation, and confirmed execution.
- `backend/app/api/v1/endpoints/ai.py`: authenticated status, chat, confirmation, and cancellation endpoints.
- `backend/app/models/product.py`: user-scoped pending-action ORM model.
- `backend/migrations/versions/20261110_01_ai_pending_actions.py`: additive schema migration.
- `backend/app/services/settlements.py`: shared settlement proposal and recipient-recorded payment logic used by both API and AI paths.

## Execution

The graph receives user identity only from FastAPI authentication. Structured model output cannot call tools or SQL. Database code scopes groups through active memberships, resolves participants within those groups, and validates with existing schemas and split/balance functions. Expense create, update, and void use shared expense services. Settlement proposals use the same existing debt calculation and pending recipient-confirmation workflow; received payments use a shared service that verifies the debt direction and partial amount. Confirmation rechecks access and state. A unique action idempotency key plus stored result prevents duplicate execution on retries.

## Current scope and follow-ups

The product endpoint file still owns some existing balance and membership helpers; the AI service reuses them. Group/person/expense ambiguity returns clarification choices, and persisted conversation context carries incomplete facts into follow-up messages. RAG uses a small allowlisted local docs corpus and does not index live financial records.
