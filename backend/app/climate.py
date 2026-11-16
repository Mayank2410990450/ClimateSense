from __future__ import annotations

import io
import math
from dataclasses import dataclass
from typing import Any

import numpy as np
import pandas as pd
from sklearn.ensemble import IsolationForest, RandomForestRegressor
from sklearn.metrics import mean_absolute_error, mean_squared_error
from statsmodels.tsa.statespace.sarimax import SARIMAX

try:
    from xgboost import XGBRegressor
except ImportError:  # The API reports XGBoost as unavailable if its optional wheel cannot load.
    XGBRegressor = None


@dataclass
class ClimateDataset:
    frame: pd.DataFrame
    name: str
    source: str
    provenance: str


def parse_csv(content: bytes, filename: str, unit: str = "C", source_name: str = "User upload") -> tuple[ClimateDataset, dict[str, Any]]:
    if len(content) > 20 * 1024 * 1024:
        raise ValueError("CSV must be 20 MB or smaller")
    try:
        raw = pd.read_csv(io.BytesIO(content))
    except Exception as exc:
        raise ValueError(f"Could not read CSV: {exc}") from exc
    if raw.empty:
        raise ValueError("CSV has no observations")

    normalized = {str(column).strip().lower(): column for column in raw.columns}
    date_column = next((normalized[key] for key in ("date", "time", "datetime", "month", "year") if key in normalized), None)
    temp_column = next((normalized[key] for key in ("temperature", "temp", "tavg", "mean temperature", "value") if key in normalized), None)
    location_column = next((normalized[key] for key in ("location", "station", "city", "region") if key in normalized), None)
    if date_column is None or temp_column is None:
        raise ValueError("CSV needs a date/time column and a temperature column (temperature, temp, tavg, or value)")
    unit = unit.upper()
    if unit not in {"C", "F", "K"}:
        raise ValueError("Temperature unit must be C, F, or K")

    frame = pd.DataFrame({
        "date": pd.to_datetime(raw[date_column], errors="coerce", utc=True).dt.tz_localize(None),
        "temperature": pd.to_numeric(raw[temp_column], errors="coerce"),
        "location": raw[location_column].fillna("Unspecified").astype(str) if location_column else "Unspecified",
    })
    invalid_rows = int(frame[["date", "temperature"]].isna().any(axis=1).sum())
    frame = frame.dropna(subset=["date", "temperature"])
    if frame.empty:
        raise ValueError("No valid date and temperature observations were found")
    if unit == "F":
        frame["temperature"] = (frame["temperature"] - 32) * 5 / 9
    elif unit == "K":
        frame["temperature"] -= 273.15
    before_duplicates = len(frame)
    frame = frame.drop_duplicates(["date", "location"], keep="last").sort_values("date")
    duplicates = before_duplicates - len(frame)
    frame["date"] = frame["date"].dt.to_period("M").dt.to_timestamp()
    frame = frame.groupby(["date", "location"], as_index=False)["temperature"].mean().sort_values("date")
    source_name = source_name.strip() or "User upload"
    dataset = ClimateDataset(frame=frame.reset_index(drop=True), name=filename, source=source_name, provenance=f"Uploaded file: {filename}; source: {source_name}")
    metadata = {
        "rows": len(frame), "invalid_rows_dropped": invalid_rows, "duplicates_removed": duplicates,
        "unit_converted_from": unit, "unit": "C", "start": frame.date.min().date().isoformat(),
        "end": frame.date.max().date().isoformat(), "locations": sorted(frame.location.unique().tolist()),
    }
    return dataset, metadata


def sample_dataset() -> ClimateDataset:
    dates = pd.date_range("1980-01-01", "2024-12-01", freq="MS")
    rng = np.random.default_rng(42)
    seasonal = 7.2 * np.sin(2 * np.pi * (dates.month - 1) / 12)
    trend = np.arange(len(dates)) * 0.018
    noise = rng.normal(0, 0.42, len(dates))
    values = 14.1 + seasonal + trend + noise
    frame = pd.DataFrame({"date": dates, "temperature": values, "location": "Demo station"})
    return ClimateDataset(frame, "Synthetic monthly demo (not observed climate data)", "Synthetic demo", "Generated locally with a fixed random seed for functionality testing; not a real measurement dataset.")


