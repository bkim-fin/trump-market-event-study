const state = {
  data: null,
  toneLag: null,
  reverseClusters: null,
  filters: {
    term: "All",
    platform: "All",
    theme: "All",
    asset: "QQQ",
    window: "1D",
    hideConfounded: false,
    search: "",
  },
  selectedId: null,
};

const fmtPct = (v) => (v === null || v === undefined || Number.isNaN(v) ? "n/a" : `${v > 0 ? "+" : ""}${v.toFixed(3)}%`);
const cls = (v) => (v > 0 ? "gain" : v < 0 ? "loss" : "");
const dateFmt = new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short" });

function unique(values) {
  return [...new Set(values.filter(Boolean))].sort();
}

function byId(id) {
  return document.getElementById(id);
}

async function init() {
  const res = await fetch("data/processed/event_study_data.json");
  state.data = await res.json();
  const toneLagRes = await fetch("data/processed/topic_tone_lag_effects.json");
  state.toneLag = toneLagRes.ok ? await toneLagRes.json() : null;
  const reverseRes = await fetch("data/processed/reverse_response_clusters.json");
  state.reverseClusters = reverseRes.ok ? await reverseRes.json() : null;
  byId("generatedAt").textContent = `Generated ${new Date(state.data.generated_at_utc).toLocaleString()}`;
  const ranges = state.data.summary.asset_date_ranges;
  byId("coverageLabel").textContent = `Prices ${ranges.SPY.start} to ${ranges.SPY.end} | ${state.data.summary.event_count.toLocaleString()} events`;
  populateFilters();
  renderReferences();
  renderToneLagTable();
  renderVolRegimeTable();
  renderReverseClusterTable();
  bindControls();
  render();
}

function populateFilters() {
  const events = state.data.events;
  setOptions("termFilter", ["All", ...unique(events.map((d) => d.term))]);
  setOptions("platformFilter", ["All", ...unique(events.map((d) => d.platform))]);
  setOptions("themeFilter", ["All", ...unique(events.flatMap((d) => d.themes))]);
}

function setOptions(id, options) {
  const el = byId(id);
  el.innerHTML = options.map((value) => `<option value="${escapeHtml(value)}">${escapeHtml(value)}</option>`).join("");
}

function bindControls() {
  [
    ["termFilter", "term"],
    ["platformFilter", "platform"],
    ["themeFilter", "theme"],
    ["assetFilter", "asset"],
    ["windowFilter", "window"],
  ].forEach(([id, key]) => {
    byId(id).addEventListener("change", (event) => {
      state.filters[key] = event.target.value;
      state.selectedId = null;
      render();
    });
  });
  byId("hideConfounded").addEventListener("change", (event) => {
    state.filters.hideConfounded = event.target.checked;
    render();
  });
  byId("textSearch").addEventListener("input", (event) => {
    state.filters.search = event.target.value.trim().toLowerCase();
    render();
  });
}

function filteredEvents() {
  const f = state.filters;
  return state.data.events.filter((e) => {
    if (f.term !== "All" && e.term !== f.term) return false;
    if (f.platform !== "All" && e.platform !== f.platform) return false;
    if (f.theme !== "All" && !e.themes.includes(f.theme)) return false;
    if (f.hideConfounded && e.confounders.length) return false;
    if (f.search) {
      const hay = `${e.original_text} ${e.themes.join(" ")} ${e.entities.join(" ")} ${e.platform} ${e.term}`.toLowerCase();
      if (!hay.includes(f.search)) return false;
    }
    return Boolean(e.returns[f.asset]?.[f.window]);
  });
}

function selectedReturn(e, mode = "abnormal") {
  const r = e.returns[state.filters.asset]?.[state.filters.window];
  if (!r) return null;
  return mode === "raw" ? r.raw : r.abnormal;
}

