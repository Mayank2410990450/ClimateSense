from __future__ import annotations

import io
import logging
import os
from datetime import datetime, timezone
from uuid import uuid4

import pandas as pd
from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from .climate import ClimateDataset, compare_forecasts, detect_anomalies, parse_csv, sample_dataset, series_for, to_json_records

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("climatesense")
app = FastAPI(title="ClimateSense API", version="1.0.0", description="Local climate data exploration, forecasting and statistical anomaly analysis.")
allowed_origins = [origin.strip() for origin in os.getenv("CLIMATESENSE_ALLOWED_ORIGINS", "http://localhost:3000,http://127.0.0.1:3000").split(",") if origin.strip()]
app.add_middleware(CORSMiddleware, allow_origins=allowed_origins, allow_credentials=True, allow_methods=["*"], allow_headers=["*"])

datasets: dict[str, tuple[ClimateDataset, dict]] = {}
experiments: list[dict] = []


class ForecastRequest(BaseModel):
    horizon_months: int = Field(default=12, ge=1, le=60)
    test_months: int = Field(default=24, ge=6, le=60)
    location: str | None = None
    arima_order: tuple[int, int, int] = (1, 1, 1)
    seasonal_period: int | None = Field(default=None, description="Use 12 for monthly SARIMA; omit for nonseasonal ARIMA")


class ExperimentRequest(BaseModel):
    dataset_id: str
    configuration: dict
    results: dict


class ReportRequest(BaseModel):
    dataset_name: str
    forecast: dict | None = None
    anomalies: dict | None = None


def get_dataset(dataset_id: str) -> tuple[ClimateDataset, dict]:
    try:
        return datasets[dataset_id]
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="Dataset not found. Upload a CSV or load the labeled demo dataset.") from exc


@app.get("/api/health")
def health() -> dict:
    return {"status": "ok", "service": "ClimateSense API", "storage": "in-memory for this local process"}


@app.post("/api/datasets/demo")
def load_demo() -> dict:
    dataset = sample_dataset()
    dataset_id = str(uuid4())
    metadata = {"rows": len(dataset.frame), "invalid_rows_dropped": 0, "duplicates_removed": 0, "unit_converted_from": "C", "unit": "C", "start": dataset.frame.date.min().date().isoformat(), "end": dataset.frame.date.max().date().isoformat(), "locations": ["Demo station"]}
    datasets[dataset_id] = (dataset, metadata)
    return {"id": dataset_id, "name": dataset.name, "source": dataset.source, "provenance": dataset.provenance, **metadata}


@app.post("/api/datasets/upload")
async def upload_dataset(file: UploadFile = File(...), unit: str = Form("C"), source_name: str = Form("User upload")) -> dict:
    if not file.filename or not file.filename.lower().endswith(".csv"):
        raise HTTPException(status_code=400, detail="Upload a .csv file")
    try:
        dataset, metadata = parse_csv(await file.read(), file.filename, unit, source_name)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    dataset_id = str(uuid4())
    datasets[dataset_id] = (dataset, metadata)
    logger.info("Loaded dataset %s (%s rows)", file.filename, metadata["rows"])
    return {"id": dataset_id, "name": dataset.name, "source": dataset.source, "provenance": dataset.provenance, **metadata}


@app.get("/api/datasets")
def list_datasets() -> list[dict]:
    return [{"id": key, "name": dataset.name, "source": dataset.source, **metadata} for key, (dataset, metadata) in datasets.items()]


@app.get("/api/datasets/{dataset_id}/explore")
def explore_dataset(dataset_id: str, location: str | None = None) -> dict:
    dataset, metadata = get_dataset(dataset_id)
    try:
        series = series_for(dataset, location)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    frame = dataset.frame
    if location and location != "All locations":
        frame = frame[frame.location == location]
    monthly = frame.groupby(frame.date.dt.month).temperature.mean().round(3)
    return {"dataset": dataset.name, "provenance": dataset.provenance, "metadata": metadata, "locations": metadata["locations"], "observations": to_json_records(frame.sort_values("date")), "monthly_climatology": [{"month": int(month), "temperature_c": float(value)} for month, value in monthly.items()], "summary": {"mean_c": round(float(series.mean()), 3), "min_c": round(float(series.min()), 3), "max_c": round(float(series.max()), 3), "latest_c": round(float(series.iloc[-1]), 3), "latest_date": series.index[-1].date().isoformat(), "trend_c_per_decade": round(float(series.diff().mean() * 120), 3)}}


