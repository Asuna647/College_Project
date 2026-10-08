# MockProctor — Exam Anomaly Detection System

## ⚠️ Critical Disclaimer

**MockProctor detects behavioral anomalies, not proof of cheating.** This system logs suspicious patterns (looking away, multiple faces, tab switches, window blur) to assist educators in identifying sessions that warrant human review. It does not prevent cheating, does not prove guilt, and should never be used as the sole basis for academic discipline.

**False positives are expected and common.** Students look away while thinking, have roommates pass by, need to reference assignment instructions—all legitimate behaviors that trigger anomalies. Institutional policy must require human review with full context before any action is taken.

---

## What This Project Teaches

This is a **learning project**, not a production proctoring solution. It demonstrates:

✅ Real-time computer vision in the browser (MediaPipe Face Detection)  
✅ Full-stack JavaScript + Python integration (React/Vite + FastAPI)  
✅ Event-sourced architecture (immutable audit logs)  
✅ Client-server state synchronization with debouncing  

❌ It does NOT reliably prevent cheating  
❌ It does NOT scale to institutional deployment without major overhaul  
❌ It should NOT be used for high-stakes academic decisions  

---

## Quick Start

### Prerequisites
- Node.js 18+
- Python 3.10+
- Modern browser with webcam access

### Local Development

**1. Install backend dependencies**
```bash
cd backend
python -m venv venv
source venv/bin/activate  # Windows: venv\Scripts\activate
pip install -r requirements.txt
```

**2. Start backend (from `backend/` directory)**
```bash
uvicorn main:app --reload --port 8000
```

**3. Install frontend dependencies (from `frontend/` directory)**
```bash
npm install
```

**4. Start frontend dev server (from `frontend/` directory)**
```bash
npm run dev
```

**5. Open browser**
```
http://localhost:5173
```

You should see the MockProctor UI. Click "Start Session" to begin webcam monitoring.

---

## How It Works

### Detection Flow

```
Browser
├─ WebcamFeed reads video stream
│  └─ MediaPipe FaceDetector runs inference on each frame (~30fps)
│
├─ Face Detection Signals (Phase 1 ✅)
│  ├─ No faces detected for 45+ frames (~1.5s) → "no_face" event
│  └─ 2+ faces detected for 10+ frames (~0.3s) → "multi_face" event
│
├─ Gaze Detection Signals (Phase 2 🚧)
│  └─ Head yaw exceeds ±25° for 5+ seconds → "looking_away" event
│
├─ Browser Signals (Phase 3 🚧)
│  ├─ Page hidden (tab switch) → "tab_switch" event
│  └─ Window loses focus → "window_blur" event
│
└─ Event Multiplexer debounces and sends to backend
   └─ POST /log-event with {session_id, event_type, timestamp, confidence}

Backend
├─ Validates event and writes to SQLite
├─ Each event is immutable (never updated or deleted)
└─ Report endpoint aggregates events for human review
```

### Data Model

**Sessions Table**
```sql
CREATE TABLE sessions (
  id TEXT PRIMARY KEY,           -- UUID generated on /session/start
  started_at TEXT NOT NULL,      -- ISO8601 timestamp
  ended_at TEXT                  -- ISO8601 timestamp (nullable until /session/{id}/end)
);
```

**Events Table**
```sql
CREATE TABLE events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL,      -- Foreign key to sessions.id
  event_type TEXT NOT NULL,      -- Enum: no_face, multi_face, looking_away, tab_switch, window_blur
  timestamp TEXT NOT NULL,       -- ISO8601 when event was detected
  meta TEXT                      -- JSON: optional {confidence, duration}
);
```

---

## API Reference

### Health Check
```
GET /health
Response: { "status": "ok" }
```

### Start Session
```
POST /session/start
Response: { "session_id": "550e8400-e29b-41d4-a716-446655440000" }
```

### End Session
```
POST /session/{session_id}/end
Response: { "status": "ended", "session_id": "..." }
```

### Log Event
```
POST /log-event
Body: {
  "session_id": "550e8400-e29b-41d4-a716-446655440000",
  "event_type": "no_face",
  "timestamp": "2026-10-08T13:00:00.000Z",
  "meta": { "confidence": 0.92 }
}
Response: { "status": "logged" }
```

