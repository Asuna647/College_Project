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


@app.get("/health")
def health():
    return {"status": "ok"}


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
    conn = get_connection()
    conn.execute(
        "INSERT INTO events (session_id, event_type, timestamp, meta) VALUES (?, ?, ?, ?)",
        (event.session_id, event.event_type, event.timestamp, json.dumps(event.meta)),
    )
    conn.commit()
    conn.close()
    return {"status": "logged"}


@app.get("/session/{session_id}/events")
def get_events(session_id: str):
    conn = get_connection()
    rows = conn.execute(
        "SELECT event_type, timestamp, meta FROM events WHERE session_id = ? ORDER BY timestamp",
        (session_id,),
    ).fetchall()
    conn.close()
    return [dict(row) for row in rows]
