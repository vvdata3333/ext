const DEFAULT_API = "https://YOUR_BACKEND_URL.railway.app";

function getApiUrl(cb) {
  try {
    chrome.storage.sync.get(["apiUrl"], r => cb(r.apiUrl || DEFAULT_API));
  } catch {
    cb(DEFAULT_API);
  }
}

const scC  = s => s >= 70 ? "#1B4332" : s >= 40 ? "#7B5E00" : "#7B1D1D";
const bgC  = s => s >= 70 ? "#D8F3DC" : s >= 40 ? "#FFF3CD" : "#FFE5E5";
const barC = v => v >= 70 ? "#2D6A4F" : v >= 40 ? "#BA7517" : "#A32D2D";
const fmt  = n => n ? `$${Math.round(n/1000)}k` : "—";

function showTab(t) {
  ["search","config","lca"].forEach(id => {
    const el = document.getElementById(`tab-${id}`);
    if (el) el.style.display = id === t ? "block" : "none";
  });
  document.querySelectorAll(".t").forEach(el => {
    el.className = "t" + (el.dataset.tab === t ? " on" : "");
  });
}

function setStatus(id, msg, isErr) {
  const el = document.getElementById(id);
  if (!el) return;
  el.textContent = msg;
  el.className   = "status" + (isErr ? " err" : "");
  el.style.display = msg ? "block" : "none";
}

async function lookup() {
  const val = document.getElementById("ci").value.trim();
  if (!val) return;
  const btn = document.getElementById("sbtn");
  btn.disabled = true; btn.textContent = "Scoring...";
  setStatus("status", "Fetching live signals + LCA data + AI scoring...");
  document.getElementById("result").innerHTML = "";

  getApiUrl(async apiUrl => {
    try {
      const res = await fetch(`${apiUrl}/score/${encodeURIComponent(val)}`);
      if (!res.ok) throw new Error(`API error ${res.status}`);
      const d = await res.json();
      setStatus("status", "");
      renderResult(d);
    } catch (err) {
      setStatus("status", "Cannot reach API. Check Settings tab.", true);
    } finally {
      btn.disabled = false; btn.textContent = "Score";
    }
  });
}

async function lookupLCA() {
  const val = document.getElementById("lca-input").value.trim();
  if (!val) return;
  const btn = document.getElementById("lca-btn");
  btn.disabled = true; btn.textContent = "Fetching...";
  setStatus("lca-status", "Checking h1bdata.info, myvisajobs, h1bgrader...");
  document.getElementById("lca-result").innerHTML = "";

  getApiUrl(async apiUrl => {
    try {
      const res = await fetch(`${apiUrl}/lca/${encodeURIComponent(val)}`);
      if (!res.ok) throw new Error(`API error ${res.status}`);
      const d = await res.json();
      setStatus("lca-status", "");
      renderLCA(d);
    } catch (err) {
      setStatus("lca-status", "Cannot reach API. Check Settings tab.", true);
    } finally {
      btn.disabled = false; btn.textContent = "Look up";
    }
  });
}

function renderResult(d) {
  const sigs = d.signals || {};
  const lca  = d.lca?.analysis;
  const cached = d.from_cache ? " · cached" : " · live";

  const sigRows = [
    ["Posting velocity",  sigs.posting_velocity],
    ["Headcount growth",  sigs.headcount_growth],
    ["Funding recency",   sigs.funding_recency],
    ["Layoff risk (inv)", sigs.layoff_risk],
    ["News sentiment",    sigs.news_sentiment],
    ["LCA activity",      sigs.lca_activity],
  ].filter(([, v]) => v != null);

  const lcaSection = lca ? `
    <div class="lca-section">
      <div class="lca-header">H-1B / LCA Filing Data</div>
      <div class="lca-grid">
        <div class="lca-stat"><span>Certified filings</span><strong>${lca.certifiedFilings?.toLocaleString() || 0}</strong></div>
        <div class="lca-stat"><span>Last 12 months</span><strong style="color:${lca.activelySponsoring?"#2D6A4F":"#888"}">${lca.recentFilings}</strong></div>
        <div class="lca-stat"><span>Avg salary</span><strong>${fmt(lca.avgSalary)}</strong></div>
        <div class="lca-stat"><span>Approval rate</span><strong>${lca.approvalRate}%</strong></div>
      </div>
      ${lca.topRoles?.length ? `
        <div class="lca-sub">Top sponsored roles</div>
        <div class="lca-pills">${lca.topRoles.slice(0,4).map(r=>`<span class="lca-pill">${r.title} (${r.count})</span>`).join("")}</div>` : ""}
      ${lca.topStates?.length ? `
        <div class="lca-sub" style="margin-top:6px">Top states</div>
        <div style="font-size:11px;color:#444">${lca.topStates.slice(0,4).map(s=>`${s.state} (${s.count})`).join(" · ")}</div>` : ""}
      ${d.visaNote ? `<div class="visa-note">${d.visaNote}</div>` : ""}
      <div class="lca-sources">Sources: h1bdata.info · myvisajobs.com · h1bgrader.com</div>
    </div>` : "";

  document.getElementById("result").innerHTML = `
    <div class="card">
      <div class="card-hdr">
        <div>
          <div class="card-name">${d.company}</div>
          <div class="card-meta">${d.industry||""} · ${d.trend||"—"}pts · ${d.confidence}${cached}</div>
        </div>
        <div class="card-score" style="color:${scC(d.score)}">${d.score}</div>
      </div>
      <div class="card-rec" style="background:${bgC(d.score)};color:${scC(d.score)}">${d.recommendation}</div>
      ${d.summary ? `<div class="card-summary">${d.summary}</div>` : ""}
      <div class="card-sigs">
        ${sigRows.map(([n,v])=>`<div class="sig">
          <span class="sig-n">${n}</span>
          <div class="sig-b"><div class="sig-f" style="width:${v}%;background:${barC(v)}"></div></div>
          <span class="sig-v">${v}</span>
        </div>`).join("")}
      </div>
      ${lcaSection}
      <div class="card-foot">The Offer Pulse · AI + live signals + LCA</div>
    </div>`;
}

