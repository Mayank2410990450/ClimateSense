import numpy as np
import pandas as pd
import pytest

from app.climate import ClimateDataset, compare_forecasts, detect_anomalies, metrics, parse_csv, sample_dataset, series_for


def test_csv_parsing_converts_units_drops_bad_rows_and_duplicates():
    content = b"date,temp,location\n2020-01-01,32,A\n2020-01-01,32,A\n2020-02-01,50,A\ninvalid,22,A\n"
    dataset, metadata = parse_csv(content, "test.csv", "F")
    assert dataset.frame.temperature.tolist() == pytest.approx([0, 10])
    assert metadata["duplicates_removed"] == 1
    assert metadata["invalid_rows_dropped"] == 1


def test_csv_parser_rejects_missing_required_columns():
    with pytest.raises(ValueError, match="date/time"):
        parse_csv(b"humidity\n20\n", "bad.csv")


def test_metrics_calculate_actual_outputs():
    result = metrics(np.array([1.0, 2.0]), np.array([2.0, 2.0]))
    assert result["mae"] == pytest.approx(0.5)
    assert result["rmse"] == pytest.approx(2**-0.5)
    assert result["mape"] == pytest.approx(50)


def test_sample_is_explicitly_synthetic_and_forecasts_chronologically():
    dataset = sample_dataset()
    assert "Synthetic" in dataset.source
    result = compare_forecasts(dataset, horizon=3, test_months=12)
    assert result["train_end"] < result["evaluation_start"]
    assert all("metrics" in model or "error" in model for model in result["models"])
    assert all(len(model.get("forecast", [])) == 3 for model in result["models"] if "metrics" in model)


def test_anomaly_detection_returns_explanatory_records():
    dataset = sample_dataset()
    frame = dataset.frame.copy()
    frame.loc[frame.index[-1], "temperature"] += 9
    altered = ClimateDataset(frame, "test", "test", "test")
    result = detect_anomalies(altered)
    assert result["count"] > 0
    assert "statistical outlier" in result["anomalies"][-1]["explanation"]
    assert result["anomaly_thresholds"]["high_difference_c"] == 4


def test_anomaly_baseline_controls_for_month_of_year_seasonality():
    result = detect_anomalies(sample_dataset())
    assert "same calendar month" in result["baseline"]
    assert not any(anomaly["severity"] == "High" for anomaly in result["anomalies"])


def test_series_rejects_insufficient_history():
    dataset = ClimateDataset(pd.DataFrame({"date": pd.date_range("2020-01-01", periods=12, freq="MS"), "temperature": range(12), "location": "X"}), "short", "test", "test")
    with pytest.raises(ValueError, match="24"):
        series_for(dataset)