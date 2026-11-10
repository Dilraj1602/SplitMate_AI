# AI Setup and Testing

## Ollama

Install and start Ollama locally, then ensure the configured model exists (default `qwen2.5:7b`). The API defaults to `http://localhost:11434`.

Set these optional values in the root `.env`:

```env
AI_PROVIDER=ollama
OLLAMA_BASE_URL=http://localhost:11434
OLLAMA_MODEL=qwen2.5:7b
AI_TEMPERATURE=0
AI_TIMEOUT_SECONDS=60
AI_MAX_RETRIES=2
WHISPER_MODEL=tiny
```

Apply the migration and start the app using the commands in the root README:

```powershell
uv sync
uv run alembic -c backend/alembic.ini upgrade head
uv run uvicorn backend.app.main:app --reload
cd frontend
npm ci
npm run dev
```

Sign in, open `/app/assistant`, and ask a read question or describe an expense. The assistant displays a proposal; only the explicit Confirm expense button writes the record. Check `GET /api/v1/ai/status` while signed in to diagnose local model availability.

The first voice transcription downloads the configured Faster Whisper model to the local model cache. The default `tiny` model is multilingual and runs on CPU. Its PyAV dependency bundles audio decoding libraries, so a system FFmpeg install is not required. Browser microphone access requires localhost or HTTPS.

## Verification

```powershell
uv run pytest -q
npm --prefix frontend run build
npm --prefix frontend run test
```

The deterministic backend suite does not require a running Ollama service. Live Ollama and Whisper checks are run separately against the configured local services. RAG reads only the allowlisted markdown docs and refreshes its text chunks at request time.