function render() {
  const events = filteredEvents();
  if (!state.selectedId && events.length) state.selectedId = events[0].post_id;
  renderMetrics(events);
  renderTimeline(events);
  renderThemeTable();
  renderEventTable(events);
  const selected = events.find((e) => e.post_id === state.selectedId) || events[0];
  renderDetail(selected);
}

function renderMetrics(events) {
  const vals = events.map((e) => selectedReturn(e)).filter((v) => v !== null && Number.isFinite(v));
  const mean = vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
  const hit = vals.length ? vals.filter((v) => v > 0).length / vals.length : null;
  const conf = events.filter((e) => e.confounders.length).length;
  byId("metricEvents").textContent = events.length.toLocaleString();
  byId("metricMean").textContent = fmtPct(mean);
  byId("metricMean").className = cls(mean || 0);
  byId("metricHit").textContent = hit === null ? "n/a" : `${Math.round(hit * 100)}%`;
  byId("metricConf").textContent = conf.toLocaleString();
  byId("chartSubhead").textContent = `${state.filters.asset} ${state.filters.window} abnormal returns by aligned trading session. Marker size scales with absolute move.`;
}

function renderTimeline(events) {
  const svg = byId("timeline");
  svg.innerHTML = "";
  const width = svg.clientWidth || 900;
  const height = svg.clientHeight || 360;
  const margin = { top: 24, right: 24, bottom: 42, left: 56 };
  const w = width - margin.left - margin.right;
  const h = height - margin.top - margin.bottom;
  if (!events.length) {
    svg.innerHTML = `<text x="24" y="48" fill="#b8b8b8">No events match the active filters.</text>`;
    return;
  }
  const dates = events.map((e) => new Date(`${e.trading_session}T16:00:00-05:00`).getTime());
  const values = events.map((e) => selectedReturn(e)).filter((v) => v !== null);
  const minDate = Math.min(...dates);
  const maxDate = Math.max(...dates);
  const maxAbs = Math.max(0.5, ...values.map((v) => Math.abs(v)));
  const yLimit = Math.min(Math.max(maxAbs, 1), 12);
  const x = (t) => margin.left + ((t - minDate) / Math.max(1, maxDate - minDate)) * w;
  const y = (v) => margin.top + ((yLimit - Math.max(-yLimit, Math.min(yLimit, v))) / (2 * yLimit)) * h;
  const zeroY = y(0);

  const grid = document.createElementNS("http://www.w3.org/2000/svg", "g");
  grid.setAttribute("class", "grid");
  [-yLimit, -yLimit / 2, 0, yLimit / 2, yLimit].forEach((tick) => {
    const line = svgLine(margin.left, y(tick), margin.left + w, y(tick), tick === 0 ? "#d8d8d8" : "rgba(255,255,255,0.14)");
    grid.appendChild(line);
    const label = svgText(10, y(tick) + 4, `${tick.toFixed(1)}%`);
    label.setAttribute("fill", "#b8b8b8");
    label.setAttribute("font-size", "11");
    grid.appendChild(label);
  });
  svg.appendChild(grid);

  const axis = document.createElementNS("http://www.w3.org/2000/svg", "g");
  axis.setAttribute("class", "axis");
  const startYear = new Date(minDate).getFullYear();
  const endYear = new Date(maxDate).getFullYear();
  for (let yr = startYear; yr <= endYear; yr += 1) {
    const t = new Date(`${yr}-01-01T00:00:00Z`).getTime();
    if (t >= minDate && t <= maxDate) {
      axis.appendChild(svgLine(x(t), margin.top, x(t), margin.top + h, "rgba(255,255,255,0.11)"));
      axis.appendChild(svgText(x(t) - 12, margin.top + h + 24, String(yr)));
    }
  }
  svg.appendChild(axis);
  svg.appendChild(svgLine(margin.left, zeroY, margin.left + w, zeroY, "#d8d8d8"));

  const drawEvents = [...events]
    .sort((a, b) => Math.abs(selectedReturn(a) || 0) - Math.abs(selectedReturn(b) || 0))
    .slice(-900);
  drawEvents.forEach((e) => {
    const value = selectedReturn(e);
    if (value === null) return;
    const cx = x(new Date(`${e.trading_session}T16:00:00-05:00`).getTime());
    const cy = y(value);
    const r = 3 + Math.min(8, Math.abs(value) * 0.85);
    const c = document.createElementNS("http://www.w3.org/2000/svg", "circle");
    c.setAttribute("class", `event-point ${e.post_id === state.selectedId ? "active" : ""}`);
    c.setAttribute("cx", cx);
    c.setAttribute("cy", cy);
    c.setAttribute("r", r);
    c.setAttribute("fill", e.confounders.length ? "#d8d8d8" : value >= 0 ? "#00e676" : "#ff1d35");
    c.setAttribute("opacity", "0.78");
    c.addEventListener("click", () => {
      state.selectedId = e.post_id;
      render();
    });
    const title = document.createElementNS("http://www.w3.org/2000/svg", "title");
    title.textContent = `${e.trading_session} ${fmtPct(value)} ${e.themes.join(", ")} - ${e.summary}`;
    c.appendChild(title);
    svg.appendChild(c);
  });
}