### Get Session Events (for report aggregation)
```
GET /session/{session_id}/events
Response: [
  { "event_type": "no_face", "timestamp": "2026-10-08T13:00:05.000Z", "meta": "{...}" },
  { "event_type": "tab_switch", "timestamp": "2026-10-08T13:00:12.000Z", "meta": "{...}" }
]
```

---

## Roadmap & Implementation Status

| Phase | Goal | Status | Est. Time |
|-------|------|--------|-----------|
| **0** | Environment setup, architecture locked | ✅ Done | 2–3 days |
| **1** | Face detection (no face, multiple faces) | ✅ Done | 1 week |
| **2** | Gaze detection (looking away) | 🚧 In Progress | 1 week |
| **3** | Browser signals (tab switch, blur) | ⏳ Queued | 2–3 days |
| **4** | Event pipeline polish, end-to-end testing | ⏳ Queued | 1 week |
| **5** | Report dashboard + aggregation UI | ⏳ Queued | 1 week |
| **6** | Error handling, README, ethical considerations, deploy | ⏳ Queued | 1 week |

---

## Architecture Overview

See [`ARCHITECTURE.md`](./ARCHITECTURE.md) for detailed system design, data flows, and scaling considerations.

**Key principles:**
- **Client-side detection:** All real-time inference happens in the browser using MediaPipe (no backend ML required).
- **Event-sourced backend:** SQLite stores immutable, append-only event records. Reports are computed from raw events.
- **Stateless API:** Backend has no session state; it only validates and stores events.
- **Human-in-the-loop:** Anomalies are logged but never acted upon automatically. Humans review before any decision.

---

## Known Limitations & Why This Isn't a Real Solution

### The Fundamental Problem

Behavioral anomaly detection **cannot prove cheating.** It can only flag suspicious patterns. Consider these gaps:

1. **False Positives Are Inevitable**
   - Student looks away while thinking → Flagged as "looking away"
   - Roommate walks past camera → Flagged as "multiple faces"
   - Student checks assignment instructions on second monitor → Flagged as "tab switch"
   - **None of these are cheating.** Your system treats them as anomalies.

2. **True Cheaters Often Go Undetected**
   - Uses a second device outside camera frame (phone, tablet, second monitor)
   - Pre-memorizes answers before exam starts
   - Receives answers via earpiece or text
   - Uses browser extensions to intercept video or spoof camera
   - **Your system catches none of these.**

3. **Gaming Is Trivial**
   - Disable camera permissions (browser will show warning, exam proceeds anyway)
   - Use a virtual background or webcam hijacker
   - Use eye-tracking glasses to maintain center gaze while reading off-screen notes
   - Have a second person wearing similar clothing sit in view

4. **Privacy & Legal Risk**
   - Continuous facial data collection requires explicit consent and legal review
   - Biometric data is regulated under GDPR, BIPA, and other frameworks
   - False accusations expose institutions to discrimination lawsuits
   - Student union protests likely (see: ProctorU backlash)

5. **Scale & Performance**
   - SQLite is single-writer; saturates under 100+ concurrent exams
   - No real-time alerting to instructors (polling only)
   - Report generation is O(n) per session; slow on large datasets
   - No mechanism to prevent students from tampering with events

### What Actually Works

**Real proctoring systems use:**
1. **Prevention:** Locked browser, no alt-tab, no second monitors (enforced via OS/browser controls)
2. **Proof:** Content-aware anomaly detection (answer patterns, timing anomalies, keystroke dynamics)
3. **Humans:** Real proctors reviewing suspicious sessions in real-time (ProctorU model)
4. **Legal backing:** Clear institutional policy + consent + escalation procedures

MockProctor does none of these. It's an observation tool, not a proctoring system.

---

## Development & Testing

### Running Tests (Phase 5+)
```bash
# Frontend tests (Vitest)
cd frontend && npm run test

# Backend tests (pytest)
cd backend && pytest tests/
```

### Manual Testing Checklist

**Phase 1 (Face Detection)**
- [ ] Start session, show face to camera → bounding box appears
- [ ] Cover camera → "no_face" event fires within 2 seconds
- [ ] Hold up two objects side-by-side → "multi_face" event fires within 0.5s

**Phase 2 (Gaze Detection)**
- [ ] Start session, turn head to 30° → "looking_away" event fires within 5s
- [ ] Small head movements don't trigger false positives

**Phase 3 (Browser Signals)**
- [ ] Start session, switch to another tab → "tab_switch" event fires immediately
- [ ] Click outside browser window → "window_blur" event fires immediately