@app.post("/api/datasets/{dataset_id}/compare")
def compare(dataset_id: str, request: ForecastRequest) -> dict:
    dataset, _ = get_dataset(dataset_id)
    try:
        result = compare_forecasts(dataset, request.horizon_months, request.test_months, request.location, request.arima_order, request.seasonal_period)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except Exception:
        logger.exception("Forecast comparison failed for %s", dataset_id)
        raise HTTPException(status_code=500, detail="Forecast comparison failed. Review server logs for details.")
    experiment = {"id": str(uuid4()), "created_at": datetime.now(timezone.utc).isoformat(), "dataset_id": dataset_id, "dataset_name": dataset.name, "configuration": request.model_dump(), "results": result}
    experiments.append(experiment)
    return result


@app.get("/api/datasets/{dataset_id}/anomalies")
def anomalies(dataset_id: str, location: str | None = None) -> dict:
    dataset, _ = get_dataset(dataset_id)
    try:
        return detect_anomalies(dataset, location)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@app.get("/api/experiments")
def list_experiments() -> list[dict]:
    return list(reversed(experiments))


@app.post("/api/experiments")
def save_experiment(request: ExperimentRequest) -> dict:
    dataset, _ = get_dataset(request.dataset_id)
    experiment = {"id": str(uuid4()), "created_at": datetime.now(timezone.utc).isoformat(), "dataset_id": request.dataset_id, "dataset_name": dataset.name, "configuration": request.configuration, "results": request.results}
    experiments.append(experiment)
    return experiment


@app.post("/api/report.csv")
def report_csv(request: ReportRequest) -> StreamingResponse:
    rows = []
    if request.forecast:
        for model in request.forecast.get("models", []):
            if model.get("metrics"):
                rows.append({"section": "metrics", "dataset": request.dataset_name, "model": model.get("model"), "date": "", "actual_c": "", "predicted_c": "", "observed_c": "", "baseline_c": "", "difference_c": "", "severity": "", "mae_c": model["metrics"].get("mae"), "rmse_c": model["metrics"].get("rmse"), "mape_pct": model["metrics"].get("mape")})
            for entry in model.get("evaluation", []):
                rows.append({"section": "evaluation", "dataset": request.dataset_name, "model": model.get("model"), "date": entry[0], "actual_c": entry[1], "predicted_c": entry[2], "observed_c": "", "baseline_c": "", "difference_c": "", "severity": "", "mae_c": "", "rmse_c": "", "mape_pct": ""})
            for date, prediction in model.get("forecast", []):
                rows.append({"section": "forecast", "dataset": request.dataset_name, "model": model.get("model"), "date": date, "actual_c": "", "predicted_c": prediction, "observed_c": "", "baseline_c": "", "difference_c": "", "severity": "", "mae_c": "", "rmse_c": "", "mape_pct": ""})
    if request.anomalies:
        for anomaly in request.anomalies.get("anomalies", []):
            rows.append({"section": "anomaly", "dataset": request.dataset_name, "model": "; ".join(anomaly.get("methods", [])), "date": anomaly.get("date"), "actual_c": "", "predicted_c": "", "observed_c": anomaly.get("observed_c"), "baseline_c": anomaly.get("baseline_c"), "difference_c": anomaly.get("difference_c"), "severity": anomaly.get("severity"), "mae_c": "", "rmse_c": "", "mape_pct": ""})
    output = io.StringIO()
    columns = ["section", "dataset", "model", "date", "actual_c", "predicted_c", "observed_c", "baseline_c", "difference_c", "severity", "mae_c", "rmse_c", "mape_pct"]
    pd.DataFrame(rows, columns=columns).to_csv(output, index=False)
    return StreamingResponse(iter([output.getvalue()]), media_type="text/csv", headers={"Content-Disposition": 'attachment; filename="climatesense-report.csv"'})