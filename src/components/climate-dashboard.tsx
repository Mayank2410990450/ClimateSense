"use client";

import { motion } from "framer-motion";
import { Activity, AlertTriangle, ArrowDownToLine, ArrowUpRight, BarChart3, BookOpen, Check, CircleHelp, CloudSun, Database, FileChartColumn, FileUp, FlaskConical, Gauge, Globe2, Layers3, LoaderCircle, Microscope, RefreshCw, Settings2, Thermometer, Wind } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

type Dataset = { id: string; name: string; source: string; provenance?: string; rows: number; start: string; end: string; locations: string[]; unit: string };
type Observation = { date: string; temperature: number; location: string };
type Summary = { mean_c: number; min_c: number; max_c: number; latest_c: number; latest_date: string; trend_c_per_decade: number };
type Model = { model: string; error?: string; metrics?: { mae: number; rmse: number; mape: number | null }; evaluation?: [string, number, number][]; forecast?: [string, number][]; feature_importance?: { feature: string; importance: number }[] };
type Forecast = { dataset: string; train_end: string; evaluation_start: string; evaluation_end: string; horizon_months: number; models: Model[]; metric_notes: string };
type Anomaly = { date: string; observed_c: number; baseline_c: number; difference_c: number; z_score: number; direction: string; severity: string; methods: string[]; explanation: string };
type AnomalyResponse = { count: number; anomalies: Anomaly[]; baseline: string; anomaly_thresholds: Record<string, number> };
type Experiment = { id: string; created_at: string; dataset_name: string; configuration: { horizon_months?: number; test_months?: number }; results: Forecast };
type Section = "Overview" | "Forecast Studio" | "Anomaly Explorer" | "Model Comparison" | "Data Explorer" | "Experiments" | "Documentation";

const navigation: { name: Section; icon: typeof Activity }[] = [
  { name: "Overview", icon: Gauge }, { name: "Forecast Studio", icon: CloudSun }, { name: "Anomaly Explorer", icon: AlertTriangle },
  { name: "Model Comparison", icon: BarChart3 }, { name: "Data Explorer", icon: Database }, { name: "Experiments", icon: FlaskConical }, { name: "Documentation", icon: BookOpen },
];
const colors = ["#85d9c8", "#e8b477", "#83b9dc"];
const formatDate = (date: string) => new Date(`${date}T00:00:00`).toLocaleDateString("en", { month: "short", year: "2-digit" });
const fmt = (value: number | undefined, digits = 1) => value === undefined || !Number.isFinite(value) ? "—" : value.toFixed(digits);

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, init);
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.detail || `Request failed (${response.status})`);
  }
  return response.json() as Promise<T>;
}