function svgLine(x1, y1, x2, y2, stroke) {
  const el = document.createElementNS("http://www.w3.org/2000/svg", "line");
  el.setAttribute("x1", x1);
  el.setAttribute("y1", y1);
  el.setAttribute("x2", x2);
  el.setAttribute("y2", y2);
  el.setAttribute("stroke", stroke);
  return el;
}

function svgText(x, y, text) {
  const el = document.createElementNS("http://www.w3.org/2000/svg", "text");
  el.setAttribute("x", x);
  el.setAttribute("y", y);
  el.textContent = text;
  return el;
}

function renderThemeTable() {
  const f = state.filters;
  const rows = state.data.theme_stats.filter((r) => {
    if (f.term !== "All" && r.term !== f.term) return false;
    if (f.theme !== "All" && r.theme !== f.theme) return false;
    return true;
  });
  const tbody = byId("themeTable").querySelector("tbody");
  tbody.innerHTML = rows
    .map(
      (r) => `<tr>
        <td>${escapeHtml(r.term)}</td>
        <td>${escapeHtml(r.theme)}</td>
        <td class="num">${r.n.toLocaleString()}</td>
        <td class="num ${cls(r.QQQ_mean_abn_1d || 0)}">${fmtPct(r.QQQ_mean_abn_1d)}</td>
        <td class="num ${cls(r.RTX_mean_abn_1d || 0)}">${fmtPct(r.RTX_mean_abn_1d)}</td>
        <td class="num">${r.QQQ_t ?? "n/a"}</td>
        <td class="num">${r.RTX_t ?? "n/a"}</td>
        <td class="num">${r.confounded}</td>
      </tr>`
    )
    .join("");
}

function renderToneLagTable() {
  const tbody = byId("toneLagTable")?.querySelector("tbody");
  if (!tbody) return;
  if (!state.toneLag) {
    tbody.innerHTML = `<tr><td colspan="11" class="empty">Topic-tone lag analysis has not been generated.</td></tr>`;
    return;
  }
  const cleanRows = state.toneLag.rows
    .filter((r) => !r.topic_id.startsWith("false_positive"))
    .slice(0, 18);
  tbody.innerHTML = cleanRows
    .map((r) => {
      const q = r.qqq_best || {};
      const x = r.rtx_best || {};
      const read = inferRead(r);
      return `<tr>
        <td>${escapeHtml(r.topic_label)}</td>
        <td>${escapeHtml(r.tone_label)}</td>
        <td class="num">${r.event_days}</td>
        <td class="num">${r.influence_score}</td>
        <td>${escapeHtml(q.window || "n/a")}</td>
        <td class="num ${cls(q.mean || 0)}">${fmtPct(q.mean)}</td>
        <td class="num">${q.t ?? "n/a"}</td>
        <td>${escapeHtml(x.window || "n/a")}</td>
        <td class="num ${cls(x.mean || 0)}">${fmtPct(x.mean)}</td>
        <td class="num">${x.t ?? "n/a"}</td>
        <td>${escapeHtml(read)}</td>
      </tr>`;
    })
    .join("");
}

