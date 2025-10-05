<div align="center">
	<h1>🪐 ExoLiX</h1>
	<p><strong>Browser‑native AI platform for exoplanet candidate exploration, training & classification.</strong></p>
	<p>
		<a href="https://github.com/damanikjosh/exolix">Frontend Repo</a> ·
		<a href="https://github.com/damanikjosh/exolix-api">API / Encoder Repo</a>
	</p>
	<sub>Built for the <a href="https://www.spaceappschallenge.org/">2025 NASA Space Apps Challenge</a></sub>
	<br/>
</div>

---

## 🚀 Overview
ExoLiX is an interactive, fully client‑side web platform that empowers researchers, students, and citizen scientists to classify exoplanet candidates using both numerical machine learning (MLP) and large language model (LLM) reasoning pipelines. No backend GPU, login, or server hosting required—everything runs in your browser with optional asynchronous encoding jobs via a lightweight API.

## ✨ Core Capabilities
| Capability | Description |
|------------|-------------|
| Multi‑Dataset Exploration | Load Kepler, TESS, K2 (and future missions) or custom CSVs into parallel tables. |
| Feature Mapping UI | Drag‑and‑drop feature & label alignment across heterogeneous tables. |
| Dual Training Modes | 1) Raw numeric MLP (TensorFlow.js)  2) LLM‑driven embedding classification. |
| Prompt Engineering | Hard‑coded preset prompts + editable template with dynamic column placeholders. |
| Asynchronous Embeddings | Background encode job polling with progress, cancellation, and preview. |
| In‑Browser Persistence | Models & mappings stored via IndexedDB / localStorage—reproducible sessions. |
| Selective Row Training | Manually curate training cohorts; snapshot isolation prevents drift. |
| Prediction Workflow | Batch inference with model availability detection & guarded re‑entry. |

## 🧠 Training Modes
### 1. MLP (Tabular Numerical)
Lightweight fully‑connected network (TensorFlow.js) operating on sanitized numeric feature vectors (zero‑filled invalids; unmapped labels skipped). Ideal for rapid iteration & pedagogy.

### 2. LLM Embedding Mode
Each row is converted into a structured natural‑language description (prompt template with `{{index}}` placeholders). Rows are embedded (async job or immediate mode) → embeddings feed the same classification head architecture. Enables semantic reasoning and cross‑dataset harmonization.

## 🔄 Typical Workflow
1. Explorer → Load dataset(s) (Kepler / TESS / K2 / custom CSV).  
2. Select rows → Send to Training (snapshot captured).  
3. Mapping → Assign input features & output label; adjust label groupings.  
4. (Optional) Prompt Builder → Refine LLM template & generate embeddings.  
5. Training → Choose mode (raw / LLM embedding), train, inspect metrics.  
6. Explorer → Run predictions on selected rows (adds pinned prediction column).  
7. Iterate: refine features, regroup labels, retrain, compare stored models.

## 🧩 Architecture Overview
```text
Browser (Client)
 ├─ explorer.html / explorer.js      (multi-table data ingest & selection)
 ├─ mapping.html / mapping.js        (feature + label mapping & grouping)
 ├─ training.html / training.js      (preprocessing, model build & train)
 ├─ promptflow.js                    (prompt editing, embedding job lifecycle)
 ├─ dataStore.js / datasetManager.js (IndexedDB persistence + CSV ingestion)
 └─ tfjs model storage (indexeddb://exolix-model)

Optional API (encode service)
 └─ /encode  (POST data+prompt → job_id | immediate embedding)
			/encode/{job_id}  (poll status, retrieve embedding matrix)
```

## 🗃️ Data Handling Principles
- Rows never mutated in-place once snapshotted (training isolation).  
- Missing / invalid numeric entries → coerced to `0.0` (raw mode) for stability.  
- Label grouping supports collapsing multiple raw dispositions into target classes.  
- Unmapped label rows are skipped (logged) rather than poisoning the set.  
- Prompt placeholder expansion preserves blank values as empty strings (`""`).

## 🧪 Model Details
| Component | Raw MLP Mode | LLM Embedding Mode |
|-----------|--------------|--------------------|
| Input Dim | # numeric features | Embedding dimension (e.g., 1024–2048) |
| Sanitization | Zero‑fill invalid values | N/A (numeric pre‑vectorized) |
| Architecture | Dense → Dense → Softmax | Same classifier head over embeddings |
| Storage | IndexedDB (`indexeddb://exolix-model`) | Same |

## 🌌 NASA Alignment & Impact
ExoLiX lowers barriers to exoplanet vetting by combining accessible UI + reproducible in‑browser ML. It supports NASA goals of:  
- Broadening participation (no infrastructure required).  
- STEM education (transparent preprocessing & mapping).  
- Citizen science (hands-on experimentation with real mission data).  
- Method innovation (numerical + language reasoning fusion).

## 🧰 Tech Stack
| Layer | Tools |
|-------|-------|
| UI / Styling | Vanilla JS + Tailwind (direct) + custom modules |
| ML (Browser) | TensorFlow.js (Sequential dense models) |
| Embeddings | External encoder API (LLM backend) + polling logic |
| Data Ops | Custom CSV parser, IndexedDB persistence, localStorage keys |
| Language | JavaScript (ES modules), minimal dependencies |

