const BASE_URL = "http://localhost:8000";

export async function checkHealth() {
  const res = await fetch(`${BASE_URL}/health`);
  if (!res.ok) throw new Error("backend unreachable");
  return res.json();
}

export async function startSession() {
  const res = await fetch(`${BASE_URL}/session/start`, { method: "POST" });
  if (!res.ok) throw new Error("could not start session");
  return res.json();
}

export async function endSession(sessionId) {
  const res = await fetch(`${BASE_URL}/session/${sessionId}/end`, {
    method: "POST",
  });
  if (!res.ok) throw new Error("could not end session");
  return res.json();
}

export async function logEvent(sessionId, eventType, meta = {}) {
  const res = await fetch(`${BASE_URL}/log-event`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      session_id: sessionId,
      event_type: eventType,
      timestamp: new Date().toISOString(),
      meta,
    }),
  });
  if (!res.ok) throw new Error("could not log event");
  return res.json();
}
