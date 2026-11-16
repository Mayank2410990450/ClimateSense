# API

Base URL: `http://127.0.0.1:8000`. Interactive OpenAPI docs: `/docs`.

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/api/health` | Health and storage mode |
| POST | `/api/datasets/demo` | Create synthetic functionality-test dataset |
| POST | `/api/datasets/upload` | Multipart CSV upload; optional `unit` form field (`C`, `F`, `K`) |
| GET | `/api/datasets` | List process-memory datasets |
| GET | `/api/datasets/{id}/explore` | Summary, monthly records, climatology and location list |
| POST | `/api/datasets/{id}/compare` | Forecast comparison; JSON horizon, test months, optional location, ARIMA order, optional seasonal period `12` |
| GET | `/api/datasets/{id}/anomalies` | Statistical and Isolation Forest anomaly records |
| GET/POST | `/api/experiments` | List or save in-memory experiment results |
| POST | `/api/report.csv` | Download evaluation, forecast and anomaly rows as CSV |

Upload validation errors return HTTP 422; missing dataset IDs return 404. Uploads are limited to 20 MB. Dataset IDs are generated per process and are invalid after restart. The experiment POST accepts client-provided result JSON for explicitly saved experiments; automatic comparison runs are saved by the forecast route.