function renderVolRegimeTable() {
  const tbody = byId("volRegimeTable")?.querySelector("tbody");
  if (!tbody) return;
  if (!state.toneLag) {
    tbody.innerHTML = `<tr><td colspan="9" class="empty">Volatility-regime analysis has not been generated.</td></tr>`;
    return;
  }
  const rows = [];
  state.toneLag.rows
    .filter((r) => !r.topic_id.startsWith("false_positive"))
    .forEach((row) => {
      Object.entries(row.by_vix_regime || {}).forEach(([regime, stats]) => {
        const q = stats.QQQ || {};
        const x = stats.RTX || {};
        if ((q.n_days || 0) < 6) return;
        rows.push({
          topic: row.topic_label,
          tone: row.tone_label,
          regime,
          days: q.n_days,
          qMean: q.mean,
          qHit: q.hit_rate,
          rMean: x.mean,
          rHit: x.hit_rate,
          strength: Math.abs(q.mean || 0) + Math.abs(x.mean || 0),
        });
      });
    });
  rows.sort((a, b) => b.strength - a.strength);
  tbody.innerHTML = rows
    .slice(0, 24)
    .map((r) => `<tr>
      <td>${escapeHtml(r.topic)}</td>
      <td>${escapeHtml(r.tone)}</td>
      <td><span class="tag ${r.regime === "high-vol" ? "warn" : ""}">${escapeHtml(r.regime)}</span></td>
      <td class="num">${r.days}</td>
      <td class="num ${cls(r.qMean || 0)}">${fmtPct(r.qMean)}</td>
      <td class="num">${r.qHit === null || r.qHit === undefined ? "n/a" : `${Math.round(r.qHit * 100)}%`}</td>
      <td class="num ${cls(r.rMean || 0)}">${fmtPct(r.rMean)}</td>
      <td class="num">${r.rHit === null || r.rHit === undefined ? "n/a" : `${Math.round(r.rHit * 100)}%`}</td>
      <td>${escapeHtml(regimeRead(r))}</td>
    </tr>`)
    .join("");
}

function renderReverseClusterTable() {
  const tbody = byId("reverseClusterTable")?.querySelector("tbody");
  if (!tbody) return;
  if (!state.reverseClusters) {
    tbody.innerHTML = `<tr><td colspan="9" class="empty">Reverse response clusters have not been generated.</td></tr>`;
    return;
  }
  const rows = [...state.reverseClusters.clusters]
    .filter((cluster) => ["QQQ", "NASDAQ", "RTX"].includes(cluster.asset))
    .sort((a, b) => Math.abs(b.surprise_vs_prev3.mean || 0) - Math.abs(a.surprise_vs_prev3.mean || 0))
    .slice(0, 36);
  tbody.innerHTML = rows
    .map((cluster) => {
      const example = cluster.examples?.[0];
      return `<tr>
        <td>${escapeHtml(cluster.asset)}</td>
        <td><span class="tag ${cluster.outcome === "negative" ? "warn" : ""}">${escapeHtml(cluster.outcome)}</span></td>
        <td class="num">${cluster.n_event_days}</td>
        <td class="num">${cluster.n_posts}</td>
        <td class="num ${cls(cluster.surprise_vs_prev3.mean || 0)}">${fmtPct(cluster.surprise_vs_prev3.mean)}</td>
        <td class="num ${cls(cluster.response_return.mean || 0)}">${fmtPct(cluster.response_return.mean)}</td>
        <td>${escapeHtml(Object.entries(cluster.lag_mix || {}).map(([k, v]) => `${k}:${v}`).join(" "))}</td>
        <td>${escapeHtml(cluster.top_terms.slice(0, 9).join(", "))}</td>
        <td>${example ? `${escapeHtml(example.trading_session)} | ${escapeHtml(example.summary)}` : ""}</td>
      </tr>`;
    })
    .join("");
}

