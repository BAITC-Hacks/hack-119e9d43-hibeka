"""Minimal API entry point."""

from fastapi import FastAPI, HTTPException, Query

from backend.app.analytics.graph import GraphSummary, load_graph_summary
from backend.app.analytics.metrics import ClientMetricsPage, load_client_metrics
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


@app.get("/api/graph/summary", response_model=GraphSummary, tags=["graph"])
def graph_summary() -> GraphSummary:
    try:
        return load_graph_summary()
    except DatasetError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc


@app.get("/api/clients/metrics", response_model=ClientMetricsPage, tags=["clients"])
def client_metrics(
    offset: int = Query(default=0, ge=0),
    limit: int = Query(default=100, ge=1, le=500),
) -> ClientMetricsPage:
    try:
        return load_client_metrics(offset=offset, limit=limit)
    except DatasetError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
