/* Byzantine War Room — CEO Dashboard */
const { useState, useEffect, useMemo } = React;

// ─── Design Tokens (Byzantine brand: light theme, plum/purple accents) ──────
const T = {
  bg: "#faf9f7", surface: "#ffffff", card: "#ffffff", border: "#e8e4df",
  dim: "#f3f1ed", text: "#1a1a1a", muted: "#8c8578", accent: "#6B2D5B",
  green: "#1a8754", amber: "#c67f17", red: "#c0392b", blue: "#2d6bcb",
  purple: "#6B2D5B", pink: "#d4a5c9",
};

const STAGE_COLOR = {
  "Qualification": "#c67f17",
  "Contacted": "#2d6bcb",
  "Meeting": "#6B2D5B",
  "Proposal / Negotiation": "#8B5CF6",
  "Testing": "#1a8754",
  "Active": "#1a8754",
  "Won": "#1a8754",
  "Lost": "#c0392b",
  "Paused": "#8c8578",
};

const STAGE_SHORT = {
  "Qualification": "QUALIF",
  "Contacted": "CONTACT",
  "Meeting": "MEETING",
  "Proposal / Negotiation": "PROPOSAL",
  "Testing": "TESTING",
  "Active": "ACTIVE",
  "Won": "WON",
  "Lost": "LOST",
  "Paused": "PAUSED",
};

// ─── Business Logic ─────────────────────────────────────────────────────────
function getRag(d) {
  if (d.lastDays === null || d.lastDays === undefined || d.lastDays > 7 || !d.nextSteps) return "red";
  if (d.lastDays >= 4) return "amber";
  return "green";
}

function getHealth(d) {
  let s = 0;
  if (d.lastDays !== null && d.lastDays !== undefined) {
    if (d.lastDays <= 2) s += 2;
    else if (d.lastDays <= 7) s += 1;
  }
  if (d.nextSteps) s += 1;
  if (d.contact) s += 1;
  if (d.confidence !== null && d.confidence !== undefined && d.confidence >= 3) s += 1;
  return Math.max(1, Math.min(5, s));
}

function fmtCurrency(v) {
  if (v === null || v === undefined) return "\u2014";
  if (v >= 1e9) return "$" + (v / 1e9).toFixed(1) + "B";
  if (v >= 1e6) return "$" + (v / 1e6).toFixed(1) + "M";
  if (v >= 1e3) return "$" + Math.round(v / 1e3) + "K";
  return "$" + v.toFixed(0);
}

function fmtNumber(v) {
  if (v === null || v === undefined) return "\u2014";
  return v.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}

function relDate(dateStr) {
  if (!dateStr) return "";
  const now = new Date(); const d = new Date(dateStr + "T00:00:00");
  const diff = Math.floor((now - d) / 86400000);
  if (diff <= 0) return "today";
  if (diff === 1) return "yesterday";
  return diff + "d ago";
}

function isToday(dateStr) {
  if (!dateStr) return false;
  return new Date().toISOString().slice(0, 10) === dateStr;
}

function isThisWeek(dateStr) {
  if (!dateStr) return false;
  const d = new Date(dateStr + "T00:00:00"); const now = new Date();
  const diff = (d - now) / 86400000;
  return diff >= 0 && diff < 7;
}

// ─── Global Styles ──────────────────────────────────────────────────────────
const GLOBAL_CSS = `
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500&display=swap');

* { box-sizing: border-box; margin: 0; padding: 0; }
body { background: ${T.bg}; color: ${T.text}; font-family: 'Inter', -apple-system, sans-serif; -webkit-font-smoothing: antialiased; }
::-webkit-scrollbar { width: 4px; }
::-webkit-scrollbar-track { background: transparent; }
::-webkit-scrollbar-thumb { background: ${T.border}; border-radius: 4px; }

@keyframes fadeIn { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: translateY(0); } }
@keyframes shimmer { 0% { background-position: -200px 0; } 100% { background-position: 200px 0; } }
@keyframes spin { to { transform: rotate(360deg); } }

.fade-in { animation: fadeIn 0.3s ease both; }
.shimmer { background: linear-gradient(90deg, ${T.dim} 25%, #fff 50%, ${T.dim} 75%); background-size: 400px 100%; animation: shimmer 1.2s infinite; border-radius: 6px; }
.label { font-family: 'IBM Plex Mono', monospace; text-transform: uppercase; font-size: 10px; letter-spacing: 0.08em; font-weight: 600; color: ${T.muted}; }
.mono { font-family: 'IBM Plex Mono', monospace; }

.hm { }
@media (max-width: 768px) {
  .stats-grid { grid-template-columns: repeat(2, 1fr) !important; }
  .two-col { grid-template-columns: 1fr !important; }
  .hm { display: none !important; }
}
`;