function renderLCA(d) {
  const lca = d.analysis;
  if (!d.dataAvailable || !lca) {
    document.getElementById("lca-result").innerHTML =
      `<div class="empty">No LCA/H-1B filings found for "${d.company}".<br><span style="font-size:11px;color:#aaa">This company may not sponsor or filings are under a different entity name.</span></div>`;
    return;
  }

  const recentFilings = (d.recentFilings || []).slice(0, 8);

  document.getElementById("lca-result").innerHTML = `
    <div class="card">
      <div class="card-hdr" style="background:#EBF5FF">
        <div>
          <div class="card-name">${d.company}</div>
          <div class="card-meta">LCA / H-1B filing data · ${d.fetchedAt?.slice(0,10)||""}</div>
        </div>
        <div style="font-size:22px;font-weight:700;color:${lca.activelySponsoring?"#185FA5":"#888"}">
          ${lca.activelySponsoring ? "✓" : "—"}
        </div>
      </div>
      <div style="padding:10px 12px;font-size:12px;font-weight:600;text-align:center;background:${lca.activelySponsoring?"#E6F1FB":"#f5f5f5"};color:${lca.activelySponsoring?"#185FA5":"#888"}">
        ${lca.activelySponsoring ? "Actively sponsoring H-1B visas" : "No recent H-1B sponsorship activity"}
      </div>
      <div class="lca-grid" style="padding:10px 12px">
        <div class="lca-stat"><span>Total certified</span><strong>${lca.certifiedFilings?.toLocaleString()}</strong></div>
        <div class="lca-stat"><span>Last 12 months</span><strong>${lca.recentFilings}</strong></div>
        <div class="lca-stat"><span>Avg salary</span><strong>${fmt(lca.avgSalary)}</strong></div>
        <div class="lca-stat"><span>Approval rate</span><strong>${lca.approvalRate}%</strong></div>
        <div class="lca-stat"><span>Min salary</span><strong>${fmt(lca.salaryRange?.min)}</strong></div>
        <div class="lca-stat"><span>Max salary</span><strong>${fmt(lca.salaryRange?.max)}</strong></div>
      </div>
      ${lca.topRoles?.length ? `
        <div style="padding:0 12px 6px">
          <div class="lca-sub">Top sponsored roles</div>
          <div class="lca-pills">${lca.topRoles.map(r=>`<span class="lca-pill">${r.title}<span style="opacity:0.6;margin-left:3px">(${r.count})</span></span>`).join("")}</div>
        </div>` : ""}
      ${lca.topStates?.length ? `
        <div style="padding:0 12px 10px">
          <div class="lca-sub">Top hiring states</div>
          <div style="font-size:11px;color:#444">${lca.topStates.map(s=>`${s.state} (${s.count})`).join(" · ")}</div>
        </div>` : ""}
      ${recentFilings.length ? `
        <div style="padding:0 12px 10px;border-top:1px solid #eee">
          <div class="lca-sub" style="padding-top:8px">Recent filings</div>
          ${recentFilings.map(f=>`<div style="font-size:11px;color:#333;padding:3px 0;border-bottom:1px solid #f5f5f5;display:flex;justify-content:space-between">
            <span style="flex:1">${f.jobTitle}</span>
            <span style="color:#555;margin:0 6px">${fmt(f.baseSalary)}</span>
            <span style="color:#888">${f.submitDate?.slice(0,7)||""}</span>
          </div>`).join("")}
        </div>` : ""}
      <div class="lca-sources" style="padding:7px 12px">
        Sources: h1bdata.info · myvisajobs.com · h1bgrader.com · ${d.sources?.h1bdata||0}+${d.sources?.myvisajobs||0} records
      </div>
    </div>`;
}

async function saveConfig() {
  const url = document.getElementById("api-url").value.trim();
  if (!url) return;
  chrome.storage.sync.set({ apiUrl: url }, async () => {
    setStatus("cfg-status", "Saved. Testing...");
    try {
      const res = await fetch(`${url}/`);
      const d   = await res.json();
      setStatus("cfg-status", `Connected: ${d.service||"OK"} v${d.version||""}`);
    } catch {
      setStatus("cfg-status", "Saved but cannot connect. Check URL.", true);
    }
  });
}

// Init
document.addEventListener("DOMContentLoaded", () => {
  showTab("search");
  try {
    chrome.storage.sync.get(["apiUrl"], r => {
      if (r.apiUrl) document.getElementById("api-url").value = r.apiUrl;
    });
  } catch {}
});

document.getElementById("ci")?.addEventListener("keydown", e => { if (e.key === "Enter") lookup(); });
document.getElementById("lca-input")?.addEventListener("keydown", e => { if (e.key === "Enter") lookupLCA(); });
