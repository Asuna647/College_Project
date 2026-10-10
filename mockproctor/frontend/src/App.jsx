import { useCallback, useEffect, useState } from "react";
import WebcamFeed from "./components/WebcamFeed.jsx";
import SignalLog from "./components/SignalLog.jsx";
import ReportDashboard from "./components/ReportDashboard.jsx";
import { checkHealth, startSession, endSession, logEvent } from "./lib/api.js";

export default function App() {
  const [backendOk, setBackendOk] = useState(false);
  const [sessionId, setSessionId] = useState(null);
  const [active, setActive] = useState(false);
  const [faceState, setFaceState] = useState("unknown");
  const [gazeState, setGazeState] = useState("unknown");
  const [tabState, setTabState] = useState("unknown"); // Phase 3: TAB FOCUS state
  const [events, setEvents] = useState([]);

  // Phase 5: View switcher state ('live' | 'report')
  const [view, setView] = useState("live");
  const [selectedReportSessionId, setSelectedReportSessionId] = useState("");

  useEffect(() => {
    checkHealth()
      .then(() => setBackendOk(true))
      .catch(() => setBackendOk(false));
  }, []);

  const handleStart = async () => {
    try {
      const { session_id } = await startSession();
      setSessionId(session_id);
      setSelectedReportSessionId(session_id);
      setEvents([]);
      setFaceState("unknown");
      setGazeState("unknown");
      setTabState("ok");
      setActive(true);
      setView("live");
    } catch (err) {
      console.error(err);
    }
  };

  const handleEnd = async () => {
    setActive(false);
    if (sessionId) {
      try {
        await endSession(sessionId);
        setSelectedReportSessionId(sessionId);
      } catch (err) {
        console.error(err);
      }
    }
    // Auto-switch to report dashboard when live session ends
    setView("report");
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

        {/* Phase 5: View Switcher Navigation */}
        <div className="view-switcher" role="tablist" aria-label="Main View Selector">
          <button
            className={`nav-tab ${view === "live" ? "active" : ""}`}
            onClick={() => setView("live")}
            role="tab"
            aria-selected={view === "live"}
          >
            🔴 LIVE PROCTORING
          </button>
          <button
            className={`nav-tab ${view === "report" ? "active" : ""}`}
            onClick={() => setView("report")}
            role="tab"
            aria-selected={view === "report"}
          >
            📊 REPORT DASHBOARD
          </button>
        </div>

        <div className="status-pill">
          <span className={`dot ${backendOk ? "ok" : ""}`} />
          {backendOk ? "backend connected" : "backend unreachable"}
          {sessionId && (
            <span style={{ marginLeft: 16 }}>session {sessionId.slice(0, 8)}</span>
          )}
        </div>
      </div>

      {view === "live" ? (
        <>
          <div className="main-grid">
            <WebcamFeed
              active={active}
              onSignalChange={setFaceState}
              onGazeChange={setGazeState}
              onTabChange={setTabState}
              onEvent={handleEvent}
            />
            <SignalLog
              faceState={faceState}
              gazeState={gazeState}
              tabState={tabState}
              events={events}
            />
          </div>

          <div className="controls">
            <button className="primary" onClick={handleStart} disabled={active || !backendOk}>
              Start Session
            </button>
            <button className="danger" onClick={handleEnd} disabled={!active}>
              End Session &amp; Generate Report
            </button>
          </div>
        </>
      ) : (
        <ReportDashboard initialSessionId={selectedReportSessionId} />
      )}
    </div>
  );
}