function regimeRead(row) {
  if (row.regime === "high-vol" && row.qMean < -0.25 && row.rMean > 0.25) return "stress defense tilt";
  if (row.regime === "high-vol" && row.qMean > 0.25 && row.rMean < -0.25) return "stress tech relief, RTX weak";
  if (row.qMean > 0.25 && row.rMean > 0.25) return "both positive";
  if (row.qMean < -0.25 && row.rMean < -0.25) return "both negative";
  if (row.qMean > 0.25) return "QQQ-led";
  if (row.rMean > 0.25) return "RTX-led";
  if (row.rMean < -0.25) return "RTX drag";
  return "mixed";
}

function inferRead(row) {
  const q = row.qqq_best?.mean;
  const r = row.rtx_best?.mean;
  if (q > 0.25 && r < -0.25) return "QQQ up, RTX down after lag";
  if (q > 0.25 && r > 0.25) return "Broad risk-on / both positive";
  if (q < -0.25 && r > 0.25) return "Defense tilt vs tech";
  if (q < -0.25 && r < -0.25) return "Risk-off / both negative";
  if (r > 0.5) return "RTX-sensitive";
  if (r < -0.5) return "RTX-negative";
  if (q > 0.25) return "QQQ-sensitive";
  return "Weak or mixed";
}

function renderEventTable(events) {
  const tbody = byId("eventTable").querySelector("tbody");
  const rows = [...events]
    .sort((a, b) => Math.abs(selectedReturn(b) || 0) - Math.abs(selectedReturn(a) || 0))
    .slice(0, 350);
  tbody.innerHTML = rows
    .map((e) => {
      const raw = selectedReturn(e, "raw");
      const abn = selectedReturn(e, "abnormal");
      return `<tr data-id="${escapeHtml(e.post_id)}">
        <td>${escapeHtml(formatEt(e.datetime_et))}</td>
        <td>${escapeHtml(e.term)}</td>
        <td>${escapeHtml(e.platform)}</td>
        <td>${escapeHtml(e.session_bucket)}</td>
        <td><div class="tagline">${e.themes.map((t) => `<span class="tag">${escapeHtml(t)}</span>`).join("")}</div></td>
        <td class="num ${cls(raw || 0)}">${fmtPct(raw)}</td>
        <td class="num ${cls(abn || 0)}">${fmtPct(abn)}</td>
        <td>${e.confounders.length ? `<span class="tag warn">${e.confounders.length}</span>` : ""}</td>
        <td>${escapeHtml(e.summary)}</td>
      </tr>`;
    })
    .join("");
  tbody.querySelectorAll("tr").forEach((tr) => {
    tr.addEventListener("click", () => {
      state.selectedId = tr.dataset.id;
      renderDetail(events.find((e) => e.post_id === state.selectedId));
      renderTimeline(events);
    });
  });
  if (!rows.length) tbody.innerHTML = `<tr><td colspan="9" class="empty">No events match the active filters.</td></tr>`;
}

