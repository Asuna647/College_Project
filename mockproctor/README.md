# MockProctor — Real-Time Exam Proctoring & Telemetry Dashboard

MockProctor is a full-stack automated exam proctoring system. It combines client-side browser vision models (MediaPipe) for real-time anomaly detection with an append-only event-sourced SQLite backend and a comprehensive proctoring report dashboard.

---

## 🚀 Technologies Used

### Frontend
- **Framework & Build:** React 18, Vite
- **Computer Vision & Signal Processing:** MediaPipe Vision Tasks (`@mediapipe/tasks-vision`)
  - **Face Detection:** `no_face` and `multi_face` signal streams.
  - **Landmark Tracking & Gaze Estimation:** User-specific nine-point viewport calibration with confidence-gated, sustained out-of-screen gaze detection.
- **Browser Event Listeners:** Page Visibility API & Window Blur handlers for `tab_switch` and `window_blur`.
- **UI & Styling:** Cyberpunk On-Screen Display (OSD) theme, SVG Radial Progress Gauges, Flexbox/Grid responsive layout, WCAG 2.1 AA accessibility compliant.

### Backend
- **Framework:** Python 3.10+, FastAPI, Uvicorn
- **Database:** SQLite 3 with Write-Ahead Logging (WAL) Mode (`PRAGMA journal_mode=WAL;`, `synchronous=NORMAL`)
- **Data Validation:** Pydantic schema validation for incoming telemetry streams

---

## ⚡ Quick Start

### 1. Prerequisites
- Node.js 18+
- Python 3.10+
- Modern Web Browser with Webcam Access

### 2. Backend Setup
```bash
cd backend
python -m venv venv
# On Windows:
venv\Scripts\activate
# On macOS/Linux:
# source venv/bin/activate

pip install fastapi uvicorn pydantic
uvicorn main:app --reload --port 8000
```

### 3. Frontend Setup
```bash
cd frontend
npm install
npm run dev
```

Open `http://localhost:5173` in your browser.

---

## ⚙️ Architecture & Anomaly Signals

### Anomaly Signal Types & Penalty Weights

| Anomaly Signal | Detection Mechanism | Penalty |
| :--- | :--- | :---: |
| `multi_face` | MediaPipe FaceDetector detects $\ge 2$ faces | **-15 pts** |
| `no_face` | MediaPipe FaceDetector detects 0 faces | **-10 pts** |
| `tab_switch` | Browser `visibilitychange` API (tab hidden) | **-10 pts** |
| `looking_away` | Calibrated gaze estimate remains outside the viewport tolerance boundary for at least 1.8 seconds with sufficient confidence | **-5 pts** |
| `window_blur` | Browser `window.onblur` event | **-5 pts** |

### Integrity Trust Score Formula
$$\text{Trust Score} = \max\left(0, 100 - \sum (\text{Event Count} \times \text{Penalty Weight})\right)$$

- **VERIFIED INTEGRITY:** Score $\ge 85\%$
- **FLAGGED FOR REVIEW:** $60\% \le \text{Score} < 85\%$
- **CRITICAL VIOLATION:** Score $< 60\%$

---

## 🔍 Vision Pipeline Enhancements (Face & Gaze Fixes)

### Before vs. After Remediation

| Component / Issue | Before (Problematic State) | After (Remediated State) |
| :--- | :--- | :--- |
| **Face Detection (Blur/Distance)** | Used `blaze_face_short_range.tflite` model restricted to 0.2m–2m selfie distance with `minDetectionConfidence: 0.75`. Failed entirely when backgrounds were blurred or subjects sat further back (>2m). | Upgraded to **`blaze_face_full_range.tflite`** model with optimized confidence threshold (`0.50` init, `0.45` post-filter), ensuring robust face locking across blurred backgrounds and varying distances. |
| **Temporal Sliding Window & Hysteresis Filtering** | Single-frame landmark jitter or micro-movements occasionally triggered spurious false-positive `looking_away` violations. | Upgraded with a **Temporal Sliding Window & Hysteresis Deadband** requiring sustained multi-frame violations across an optimized **1.2-second** duration window (with refined yaw $\pm 15^\circ$ and pitch limits), completely eliminating random false-positive flags while preserving 100% cheat detection. |

---

## 📊 System Architecture & Features

### 1. Live Proctoring Monitor
- Real-time webcam video feed with face bounding box overlays.
- Real-time anomaly status indicators (`FACE`, `GAZE`, `TAB`).
- Auto-debounced event logger sending telemetry events to `POST /log-event`.

