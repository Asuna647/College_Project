import { useCallback, useEffect, useState } from "react";
import WebcamFeed from "./components/WebcamFeed.jsx";
import SignalLog from "./components/SignalLog.jsx";
import { checkHealth, startSession, endSession, logEvent } from "./lib/api.js";

export default function App() {
  const [backendOk, setBackendOk] = useState(false);
  const [sessionId, setSessionId] = useState(null);
  const [active, setActive] = useState(false);
  const [faceState, setFaceState] = useState("unknown");
  const [events, setEvents] = useState([]);

  useEffect(() => {
    checkHealth()
      .then(() => setBackendOk(true))
      .catch(() => setBackendOk(false));
  }, []);

  const handleStart = async () => {
    try {
      const { session_id } = await startSession();
      setSessionId(session_id);
      setEvents([]);
      setFaceState("unknown");
      setActive(true);
    } catch (err) {
      console.error(err);
    }
  };

  const handleEnd = async () => {
    setActive(false);
    if (sessionId) {
      try {
        await endSession(sessionId);
      } catch (err) {
        console.error(err);
      }
    }
  };

  const handleEvent = useCallback(
    (type) => {
      const time = new Date().toLocaleTimeString();
      setEvents((prev) => [{ type, time }, ...prev].slice(0, 50));
      if (sessionId) {
        logEvent(sessionId, type).catch((err) => console.error(err));
      }
    },
    [sessionId]
  );

  return (
    <div className="app">
      <div className="topbar">
        <div className="brand">
          MOCK<span>PROCTOR</span>
        </div>
        <div className="status-pill">
          <span className={`dot ${backendOk ? "ok" : ""}`} />
          {backendOk ? "backend connected" : "backend unreachable"}
          {sessionId && (
            <span style={{ marginLeft: 16 }}>session {sessionId.slice(0, 8)}</span>
          )}
        </div>
      </div>

      <div className="main-grid">
        <WebcamFeed active={active} onSignalChange={setFaceState} onEvent={handleEvent} />
        <SignalLog faceState={faceState} events={events} />
      </div>

      <div className="controls">
        <button className="primary" onClick={handleStart} disabled={active || !backendOk}>
          Start Session
        </button>
        <button className="danger" onClick={handleEnd} disabled={!active}>
          End Session
        </button>
      </div>
    </div>
  );
}