export default function ClimateDashboard() {
  const [section, setSection] = useState<Section>("Overview");
  const [datasets, setDatasets] = useState<Dataset[]>([]);
  const [datasetId, setDatasetId] = useState("");
  const [observations, setObservations] = useState<Observation[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [forecast, setForecast] = useState<Forecast | null>(null);
  const [anomalyResult, setAnomalyResult] = useState<AnomalyResponse | null>(null);
  const [experiments, setExperiments] = useState<Experiment[]>([]);
  const [horizon, setHorizon] = useState(12);
  const [testMonths, setTestMonths] = useState(24);
  const [seasonal, setSeasonal] = useState(true);
  const [uploadUnit, setUploadUnit] = useState("C");
  const [uploadSource, setUploadSource] = useState("");
  const [location, setLocation] = useState("All locations");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const selected = datasets.find((dataset) => dataset.id === datasetId);

  const loadDatasets = async () => {
    try { setDatasets(await request<Dataset[]>("/api/datasets")); }
    catch { setError("API is offline. Start FastAPI on port 8000 to connect the workspace."); }
  };
  const loadExperiments = async () => {
    try { setExperiments(await request<Experiment[]>("/api/experiments")); } catch { /* Dataset loading reports API availability. */ }
  };
  useEffect(() => { void loadDatasets(); void loadExperiments(); }, []);

  const refreshDataset = async (id: string, nextLocation = "All locations") => {
    setDatasetId(id); setLocation(nextLocation); setForecast(null); setAnomalyResult(null); setBusy(true); setError("");
    try {
      const query = nextLocation === "All locations" ? "" : `?location=${encodeURIComponent(nextLocation)}`;
      const [exploration, anomalies] = await Promise.all([
        request<{ observations: Observation[]; summary: Summary }>(`/api/datasets/${id}/explore${query}`),
        request<AnomalyResponse>(`/api/datasets/${id}/anomalies${query}`),
      ]);
      setObservations(exploration.observations); setSummary(exploration.summary); setAnomalyResult(anomalies);
    } catch (issue) { setError(issue instanceof Error ? issue.message : "Unable to read dataset"); }
    finally { setBusy(false); }
  };

  const loadDemo = async () => {
    setBusy(true); setError("");
    try {
      const demo = await request<Dataset>("/api/datasets/demo", { method: "POST" });
      setDatasets(await request<Dataset[]>("/api/datasets"));
      await refreshDataset(demo.id);
    } catch (issue) { setError(issue instanceof Error ? issue.message : "Could not load demo data"); }
    finally { setBusy(false); }
  };

  const uploadFile = async (file?: File) => {
    if (!file) return;
    setBusy(true); setError("");
    try {
      const form = new FormData();
      form.append("file", file); form.append("unit", uploadUnit); form.append("source_name", uploadSource || "User upload");
      const uploaded = await request<Dataset>("/api/datasets/upload", { method: "POST", body: form });
      setDatasets(await request<Dataset[]>("/api/datasets"));
      await refreshDataset(uploaded.id);
    } catch (issue) { setError(issue instanceof Error ? issue.message : "Upload failed"); }
    finally { setBusy(false); }
  };

  const runForecast = async () => {
    if (!datasetId) return;
    setBusy(true); setError("");
    try {
      const result = await request<Forecast>(`/api/datasets/${datasetId}/compare`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ horizon_months: horizon, test_months: testMonths, location: location === "All locations" ? null : location, seasonal_period: seasonal ? 12 : null }),
      });
      setForecast(result); await loadExperiments();
    } catch (issue) { setError(issue instanceof Error ? issue.message : "Forecast run failed"); }
    finally { setBusy(false); }
  };

  const downloadReport = async () => {
    if (!selected) return;
    setBusy(true);
    try {
      const response = await fetch("/api/report.csv", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ dataset_name: selected.name, forecast, anomalies: anomalyResult }) });
      if (!response.ok) throw new Error("Could not generate report");
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement("a"); link.href = url; link.download = "climatesense-report.csv"; link.click(); URL.revokeObjectURL(url);
    } catch (issue) { setError(issue instanceof Error ? issue.message : "Report export failed"); }
    finally { setBusy(false); }
  };

  const downloadObservations = () => {
    const blob = new Blob(["date,temperature_c,location\n" + observations.map((row) => `${row.date},${row.temperature},${row.location}`).join("\n")], { type: "text/csv" });
    const url = URL.createObjectURL(blob); const link = document.createElement("a"); link.href = url; link.download = "climatesense-observations.csv"; link.click(); URL.revokeObjectURL(url);
  };

  const historicalChart = observations.map((point) => ({ date: point.date, temperature: point.temperature }));
  const compareChart = forecast?.models.find((model) => model.evaluation)?.evaluation?.map(([date, actual, predicted]) => ({ date, actual, predicted })) ?? [];
  const bestModel = forecast?.models.filter((model) => model.metrics && model.forecast).sort((a, b) => (a.metrics?.mae ?? Infinity) - (b.metrics?.mae ?? Infinity))[0];
  const forecastChart = bestModel?.forecast?.map(([date, temperature]) => ({ date, temperature })) ?? [];
  const sectionCopy: Record<Section, [string, string, string]> = {
    "Overview": ["Climate overview", "A grounded view of the observations in your selected dataset.", "LIVE DATA WORKSPACE"],
    "Forecast Studio": ["Forecast studio", "Configure the horizon and compare holdout performance before exploring future estimates.", "MODEL WORKBENCH"],
    "Anomaly Explorer": ["Anomaly explorer", "Investigate observations that diverge from their historical baseline.", "STATISTICAL REVIEW"],
    "Model Comparison": ["Model comparison lab", "Compare recursive, chronological holdout predictions across three model families.", "EVALUATION LAB"],
    "Data Explorer": ["Climate data explorer", "Inspect and export validated monthly observations by location.", "DATA EXPLORER"],
    "Experiments": ["Experiment history", "Review model runs created in this local API process.", "RUN ARCHIVE"],
    "Documentation": ["Method notes", "Sources, evaluation design and known limitations for this workspace.", "PROJECT NOTES"],
  };
  const [title, subtitle, eyebrow] = sectionCopy[section];

  return (
    <div className="workspace">
      <aside className="sidebar">
        <div className="brand"><div className="brand-mark"><Wind size={19} strokeWidth={2.2} /></div><div><div className="brand-name">ClimateSense</div><div className="brand-caption">Climate intelligence</div></div></div>
        <div className="nav-label">Workspace</div>
        <nav className="nav-group" aria-label="Main navigation">
          {navigation.map(({ name, icon: Icon }) => <button key={name} className={`nav-item ${section === name ? "active" : ""}`} onClick={() => setSection(name)} aria-current={section === name ? "page" : undefined}><Icon size={16} /><span>{name}</span>{name === "Overview" && section === name ? <ArrowUpRight size={13} /> : null}</button>)}
        </nav>
        <div className="sidebar-bottom"><div className="source-mini"><p>Current dataset</p><strong>{selected?.name ?? "No dataset loaded"}</strong><small>{selected ? `${selected.rows.toLocaleString()} monthly records` : "Upload a CSV to begin"}</small></div><div className="side-footer">Local workspace · v1.0</div></div>
      </aside>

      <main className="main-area">
        <header className="topbar"><div className="breadcrumb">Workspace <span style={{ color: "#516965", margin: "0 8px" }}>/</span><strong>{section}</strong></div><div className="top-actions"><div className="status"><i className="status-dot" />Local API</div><div className="avatar" title="Local workspace">CS</div></div></header>
        <div className="content">
          <motion.div className="page-heading" key={section} initial={{ opacity: 0, y: 7 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: .22 }}>
            <div><div className="eyebrow">{eyebrow}</div><h1>{title}</h1><p className="subhead">{subtitle}</p></div>
            <div className="heading-tools">
              {datasets.length > 0 && <select className="select" aria-label="Select dataset" value={datasetId} onChange={(event) => void refreshDataset(event.target.value)}><option value="">Select dataset</option>{datasets.map((dataset) => <option key={dataset.id} value={dataset.id}>{dataset.name}</option>)}</select>}
              {selected && <button className="button" onClick={() => void downloadReport()} disabled={busy} title="Download current results as CSV"><ArrowDownToLine size={14} /><span className="hide-mobile">Export CSV</span></button>}
            </div>
          </motion.div>
          {error && <div className="error-note" role="alert">{error}</div>}

          {!selected ? <section className="panel empty">
            <div className="empty-mark"><Globe2 size={26} /></div><h2>Bring your climate data into focus</h2>
            <p>Import a monthly climate CSV with a date and temperature column, or load a clearly labeled synthetic demo to explore the full workflow.</p>
            <div className={`upload-zone ${dragging ? "dragging" : ""}`} onDragOver={(event) => { event.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={(event) => { event.preventDefault(); setDragging(false); void uploadFile(event.dataTransfer.files[0]); }}>
              <div className="upload-row"><button className="button primary" onClick={() => inputRef.current?.click()} disabled={busy}><FileUp size={15} />Import CSV</button><span className="drop-label">or drop a file here</span><button className="button" onClick={() => void loadDemo()} disabled={busy}><RefreshCw size={13} />Load demo</button></div>
              <div className="toolbar-row" style={{ justifyContent: "center", marginTop: 13 }}>
                <label className="drop-label">Source unit<select className="select" aria-label="Source temperature unit" value={uploadUnit} onChange={(event) => setUploadUnit(event.target.value)} style={{ marginLeft: 7 }}><option value="C">Celsius</option><option value="F">Fahrenheit</option><option value="K">Kelvin</option></select></label>
                <label className="drop-label">Source name<input className="select" aria-label="Dataset source name" placeholder="Provider or station" value={uploadSource} onChange={(event) => setUploadSource(event.target.value)} style={{ marginLeft: 7, width: 150 }} /></label>
              </div>
              <input ref={inputRef} className="file-input" type="file" accept=".csv,text/csv" onChange={(event) => void uploadFile(event.target.files?.[0])} />
              <div className="footer-note">Required columns: date/time and temperature. Uploads are processed locally and retained in memory until the API restarts. Demo data is synthetic, not a climate record.</div>
            </div>
            {busy && <div className="loading" style={{ marginTop: 16 }}><span className="spinner" />Processing dataset</div>}
          </section> : <>
            {section === "Overview" && <>
              <div className="metrics-grid">
                <Metric icon={Thermometer} label="Latest monthly mean" value={`${fmt(summary?.latest_c)}°C`} note={summary?.latest_date ? `Observed · ${formatDate(summary.latest_date)}` : "No observation loaded"} />
                <Metric icon={Activity} label="Dataset mean" value={`${fmt(summary?.mean_c)}°C`} note="Monthly mean across selected series" accent="var(--sky)" />
                <Metric icon={ArrowUpRight} label="Linear change rate" value={`${summary && summary.trend_c_per_decade > 0 ? "+" : ""}${fmt(summary?.trend_c_per_decade)}°C`} note="Mean monthly difference × 120; descriptive only" accent="var(--amber)" />
                <Metric icon={Layers3} label="Observations" value={selected.rows.toLocaleString()} note={`${selected.start} to ${selected.end}`} accent="var(--lime)" />
              </div>
              <div className="content-grid">
                <section className="panel"><PanelHeading title="Monthly temperature record" subtitle={`${selected.name} · Celsius · monthly aggregates`} trailing={<span className="mono" style={{ color: "#7d9690", fontSize: 10 }}>{observations.length} MONTHS</span>} /><div className="panel-body"><Chart data={historicalChart} dataKey="temperature" color={colors[0]} yLabel="°C" /></div></section>
                <section className="panel"><PanelHeading title="Recent flagged periods" subtitle="Calendar-month baseline screening" trailing={<button className="icon-button" onClick={() => setSection("Anomaly Explorer")} title="Open anomaly explorer"><ArrowUpRight size={14} /></button>} /><AnomalyList anomalies={anomalyResult?.anomalies.slice(-5).reverse() ?? []} /></section>
              </div>
              <div className="bottom-grid"><section className="panel"><PanelHeading title="Forecast model snapshot" subtitle={forecast ? `Evaluation · ${forecast.evaluation_start} – ${forecast.evaluation_end}` : "Run a comparison to populate model results"} trailing={forecast ? <span className="severity">Holdout</span> : null} />{forecast ? <ModelMetrics models={forecast.models} /> : <div className="dataset-card"><div className="dataset-icon"><Microscope size={18} /></div><div className="dataset-info"><strong>Forecasts are calculated from your data</strong><p>No accuracy or prediction values are prefilled. Configure a test window and run model comparison.</p><div className="dataset-actions"><button className="button primary" onClick={() => setSection("Forecast Studio")}><FlaskConical size={14} />Open forecast studio</button></div></div></div>}</section><DatasetPanel dataset={selected} onUpload={() => inputRef.current?.click()} /></div>
            </>}

            {section === "Forecast Studio" && <>
              <div className="panel section-gap"><PanelHeading title="Forecast configuration" subtitle="All algorithms share the same chronological holdout window." trailing={<Settings2 size={16} color="#85d9c8" />} /><div className="panel-body"><div className="toolbar-row"><label className="drop-label">Forecast horizon<select className="select" value={horizon} onChange={(event) => setHorizon(Number(event.target.value))} style={{ marginLeft: 9 }}><option value={3}>3 months</option><option value={6}>6 months</option><option value={12}>12 months</option><option value={24}>24 months</option><option value={36}>36 months</option></select></label><label className="drop-label">Evaluation window<select className="select" value={testMonths} onChange={(event) => setTestMonths(Number(event.target.value))} style={{ marginLeft: 9 }}><option value={12}>12 months</option><option value={18}>18 months</option><option value={24}>24 months</option><option value={36}>36 months</option></select></label><label className="drop-label" style={{ display: "inline-flex", alignItems: "center", gap: 7 }}><input type="checkbox" checked={seasonal} onChange={(event) => setSeasonal(event.target.checked)} />Monthly SARIMA</label><button className="button primary" onClick={() => void runForecast()} disabled={busy}>{busy ? <LoaderCircle size={14} /> : <FlaskConical size={14} />}Run comparison</button></div><div className="footer-note">ARIMA(1,1,1) or optional seasonal SARIMA, plus lag-feature Random Forest/XGBoost, are evaluated using recursive predictions after the training cutoff. Tree models use lag 1, 2, 3, 6, 12, rolling means, and month-of-year cycles.</div></div></div>
              {busy && <div className="loading section-gap"><span className="spinner" />Training and evaluating models on the selected data</div>}
              {forecast && <><div className="metrics-grid section-gap">{forecast.models.map((model, index) => <Metric key={model.model} icon={index === 0 ? Activity : index === 1 ? BarChart3 : Layers3} label={model.model} value={model.metrics ? `${fmt(model.metrics.mae, 2)}°C` : "Unavailable"} note={model.metrics ? `MAE · RMSE ${fmt(model.metrics.rmse, 2)}°C · MAPE ${fmt(model.metrics.mape ?? undefined, 1)}%` : model.error} accent={colors[index]} />)}</div><div className="content-grid"><section className="panel"><PanelHeading title="Holdout: observed vs predicted" subtitle={`${forecast.train_end} training cutoff · ${forecast.evaluation_start} – ${forecast.evaluation_end} evaluation`} /><div className="panel-body"><CompareChart data={compareChart} /></div></section><section className="panel"><PanelHeading title="Future forecast" subtitle={`${forecast.horizon_months}-month estimate · ${bestModel?.model ?? "no successful model"}`} /><div className="panel-body"><Chart data={forecastChart} dataKey="temperature" color={colors[1]} yLabel="°C" /></div></section></div><section className="panel section-gap"><PanelHeading title="Model scores" subtitle="Calculated from recursively generated holdout predictions" /><ModelMetrics models={forecast.models} /><div className="footer-note" style={{ padding: "0 17px 14px" }}>{forecast.metric_notes} Model choice should consider stability, domain context, and forecast horizon as well as MAE.</div></section></>}
              {!forecast && !busy && <section className="panel empty section-gap"><div className="empty-mark"><CloudSun size={24} /></div><h2>Run a data-backed forecast</h2><p>The three model outputs, evaluation scores and feature importance appear here after training succeeds.</p><button className="button primary" onClick={() => void runForecast()} disabled={busy}><FlaskConical size={14} />Train models</button></section>}
            </>}

            {section === "Model Comparison" && <>
              <div className="toolbar-row section-gap"><button className="button primary" onClick={() => void runForecast()} disabled={busy}><RefreshCw size={14} />{busy ? "Running models…" : "Run model comparison"}</button>{forecast && <span className="drop-label">Shared evaluation period: {forecast.evaluation_start} – {forecast.evaluation_end}</span>}</div>
              {forecast ? <><div className="content-grid section-gap"><section className="panel"><PanelHeading title="Observed vs predicted" subtitle="Recursive forecasts over the untouched chronological test period" /><div className="panel-body"><CompareChart data={compareChart} /></div></section><section className="panel"><PanelHeading title="Model score comparison" subtitle="MAE, RMSE and MAPE; lower is better" /><ModelMetrics models={forecast.models} /></section></div><section className="panel section-gap"><PanelHeading title="Feature importance" subtitle="Tree-model impurity importance; not a causal explanation" /><FeatureImportance models={forecast.models} /></section></> : <section className="panel empty section-gap"><div className="empty-mark"><BarChart3 size={24} /></div><h2>No comparison run yet</h2><p>Each model uses the same chronological split so holdout metrics can be compared fairly.</p></section>}
              <p className="footer-note">ARIMA does not have tree feature importance. Feature importance values indicate how a tree model used engineered inputs, not causal influence. XGBoost errors are reported explicitly if its runtime cannot initialize.</p>
            </>}

            {section === "Anomaly Explorer" && <>
              <div className="metrics-grid section-gap"><Metric icon={AlertTriangle} label="Flagged periods" value={String(anomalyResult?.count ?? 0)} note="At least one documented detector" accent="var(--amber)" /><Metric icon={Activity} label="Baseline" value="Same calendar month" note="Minimum 3 prior years" accent="var(--sky)" /><Metric icon={Gauge} label="Moderate deviation" value="≥ 2.0°C" note="Absolute difference from baseline" accent="var(--lime)" /><Metric icon={AlertTriangle} label="High deviation" value="≥ 4.0°C" note="Severity label, not attribution" accent="var(--coral)" /></div>
              <section className="panel section-gap"><PanelHeading title="Anomaly timeline" subtitle={anomalyResult?.baseline ?? "Detector results"} trailing={<span className="mono" style={{ color: "#829791", fontSize: 10 }}>{anomalyResult?.count ?? 0} FLAGS</span>} />{anomalyResult?.anomalies.length ? <div className="table-wrap"><table><thead><tr><th>Period</th><th>Observed</th><th>Baseline</th><th>Difference</th><th>Method</th><th>Severity</th><th>Explanation</th></tr></thead><tbody>{[...anomalyResult.anomalies].reverse().map((item) => <tr key={item.date}><td>{item.date}</td><td>{fmt(item.observed_c, 2)}°C</td><td>{fmt(item.baseline_c, 2)}°C</td><td style={{ color: item.difference_c > 0 ? "var(--coral)" : "var(--sky)" }}>{item.difference_c > 0 ? "+" : ""}{fmt(item.difference_c, 2)}°C</td><td>{item.methods.join(" · ")}</td><td><span className={`severity ${item.severity.toLowerCase()}`}>{item.severity}</span></td><td>{item.explanation}</td></tr>)}</tbody></table></div> : <div className="empty" style={{ minHeight: 180 }}><p>No periods met the current detector thresholds in this dataset.</p></div>}</section>
              <p className="footer-note">Anomalies are statistical deviations from a calendar-month historical baseline. A flagged value does not establish a climate trend or attribute its cause. Isolation Forest is an unsupervised outlier screen.</p>
            </>}

            {section === "Data Explorer" && <>
              <div className="toolbar-row section-gap"><label className="drop-label">Location <select className="select" value={location} onChange={(event) => void refreshDataset(datasetId, event.target.value)} style={{ marginLeft: 8 }}><option>All locations</option>{selected.locations.map((place) => <option key={place}>{place}</option>)}</select></label><button className="button" onClick={downloadObservations}><ArrowDownToLine size={14} />Download observations</button></div>
              <div className="content-grid section-gap"><section className="panel"><PanelHeading title="Historical temperature" subtitle={`${selected.name} · normalized to Celsius`} /><div className="panel-body"><Chart data={historicalChart} dataKey="temperature" color={colors[0]} yLabel="°C" /></div></section><DatasetPanel dataset={selected} onUpload={() => inputRef.current?.click()} compact /></div>
              <section className="panel section-gap"><PanelHeading title="Monthly observations" subtitle={`${observations.length.toLocaleString()} records · newest first`} /><div className="table-wrap" style={{ maxHeight: 430, overflowY: "auto" }}><table><thead><tr><th>Date</th><th>Temperature (°C)</th><th>Location</th></tr></thead><tbody>{[...observations].reverse().slice(0, 500).map((row, index) => <tr key={`${row.date}-${row.location}-${index}`}><td>{row.date}</td><td>{fmt(row.temperature, 3)}</td><td>{row.location}</td></tr>)}</tbody></table></div><p className="footer-note" style={{ padding: "0 14px 13px" }}>Showing up to 500 latest observations. Duplicate dates are aggregated monthly by location.</p></section>
            </>}

            {section === "Experiments" && <section className="panel section-gap"><PanelHeading title="Saved model runs" subtitle="Runs are held in API memory and disappear when the local backend restarts" trailing={<button className="icon-button" onClick={() => void loadExperiments()} title="Refresh experiments"><RefreshCw size={14} /></button>} />{experiments.length ? <div className="table-wrap"><table><thead><tr><th>Dataset</th><th>Created</th><th>Horizon</th><th>Best MAE</th><th>Evaluation</th></tr></thead><tbody>{experiments.map((experiment) => <tr key={experiment.id}><td>{experiment.dataset_name}</td><td>{new Date(experiment.created_at).toLocaleString()}</td><td>{experiment.configuration.horizon_months ?? experiment.results.horizon_months} mo</td><td>{fmt(Math.min(...experiment.results.models.filter((model) => model.metrics).map((model) => model.metrics?.mae ?? Infinity)), 3)}°C</td><td>{experiment.results.evaluation_start} – {experiment.results.evaluation_end}</td></tr>)}</tbody></table></div> : <div className="empty" style={{ minHeight: 220 }}><div className="empty-mark"><FlaskConical size={23} /></div><h2>No experiments recorded</h2><p>Successful forecast comparisons are automatically saved to the local API process.</p><button className="button" onClick={() => setSection("Forecast Studio")}>Open forecast studio</button></div>}</section>}

            {section === "Documentation" && <div className="content-grid section-gap"><section className="panel"><PanelHeading title="Data contract" subtitle="CSV import and provenance" /><div className="panel-body"><DocItem title="Accepted columns" text="A date/time column (date, time, datetime, month, year) and temperature (temperature, temp, tavg, mean temperature, value). Optional location/station/city/region separates series." /><DocItem title="Normalization" text="Upload unit selector supports Celsius, Fahrenheit and Kelvin. Invalid date/temperature rows are dropped and counted. Duplicate month/location records are averaged." /><DocItem title="Public sources" text="NASA GISTEMP, NOAA, and Berkeley Earth are suitable public sources. Import downloaded source files as CSV and record provider or station in the source field. The app does not fetch or fabricate official observations." /><DocItem title="Demo data" text="The bundled demo is generated synthetic monthly data from a seeded seasonal trend and noise process. It is only for checking the interface and model pipeline." /></div></section><section className="panel"><PanelHeading title="Model & interpretation notes" subtitle="Evaluation and limits" /><div className="panel-body"><DocItem title="Chronological evaluation" text="The final N months are held out. Tree models train only on lag-feature rows before that cutoff, then predict the holdout recursively without using test actuals as future lags." /><DocItem title="Metrics" text="MAE and RMSE are in °C. MAPE is shown only when actual values are nonzero; it can still be unstable near zero and should not be used alone." /><DocItem title="Anomaly rules" text="Baseline uses preceding values from the same calendar month (minimum 3 prior years). Moderate/high severity corresponds to absolute deviation ≥2/≥4°C. Residual |z|≥3 and Isolation Forest are additional flags." /><DocItem title="Not attribution" text="A statistical anomaly is not evidence that climate change caused the observation. Forecast performance depends on stationarity, data quality, representativeness and horizon; estimates are not official climate guidance." /><DocItem title="Local persistence" text="Datasets and experiment history are in process memory, not a configured database. Restarting FastAPI clears both." /></div></section></div>}
          </>}

          <div className="footer-note" style={{ marginTop: 18, display: "flex", justifyContent: "space-between", gap: 10 }}><span><CircleHelp size={12} style={{ display: "inline", verticalAlign: "-2px", marginRight: 5 }} />Statistical analysis, not climate attribution.</span><span className="mono">LOCAL · NO CLOUD STORAGE</span></div>
        </div>
      </main>
    </div>
  );
}

function Metric({ icon: Icon, label, value, note, accent = "var(--mint)" }: { icon: typeof Activity; label: string; value: string; note?: string; accent?: string }) {
  return <motion.div className="metric" initial={{ opacity: 0, y: 5 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: .24 }}><div className="metric-top"><span>{label}</span><Icon size={15} className="metric-icon" style={{ color: accent }} /></div><div className="metric-value">{value}</div><div className="metric-note">{note}</div></motion.div>;
}

function PanelHeading({ title, subtitle, trailing }: { title: string; subtitle?: string; trailing?: React.ReactNode }) {
  return <div className="panel-head"><div><div className="panel-title">{title}</div>{subtitle && <div className="panel-subtitle">{subtitle}</div>}</div>{trailing}</div>;
}

function Chart({ data, dataKey, color, yLabel }: { data: { date: string; [key: string]: string | number }[]; dataKey: string; color: string; yLabel: string }) {
  return <div className="chart-wrap"><ResponsiveContainer width="100%" height="100%"><LineChart data={data} margin={{ top: 8, right: 12, left: -14, bottom: 0 }}><CartesianGrid stroke="rgba(180,210,200,.09)" vertical={false} /><XAxis dataKey="date" tickFormatter={formatDate} minTickGap={45} tick={{ fill: "#77908c", fontSize: 9 }} axisLine={false} tickLine={false} /><YAxis unit={yLabel} width={53} tick={{ fill: "#77908c", fontSize: 9 }} axisLine={false} tickLine={false} domain={["auto", "auto"]} /><Tooltip content={<ChartTooltip />} /><Line type="monotone" dataKey={dataKey} name="Temperature" stroke={color} strokeWidth={1.8} dot={false} activeDot={{ r: 3, fill: color, stroke: "#14252b", strokeWidth: 2 }} isAnimationActive={false} /></LineChart></ResponsiveContainer></div>;
}

function CompareChart({ data }: { data: { date: string; actual: number; predicted: number }[] }) {
  return <div className="chart-wrap"><ResponsiveContainer width="100%" height="100%"><LineChart data={data} margin={{ top: 8, right: 12, left: -14, bottom: 0 }}><CartesianGrid stroke="rgba(180,210,200,.09)" vertical={false} /><XAxis dataKey="date" tickFormatter={formatDate} minTickGap={38} tick={{ fill: "#77908c", fontSize: 9 }} axisLine={false} tickLine={false} /><YAxis unit="°C" width={53} tick={{ fill: "#77908c", fontSize: 9 }} axisLine={false} tickLine={false} domain={["auto", "auto"]} /><Tooltip content={<ChartTooltip />} /><Legend iconType="circle" wrapperStyle={{ fontSize: 10, color: "#91a6a4" }} /><Line type="monotone" dataKey="actual" name="Observed" stroke={colors[0]} strokeWidth={2} dot={false} isAnimationActive={false} /><Line type="monotone" dataKey="predicted" name="Predicted" stroke={colors[1]} strokeWidth={1.8} strokeDasharray="5 4" dot={false} isAnimationActive={false} /></LineChart></ResponsiveContainer></div>;
}

function ChartTooltip({ active, payload, label }: { active?: boolean; payload?: { name: string; value: number; color: string }[]; label?: string }) {
  if (!active || !payload?.length) return null;
  return <div style={{ padding: "9px 11px", border: "1px solid #385051", borderRadius: 5, background: "#102127", fontSize: 10 }}><div style={{ marginBottom: 6, color: "#91a6a4" }}>{label ? formatDate(label) : ""}</div>{payload.map((point) => <div key={point.name} style={{ color: point.color, marginTop: 3 }}>{point.name}: {fmt(point.value, 2)}°C</div>)}</div>;
}

function AnomalyList({ anomalies }: { anomalies: Anomaly[] }) {
  if (!anomalies.length) return <div className="empty" style={{ minHeight: 190 }}><div className="empty-mark"><Check size={20} /></div><h2 style={{ fontSize: 14 }}>No recent flags</h2><p style={{ marginBottom: 0 }}>No periods met the current statistical thresholds.</p></div>;
  return <div className="anomaly-list">{anomalies.map((anomaly) => <div key={anomaly.date} className={`anomaly-row ${anomaly.severity.toLowerCase()}`}><div className="anomaly-icon"><AlertTriangle size={14} /></div><div><div className="anomaly-date">{formatDate(anomaly.date)} · {anomaly.direction.toLowerCase()}</div><div className="anomaly-desc">{anomaly.methods.length > 1 ? `${anomaly.methods.length} detectors flagged` : anomaly.methods[0]}</div></div><div style={{ textAlign: "right" }}><span className={`severity ${anomaly.severity.toLowerCase()}`}>{anomaly.severity}</span><span className="anomaly-value">{anomaly.difference_c > 0 ? "+" : ""}{fmt(anomaly.difference_c)}°C</span></div></div>)}</div>;
}

function ModelMetrics({ models }: { models: Model[] }) {
  const active = models.filter((model) => model.metrics);
  const maximum = Math.max(...active.map((model) => model.metrics?.mae ?? 0), 0.01);
  return <div className="model-bars">{models.map((model, index) => <div key={model.model}><div className="model-bar-head"><span>{model.model}</span><span>{model.metrics ? `MAE ${fmt(model.metrics.mae, 3)}°C · RMSE ${fmt(model.metrics.rmse, 3)}°C · MAPE ${fmt(model.metrics.mape ?? undefined, 1)}%` : model.error ?? "Unavailable"}</span></div>{model.metrics && <div className="bar-track"><div className="bar-fill" style={{ width: `${Math.max(3, (model.metrics.mae / maximum) * 100)}%`, background: colors[index] }} /></div>}</div>)}{active.length > 0 && <div className="model-foot">{active.slice().sort((a, b) => (a.metrics?.mae ?? Infinity) - (b.metrics?.mae ?? Infinity))[0].model} has the lowest MAE in this holdout. Selection is dataset- and period-specific.</div>}</div>;
}

function FeatureImportance({ models }: { models: Model[] }) {
  const treeModels = models.filter((model) => model.feature_importance?.length);
  if (!treeModels.length) return <p className="footer-note" style={{ padding: "0 17px 15px" }}>No tree model importance values are available for this run.</p>;
  return <div className="content-grid" style={{ padding: 15, margin: 0 }}>{treeModels.map((model) => <div key={model.model}><div className="panel-title" style={{ padding: "0 2px 12px" }}>{model.model}</div><div className="model-bars" style={{ padding: 0 }}>{model.feature_importance?.slice(0, 6).map((feature) => <div key={feature.feature}><div className="model-bar-head"><span>{feature.feature}</span><span>{(feature.importance * 100).toFixed(1)}%</span></div><div className="bar-track"><div className="bar-fill" style={{ width: `${Math.max(2, feature.importance * 100)}%` }} /></div></div>)}</div></div>)}</div>;
}

function DatasetPanel({ dataset, onUpload, compact = false }: { dataset: Dataset; onUpload: () => void; compact?: boolean }) {
  return <section className="panel"><PanelHeading title="Dataset provenance" subtitle="Current observation source" /><div className="dataset-card"><div className="dataset-icon"><FileChartColumn size={18} /></div><div className="dataset-info"><strong>{dataset.name}</strong><p>{dataset.source} · {dataset.rows.toLocaleString()} monthly rows<br />{dataset.start} — {dataset.end}<br />{dataset.locations.join(", ")}</p>{!compact && <div className="dataset-actions"><button className="button" onClick={onUpload}><FileUp size={13} />Import another</button></div>}</div></div></section>;
}

function DocItem({ title, text }: { title: string; text: string }) {
  return <div style={{ padding: "11px 2px", borderBottom: "1px solid rgba(195,220,211,.07)" }}><div style={{ marginBottom: 5, fontSize: 11, fontWeight: 600 }}>{title}</div><div style={{ color: "#8da29e", fontSize: 11, lineHeight: 1.65 }}>{text}</div></div>;
}