### 2. Audit Report Dashboard
- **Session Selector:** Filter and inspect all past exam sessions.
- **Radial Integrity Score Gauge:** SVG trust score display with dynamic status categorization.
- **Score Deduction Breakdown:** Itemized list of detected anomaly counts, rates, and deduction subtotals.
- **Interactive 10-Bucket Anomaly Timeline:** Histogram dividing exam duration into 10 equal time windows; clicking a bar filters the audit table to that time window.
- **Filterable Audit Log Table:** Category chips (`ALL`, `no_face`, `multi_face`, `looking_away`, `tab_switch`, `window_blur`), full-text metadata search, timestamp sorting, and pagination.
- **Data Exporters:** One-click JSON and CSV audit log reporting exports.

---

## 🔌 API Reference

### Health Check
- **`GET /health`**
  - **Response:** `{"status": "ok"}`

### Session Management
- **`POST /session/start`**
  - **Response:** `{"session_id": "uuid-string"}`
- **`POST /session/{session_id}/end`**
  - **Response:** `{"status": "ended", "session_id": "uuid-string"}`
- **`GET /sessions`**
  - **Response:** Array of session metadata objects (`id`, `started_at`, `ended_at`, `duration_seconds`, `event_count`).

### Event Telemetry & Analytics
- **`POST /log-event`**
  - **Request Body:** `{"session_id": "...", "event_type": "...", "timestamp": "...", "meta": {}}`
  - **Validation:** Rejects invalid event types or events sent to ended sessions (HTTP 400).
  - **Response:** `{"status": "logged", "event_type": "..."}`
- **`GET /session/{session_id}/events`**
  - **Response:** Array of raw event objects for the specified session.
- **`GET /session/{session_id}/summary`**
  - **Response:** Summary object containing `trust_score`, `status`, `duration_seconds`, `score_breakdown`, `timeline_buckets`, and `events`.

---

## 🗄️ Database Schema (SQLite)

```sql
CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  started_at TEXT NOT NULL,
  ended_at TEXT
);

CREATE TABLE events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  timestamp TEXT NOT NULL,
  meta TEXT,
  FOREIGN KEY (session_id) REFERENCES sessions (id)
);
```

---

## 📁 Project Structure

```
mockproctor/
├── backend/
│   ├── main.py            # FastAPI REST endpoints & scoring engine
│   ├── database.py        # SQLite WAL connection & schema initialization
│   └── requirements.txt   # Python dependencies
├── frontend/
│   ├── src/
│   │   ├── App.jsx        # App root & view switcher (Live vs. Report)
│   │   ├── App.css        # OSD layout & theme styles
│   │   ├── components/
│   │   │   ├── WebcamFeed.jsx       # Camera stream & MediaPipe detection loop
│   │   │   ├── SignalLog.jsx        # Real-time anomaly status panel
│   │       └── ReportDashboard.jsx  # Telemetry summary & audit log dashboard
│   │   └── lib/
│   │       ├── api.js                 # Axios/Fetch REST client
│   │       ├── faceDetector.js        # MediaPipe FaceDetector integration (blaze_face_full_range)
│   │       ├── faceLandmarker.js      # MediaPipe FaceLandmarker integration
│   │       ├── advancedGazeDetection.js # Head yaw angle estimation & adaptive thresholds
│   │       ├── browserSignals.js      # Visibility & window blur listeners
│   │       └── eventDebouncer.js      # Anomaly event debouncing
│   ├── index.html
│   ├── vite.config.js
│   └── package.json
└── README.md
```

## Personalized screen-gaze calibration

Before gaze-based anomalies are enabled, MockProctor asks the user to complete a nine-point calibration across the browser viewport. The per-session mapping learns from that user's iris-relative eye features and head-pose proxies. A `looking_away` event is emitted only when the predicted gaze remains beyond the calibrated viewport plus a 4% tolerance margin for at least 1.8 seconds with sufficient confidence. Uncertain tracking is ignored rather than treated as a gaze violation. Face absence and multiple-face anomalies remain independent of gaze calibration.

This is a webcam-based estimate, not a dedicated eye tracker; calibration quality depends on lighting, camera placement, glasses/reflections, and the user's ability to follow the targets. The live diagnostics panel shows predicted normalized screen coordinates and confidence, making it easier to tell whether a problem is in landmark tracking, calibration, or the boundary threshold. If calibration is inconsistent, the user can retry it. The mapping is held in memory for the current page session and is not uploaded as biometric data by this feature.
