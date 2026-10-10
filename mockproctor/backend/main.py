"""
MockProctor backend — Phase 0/1 scaffold.

Endpoints:
  GET  /health                     -> connectivity check for the frontend
  POST /session/start              -> creates a new proctoring session
  POST /session/{session_id}/end   -> marks a session as ended
  POST /log-event                  -> logs a timestamped anomaly event
  GET  /session/{session_id}/events -> returns all events for a session (used later, Phase 5)

Run with:
  uvicorn main:app --reload --port 8000
"""

import json
import uuid
from datetime import datetime, timezone

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from database import get_connection, init_db

app = FastAPI(title="MockProctor API")

# Vite's default dev server port. Update this if you deploy the frontend elsewhere.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
    allow_methods=["*"],
    allow_headers=["*"],
)

init_db()


class EventIn(BaseModel):
    session_id: str
    event_type: str
    timestamp: str
    meta: dict = {}


# Phase 4: Valid event types
VALID_EVENT_TYPES = {
    "no_face",        # Phase 1
    "multi_face",     # Phase 1
    "looking_away",   # Phase 2
    "tab_switch",     # Phase 3
    "window_blur",    # Phase 3
}

# Phase 5: Integrity score penalty mapping
PENALTY_WEIGHTS = {
    "multi_face": 15,
    "tab_switch": 10,
    "no_face": 10,
    "looking_away": 5,
    "window_blur": 5,
}


@app.get("/health")
def health():
    return {"status": "ok"}


@app.get("/sessions")
def list_sessions():
    conn = get_connection()
    rows = conn.execute(
        """
        SELECT
            s.id,
            s.started_at,
            s.ended_at,
            COUNT(e.id) as event_count
        FROM sessions s
        LEFT JOIN events e ON s.id = e.session_id
        GROUP BY s.id
        ORDER BY s.started_at DESC
        """
    ).fetchall()
    conn.close()

    result = []
    for r in rows:
        started = datetime.fromisoformat(r["started_at"]) if r["started_at"] else None
        ended = datetime.fromisoformat(r["ended_at"]) if r["ended_at"] else None
        duration = (ended - started).total_seconds() if (started and ended) else None

        result.append({
            "id": r["id"],
            "started_at": r["started_at"],
            "ended_at": r["ended_at"],
            "duration_seconds": round(duration, 1) if duration is not None else None,
            "event_count": r["event_count"],
        })
    return result


@app.post("/session/start")
def start_session():
    session_id = str(uuid.uuid4())
    conn = get_connection()
    conn.execute(
        "INSERT INTO sessions (id, started_at) VALUES (?, ?)",
        (session_id, datetime.now(timezone.utc).isoformat()),
    )
    conn.commit()
    conn.close()
    return {"session_id": session_id}


@app.post("/session/{session_id}/end")
def end_session(session_id: str):
    conn = get_connection()
    cur = conn.execute(
        "UPDATE sessions SET ended_at = ? WHERE id = ?",
        (datetime.now(timezone.utc).isoformat(), session_id),
    )
    conn.commit()
    conn.close()
    if cur.rowcount == 0:
        raise HTTPException(status_code=404, detail="session not found")
    return {"status": "ended", "session_id": session_id}


@app.post("/log-event")
def log_event(event: EventIn):
    # Phase 4: Validate session exists and is not ended
    conn = get_connection()
    session = conn.execute(
        "SELECT ended_at FROM sessions WHERE id = ?",
        (event.session_id,)
    ).fetchone()

    if not session:
        conn.close()
        raise HTTPException(status_code=404, detail="Session not found")

    if session['ended_at']:
        conn.close()
        raise HTTPException(status_code=400, detail="Session already ended")

    # Phase 4: Validate event type
    if event.event_type not in VALID_EVENT_TYPES:
        conn.close()
        raise HTTPException(
            status_code=400,
            detail=f"Invalid event_type. Must be one of: {', '.join(sorted(VALID_EVENT_TYPES))}"
        )

    # Phase 4: Log event with validation
    conn.execute(
        "INSERT INTO events (session_id, event_type, timestamp, meta) VALUES (?, ?, ?, ?)",
        (event.session_id, event.event_type, event.timestamp, json.dumps(event.meta)),
    )
    conn.commit()
    conn.close()

    return {"status": "logged", "event_type": event.event_type}


