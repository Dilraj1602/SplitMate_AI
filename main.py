
from fastapi import FastAPI

app = FastAPI(
    title="SplitMate AI",
    description="AI-powered expense-sharing application",
    version="0.1.0",
)


@app.get("/")
def health_check():
    return {
        "status": "healthy",
        "project": "SplitMate AI",
        "message": "API is running successfully",
    }


@app.get("/health")
def health():
    return {"status": "ok"}
