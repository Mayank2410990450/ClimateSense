from fastapi.testclient import TestClient

from app.main import app, datasets, experiments

client = TestClient(app)


def setup_function():
    datasets.clear()
    experiments.clear()


def test_demo_exploration_and_anomalies():
    created = client.post("/api/datasets/demo").json()
    assert "Synthetic" in created["name"]
    explored = client.get(f"/api/datasets/{created['id']}/explore").json()
    assert explored["summary"]["latest_c"] is not None
    assert explored["observations"]
    anomalies = client.get(f"/api/datasets/{created['id']}/anomalies").json()
    assert "anomaly_thresholds" in anomalies


def test_upload_and_compare_endpoint():
    demo = client.post("/api/datasets/demo").json()
    uploaded = client.post("/api/datasets/upload", data={"unit": "F", "source_name": "Test station archive"}, files={"file": ("monthly.csv", b"date,temperature\n" + b"".join(f"{year}-{month:02d}-01,{50 + month}\n".encode() for year in range(2000, 2005) for month in range(1, 13)), "text/csv")})
    assert uploaded.status_code == 200
    assert uploaded.json()["unit"] == "C"
    assert uploaded.json()["source"] == "Test station archive"
    assert uploaded.json()["unit_converted_from"] == "F"
    response = client.post(f"/api/datasets/{demo['id']}/compare", json={"horizon_months": 2, "test_months": 6})
    assert response.status_code == 200
    assert response.json()["evaluation_start"] > response.json()["train_end"]
    assert client.get("/api/experiments").json()


def test_invalid_dataset_returns_404():
    response = client.get("/api/datasets/missing/explore")
    assert response.status_code == 404


def test_report_includes_metrics_and_anomaly_context():
    response = client.post("/api/report.csv", json={"dataset_name": "Test", "forecast": {"models": [{"model": "Random Forest", "metrics": {"mae": 1.2, "rmse": 1.5, "mape": 8.0}, "evaluation": [], "forecast": []}]}, "anomalies": {"anomalies": []}})
    assert response.status_code == 200
    assert "metrics,Test,Random Forest" in response.text
    assert "mae_c" in response.text