@app.get("/session/{session_id}/events")
def get_events(session_id: str):
    conn = get_connection()
    rows = conn.execute(
        "SELECT event_type, timestamp, meta FROM events WHERE session_id = ? ORDER BY timestamp",
        (session_id,),
    ).fetchall()
    conn.close()
    return [dict(row) for row in rows]


@app.get("/session/{session_id}/summary")
def get_session_summary(session_id: str):
    conn = get_connection()
    session = conn.execute(
        "SELECT id, started_at, ended_at FROM sessions WHERE id = ?",
        (session_id,)
    ).fetchone()

    if not session:
        conn.close()
        raise HTTPException(status_code=404, detail="Session not found")

    event_rows = conn.execute(
        "SELECT id, event_type, timestamp, meta FROM events WHERE session_id = ? ORDER BY timestamp ASC",
        (session_id,)
    ).fetchall()
    conn.close()

    events = []
    event_type_counts = {k: 0 for k in PENALTY_WEIGHTS.keys()}

    for row in event_rows:
        meta_data = {}
        if row["meta"]:
            try:
                meta_data = json.loads(row["meta"])
            except Exception:
                meta_data = {}

        etype = row["event_type"]
        if etype in event_type_counts:
            event_type_counts[etype] += 1

        events.append({
            "id": row["id"],
            "event_type": etype,
            "timestamp": row["timestamp"],
            "meta": meta_data,
        })

    total_penalty = sum(event_type_counts[etype] * PENALTY_WEIGHTS[etype] for etype in PENALTY_WEIGHTS)
    trust_score = max(0, 100 - total_penalty)

    if trust_score >= 85:
        status = "VERIFIED"
    elif trust_score >= 60:
        status = "FLAGGED"
    else:
        status = "VIOLATION"

    started_dt = datetime.fromisoformat(session["started_at"]) if session["started_at"] else None
    ended_dt = datetime.fromisoformat(session["ended_at"]) if session["ended_at"] else datetime.now(timezone.utc)

    if started_dt and ended_dt and ended_dt > started_dt:
        total_duration = (ended_dt - started_dt).total_seconds()
    else:
        total_duration = 1.0

    bucket_count = 10
    bucket_duration = max(0.1, total_duration / bucket_count)
    timeline_buckets = [
        {
            "bucket": i,
            "count": 0,
            "start_offset": round(i * bucket_duration, 1),
            "end_offset": round((i + 1) * bucket_duration, 1)
        }
        for i in range(bucket_count)
    ]

    for ev in events:
        try:
            ev_dt = datetime.fromisoformat(ev["timestamp"])
            offset = (ev_dt - started_dt).total_seconds()
            b_idx = min(bucket_count - 1, max(0, int(offset // bucket_duration)))
            timeline_buckets[b_idx]["count"] += 1
        except Exception:
            pass

    score_breakdown = [
        {
            "event_type": etype,
            "count": event_type_counts[etype],
            "penalty_per_event": PENALTY_WEIGHTS[etype],
            "total_deduction": event_type_counts[etype] * PENALTY_WEIGHTS[etype]
        }
        for etype in PENALTY_WEIGHTS
    ]

    duration_seconds = round((ended_dt - started_dt).total_seconds(), 1) if (started_dt and ended_dt) else 0

    return {
        "session_id": session["id"],
        "started_at": session["started_at"],
        "ended_at": session["ended_at"],
        "duration_seconds": duration_seconds,
        "trust_score": trust_score,
        "status": status,
        "total_events": len(events),
        "event_counts": event_type_counts,
        "score_breakdown": score_breakdown,
        "timeline_buckets": timeline_buckets,
        "events": events
    }