**Phase 5 (Report)**
- [ ] After session, navigate to report page
- [ ] Report shows accurate event counts and timeline
- [ ] Integrity score reflects anomaly density

---

## Ethical Considerations

### Why Surveillance Isn't Education

Continuous webcam monitoring raises serious questions:

- **Does it teach integrity?** No. It teaches students they're not trusted.
- **Does it prevent cheating?** No. It only detects observable behavioral anomalies, which overlap significantly with legitimate behavior.
- **Is it proportional?** Unlikely. You're collecting biometric + behavioral data to flag 0.1% of attempts that look suspicious.
- **Is there consent?** Often no. Students in online courses are often presented with proctoring as a requirement, not an option.

### Institutional Use Requires

1. **Explicit consent:** Students must opt-in with clear understanding of data collection.
2. **Legal review:** Compliance with FERPA, GDPR, state biometrics laws, institutional policy.
3. **Human oversight:** No automated academic action based on anomaly logs. Always human review first.
4. **Transparency:** Students must know what signals are monitored and how they're weighted.
5. **Appeal process:** Students flagged for anomalies must have a clear path to challenge the finding.

### Better Alternatives

- **Randomized, re-randomized exams:** Reduce collaboration value (everyone gets different Q order)
- **Take-home assessments:** Shift to portfolio/project-based evaluation where collaboration is feature, not bug
- **Timed short-answer:** Reduce time for looking things up; increase depth of reasoning
- **Keystroke dynamics + answer patterns:** Detect actual cheating signals (not "looks suspicious")
- **Proactive support:** Office hours, tutoring, review sessions—address root cause of cheating pressure

---

## Deployment (Phase 6)

### Local-Only (Classroom/Testing)
No special setup needed; run dev servers locally.

### Production Deployment

**Frontend (React SPA) → Vercel/Netlify**
```bash
npm run build
# Upload dist/ directory to Vercel or Netlify
```

**Backend (FastAPI) → Render/Railway**
```bash
# Push to Render or Railway git integration
# Set environment variables: DATABASE_URL, CORS_ORIGINS
uvicorn main:app --host 0.0.0.0 --port 8000
```

⚠️ **Before deploying:**
- [ ] Replace localhost CORS origin with actual frontend URL
- [ ] Enable HTTPS at reverse proxy (mandatory)
- [ ] Add authentication & authorization (JWT + RBAC)
- [ ] Implement database encryption and backups
- [ ] Get legal/compliance review for data handling
- [ ] Write privacy policy and data retention guidelines

---

## Project Structure

```
mockproctor/
├── frontend/                      # React SPA
│   ├── src/
│   │   ├── App.jsx               # Root component, session state
│   │   ├── components/
│   │   │   ├── WebcamFeed.jsx   # Video + face detection loop
│   │   │   └── SignalLog.jsx    # Event log + signal status UI
│   │   ├── lib/
│   │   │   ├── faceDetector.js  # MediaPipe wrapper
│   │   │   ├── faceLandmarker.js # [Phase 2] Gaze estimation
│   │   │   └── api.js            # HTTP client
│   │   └── main.jsx
│   ├── vite.config.js
│   └── package.json
│
├── backend/                       # FastAPI
│   ├── main.py                   # REST endpoints
│   ├── database.py               # SQLite helpers
│   ├── models.py                 # [Phase 4+] Pydantic schemas
│   ├── requirements.txt
│   └── mockproctor.db            # SQLite file
│
├── ARCHITECTURE.md               # System design & internals
└── README.md                     # This file

```

---

## Contributing & Next Steps

### For Developers
1. Read [`ARCHITECTURE.md`](./ARCHITECTURE.md) for system design
2. Pick a phase from the roadmap above
3. Follow the "done when" criteria to know when to move on

### For Educators Considering This
Please don't. Use established proctoring services or shift your assessment model. This project is educational, not production-ready.

### For Researchers
This codebase is a good foundation for exploring:
- Gaze estimation accuracy and false-positive rates
- Event debouncing strategies for behavioral signals
- Privacy-preserving alternatives to continuous video monitoring
- How far behavioral signals correlate with actual cheating (spoiler: not far)

---

## Questions or Feedback?

See [`ARCHITECTURE.md`](./ARCHITECTURE.md) for technical Q&A. For ethical concerns, start with the "Ethical Considerations" section above.