// ─── Tiny Components ────────────────────────────────────────────────────────
const Dot = ({ color, size = 8 }) => (
  <span style={{ display: "inline-block", width: size, height: size, borderRadius: "50%", background: color, flexShrink: 0 }} />
);

const Badge = ({ children, bg, color = "#fff", style }) => (
  <span style={{ display: "inline-block", padding: "3px 8px", borderRadius: 4, background: bg, color, fontSize: 10, fontWeight: 600, fontFamily: "'IBM Plex Mono', monospace", letterSpacing: "0.03em", ...style }}>
    {children}
  </span>
);

const SectionLabel = ({ children }) => (
  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14 }}>
    <span style={{ width: 3, height: 14, background: T.accent, borderRadius: 2, flexShrink: 0 }} />
    <span className="label" style={{ fontSize: 11, color: T.text, fontWeight: 700 }}>{children}</span>
  </div>
);

const HealthBars = ({ score }) => (
  <div style={{ display: "flex", gap: 2, alignItems: "center" }}>
    {[1,2,3,4,5].map(i => (
      <span key={i} style={{ width: 4, height: i <= score ? 14 : 8, borderRadius: 2, background: i <= score ? (score >= 4 ? T.green : score >= 2 ? T.amber : T.red) : T.border, transition: "height 0.2s" }} />
    ))}
  </div>
);