function renderDetail(e) {
  const el = byId("eventDetail");
  if (!e) {
    el.innerHTML = "No event selected.";
    return;
  }
  const returns = e.returns[state.filters.asset] || {};
  const returnCards = Object.entries(returns)
    .map(([windowName, r]) => `<div><strong>${escapeHtml(windowName)}</strong><br>Raw <span class="${cls(r.raw || 0)}">${fmtPct(r.raw)}</span><br>Abn. <span class="${cls(r.abnormal || 0)}">${fmtPct(r.abnormal)}</span><br>Beta ${r.beta_vs_spy}</div>`)
    .join("");
  el.innerHTML = `
    <h3>${escapeHtml(e.summary)}</h3>
    <div class="detail-row"><strong>Timestamp</strong><span>${escapeHtml(formatEt(e.datetime_et))}<br>${escapeHtml(e.datetime_utc)}</span></div>
    <div class="detail-row"><strong>Session</strong><span>${escapeHtml(e.trading_session)} | ${escapeHtml(e.session_bucket)}</span></div>
    <div class="detail-row"><strong>Source</strong><span><a href="${escapeAttr(e.source_url)}" target="_blank" rel="noreferrer">${escapeHtml(e.platform)} record</a></span></div>
    <div class="detail-row"><strong>Themes</strong><span>${tags(e.themes)}</span></div>
    <div class="detail-row"><strong>Entities</strong><span>${e.entities.length ? tags(e.entities) : "None detected"}</span></div>
    <div class="detail-row"><strong>Fact Check</strong><span>${escapeHtml(e.fact_check_status)} | confidence ${Math.round(e.confidence * 100)}%</span></div>
    <div class="returns-grid">${returnCards}</div>
    <div class="detail-row"><strong>Confounders</strong><span>${e.confounders.length ? e.confounders.map((c) => `${escapeHtml(c.date)} ${escapeHtml(c.type)}: ${escapeHtml(c.note)}`).join("<br>") : "None flagged in +/-1 day ledger"}</span></div>
    <div class="detail-row"><strong>Original</strong><span>${escapeHtml(e.original_text)}</span></div>
    <div class="detail-row"><strong>Dataset Note</strong><span>${escapeHtml(e.dataset_note)}</span></div>
  `;
}

function tags(items) {
  return `<div class="tagline">${items.map((t) => `<span class="tag">${escapeHtml(t)}</span>`).join("")}</div>`;
}

function renderReferences() {
  byId("sourceRegistry").innerHTML = state.data.source_registry
    .map((s) => `<div class="reference-item">
      <strong>${escapeHtml(s.dataset)}</strong>
      <p>Primary: ${escapeHtml(s.primary_source)}</p>
      <p>Backup: ${escapeHtml(s.backup_source)}</p>
      <p>Coverage: ${escapeHtml(s.coverage)}</p>
      <p>Timestamp: ${escapeHtml(s.timestamp)}</p>
      <p>Reliability: ${escapeHtml(s.reliability)}</p>
      <p><a href="${escapeAttr(s.url)}" target="_blank" rel="noreferrer">Reference link</a></p>
    </div>`)
    .join("");
  byId("factLedger").innerHTML = state.data.fact_check_ledger
    .map((f) => `<div class="reference-item"><strong>${escapeHtml(f.layer)} - ${escapeHtml(f.status)}</strong><p>${escapeHtml(f.note)}</p></div>`)
    .join("");
  byId("limitations").innerHTML = state.data.limitations.map((l) => `<li>${escapeHtml(l)}</li>`).join("");
  byId("qaChecks").innerHTML = state.data.qa_checks
    .map((q) => `<div class="reference-item"><strong>${escapeHtml(q.check)} - ${escapeHtml(q.status)}</strong><p>${escapeHtml(q.detail)}</p></div>`)
    .join("");
  byId("methodText").innerHTML = Object.entries(state.data.method)
    .map(([k, v]) => `<p><strong>${escapeHtml(titleCase(k))}:</strong> ${escapeHtml(v)}</p>`)
    .join("");
}

function formatEt(iso) {
  try {
    return dateFmt.format(new Date(iso));
  } catch {
    return iso;
  }
}

function titleCase(text) {
  return text.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function escapeAttr(value) {
  return escapeHtml(value).replaceAll("`", "&#096;");
}

window.addEventListener("resize", () => {
  if (state.data) renderTimeline(filteredEvents());
});

init().catch((error) => {
  document.body.innerHTML = `<main class="empty">Could not load dashboard data: ${escapeHtml(error.message)}</main>`;
});