def series_for(dataset: ClimateDataset, location: str | None = None) -> pd.Series:
    frame = dataset.frame
    if location and location != "All locations":
        frame = frame[frame.location == location]
    if frame.empty:
        raise ValueError("No observations match the selected location")
    series = frame.groupby("date").temperature.mean().sort_index().asfreq("MS")
    if series.notna().sum() < 24:
        raise ValueError("At least 24 valid monthly observations are required")
    return series.interpolate(limit_direction="both")


def metrics(actual: np.ndarray, predicted: np.ndarray) -> dict[str, float | None]:
    actual, predicted = np.asarray(actual, dtype=float), np.asarray(predicted, dtype=float)
    nonzero = actual != 0
    return {
        "mae": float(mean_absolute_error(actual, predicted)),
        "rmse": float(math.sqrt(mean_squared_error(actual, predicted))),
        "mape": float(np.mean(np.abs((actual[nonzero] - predicted[nonzero]) / actual[nonzero])) * 100) if nonzero.any() else None,
    }


def tree_features(history: list[float], date: pd.Timestamp) -> list[float]:
    values = np.asarray(history, dtype=float)
    return [float(values[-lag]) for lag in (1, 2, 3, 6, 12)] + [
        float(np.mean(values[-3:])), float(np.mean(values[-12:])),
        math.sin(2 * math.pi * date.month / 12), math.cos(2 * math.pi * date.month / 12),
    ]


def tree_training(series: pd.Series) -> tuple[np.ndarray, np.ndarray, list[int]]:
    features, targets, indices = [], [], []
    values = series.to_numpy(dtype=float)
    for index in range(12, len(values)):
        features.append(tree_features(values[:index].tolist(), series.index[index]))
        targets.append(values[index])
        indices.append(index)
    return np.asarray(features), np.asarray(targets), indices


def compare_forecasts(dataset: ClimateDataset, horizon: int = 12, test_months: int = 24, location: str | None = None, order: tuple[int, int, int] = (1, 1, 1), seasonal_period: int | None = None) -> dict[str, Any]:
    if not 1 <= horizon <= 60 or not 6 <= test_months <= 60:
        raise ValueError("Horizon must be 1-60 months and evaluation period 6-60 months")
    if seasonal_period not in (None, 12):
        raise ValueError("Seasonal period must be disabled or 12 months")
    series = series_for(dataset, location)
    if len(series) <= test_months + 18:
        raise ValueError("Dataset is too short for the selected evaluation period")
    split = len(series) - test_months
    train, test = series.iloc[:split], series.iloc[split:]
    results: list[dict[str, Any]] = []

    try:
        seasonal_order = (1, 0, 1, 12) if seasonal_period else (0, 0, 0, 0)
        arima = SARIMAX(train, order=order, seasonal_order=seasonal_order, enforce_stationarity=False, enforce_invertibility=False).fit(disp=False)
        test_prediction = arima.forecast(test_months).to_numpy()
        full_arima = SARIMAX(series, order=order, seasonal_order=seasonal_order, enforce_stationarity=False, enforce_invertibility=False).fit(disp=False)
        future = full_arima.forecast(horizon).to_numpy()
        results.append({"model": "SARIMA" if seasonal_period else "ARIMA", "metrics": metrics(test.to_numpy(), test_prediction), "evaluation": list(zip(test.index.strftime("%Y-%m-%d"), test.to_numpy().round(3), np.asarray(test_prediction).round(3))), "forecast": list(zip(pd.date_range(series.index[-1] + pd.offsets.MonthBegin(), periods=horizon, freq="MS").strftime("%Y-%m-%d"), np.asarray(future).round(3))), "feature_importance": []})
    except Exception as exc:
        results.append({"model": "ARIMA", "error": str(exc)})

    x, y, indices = tree_training(series)
    train_count = sum(index < split for index in indices)
    if train_count < 6:
        raise ValueError("Not enough training observations after lag feature construction")
    for name in ("Random Forest", "XGBoost"):
        if name == "XGBoost" and XGBRegressor is None:
            results.append({"model": name, "error": "XGBoost is not installed. Install backend requirements to enable it."})
            continue
        model = RandomForestRegressor(n_estimators=240, min_samples_leaf=2, random_state=42, n_jobs=-1) if name == "Random Forest" else XGBRegressor(n_estimators=240, max_depth=3, learning_rate=0.035, subsample=0.9, colsample_bytree=0.9, objective="reg:squarederror", random_state=42, n_jobs=4)
        model.fit(x[:train_count], y[:train_count])
        history = train.to_list()
        test_predictions = []
        for date in test.index:
            prediction = float(model.predict([tree_features(history, date)])[0])
            test_predictions.append(prediction)
            history.append(prediction)
        future_predictions = []
        for date in pd.date_range(series.index[-1] + pd.offsets.MonthBegin(), periods=horizon, freq="MS"):
            prediction = float(model.predict([tree_features(history, date)])[0])
            future_predictions.append(prediction)
            history.append(prediction)
        feature_names = ["lag 1", "lag 2", "lag 3", "lag 6", "lag 12", "3-month mean", "12-month mean", "month sin", "month cos"]
        importance = sorted(zip(feature_names, model.feature_importances_.tolist()), key=lambda pair: pair[1], reverse=True)
        results.append({"model": name, "metrics": metrics(test.to_numpy(), np.asarray(test_predictions)), "evaluation": list(zip(test.index.strftime("%Y-%m-%d"), test.to_numpy().round(3), np.asarray(test_predictions).round(3))), "forecast": list(zip(pd.date_range(series.index[-1] + pd.offsets.MonthBegin(), periods=horizon, freq="MS").strftime("%Y-%m-%d"), np.asarray(future_predictions).round(3))), "feature_importance": [{"feature": key, "importance": round(value, 4)} for key, value in importance]})
    return {"dataset": dataset.name, "location": location or "All locations", "evaluation_start": test.index.min().date().isoformat(), "evaluation_end": test.index.max().date().isoformat(), "train_end": train.index.max().date().isoformat(), "horizon_months": horizon, "seasonal_period": seasonal_period, "models": results, "metric_notes": "Metrics are computed from recursive, chronological holdout predictions. MAPE is omitted only when every actual is zero."}


