# Methodology and limitations

## Preprocessing

CSV column names are matched case-insensitively against documented aliases. Dates and temperatures are parsed independently; rows with an invalid date or nonnumeric temperature are dropped and counted. Fahrenheit and Kelvin are converted to Celsius. Duplicate date/location observations are collapsed to monthly starts and averaged. Missing monthly periods are linearly interpolated for model series; there is no imputation across locations before location selection.

## Forecast evaluation

The last `test_months` values form the chronological test period. ARIMA/SARIMA is fit on values strictly before the cutoff. Tree training samples require 12 preceding observations and are included only when their target date precedes the cutoff. Evaluation predictions are recursive: each predicted test value, rather than its actual, becomes history for the next step. For future estimates, models are refit on the complete series. Tree features are lag 1/2/3/6/12, trailing 3-/12-month means, and month sine/cosine. XGBoost uses fixed parameters (240 estimators, depth 3, learning rate 0.035); Random Forest uses 240 trees and minimum leaf size 2. They are not hyperparameter-tuned.

MAE and RMSE are measured in Celsius. MAPE is suppressed if all actual values are zero, but near-zero actuals can still make it misleading. Small test windows are noisy; holdout metrics are not a guarantee of future performance. The UI identifies training and evaluation dates. ARIMA/SARIMA order and seasonal period are available in the API; the UI exposes the optional 12-month seasonal form.

## Anomalies

Expected temperature is the mean of up to 10 preceding observations from the same calendar month, requiring at least three prior years, so the normal annual cycle is not treated as an anomaly. A 2 C absolute residual is a statistical threshold, 4 C denotes the UI's high-severity category, residual z-score uses the residual series standard deviation with an absolute threshold of 3, and Isolation Forest provides a separate unsupervised screen. These methods can flag ordinary variability, data errors, or unusual conditions; they do not attribute an event to climate change.

## Limitations

The platform analyzes imported series but does not homogenize station records, model spatial covariance, quantify forecast intervals, perform formal attribution, or validate provider metadata. Monthly interpolation may smooth gaps. Forecast models use fixed configurations except ARIMA API order and horizon/test window. Datasets and experiments are process-local and not durable. PostgreSQL, Supabase, SQLAlchemy and Alembic are not configured. The frontend/backend integration is exercised through FastAPI tests and local browser smoke testing; no separate browser automation suite is included.