// ─── Header ─────────────────────────────────────────────────────────────────
function Header({ data, loading, onRefresh }) {
  const today = new Date().toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
  const sources = data?.sources || {};
  const srcNames = ["attio", "gcal", "gmail", "fireflies"];

  return (
    <header style={{ background: T.surface, borderBottom: `1px solid ${T.border}`, padding: "14px 28px", display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 10, boxShadow: "0 1px 3px rgba(0,0,0,0.04)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
        <div style={{ width: 36, height: 36, borderRadius: 8, background: T.accent, display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700, fontSize: 18, color: "#fff" }}>B</div>
        <div>
          <div style={{ fontWeight: 700, fontSize: 15, letterSpacing: "-0.01em" }}>
            <span style={{ color: T.accent }}>Byzantine</span> <span style={{ color: T.muted }}>War Room</span>
          </div>
          <div className="mono" style={{ fontSize: 10, color: T.muted }}>{today}</div>
        </div>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
        <div style={{ display: "flex", gap: 10 }}>
          {srcNames.map(s => (
            <div key={s} style={{ display: "flex", alignItems: "center", gap: 4 }}>
              <Dot color={sources[s]?.status === "ok" ? T.green : sources[s] ? T.red : T.border} size={6} />
              <span className="label" style={{ fontSize: 9 }}>{s}</span>
            </div>
          ))}
        </div>
        <span className="mono" style={{ fontSize: 10, color: T.muted }}>
          {data?.sync_time ? data.sync_time.slice(0,16).replace("T"," ") : ""}
        </span>
        <button onClick={onRefresh} disabled={loading} style={{
          background: loading ? T.dim : T.accent, color: loading ? T.muted : "#fff",
          border: "none", borderRadius: 6, padding: "7px 16px", cursor: loading ? "default" : "pointer",
          fontSize: 12, fontWeight: 600, display: "flex", alignItems: "center", gap: 6,
          transition: "background 0.2s",
        }}
          onMouseEnter={e => { if (!loading) e.currentTarget.style.background = "#552248"; }}
          onMouseLeave={e => { if (!loading) e.currentTarget.style.background = T.accent; }}
        >
          {loading && <span style={{ display: "inline-block", width: 12, height: 12, border: "2px solid #fff4", borderTopColor: "#fff", borderRadius: "50%", animation: "spin 0.6s linear infinite" }} />}
          {loading ? "Syncing..." : "Refresh"}
        </button>
      </div>
    </header>
  );
}

// ─── Pipeline Financial Summary (3 categories like spreadsheet) ─────────────
function PipelineFinancials({ data }) {
  const pm = data?.pipeline_metrics || {};
  const incomplete = pm.incomplete_deals || [];

  return (
    <div className="fade-in" style={{ padding: "24px 28px 0" }}>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 16 }}>
        {/* PIPELINE */}
        <div style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: 10, padding: "20px", boxShadow: "0 1px 3px rgba(0,0,0,0.04)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 16 }}>
            <span style={{ background: T.accent + "15", color: T.accent, padding: "4px 10px", borderRadius: 4, fontSize: 11, fontWeight: 700, letterSpacing: "0.03em" }}>PIPELINE</span>
            <span style={{ fontSize: 11, color: T.muted }}>excl. active & lost</span>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
              <span style={{ fontSize: 13, color: T.muted }}>Deal count</span>
              <span className="mono" style={{ fontSize: 20, fontWeight: 700, color: T.text }}>{pm.pipeline_count ?? "\u2014"}</span>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
              <span style={{ fontSize: 13, color: T.muted }}>Total Allocation</span>
              <span className="mono" style={{ fontSize: 20, fontWeight: 700, color: T.text }}>{fmtNumber(pm.total_allocation)}</span>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
              <span style={{ fontSize: 13, color: T.muted }}>Weighted Pipeline /mo</span>
              <span className="mono" style={{ fontSize: 20, fontWeight: 700, color: T.accent }}>{fmtNumber(pm.time_weighted_pipeline_mo)}</span>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
              <span style={{ fontSize: 13, color: T.muted }}>Avg. % Closing</span>
              <span className="mono" style={{ fontSize: 20, fontWeight: 700, color: T.text }}>{pm.avg_pct_closing != null ? pm.avg_pct_closing + "%" : "\u2014"}</span>
            </div>
          </div>
        </div>

        {/* ACTIVE CLIENTS */}
        <div style={{ background: T.surface, border: `1px solid ${T.green}33`, borderRadius: 10, padding: "20px", boxShadow: "0 1px 3px rgba(0,0,0,0.04)" }}>
          <div style={{ marginBottom: 16 }}>
            <span style={{ background: T.green + "15", color: T.green, padding: "4px 10px", borderRadius: 4, fontSize: 11, fontWeight: 700, letterSpacing: "0.03em" }}>ACTIVE CLIENTS</span>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
              <span style={{ fontSize: 13, color: T.muted }}>Client count</span>
              <span className="mono" style={{ fontSize: 20, fontWeight: 700, color: T.green }}>{pm.active_count ?? "\u2014"}</span>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
              <span style={{ fontSize: 13, color: T.muted }}>Portfolio AUM</span>
              <span className="mono" style={{ fontSize: 20, fontWeight: 700, color: T.green }}>{fmtNumber(pm.active_allocation)}</span>
            </div>
          </div>
        </div>

        {/* LOST DEALS */}
        <div style={{ background: T.surface, border: `1px solid ${T.red}22`, borderRadius: 10, padding: "20px", boxShadow: "0 1px 3px rgba(0,0,0,0.04)" }}>
          <div style={{ marginBottom: 16 }}>
            <span style={{ background: T.red + "12", color: T.red, padding: "4px 10px", borderRadius: 4, fontSize: 11, fontWeight: 700, letterSpacing: "0.03em" }}>LOST DEALS</span>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
              <span style={{ fontSize: 13, color: T.muted }}>Lost count</span>
              <span className="mono" style={{ fontSize: 20, fontWeight: 700, color: T.red }}>{pm.lost_count ?? "\u2014"}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Missing data warning */}
      {incomplete.length > 0 && (
        <div style={{ marginTop: 14, background: T.red + "08", border: `1px solid ${T.red}22`, borderRadius: 8, padding: "12px 16px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
            <span style={{ color: T.red, fontWeight: 700, fontSize: 13 }}>Missing data</span>
            <span style={{ fontSize: 11, color: T.muted }}>({incomplete.length} deals need expected_allocation, pct_closing, or days_to_close in Attio)</span>
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {incomplete.map((name, i) => (
              <Badge key={i} bg={T.red + "12"} color={T.red}>{name}</Badge>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Stats Bar ──────────────────────────────────────────────────────────────
function StatsBar({ data }) {
  const deals = data?.deals || [];
  const meetings = data?.meetings || [];
  const countRag = (c) => deals.filter(d => getRag(d) === c).length;
  const meetingsToday = meetings.filter(m => isToday(m.date)).length;
  const meetingsWeek = meetings.filter(m => isThisWeek(m.date)).length;

  const stats = [
    { label: "Total Deals", value: deals.length, color: T.accent },
    { label: "Action Needed", value: countRag("red"), color: T.red },
    { label: "In Progress", value: countRag("amber"), color: T.amber },
    { label: "On Track", value: countRag("green"), color: T.green },
    { label: "Meetings Today", value: meetingsToday, color: T.purple },
    { label: "This Week", value: meetingsWeek, color: T.blue },
  ];

  return (
    <div className="stats-grid fade-in" style={{ display: "grid", gridTemplateColumns: "repeat(6, 1fr)", gap: 16, padding: "20px 28px 0" }}>
      {stats.map((s, i) => (
        <div key={i} style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: 10, padding: "16px 14px", textAlign: "center", boxShadow: "0 1px 3px rgba(0,0,0,0.04)" }}>
          <div style={{ fontSize: 28, fontWeight: 700, color: s.color, lineHeight: 1 }}>{data ? s.value : "\u2014"}</div>
          <div className="label" style={{ marginTop: 6 }}>{s.label}</div>
        </div>
      ))}
    </div>
  );
}

// ─── Deal Pipeline Table ────────────────────────────────────────────────────
function PipelineTable({ deals, onSelect }) {
  const [tab, setTab] = useState("ALL");
  const [sort, setSort] = useState("URGENCY");

  const stages = ["ALL", "QUALIF", "CONTACT", "MEETING", "PROPOSAL", "TESTING", "ACTIVE", "WON", "LOST", "PAUSED"];

  const filtered = useMemo(() => {
    let list = [...deals];
    if (tab !== "ALL") list = list.filter(d => STAGE_SHORT[d.stage] === tab);
    if (sort === "URGENCY") {
      const ragOrder = { red: 0, amber: 1, green: 2 };
      list.sort((a, b) => ragOrder[getRag(a)] - ragOrder[getRag(b)]);
    } else if (sort === "RECENCY") {
      list.sort((a, b) => (a.lastDays ?? 999) - (b.lastDays ?? 999));
    } else if (sort === "STAGE") {
      const order = ["Testing", "Proposal / Negotiation", "Meeting", "Contacted", "Qualification"];
      list.sort((a, b) => order.indexOf(a.stage) - order.indexOf(b.stage));
    }
    return list;
  }, [deals, tab, sort]);

  return (
    <div className="fade-in" style={{ padding: "24px 28px" }}>
      <SectionLabel>Deal Pipeline</SectionLabel>
      <div style={{ display: "flex", gap: 6, marginBottom: 12, flexWrap: "wrap" }}>
        {stages.map(s => (
          <button key={s} onClick={() => setTab(s)} style={{
            background: tab === s ? T.accent : T.surface, color: tab === s ? "#fff" : T.muted,
            border: `1px solid ${tab === s ? T.accent : T.border}`, borderRadius: 5, padding: "5px 12px",
            cursor: "pointer", fontSize: 10, fontWeight: 600, fontFamily: "'IBM Plex Mono', monospace",
            letterSpacing: "0.05em", transition: "all 0.15s",
          }}>{s}</button>
        ))}
        <span style={{ flex: 1 }} />
        {["URGENCY", "RECENCY", "STAGE"].map(s => (
          <button key={s} onClick={() => setSort(s)} style={{
            background: sort === s ? T.dim : "transparent", color: sort === s ? T.text : T.muted,
            border: `1px solid ${T.border}`, borderRadius: 5, padding: "5px 10px",
            cursor: "pointer", fontSize: 9, fontWeight: 600, fontFamily: "'IBM Plex Mono', monospace",
          }}>{s}</button>
        ))}
      </div>
      <div style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: 10, overflow: "hidden", boxShadow: "0 1px 3px rgba(0,0,0,0.04)" }}>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead>
              <tr style={{ background: T.dim }}>
                {["", "Company", "Stage", "Last", "Allocation", "% Close", "Weighted", "Next Steps", "Health"].map((h, i) => (
                  <th key={i} className="label" style={{ textAlign: "left", padding: "10px 10px", fontWeight: 700, whiteSpace: "nowrap" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map(d => {
                const rag = getRag(d);
                const ragColor = rag === "red" ? T.red : rag === "amber" ? T.amber : T.green;
                return (
                  <tr key={d.id} onClick={() => onSelect(d)} style={{ borderBottom: `1px solid ${T.border}`, cursor: "pointer", transition: "background 0.1s" }}
                    onMouseEnter={e => e.currentTarget.style.background = T.dim}
                    onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
                    <td style={{ padding: "10px 10px", width: 20 }}><Dot color={ragColor} /></td>
                    <td style={{ padding: "10px 10px", fontWeight: 600 }}>{d.company}</td>
                    <td style={{ padding: "10px 10px" }}><Badge bg={(STAGE_COLOR[d.stage] || T.muted) + "15"} color={STAGE_COLOR[d.stage] || T.muted}>{STAGE_SHORT[d.stage] || d.stage}</Badge></td>
                    <td style={{ padding: "10px 10px" }}>
                      <span className="mono" style={{ fontSize: 12, color: ragColor, fontWeight: 600 }}>
                        {d.lastDays !== null && d.lastDays !== undefined ? d.lastDays + "d" : "\u2014"}
                      </span>
                    </td>
                    <td className="hm" style={{ padding: "10px 10px" }}>
                      <span className="mono" style={{ fontSize: 12, color: d.expected_allocation ? T.text : T.red + "88" }}>
                        {d.expected_allocation ? fmtCurrency(d.expected_allocation) : "\u2014"}
                      </span>
                    </td>
                    <td className="hm" style={{ padding: "10px 10px" }}>
                      <span className="mono" style={{ fontSize: 12, color: d.pct_closing != null ? T.text : T.red + "88" }}>
                        {d.pct_closing != null ? d.pct_closing + "%" : "\u2014"}
                      </span>
                    </td>
                    <td className="hm" style={{ padding: "10px 10px" }}>
                      <span className="mono" style={{ fontSize: 12, color: d.weighted_value ? T.green : T.muted, fontWeight: d.weighted_value ? 600 : 400 }}>
                        {d.weighted_value ? fmtCurrency(d.weighted_value) : "\u2014"}
                      </span>
                    </td>
                    <td className="hm" style={{ padding: "10px 10px", color: T.muted, fontSize: 12, maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{d.nextSteps || "\u2014"}</td>
                    <td style={{ padding: "10px 10px" }}><HealthBars score={getHealth(d)} /></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// ─── Follow-Up Radar ────────────────────────────────────────────────────────
function FollowUpRadar({ deals }) {
  const redDeals = deals.filter(d => getRag(d) === "red").sort((a, b) => (b.lastDays ?? 999) - (a.lastDays ?? 999));
  const amberDeals = deals.filter(d => getRag(d) === "amber").sort((a, b) => (b.lastDays ?? 0) - (a.lastDays ?? 0));

  const Reason = ({ d }) => {
    if (d.lastDays === null || d.lastDays === undefined) return <span>No contact recorded</span>;
    if (!d.nextSteps) return <span>Next steps missing</span>;
    return <span>{d.lastDays}d since last contact</span>;
  };

  return (
    <div className="fade-in">
      <SectionLabel>Follow-Up Radar</SectionLabel>
      <div style={{ maxHeight: 380, overflowY: "auto", display: "flex", flexDirection: "column", gap: 8 }}>
        <div className="label" style={{ color: T.red, marginBottom: 2 }}>Urgent</div>
        {redDeals.length === 0 && <div style={{ color: T.muted, fontSize: 12, padding: 8 }}>All clear</div>}
        {redDeals.map(d => (
          <div key={d.id} style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: 8, padding: "10px 14px", borderLeft: `3px solid ${T.red}` }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
              <span style={{ fontWeight: 600, fontSize: 13 }}>{d.company}</span>
              <Badge bg={T.red + "12"} color={T.red}>{d.lastDays !== null && d.lastDays !== undefined ? d.lastDays + "d" : "N/A"}</Badge>
            </div>
            <div style={{ fontSize: 11, color: T.red }}><Reason d={d} /></div>
            {d.nextSteps && <div style={{ fontSize: 11, color: T.muted, marginTop: 4 }}>{d.nextSteps}</div>}
          </div>
        ))}
        <div className="label" style={{ color: T.amber, marginTop: 10, marginBottom: 2 }}>Follow Up</div>
        {amberDeals.length === 0 && <div style={{ color: T.muted, fontSize: 12, padding: 8 }}>All clear</div>}
        {amberDeals.map(d => (
          <div key={d.id} style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: 8, padding: "10px 14px", borderLeft: `3px solid ${T.amber}` }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
              <span style={{ fontWeight: 600, fontSize: 13 }}>{d.company}</span>
              <Badge bg={T.amber + "15"} color={T.amber}>{d.lastDays}d</Badge>
            </div>
            {d.nextSteps && <div style={{ fontSize: 11, color: T.muted }}>{d.nextSteps}</div>}
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Upcoming Meetings ──────────────────────────────────────────────────────
function UpcomingMeetings({ meetings }) {
  const sorted = [...meetings].sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));

  return (
    <div className="fade-in">
      <SectionLabel>Upcoming Meetings</SectionLabel>
      <div style={{ maxHeight: 380, overflowY: "auto", display: "flex", flexDirection: "column", gap: 8 }}>
        {sorted.length === 0 && <div style={{ color: T.muted, fontSize: 12, padding: 8 }}>No upcoming meetings</div>}
        {sorted.map((m, i) => {
          const attendeeStr = m.attendees?.slice(0, 2).join(", ") + (m.attendees?.length > 2 ? ` +${m.attendees.length - 2}` : "");
          return (
            <div key={i} style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: 8, padding: "10px 14px" }}>
              <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 4 }}>{m.title}</div>
              <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                <span className="mono" style={{ fontSize: 11, color: T.accent }}>{m.date} {m.time}</span>
                {isToday(m.date) && <Badge bg={T.accent} style={{ fontSize: 8 }}>TODAY</Badge>}
                {m.prepNeeded && <Badge bg={T.amber + "15"} color={T.amber} style={{ fontSize: 8 }}>PREP NEEDED</Badge>}
              </div>
              <div style={{ fontSize: 11, color: T.muted, marginTop: 4 }}>{attendeeStr}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Activity Feed ──────────────────────────────────────────────────────────
function ActivityFeed({ feed }) {
  const icons = { email_sent: "\u{1F4E7}", email_received: "\u{1F4E8}", meeting: "\u{1F4C5}", transcript: "\u{1F399}" };
  const items = (feed || []).slice(0, 10);

  return (
    <div className="fade-in" style={{ padding: "0 28px 20px" }}>
      <SectionLabel>Recent Activity</SectionLabel>
      <div style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: 10, overflow: "hidden", boxShadow: "0 1px 3px rgba(0,0,0,0.04)" }}>
        {items.map((a, i) => (
          <div key={i} style={{ padding: "10px 14px", display: "flex", alignItems: "center", gap: 10, borderBottom: i < items.length - 1 ? `1px solid ${T.border}` : "none" }}>
            <span style={{ fontSize: 14, width: 20, textAlign: "center", flexShrink: 0 }}>{icons[a.type] || "?"}</span>
            <span style={{ fontWeight: 600, fontSize: 12, minWidth: 100, flexShrink: 0 }}>{a.company}</span>
            <span style={{ fontSize: 12, color: T.muted, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{a.summary}</span>
            <span className="mono" style={{ fontSize: 10, color: T.muted, flexShrink: 0 }}>{relDate(a.date)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── All Meeting Transcripts + Action Items ─────────────────────────────────
function MeetingTranscripts({ transcripts }) {
  const items = transcripts || [];
  if (items.length === 0) return null;

  return (
    <div className="fade-in" style={{ padding: "0 28px 20px" }}>
      <SectionLabel>Meeting Notes & Action Items</SectionLabel>
      <div style={{ display: "flex", flexDirection: "column", gap: 8, maxHeight: 500, overflowY: "auto" }}>
        {items.map((tr, i) => (
          <div key={i} style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: 8, padding: "12px 14px", borderLeft: tr.linked_deal ? `3px solid ${T.green}` : `3px solid ${T.border}` }}>
            <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 6, flexWrap: "wrap" }}>
              <span className="mono" style={{ fontSize: 10, color: T.muted }}>{tr.date}</span>
              <span style={{ fontSize: 13, fontWeight: 600 }}>{tr.title}</span>
              {tr.linked_deal && <Badge bg={T.green + "12"} color={T.green}>{tr.linked_deal}</Badge>}
              {!tr.linked_deal && tr.company && <Badge bg={T.muted + "15"} color={T.muted}>{tr.company}</Badge>}
            </div>
            {tr.summary && <div style={{ fontSize: 12, color: T.muted, marginBottom: 6 }}>{tr.summary}</div>}
            {tr.actionItems && tr.actionItems.length > 0 && (
              <ul style={{ margin: "0 0 0 16px", fontSize: 12, color: T.accent }}>
                {tr.actionItems.map((ai, j) => <li key={j} style={{ marginBottom: 2 }}>{ai}</li>)}
              </ul>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Pipeline by Stage ──────────────────────────────────────────────────────
function PipelineByStage({ deals }) {
  const stageOrder = ["Qualification", "Contacted", "Meeting", "Proposal / Negotiation", "Testing", "Active", "Won", "Lost", "Paused"];

  return (
    <div className="fade-in" style={{ padding: "0 28px 24px" }}>
      <SectionLabel>Pipeline by Stage</SectionLabel>
      <div style={{ display: "flex", gap: 10, overflowX: "auto", paddingBottom: 4 }}>
        {stageOrder.map(stage => {
          const sd = deals.filter(d => d.stage === stage);
          const stageAlloc = sd.reduce((sum, d) => sum + (d.expected_allocation || 0), 0);
          return (
            <div key={stage} style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: 10, padding: "16px 18px", minWidth: 140, flex: "0 0 auto", boxShadow: "0 1px 3px rgba(0,0,0,0.04)", borderTop: `3px solid ${STAGE_COLOR[stage] || T.muted}` }}>
              <div className="label" style={{ color: STAGE_COLOR[stage], marginBottom: 8, fontSize: 10 }}>{STAGE_SHORT[stage] || stage}</div>
              <div style={{ fontSize: 28, fontWeight: 700, color: T.text }}>{sd.length}</div>
              {stageAlloc > 0 && <div className="mono" style={{ fontSize: 11, color: T.muted, marginTop: 4 }}>{fmtCurrency(stageAlloc)}</div>}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Deal Detail Modal ──────────────────────────────────────────────────────
function DealModal({ deal, meetings, onClose }) {
  if (!deal) return null;
  const rag = getRag(deal);
  const ragColor = rag === "red" ? T.red : rag === "amber" ? T.amber : T.green;
  const health = getHealth(deal);
  const relMeetings = meetings.filter(m => m.company && deal.company && m.company.toLowerCase() === deal.company.toLowerCase());

  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.3)", backdropFilter: "blur(4px)", zIndex: 1000, display: "flex", justifyContent: "center", alignItems: "flex-start", paddingTop: 40, overflowY: "auto" }}>
      <div onClick={e => e.stopPropagation()} className="fade-in" style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: 12, width: "90%", maxWidth: 700, marginBottom: 40, boxShadow: "0 20px 60px rgba(0,0,0,0.15)" }}>
        {/* Header */}
        <div style={{ position: "sticky", top: 0, background: T.surface, borderBottom: `1px solid ${T.border}`, padding: "16px 20px", borderRadius: "12px 12px 0 0", display: "flex", justifyContent: "space-between", alignItems: "center", zIndex: 1 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <Dot color={ragColor} size={10} />
            <span style={{ fontSize: 20, fontWeight: 700 }}>{deal.company}</span>
            <Badge bg={(STAGE_COLOR[deal.stage] || T.muted) + "15"} color={STAGE_COLOR[deal.stage] || T.muted}>{deal.stage}</Badge>
          </div>
          <button onClick={onClose} style={{ background: T.dim, border: "none", color: T.muted, cursor: "pointer", fontSize: 16, width: 28, height: 28, borderRadius: 6, display: "flex", alignItems: "center", justifyContent: "center" }}>&times;</button>
        </div>

        <div style={{ padding: "16px 20px", display: "flex", flexDirection: "column", gap: 16 }}>
          {/* Metrics */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 10 }}>
            {[
              { label: "Allocation", value: deal.expected_allocation ? fmtCurrency(deal.expected_allocation) : null, color: T.accent },
              { label: "% Closing", value: deal.pct_closing != null ? deal.pct_closing + "%" : null, color: T.blue },
              { label: "Days to Close", value: deal.days_to_close != null ? Math.round(deal.days_to_close) + "d" : null, color: T.purple },
              { label: "Weighted Value", value: deal.weighted_value ? fmtCurrency(deal.weighted_value) : null, color: T.green },
            ].map((m, i) => (
              <div key={i} style={{ background: m.value ? T.dim : T.red + "08", border: `1px solid ${m.value ? T.border : T.red + "22"}`, borderRadius: 8, padding: 12, textAlign: "center" }}>
                <div className="label" style={{ marginBottom: 4 }}>{m.label}</div>
                <div className="mono" style={{ fontSize: 18, fontWeight: 700, color: m.value ? m.color : T.red }}>
                  {m.value || "MISSING"}
                </div>
              </div>
            ))}
          </div>

          {/* Health + Last contact */}
          <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <span className="label">Health</span>
              <HealthBars score={health} />
            </div>
            <div className="mono" style={{ fontSize: 11, color: ragColor }}>
              Last: {deal.lastContactDate ? `${deal.lastContactDate} (${deal.lastDays}d ago)` : "None"}
            </div>
            {deal.lastContactType && <Badge bg={T.dim} color={T.muted} style={{ fontSize: 9 }}>{deal.lastContactType}</Badge>}
          </div>

          {/* Next steps */}
          <div>
            <div className="label" style={{ marginBottom: 4 }}>Next Steps</div>
            <div style={{ background: deal.nextSteps ? T.dim : T.red + "08", border: `1px solid ${deal.nextSteps ? T.border : T.red + "22"}`, borderRadius: 6, padding: "10px 12px", fontSize: 13, color: deal.nextSteps ? T.text : T.red }}>
              {deal.nextSteps || "No next steps defined"}
            </div>
          </div>

          {/* Contact */}
          {deal.contact && (
            <div>
              <div className="label" style={{ marginBottom: 4 }}>Contact</div>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <div style={{ width: 30, height: 30, borderRadius: "50%", background: T.accent, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, fontWeight: 700, color: "#fff" }}>
                  {deal.contact.split(" ").map(w => w[0]).join("").slice(0, 2)}
                </div>
                <span style={{ fontSize: 13 }}>{deal.contact}</span>
              </div>
            </div>
          )}

          {/* Notes */}
          {deal.notes && (
            <div>
              <div className="label" style={{ marginBottom: 4 }}>Notes</div>
              <div style={{ background: T.dim, border: `1px solid ${T.border}`, borderRadius: 6, padding: "10px 12px", fontSize: 12, color: T.muted }}>{deal.notes}</div>
            </div>
          )}

          {/* Emails */}
          {deal.emails && deal.emails.length > 0 && (
            <div>
              <div className="label" style={{ marginBottom: 4 }}>Last Emails</div>
              {deal.emails.slice(0, 3).map((em, i) => (
                <div key={i} style={{ background: T.dim, border: `1px solid ${T.border}`, borderRadius: 6, padding: "8px 12px", display: "flex", alignItems: "center", gap: 8, fontSize: 12, marginBottom: 4 }}>
                  <span className="mono" style={{ color: T.muted, fontSize: 10, flexShrink: 0 }}>{em.date}</span>
                  <Badge bg={em.direction === "sent" ? T.green + "15" : T.blue + "15"} color={em.direction === "sent" ? T.green : T.blue} style={{ fontSize: 8 }}>{em.direction === "sent" ? "SENT" : "RECV"}</Badge>
                  <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{em.subject}</span>
                </div>
              ))}
            </div>
          )}

          {/* Transcripts */}
          {deal.transcripts && deal.transcripts.length > 0 && (
            <div>
              <div className="label" style={{ marginBottom: 4 }}>Call Transcripts</div>
              {deal.transcripts.map((tr, i) => (
                <div key={i} style={{ background: T.dim, border: `1px solid ${T.border}`, borderRadius: 6, padding: "10px 12px", marginBottom: 6 }}>
                  <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 4 }}>
                    <span className="mono" style={{ fontSize: 10, color: T.muted }}>{tr.date}</span>
                    <span style={{ fontSize: 13, fontWeight: 600 }}>{tr.title}</span>
                  </div>
                  <div style={{ fontSize: 12, color: T.muted }}>{tr.summary}</div>
                  {tr.actionItems && tr.actionItems.length > 0 && (
                    <ul style={{ margin: "6px 0 0 16px", fontSize: 11, color: T.accent }}>
                      {tr.actionItems.map((ai, j) => <li key={j}>{ai}</li>)}
                    </ul>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* Related meetings */}
          {relMeetings.length > 0 && (
            <div>
              <div className="label" style={{ marginBottom: 4 }}>Related Meetings</div>
              {relMeetings.map((m, i) => (
                <div key={i} style={{ background: T.dim, border: `1px solid ${T.border}`, borderRadius: 6, padding: "8px 12px", fontSize: 12, marginBottom: 4 }}>
                  <span style={{ fontWeight: 600 }}>{m.title}</span>
                  <span className="mono" style={{ color: T.muted, fontSize: 10, marginLeft: 8 }}>{m.date} {m.time}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Loading State ──────────────────────────────────────────────────────────
function LoadingShimmer() {
  return (
    <div style={{ padding: "24px 28px" }}>
      <div className="stats-grid" style={{ display: "grid", gridTemplateColumns: "repeat(6, 1fr)", gap: 16 }}>
        {[1,2,3,4,5,6].map(i => (
          <div key={i} style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: 10, padding: "16px", textAlign: "center" }}>
            <div className="shimmer" style={{ height: 28, width: 40, margin: "0 auto 6px" }} />
            <div className="shimmer" style={{ height: 10, width: 60, margin: "0 auto" }} />
          </div>
        ))}
      </div>
      <div style={{ marginTop: 20 }}>
        {[1,2,3,4,5].map(i => <div key={i} className="shimmer" style={{ height: 40, marginBottom: 6, borderRadius: 6 }} />)}
      </div>
    </div>
  );
}

// ─── App Root ───────────────────────────────────────────────────────────────
function App() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [selectedDeal, setSelectedDeal] = useState(null);

  const loadData = () => {
    setLoading(true);
    setError(null);
    fetch("./data.json")
      .then(r => { if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); })
      .then(d => { setData(d); setLoading(false); })
      .catch(e => { setError(e.message); setLoading(false); });
  };

  useEffect(loadData, []);

  return (
    <React.Fragment>
      <style>{GLOBAL_CSS}</style>
      <div style={{ minHeight: "100vh", background: T.bg }}>
        <Header data={data} loading={loading} onRefresh={loadData} />

        {error && (
          <div style={{ textAlign: "center", padding: 60 }}>
            <div style={{ color: T.red, fontSize: 16, marginBottom: 12 }}>Failed to load data.</div>
            <button onClick={loadData} style={{ background: T.accent, border: "none", color: "#fff", padding: "8px 20px", borderRadius: 6, cursor: "pointer", fontSize: 12, fontWeight: 600 }}>Retry</button>
          </div>
        )}

        {loading && !error && <LoadingShimmer />}

        {data && !error && (
          <React.Fragment>
            <StatsBar data={data} />
            <PipelineFinancials data={data} />
            <PipelineTable deals={data.deals || []} onSelect={setSelectedDeal} />

            <div className="two-col" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 0, padding: "0 28px" }}>
              <div style={{ paddingRight: 12 }}>
                <FollowUpRadar deals={data.deals || []} />
              </div>
              <div style={{ paddingLeft: 12 }}>
                <UpcomingMeetings meetings={data.meetings || []} />
              </div>
            </div>

            <div style={{ padding: "20px 0 0" }}>
              <ActivityFeed feed={data.activity_feed} />
            </div>
            <MeetingTranscripts transcripts={data.all_transcripts} />
            <PipelineByStage deals={data.deals || []} />

            <DealModal deal={selectedDeal} meetings={data.meetings || []} onClose={() => setSelectedDeal(null)} />
          </React.Fragment>
        )}

        <div style={{ textAlign: "center", padding: "20px 0 30px", fontSize: 10, color: T.muted }}>
          <span className="mono">BYZANTINE FINANCE</span>
        </div>
      </div>
    </React.Fragment>
  );
}

ReactDOM.createRoot(document.getElementById("root")).render(<App />);
