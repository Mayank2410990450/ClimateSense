# Architecture

```text
Browser (Next.js / React)
  ├─ responsive dashboard, charts, upload, CSV exports
  └─ /api/* rewrite → FastAPI (127.0.0.1:8000)
       ├─ dataset validation and monthly normalization (Pandas)
       ├─ forecasting and metrics (statsmodels, scikit-learn, XGBoost)
       ├─ anomaly analysis (statistical residuals, Isolation Forest)
       └─ process-memory dataset and experiment registries
```

The frontend does not generate climate measurements or model results. It requests observation, forecast, and anomaly payloads from the API and renders those values. Uploads are CSV-only and are held in memory for the lifetime of the API process. No remote storage, database, authentication, deployment or external data-fetch integration is configured.

The API is split between `backend/app/main.py` (HTTP contracts and validation) and `backend/app/climate.py` (data processing and analysis). `backend/tests` covers core transformations and representative routes. OpenAPI documentation is generated from FastAPI/Pydantic models at runtime.