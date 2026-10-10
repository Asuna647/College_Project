import { useEffect, useState, useMemo } from "react";
import { getSessions, getSessionSummary } from "../lib/api.js";

export default function ReportDashboard({ initialSessionId }) {
  const [sessions, setSessions] = useState([]);
  const [selectedSessionId, setSelectedSessionId] = useState(initialSessionId || "");
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  // Table filters & state
  const [activeFilter, setActiveFilter] = useState("ALL");
  const [searchQuery, setSearchQuery] = useState("");
  const [sortAsc, setSortAsc] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const [selectedTimeBucket, setSelectedTimeBucket] = useState(null);

  const PAGE_SIZE = 10;

  // Fetch session list on mount
  useEffect(() => {
    fetchSessionList();
  }, []);

  const fetchSessionList = async () => {
    try {
      const data = await getSessions();
      setSessions(data);
      if (!selectedSessionId && data.length > 0) {
        setSelectedSessionId(data[0].id);
      }
    } catch (err) {
      console.error("Failed to load sessions:", err);
    }
  };

  // Sync initialSessionId prop if changed externally
  useEffect(() => {
    if (initialSessionId) {
      setSelectedSessionId(initialSessionId);
    }
  }, [initialSessionId]);

  // Load summary whenever selectedSessionId changes
  useEffect(() => {
    if (!selectedSessionId) return;
    setLoading(true);
    setError(null);
    setSelectedTimeBucket(null);
    setCurrentPage(1);

    getSessionSummary(selectedSessionId)
      .then((data) => {
        setSummary(data);
        setLoading(false);
      })
      .catch((err) => {
        console.error("Failed to load session summary:", err);
        setError("Failed to fetch session telemetry summary");
        setLoading(false);
      });
  }, [selectedSessionId]);

  // Filter & search events
  const filteredEvents = useMemo(() => {
    if (!summary || !summary.events) return [];

    let result = [...summary.events];

    // Event type filter chip
    if (activeFilter !== "ALL") {
      result = result.filter((e) => e.event_type === activeFilter);
    }

    // Timeline bucket filter
    if (selectedTimeBucket !== null && summary.timeline_buckets[selectedTimeBucket]) {
      const bucket = summary.timeline_buckets[selectedTimeBucket];
      const startedDt = summary.started_at ? new Date(summary.started_at).getTime() : 0;

      result = result.filter((e) => {
        const evTime = new Date(e.timestamp).getTime();
        const offsetSec = (evTime - startedDt) / 1000;
        return offsetSec >= bucket.start_offset && offsetSec <= bucket.end_offset;
      });
    }

    // Search query
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      result = result.filter(
        (e) =>
          e.event_type.toLowerCase().includes(q) ||
          e.timestamp.toLowerCase().includes(q) ||
          JSON.stringify(e.meta).toLowerCase().includes(q)
      );
    }

    // Sort timestamp
    result.sort((a, b) => {
      const tA = new Date(a.timestamp).getTime();
      const tB = new Date(b.timestamp).getTime();
      return sortAsc ? tA - tB : tB - tA;
    });

    return result;
  }, [summary, activeFilter, searchQuery, sortAsc, selectedTimeBucket]);

  // Pagination calculation
  const totalPages = Math.max(1, Math.ceil(filteredEvents.length / PAGE_SIZE));
  const paginatedEvents = useMemo(() => {
    const start = (currentPage - 1) * PAGE_SIZE;
    return filteredEvents.slice(start, start + PAGE_SIZE);
  }, [filteredEvents, currentPage]);

  // Export handlers
  const exportJSON = () => {
    if (!summary) return;
    const blob = new Blob([JSON.stringify(summary, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `mockproctor-session-${summary.session_id.slice(0, 8)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const exportCSV = () => {
    if (!summary) return;
    const sanitizeCsvField = (val) => {
      const str = String(val ?? "");
      if (/^[=+\-@\t\r]/.test(str)) {
        return `'${str}`;
      }
      return str;
    };

    const headers = ["Event ID", "Event Type", "Timestamp", "Metadata Details"].map(sanitizeCsvField);
    const rows = summary.events.map((e) => {
      const id = sanitizeCsvField(e.id);
      const type = sanitizeCsvField(e.event_type);
      const ts = sanitizeCsvField(e.timestamp);
      const rawMeta = JSON.stringify(e.meta);
      const meta = sanitizeCsvField(rawMeta).replace(/"/g, '""');
      return [id, type, ts, `"${meta}"`];
    });

    const csvContent = [headers.join(","), ...rows.map((r) => r.join(","))].join("\n");

    const blob = new Blob([csvContent], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `mockproctor-session-${summary.session_id.slice(0, 8)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // Helper for Status badge styles
  const getStatusBadge = (status) => {
    switch (status) {
      case "VERIFIED":
        return { label: "VERIFIED INTEGRITY", colorClass: "status-verified" };
      case "FLAGGED":
        return { label: "FLAGGED FOR REVIEW", colorClass: "status-flagged" };
      case "VIOLATION":
        return { label: "CRITICAL VIOLATION", colorClass: "status-violation" };
      default:
        return { label: "UNKNOWN", colorClass: "" };
    }
  };

  return (
    <div className="report-dashboard" role="region" aria-label="MockProctor Session Report Dashboard">
      {/* Module 1: Top Controls & Session Picker */}
      <div className="dashboard-header">
        <div className="session-selector-group">
          <label htmlFor="session-select" className="dashboard-label">
            PROCTORING AUDIT SESSION:
          </label>
          <select
            id="session-select"
            className="session-dropdown"
            value={selectedSessionId}
            onChange={(e) => setSelectedSessionId(e.target.value)}
          >
            {sessions.map((s) => (
              <option key={s.id} value={s.id}>
                {new Date(s.started_at).toLocaleString()} | ID: {s.id.slice(0, 8)}... ({s.event_count} events)
              </option>
            ))}
          </select>
          <button
            className="refresh-btn"
            onClick={fetchSessionList}
            title="Refresh session list"
            aria-label="Refresh session list"
          >
            ↻ REFRESH
          </button>
        </div>

        <div className="export-btn-group">
          <button
            className="export-btn json"
            onClick={exportJSON}
            disabled={!summary}
            aria-label="Export report as JSON file"
          >
            📄 EXPORT JSON
          </button>
          <button
            className="export-btn csv"
            onClick={exportCSV}
            disabled={!summary}
            aria-label="Export audit log as CSV file"
          >
            📊 EXPORT CSV
          </button>
        </div>
      </div>

      {loading && (
        <div className="dashboard-status-msg" aria-live="polite">
          <span className="spinner">⏳</span> Fetching session telemetry and computing trust score...
        </div>
      )}

      {error && (
        <div className="dashboard-status-msg error" role="alert">
          ⚠️ {error}
        </div>
      )}

      {!loading && !summary && !error && (
        <div className="dashboard-status-msg">No proctoring session selected. Select a session above.</div>
      )}

      {summary && !loading && (
        <>
          {/* Module 2: Trust Score & Status Card */}
          <div className="summary-cards-grid">
            <div className="trust-score-card">
              <div className="gauge-container">
                <svg className="trust-gauge-svg" viewBox="0 0 120 120">
                  <circle className="gauge-bg" cx="60" cy="60" r="50" />
                  <circle
                    className={`gauge-progress ${getStatusBadge(summary.status).colorClass}`}
                    cx="60"
                    cy="60"
                    r="50"
                    style={{
                      strokeDasharray: 314,
                      strokeDashoffset: 314 - (314 * summary.trust_score) / 100,
                    }}
                  />
                </svg>
                <div className="gauge-value">
                  <span className="score-num">{summary.trust_score}%</span>
                  <span className="score-label">TRUST SCORE</span>
                </div>
              </div>

              <div className="trust-status-info">
                <div className={`status-badge ${getStatusBadge(summary.status).colorClass}`}>
                  {getStatusBadge(summary.status).label}
                </div>
                <div className="meta-list">
                  <div>
                    <span className="meta-key">DURATION:</span>{" "}
                    <span className="meta-val">
                      {Math.floor(summary.duration_seconds / 60)}m {Math.round(summary.duration_seconds % 60)}s
                    </span>
                  </div>
                  <div>
                    <span className="meta-key">TOTAL ANOMALIES:</span>{" "}
                    <span className="meta-val">{summary.total_events}</span>
                  </div>
                  <div>
                    <span className="meta-key">START:</span>{" "}
                    <span className="meta-val">
                      {new Date(summary.started_at).toLocaleTimeString()}
                    </span>
                  </div>
                </div>
              </div>
            </div>

            {/* Score Penalty Breakdown */}
            <div className="breakdown-card">
              <h3 className="card-title">SCORE DEDUCTION BREAKDOWN</h3>
              <div className="breakdown-table">
                <div className="breakdown-header">
                  <span>ANOMALY TYPE</span>
                  <span>COUNT</span>
                  <span>PENALTY</span>
                  <span>SUBTOTAL</span>
                </div>
                {summary.score_breakdown.map((item) => (
                  <div key={item.event_type} className="breakdown-row">
                    <span className="event-name">{item.event_type.replace("_", " ").toUpperCase()}</span>
                    <span className="event-count">{item.count}</span>
                    <span className="event-rate">-{item.penalty_per_event} pts</span>
                    <span className="event-deduction">-{item.total_deduction} pts</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Module 3: Anomaly Timeline Histogram */}
          <div className="timeline-card">
            <div className="timeline-header">
              <h3>ANOMALY DENSITY TIMELINE (10 TIME BUCKETS)</h3>
              {selectedTimeBucket !== null && (
                <button
                  className="clear-bucket-btn"
                  onClick={() => setSelectedTimeBucket(null)}
                  aria-label="Clear timeline bucket filter"
                >
                  ✕ Clear Time Filter (Bucket {selectedTimeBucket + 1})
                </button>
              )}
            </div>
            <p className="timeline-subtext">Click any bucket to filter event table by time window</p>

            <div className="timeline-bars-grid" role="group" aria-label="Anomaly timeline histogram">
              {summary.timeline_buckets.map((b) => {
                const maxBucketCount = Math.max(1, ...summary.timeline_buckets.map((x) => x.count));
                const heightPercent = Math.min(100, Math.max(10, (b.count / maxBucketCount) * 100));

                const isSelected = selectedTimeBucket === b.bucket;

                return (
                  <button
                    key={b.bucket}
                    className={`timeline-bar-wrapper ${isSelected ? "selected" : ""}`}
                    onClick={() =>
                      setSelectedTimeBucket(isSelected ? null : b.bucket)
                    }
                    tabIndex={0}
                    aria-label={`Time window ${b.start_offset}s to ${b.end_offset}s, ${b.count} anomalies recorded`}
                  >
                    <div className="bar-count-label">{b.count}</div>
                    <div className="bar-track">
                      <div
                        className={`bar-fill ${b.count > 0 ? "has-events" : ""}`}
                        style={{ height: `${heightPercent}%` }}
                      />
                    </div>
                    <div className="bar-time-label">{Math.round(b.start_offset)}s</div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Module 4: Aggregated Event Table */}
          <div className="event-log-section">
            <div className="table-controls">
              <div className="filter-chips" role="toolbar" aria-label="Filter events by anomaly category">
                {[
                  "ALL",
                  "no_face",
                  "multi_face",
                  "looking_away",
                  "tab_switch",
                  "window_blur",
                ].map((chip) => (
                  <button
                    key={chip}
                    className={`filter-chip ${activeFilter === chip ? "active" : ""}`}
                    onClick={() => {
                      setActiveFilter(chip);
                      setCurrentPage(1);
                    }}
                    tabIndex={0}
                    aria-selected={activeFilter === chip}
                  >
                    {chip.replace("_", " ").toUpperCase()}
                  </button>
                ))}
              </div>

              <div className="search-sort-group">
                <input
                  type="text"
                  className="table-search-input"
                  placeholder="Search timestamp / meta..."
                  value={searchQuery}
                  onChange={(e) => {
                    setSearchQuery(e.target.value);
                    setCurrentPage(1);
                  }}
                  aria-label="Search event records"
                />
                <button
                  className="sort-toggle-btn"
                  onClick={() => setSortAsc(!sortAsc)}
                  title="Toggle timestamp sort order"
                  aria-label={`Sort timestamp ${sortAsc ? "ascending" : "descending"}`}
                >
                  {sortAsc ? "▲ OLDEST FIRST" : "▼ NEWEST FIRST"}
                </button>
              </div>
            </div>

            {/* Screen Reader Live Region */}
            <div className="sr-only" aria-live="polite">
              Showing {filteredEvents.length} matching proctoring events. Page {currentPage} of {totalPages}.
            </div>

            <div className="table-responsive-container">
              <table className="audit-table" role="table" aria-label="Proctoring Anomaly Log">
                <thead>
                  <tr>
                    <th scope="col">TIME</th>
                    <th scope="col">EVENT TYPE</th>
                    <th scope="col">SEVERITY</th>
                    <th scope="col">METADATA DETAILS</th>
                  </tr>
                </thead>
                <tbody>
                  {paginatedEvents.length === 0 ? (
                    <tr>
                      <td colSpan="4" className="empty-table-msg">
                        No anomaly events match the selected criteria.
                      </td>
                    </tr>
                  ) : (
                    paginatedEvents.map((ev) => (
                      <tr key={ev.id || ev.timestamp}>
                        <td className="time-cell">
                          {new Date(ev.timestamp).toLocaleTimeString()}
                        </td>
                        <td className="event-type-cell">
                          <span className={`event-tag tag-${ev.event_type}`}>
                            {ev.event_type.replace("_", " ").toUpperCase()}
                          </span>
                        </td>
                        <td className="severity-cell">
                          {["no_face", "multi_face"].includes(ev.event_type) ? (
                            <span className="severity-badge high">HIGH</span>
                          ) : ["tab_switch"].includes(ev.event_type) ? (
                            <span className="severity-badge med">MEDIUM</span>
                          ) : (
                            <span className="severity-badge low">LOW</span>
                          )}
                        </td>
                        <td className="meta-cell">
                          <code>{JSON.stringify(ev.meta)}</code>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>

            {/* Pagination Controls */}
            {totalPages > 1 && (
              <div className="pagination-bar">
                <button
                  className="page-btn"
                  onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                  disabled={currentPage === 1}
                  aria-label="Previous page"
                >
                  ◄ PREV
                </button>
                <span className="page-info">
                  PAGE {currentPage} OF {totalPages} ({filteredEvents.length} TOTAL EVENTS)
                </span>
                <button
                  className="page-btn"
                  onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                  disabled={currentPage === totalPages}
                  aria-label="Next page"
                >
                  NEXT ►
                </button>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