def detect_anomalies(dataset: ClimateDataset, location: str | None = None) -> dict[str, Any]:
    series = series_for(dataset, location)
    baseline = series.groupby(series.index.month).transform(lambda values: values.shift(1).rolling(10, min_periods=3).mean())
    residual = series - baseline
    scale = float(residual.dropna().std(ddof=0))
    z_scores = residual / scale if scale > 0 else residual * 0
    features = pd.DataFrame({"temperature": series, "residual": residual}).dropna()
    detector = IsolationForest(contamination="auto", random_state=42)
    labels = pd.Series(detector.fit_predict(features), index=features.index)
    records = []
    for date in features.index:
        difference = float(residual.loc[date])
        z_score = float(z_scores.loc[date]) if pd.notna(z_scores.loc[date]) else 0.0
        methods = []
        if abs(difference) >= 2.0:
            methods.append("Statistical threshold (2.0 C from trailing baseline)")
        if abs(z_score) >= 3.0:
            methods.append("Residual z-score (|z| >= 3)")
        if labels.loc[date] == -1:
            methods.append("Isolation Forest")
        if not methods:
            continue
        magnitude = abs(difference)
        records.append({"date": date.strftime("%Y-%m-%d"), "observed_c": round(float(series.loc[date]), 3), "baseline_c": round(float(baseline.loc[date]), 3), "difference_c": round(difference, 3), "z_score": round(z_score, 2), "direction": "Above baseline" if difference > 0 else "Below baseline", "severity": "High" if magnitude >= 4 else "Moderate" if magnitude >= 2 else "Low", "methods": methods, "explanation": f"{abs(difference):.1f} C {('above' if difference > 0 else 'below')} the same-calendar-month historical baseline; this is a statistical outlier, not climate-change attribution."})
    return {"dataset": dataset.name, "location": location or "All locations", "baseline": "Mean of up to 10 preceding observations from the same calendar month; minimum 3 prior years", "anomaly_thresholds": {"moderate_difference_c": 2, "high_difference_c": 4, "z_score_absolute": 3}, "count": len(records), "anomalies": records}


def to_json_records(frame: pd.DataFrame) -> list[dict[str, Any]]:
    view = frame.copy()
    view["date"] = view.date.dt.strftime("%Y-%m-%d")
    return view.to_dict(orient="records")