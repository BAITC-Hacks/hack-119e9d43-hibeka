"""Minimal API entry point."""

from fastapi import FastAPI, HTTPException

from backend.app.data import DataSummary, DatasetError, load_summary

app = FastAPI(title="Money Graph API", version="0.1.0")


@app.get("/api/health", tags=["health"])
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/api/data/summary", response_model=DataSummary, tags=["data"])
def data_summary() -> DataSummary:
    try:
        return load_summary()
    except DatasetError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
