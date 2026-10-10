export default function SignalLog({ faceState, gazeState, tabState, events }) {
  const signals = [
    { key: "face", label: "FACE LOCK", tag: "PHASE 1", status: faceDotClass(faceState) },
    { key: "gaze", label: "GAZE", tag: "PHASE 2", status: gazeDotClass(gazeState) },
    { key: "tab", label: "TAB FOCUS", tag: "PHASE 3", status: tabDotClass(tabState) },
  ];

  return (
    <div className="signal-panel">
      <div className="panel-block">
        <h3>Signal Status</h3>
        {signals.map((signal) => (
          <div className="signal-row" key={signal.key}>
            <span className={`dot ${signal.status}`} />
            <span className="label">{signal.label}</span>
            <span className="tag">{signal.tag}</span>
          </div>
        ))}
      </div>

      <div className="panel-block">
        <h3>Event Log</h3>
        <div className="event-log">
          {events.length === 0 && <div className="entry">no anomalies logged yet</div>}
          {events.map((event, i) => (
            <div className={`entry ${event.type !== "ok" ? "alert" : ""}`} key={i}>
              <span className="t">{event.time}</span>
              {formatEventType(event.type)}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function faceDotClass(state) {
  if (state === "ok") return "ok";
  if (state === "no_face" || state === "multi_face") return "rec";
  return "";
}

function gazeDotClass(state) {
  if (state === "ok") return "ok";
  if (state === "looking_away") return "rec";
  return "";
}

function tabDotClass(state) {
  if (state === "ok") return "ok";
  if (state === "tab_switch" || state === "window_blur") return "rec";
  return "";
}

function formatEventType(type) {
  return type.replace(/_/g, " ");
}
