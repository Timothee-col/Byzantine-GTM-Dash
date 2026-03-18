/* Byzantine War Room — CEO Dashboard */
const { useState, useEffect, useMemo } = React;

// ─── Design Tokens ───────────────────────────────────────────────────────────
const T = {
  bg: "#070a0f", surface: "#0c1018", card: "#101620", border: "#1a2333", dim: "#1e2d40",
  text: "#d4dce8", muted: "#4d6070", accent: "#00d4ff",
  green: "#22d17a", amber: "#f0a030", red: "#f04545", blue: "#4d9fff", purple: "#9d6fff",
};

const STAGE_COLOR = {
  "Qualification": "#f0a030",
  "Contacted": "#4d9fff",
  "Meeting": "#9d6fff",
  "Proposal / Negotiation": "#00d4ff",
  "Testing": "#22d17a",
  "Active": "#00e68a",
  "Won": "#22d17a",
  "Lost": "#f04545",
  "Paused": "#4d6070",
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

// ─── Business Logic ──────────────────────────────────────────────────────────
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

// ─── Global Styles ───────────────────────────────────────────────────────────
const GLOBAL_CSS = `
@import url('https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500&display=swap');

* { box-sizing: border-box; margin: 0; padding: 0; }
body { background: ${T.bg}; color: ${T.text}; font-family: 'Barlow Condensed', sans-serif; }
::-webkit-scrollbar { width: 3px; }
::-webkit-scrollbar-track { background: ${T.surface}; }
::-webkit-scrollbar-thumb { background: ${T.dim}; border-radius: 2px; }

@keyframes fadeIn { from { opacity: 0; transform: translateY(5px); } to { opacity: 1; transform: translateY(0); } }
@keyframes shimmer { 0% { background-position: -200px 0; } 100% { background-position: 200px 0; } }

.fade-in { animation: fadeIn 0.3s ease both; }
.shimmer { background: linear-gradient(90deg, ${T.card} 25%, ${T.dim} 50%, ${T.card} 75%); background-size: 400px 100%; animation: shimmer 1.2s infinite; border-radius: 4px; }
.label { font-family: 'IBM Plex Mono', monospace; text-transform: uppercase; font-size: 9px; letter-spacing: 0.12em; font-weight: 700; color: ${T.muted}; }
.mono { font-family: 'IBM Plex Mono', monospace; }

.hm { /* hide-mobile helper */ }
@media (max-width: 768px) {
  .stats-grid { grid-template-columns: repeat(3, 1fr) !important; }
  .two-col { grid-template-columns: 1fr !important; }
  .hm { display: none !important; }
}
`;

// ─── Tiny Components ─────────────────────────────────────────────────────────
const Dot = ({ color, size = 8 }) => (
  <span style={{ display: "inline-block", width: size, height: size, borderRadius: "50%", background: color, flexShrink: 0 }} />
);

const Badge = ({ children, bg, color = "#fff", style }) => (
  <span style={{ display: "inline-block", padding: "2px 8px", borderRadius: 3, background: bg, color, fontSize: 10, fontWeight: 700, fontFamily: "'IBM Plex Mono', monospace", letterSpacing: "0.05em", ...style }}>
    {children}
  </span>
);

const SectionLabel = ({ children }) => (
  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
    <span style={{ width: 3, height: 10, background: T.accent, borderRadius: 1, flexShrink: 0 }} />
    <span className="label">{children}</span>
  </div>
);

const HealthBars = ({ score }) => (
  <div style={{ display: "flex", gap: 2, alignItems: "center" }}>
    {[1,2,3,4,5].map(i => (
      <span key={i} style={{ width: 4, height: i <= score ? 14 : 8, borderRadius: 1, background: i <= score ? (score >= 4 ? T.green : score >= 2 ? T.amber : T.red) : T.dim, transition: "height 0.2s" }} />
    ))}
  </div>
);

// ─── Header ──────────────────────────────────────────────────────────────────
function Header({ data, loading }) {
  const today = new Date().toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
  const sources = data?.sources || {};
  const srcNames = ["attio", "gcal", "gmail", "fireflies"];

  return (
    <header style={{ background: T.surface, borderBottom: `1px solid ${T.border}`, padding: "14px 24px", display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 10 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
        <div style={{ width: 32, height: 32, borderRadius: 6, background: `linear-gradient(135deg, ${T.accent}, ${T.purple})`, display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700, fontSize: 18, color: "#fff" }}>B</div>
        <div>
          <div style={{ fontWeight: 700, fontSize: 13, letterSpacing: "0.08em", textTransform: "uppercase" }}>
            <span style={{ color: T.accent }}>Byzantine</span> <span style={{ color: T.muted }}>War Room</span> <span className="hm" style={{ color: T.muted, fontSize: 10 }}>· CEO Dashboard</span>
          </div>
          <div className="mono" style={{ fontSize: 10, color: T.muted }}>{today}</div>
        </div>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
        <span className="mono" style={{ fontSize: 10, color: loading ? T.amber : T.muted }}>
          {loading ? "SYNCING..." : data?.sync_time ? `Synced ${data.sync_time.slice(0,16).replace("T"," ")}` : ""}
        </span>
        <div style={{ display: "flex", gap: 10 }}>
          {srcNames.map(s => (
            <div key={s} style={{ display: "flex", alignItems: "center", gap: 4 }}>
              <Dot color={sources[s]?.status === "ok" ? T.green : sources[s] ? T.red : T.dim} size={6} />
              <span className="label" style={{ fontSize: 8 }}>{s.toUpperCase()}</span>
            </div>
          ))}
        </div>
      </div>
    </header>
  );
}

// ─── Stats Bar ───────────────────────────────────────────────────────────────
function StatsBar({ data }) {
  const deals = data?.deals || [];
  const meetings = data?.meetings || [];
  const countRag = (c) => deals.filter(d => getRag(d) === c).length;
  const meetingsToday = meetings.filter(m => isToday(m.date)).length;
  const meetingsWeek = meetings.filter(m => isThisWeek(m.date)).length;

  const stats = [
    { label: "Active Deals", value: deals.length, color: T.accent },
    { label: "Action Needed", value: countRag("red"), color: T.red },
    { label: "In Progress", value: countRag("amber"), color: T.amber },
    { label: "On Track", value: countRag("green"), color: T.green },
    { label: "Meetings Today", value: meetingsToday, color: T.purple },
    { label: "This Week", value: meetingsWeek, color: T.blue },
  ];

  return (
    <div className="stats-grid fade-in" style={{ display: "grid", gridTemplateColumns: "repeat(6, 1fr)", gap: 1, background: T.border, margin: "0" }}>
      {stats.map((s, i) => (
        <div key={i} style={{ background: T.surface, padding: "14px 16px", textAlign: "center" }}>
          <div style={{ fontSize: 28, fontWeight: 700, color: s.color, lineHeight: 1 }}>{data ? s.value : "—"}</div>
          <div className="label" style={{ marginTop: 4 }}>{s.label}</div>
        </div>
      ))}
    </div>
  );
}

// ─── Deal Pipeline Table ─────────────────────────────────────────────────────
function PipelineTable({ deals, onSelect }) {
  const [tab, setTab] = useState("ALL");
  const [sort, setSort] = useState("URGENCY");

  const stages = ["ALL", "QUALIF", "CONTACT", "MEETING", "PROPOSAL", "TESTING", "ACTIVE", "WON", "LOST", "PAUSED"];
  const stageMap = Object.fromEntries(Object.entries(STAGE_SHORT).map(([k,v]) => [v, k]));

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
    <div className="fade-in" style={{ padding: "20px 24px" }}>
      <SectionLabel>Deal Pipeline</SectionLabel>
      <div style={{ display: "flex", gap: 6, marginBottom: 10, flexWrap: "wrap" }}>
        {stages.map(s => (
          <button key={s} onClick={() => setTab(s)} style={{ background: tab === s ? T.accent : T.card, color: tab === s ? T.bg : T.muted, border: "none", borderRadius: 3, padding: "4px 10px", cursor: "pointer", fontSize: 10, fontWeight: 700, fontFamily: "'IBM Plex Mono', monospace", letterSpacing: "0.08em" }}>{s}</button>
        ))}
        <span style={{ flex: 1 }} />
        {["URGENCY", "RECENCY", "STAGE"].map(s => (
          <button key={s} onClick={() => setSort(s)} style={{ background: sort === s ? T.dim : "transparent", color: sort === s ? T.text : T.muted, border: `1px solid ${T.border}`, borderRadius: 3, padding: "4px 8px", cursor: "pointer", fontSize: 9, fontWeight: 700, fontFamily: "'IBM Plex Mono', monospace", letterSpacing: "0.08em" }}>{s}</button>
        ))}
      </div>
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <thead>
            <tr style={{ borderBottom: `1px solid ${T.border}` }}>
              {["", "Company", "Stage", "Last", "Contact", "Next Steps", "Health", "Pri"].map((h, i) => (
                <th key={i} className="label" style={{ textAlign: "left", padding: "8px 8px", fontWeight: 700, whiteSpace: "nowrap" }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.map(d => {
              const rag = getRag(d);
              const ragColor = rag === "red" ? T.red : rag === "amber" ? T.amber : T.green;
              return (
                <tr key={d.id} onClick={() => onSelect(d)} style={{ borderBottom: `1px solid ${T.border}`, cursor: "pointer" }}
                  onMouseEnter={e => e.currentTarget.style.background = T.dim}
                  onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
                  <td style={{ padding: "8px 8px" }}><Dot color={ragColor} /></td>
                  <td style={{ padding: "8px 8px", fontWeight: 600 }}>{d.company}</td>
                  <td style={{ padding: "8px 8px" }}><Badge bg={STAGE_COLOR[d.stage] + "22"} color={STAGE_COLOR[d.stage]}>{STAGE_SHORT[d.stage]}</Badge></td>
                  <td style={{ padding: "8px 8px" }}>
                    <span className="mono" style={{ fontSize: 12, color: ragColor, fontWeight: 600 }}>
                      {d.lastDays !== null && d.lastDays !== undefined ? d.lastDays + "d" : "—"}
                    </span>
                  </td>
                  <td className="hm" style={{ padding: "8px 8px", color: T.muted, fontSize: 12 }}>{d.contact || "—"}</td>
                  <td className="hm" style={{ padding: "8px 8px", color: T.muted, fontSize: 12, maxWidth: 190, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{d.nextSteps || "—"}</td>
                  <td style={{ padding: "8px 8px" }}><HealthBars score={getHealth(d)} /></td>
                  <td style={{ padding: "8px 8px" }}><Badge bg={d.priority === "High" ? T.red + "22" : T.dim} color={d.priority === "High" ? T.red : T.muted}>{d.priority === "High" ? "HI" : "MD"}</Badge></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─── Follow-Up Radar ─────────────────────────────────────────────────────────
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
      <div style={{ maxHeight: 360, overflowY: "auto", display: "flex", flexDirection: "column", gap: 8 }}>
        <div className="label" style={{ color: T.red, marginBottom: 2 }}>Today — Urgent</div>
        {redDeals.length === 0 && <div style={{ color: T.muted, fontSize: 12, padding: 8 }}>All clear</div>}
        {redDeals.map(d => (
          <div key={d.id} style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: 4, padding: "10px 12px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
              <span style={{ fontWeight: 600, fontSize: 13 }}>{d.company}</span>
              <Badge bg={T.red + "22"} color={T.red}>{d.lastDays !== null && d.lastDays !== undefined ? d.lastDays + "d" : "NO DATA"}</Badge>
            </div>
            <div style={{ fontSize: 11, color: T.red }}><Reason d={d} /></div>
            {d.nextSteps && <div style={{ fontSize: 11, color: T.muted, marginTop: 4 }}>{d.nextSteps}</div>}
          </div>
        ))}
        <div className="label" style={{ color: T.amber, marginTop: 8, marginBottom: 2 }}>This Week — Follow Up</div>
        {amberDeals.length === 0 && <div style={{ color: T.muted, fontSize: 12, padding: 8 }}>All clear</div>}
        {amberDeals.map(d => (
          <div key={d.id} style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: 4, padding: "10px 12px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
              <span style={{ fontWeight: 600, fontSize: 13 }}>{d.company}</span>
              <Badge bg={T.amber + "22"} color={T.amber}>{d.lastDays}d</Badge>
            </div>
            {d.nextSteps && <div style={{ fontSize: 11, color: T.muted }}>{d.nextSteps}</div>}
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Upcoming Meetings ───────────────────────────────────────────────────────
function UpcomingMeetings({ meetings }) {
  const sorted = [...meetings].sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));

  return (
    <div className="fade-in">
      <SectionLabel>Upcoming Meetings</SectionLabel>
      <div style={{ maxHeight: 360, overflowY: "auto", display: "flex", flexDirection: "column", gap: 8 }}>
        {sorted.length === 0 && <div style={{ color: T.muted, fontSize: 12, padding: 8 }}>No upcoming meetings</div>}
        {sorted.map((m, i) => {
          const attendeeStr = m.attendees?.slice(0, 2).join(", ") + (m.attendees?.length > 2 ? ` +${m.attendees.length - 2}` : "");
          return (
            <div key={i} style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: 4, padding: "10px 12px" }}>
              <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 4 }}>{m.title}</div>
              <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                <span className="mono" style={{ fontSize: 11, color: T.accent }}>{m.date} {m.time}</span>
                {isToday(m.date) && <Badge bg={T.purple} style={{ fontSize: 8 }}>TODAY</Badge>}
                {m.prepNeeded && <Badge bg={T.amber + "22"} color={T.amber} style={{ fontSize: 8 }}>&#9889; PREP</Badge>}
              </div>
              <div style={{ fontSize: 11, color: T.muted, marginTop: 4 }}>{attendeeStr}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Activity Feed ───────────────────────────────────────────────────────────
function ActivityFeed({ feed }) {
  const icons = { email_sent: "\u{1F4E7}", email_received: "\u{1F4E8}", meeting: "\u{1F4C5}", transcript: "\u{1F399}" };
  const items = (feed || []).slice(0, 10);

  return (
    <div className="fade-in" style={{ padding: "20px 24px" }}>
      <SectionLabel>Recent Activity</SectionLabel>
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        {items.map((a, i) => (
          <div key={i} style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: 4, padding: "8px 12px", display: "flex", alignItems: "center", gap: 10 }}>
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

// ─── Pipeline by Stage ───────────────────────────────────────────────────────
function PipelineByStage({ deals, onFilterStage }) {
  const stageOrder = ["Qualification", "Contacted", "Meeting", "Proposal / Negotiation", "Testing", "Active", "Won", "Lost", "Paused"];

  return (
    <div className="fade-in" style={{ padding: "20px 24px" }}>
      <SectionLabel>Pipeline by Stage</SectionLabel>
      <div style={{ display: "flex", gap: 8, overflowX: "auto", paddingBottom: 4 }}>
        {stageOrder.map(stage => {
          const sd = deals.filter(d => d.stage === stage);
          const red = sd.filter(d => getRag(d) === "red").length;
          const amber = sd.filter(d => getRag(d) === "amber").length;
          const green = sd.filter(d => getRag(d) === "green").length;
          return (
            <div key={stage} onClick={() => onFilterStage(stage)} style={{ background: T.card, border: `1px solid ${STAGE_COLOR[stage]}33`, borderRadius: 6, padding: "14px 16px", minWidth: 150, cursor: "pointer", flex: "0 0 auto" }}
              onMouseEnter={e => e.currentTarget.style.borderColor = STAGE_COLOR[stage]}
              onMouseLeave={e => e.currentTarget.style.borderColor = STAGE_COLOR[stage] + "33"}>
              <div className="label" style={{ color: STAGE_COLOR[stage], marginBottom: 6 }}>{STAGE_SHORT[stage]}</div>
              <div style={{ fontSize: 28, fontWeight: 700, color: STAGE_COLOR[stage] }}>{sd.length}</div>
              <div style={{ display: "flex", gap: 8, marginTop: 6, fontSize: 10 }}>
                {red > 0 && <span style={{ color: T.red }}><Dot color={T.red} size={5} /> {red} stale</span>}
                {amber > 0 && <span style={{ color: T.amber }}><Dot color={T.amber} size={5} /> {amber} warm</span>}
                {green > 0 && <span style={{ color: T.green }}><Dot color={T.green} size={5} /> {green} ok</span>}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Deal Detail Modal ───────────────────────────────────────────────────────
function DealModal({ deal, meetings, onClose }) {
  if (!deal) return null;
  const rag = getRag(deal);
  const ragColor = rag === "red" ? T.red : rag === "amber" ? T.amber : T.green;
  const health = getHealth(deal);
  const relMeetings = meetings.filter(m => m.company && deal.company && m.company.toLowerCase() === deal.company.toLowerCase());

  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", zIndex: 1000, display: "flex", justifyContent: "center", alignItems: "flex-start", paddingTop: 40, overflowY: "auto" }}>
      <div onClick={e => e.stopPropagation()} className="fade-in" style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: 8, width: "90%", maxWidth: 700, marginBottom: 40 }}>
        {/* Sticky header */}
        <div style={{ position: "sticky", top: 0, background: T.surface, borderBottom: `1px solid ${T.border}`, padding: "16px 20px", borderRadius: "8px 8px 0 0", display: "flex", justifyContent: "space-between", alignItems: "center", zIndex: 1 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <Dot color={ragColor} size={10} />
            <span style={{ fontSize: 22, fontWeight: 700 }}>{deal.company}</span>
            <Badge bg={STAGE_COLOR[deal.stage] + "22"} color={STAGE_COLOR[deal.stage]}>{deal.stage}</Badge>
          </div>
          <button onClick={onClose} style={{ background: "none", border: "none", color: T.muted, cursor: "pointer", fontSize: 20 }}>&times;</button>
        </div>

        <div style={{ padding: "16px 20px", display: "flex", flexDirection: "column", gap: 16 }}>
          {/* Metric grid */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12 }}>
            <div style={{ background: T.card, borderRadius: 6, padding: 14, textAlign: "center" }}>
              <div className="label" style={{ marginBottom: 6 }}>Health</div>
              <div style={{ fontSize: 32, fontWeight: 700, color: health >= 4 ? T.green : health >= 2 ? T.amber : T.red }}>{health}<span style={{ fontSize: 14, color: T.muted }}>/5</span></div>
            </div>
            <div style={{ background: T.card, borderRadius: 6, padding: 14, textAlign: "center" }}>
              <div className="label" style={{ marginBottom: 6 }}>Priority</div>
              <Badge bg={deal.priority === "High" ? T.red + "33" : T.dim} color={deal.priority === "High" ? T.red : T.muted} style={{ fontSize: 16, padding: "4px 14px" }}>{deal.priority}</Badge>
            </div>
            <div style={{ background: T.card, borderRadius: 6, padding: 14, textAlign: "center" }}>
              <div className="label" style={{ marginBottom: 6 }}>Confidence</div>
              <div style={{ fontSize: 32, fontWeight: 700, color: T.muted }}>{deal.confidence !== null && deal.confidence !== undefined ? deal.confidence + "/5" : "\u2014"}</div>
            </div>
          </div>

          {/* Last contact */}
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
            <div className="mono" style={{ fontSize: 11, color: ragColor }}>
              Last contact: {deal.lastContactDate ? `${deal.lastContactDate} (${deal.lastDays}d ago)` : "None recorded"}
            </div>
            {deal.lastContactType && <Badge bg={T.dim} color={T.muted} style={{ fontSize: 9 }}>{deal.lastContactType}</Badge>}
          </div>

          {/* Next steps */}
          <div>
            <div className="label" style={{ marginBottom: 4 }}>Next Steps</div>
            <div style={{ background: deal.nextSteps ? T.card : T.red + "11", border: `1px solid ${deal.nextSteps ? T.border : T.red + "44"}`, borderRadius: 4, padding: "10px 12px", fontSize: 13, color: deal.nextSteps ? T.text : T.red }}>
              {deal.nextSteps || "No next steps defined"}
            </div>
          </div>

          {/* Champion */}
          {deal.contact && (
            <div>
              <div className="label" style={{ marginBottom: 4 }}>Champion</div>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <div style={{ width: 32, height: 32, borderRadius: "50%", background: T.blue, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 700, color: "#fff" }}>
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
              <div style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: 4, padding: "10px 12px", fontSize: 12, color: T.muted }}>{deal.notes}</div>
            </div>
          )}

          {/* Emails */}
          {deal.emails && deal.emails.length > 0 && (
            <div>
              <div className="label" style={{ marginBottom: 4 }}>Last Emails</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                {deal.emails.slice(0, 3).map((em, i) => (
                  <div key={i} style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: 4, padding: "8px 12px", display: "flex", alignItems: "center", gap: 8, fontSize: 12 }}>
                    <span className="mono" style={{ color: T.muted, fontSize: 10, flexShrink: 0 }}>{em.date}</span>
                    <Badge bg={em.direction === "sent" ? T.green + "22" : T.blue + "22"} color={em.direction === "sent" ? T.green : T.blue} style={{ fontSize: 8 }}>{em.direction === "sent" ? "SENT" : "RECV"}</Badge>
                    <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{em.subject}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Transcripts */}
          {deal.transcripts && deal.transcripts.length > 0 && (
            <div>
              <div className="label" style={{ marginBottom: 4 }}>Call Transcripts</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {deal.transcripts.map((tr, i) => (
                  <div key={i} style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: 4, padding: "10px 12px" }}>
                    <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 4 }}>
                      <span className="mono" style={{ fontSize: 10, color: T.muted }}>{tr.date}</span>
                      <span style={{ fontSize: 13, fontWeight: 600 }}>{tr.title}</span>
                    </div>
                    <div style={{ fontSize: 12, color: T.muted }}>{tr.summary}</div>
                    {tr.actionItems && tr.actionItems.length > 0 && (
                      <ul style={{ margin: "6px 0 0 16px", fontSize: 11, color: T.muted }}>
                        {tr.actionItems.map((ai, j) => <li key={j}>{ai}</li>)}
                      </ul>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Related meetings */}
          {relMeetings.length > 0 && (
            <div>
              <div className="label" style={{ marginBottom: 4 }}>Related Meetings</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                {relMeetings.map((m, i) => (
                  <div key={i} style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: 4, padding: "8px 12px", fontSize: 12 }}>
                    <span style={{ fontWeight: 600 }}>{m.title}</span>
                    <span className="mono" style={{ color: T.muted, fontSize: 10, marginLeft: 8 }}>{m.date} {m.time}</span>
                    <span style={{ color: T.muted, marginLeft: 8 }}>{m.attendees?.join(", ")}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Loading State ───────────────────────────────────────────────────────────
function LoadingShimmer() {
  return (
    <div style={{ padding: "20px 24px" }}>
      <div className="stats-grid" style={{ display: "grid", gridTemplateColumns: "repeat(6, 1fr)", gap: 1, background: T.border }}>
        {[1,2,3,4,5,6].map(i => (
          <div key={i} style={{ background: T.surface, padding: "14px 16px", textAlign: "center" }}>
            <div className="shimmer" style={{ height: 28, width: 40, margin: "0 auto 4px" }} />
            <div className="shimmer" style={{ height: 9, width: 60, margin: "0 auto" }} />
          </div>
        ))}
      </div>
      <div style={{ marginTop: 20 }}>
        {[1,2,3,4,5].map(i => <div key={i} className="shimmer" style={{ height: 36, marginBottom: 4, borderRadius: 4 }} />)}
      </div>
    </div>
  );
}

// ─── App Root ────────────────────────────────────────────────────────────────
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

  const handleFilterStage = (stage) => {
    const el = document.querySelector(".stats-grid");
    if (el) el.scrollIntoView({ behavior: "smooth" });
  };

  return (
    <React.Fragment>
      <style>{GLOBAL_CSS}</style>
      <div style={{ minHeight: "100vh", background: T.bg }}>
        <Header data={data} loading={loading} />

        {error && (
          <div style={{ textAlign: "center", padding: 60 }}>
            <div style={{ color: T.red, fontSize: 16, marginBottom: 12 }}>Failed to load data. Check sync status.</div>
            <button onClick={loadData} style={{ background: T.card, border: `1px solid ${T.red}`, color: T.red, padding: "8px 20px", borderRadius: 4, cursor: "pointer", fontFamily: "'IBM Plex Mono', monospace", fontSize: 11 }}>Retry</button>
          </div>
        )}

        {loading && !error && <LoadingShimmer />}

        {data && !error && (
          <React.Fragment>
            <StatsBar data={data} />
            <PipelineTable deals={data.deals || []} onSelect={setSelectedDeal} />

            <div className="two-col" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 0, padding: "0 24px 0 24px" }}>
              <div style={{ paddingRight: 12 }}>
                <FollowUpRadar deals={data.deals || []} />
              </div>
              <div style={{ paddingLeft: 12 }}>
                <UpcomingMeetings meetings={data.meetings || []} />
              </div>
            </div>

            <ActivityFeed feed={data.activity_feed} />
            <PipelineByStage deals={data.deals || []} onFilterStage={handleFilterStage} />

            <DealModal deal={selectedDeal} meetings={data.meetings || []} onClose={() => setSelectedDeal(null)} />
          </React.Fragment>
        )}

        <div style={{ textAlign: "center", padding: "20px 0 30px", fontSize: 10, color: T.dim }}>
          <span className="mono">BYZANTINE FINANCE</span>
        </div>
      </div>
    </React.Fragment>
  );
}

ReactDOM.createRoot(document.getElementById("root")).render(<App />);
