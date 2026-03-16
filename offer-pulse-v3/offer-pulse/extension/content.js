// ============================================================
// The Offer Pulse — Content Script v2
// Works on ANY job posting site — no hardcoded company list
// Shows: Hiring Intent Score + LCA/H-1B filing data
// ============================================================

(function () {
  if (window.__offerPulseV2) return;
  window.__offerPulseV2 = true;

  const API_BASE = "https://YOUR_BACKEND_URL.railway.app";
  // ↑ Replace with your deployed backend URL after deploying

  const sessionCache = {};

  // ── UNIVERSAL COMPANY EXTRACTORS ─────────────────────────
  const EXTRACTORS = [
    {
      test: () => location.hostname.includes("linkedin.com"),
      getCompany: () => {
        const sels = [
          ".job-details-jobs-unified-top-card__company-name a",
          ".job-details-jobs-unified-top-card__company-name",
          ".jobs-unified-top-card__company-name a",
          ".jobs-unified-top-card__company-name",
          ".topcard__org-name-link",
          ".topcard__org-name",
        ];
        for (const s of sels) { const el = document.querySelector(s); if (el?.textContent?.trim()) return el.textContent.trim(); }
        return null;
      },
      getBadgeAnchor: () => document.querySelector(".job-details-jobs-unified-top-card__company-name, .jobs-unified-top-card__primary-description, .topcard__flavor-container"),
      getCards: () => document.querySelectorAll(".job-card-container, .jobs-search-results__list-item, .base-card"),
      getCardCompany: (c) => c.querySelector(".job-card-container__primary-description, .job-card-container__company-name, .base-search-card__subtitle, .job-card-list__subtitle")?.textContent?.trim(),
      getCardAnchor: (c) => c.querySelector(".job-card-container__primary-description, .base-search-card__subtitle, .job-card-list__subtitle"),
    },
    {
      test: () => location.hostname.includes("indeed.com"),
      getCompany: () => {
        const sels = ['[data-testid="inlineHeader-companyName"] span', '[data-testid="inlineHeader-companyName"]', ".jobsearch-InlineCompanyRating-companyName", ".css-1ioi40n"];
        for (const s of sels) { const el = document.querySelector(s); if (el?.textContent?.trim()) return el.textContent.trim(); }
        return null;
      },
      getBadgeAnchor: () => document.querySelector('[data-testid="inlineHeader-companyName"], .jobsearch-InlineCompanyRating'),
      getCards: () => document.querySelectorAll(".job_seen_beacon, .tapItem, [data-testid='slider_item']"),
      getCardCompany: (c) => c.querySelector("[data-testid='company-name'], .companyName")?.textContent?.trim(),
      getCardAnchor: (c) => c.querySelector("[data-testid='company-name'], .companyName"),
    },
    {
      test: () => location.hostname.includes("glassdoor.com"),
      getCompany: () => document.querySelector(".employerName, [data-test='employer-name']")?.textContent?.trim(),
      getBadgeAnchor: () => document.querySelector(".employerName, [data-test='employer-name']"),
      getCards: () => document.querySelectorAll("[data-test='job-list-item'], .react-job-listing"),
      getCardCompany: (c) => c.querySelector(".jobEmpolyerName, [data-test='employer-name']")?.textContent?.trim(),
      getCardAnchor: (c) => c.querySelector(".jobLink, .job-title"),
    },
    {
      test: () => location.hostname.includes("greenhouse.io") || location.hostname.includes("boards.greenhouse"),
      getCompany: () => {
        const el = document.querySelector(".company-name, #header .company");
        if (el) return el.textContent.trim();
        const m = location.hostname.match(/^([^.]+)\.greenhouse/) || location.pathname.match(/^\/([^/]+)/);
        return m ? m[1].replace(/-/g, " ") : null;
      },
      getBadgeAnchor: () => document.querySelector(".app-title, .posting-headline, h1"),
      getCards: () => document.querySelectorAll(".opening"),
      getCardCompany: () => document.querySelector(".company-name")?.textContent?.trim(),
      getCardAnchor: (c) => c.querySelector("a"),
    },
    {
      test: () => location.hostname.includes("lever.co"),
      getCompany: () => {
        const el = document.querySelector(".main-header-logo");
        if (el) return el.getAttribute("alt") || el.textContent.trim();
        const p = location.pathname.match(/^\/([^/]+)/);
        return p ? p[1].replace(/-/g, " ") : null;
      },
      getBadgeAnchor: () => document.querySelector(".posting-headline, h1"),
      getCards: () => document.querySelectorAll(".posting"),
      getCardCompany: () => document.querySelector(".main-header-logo")?.getAttribute("alt"),
      getCardAnchor: (c) => c.querySelector("h5, .posting-name"),
    },
    {
      test: () => location.hostname.includes("workday.com") || location.hostname.includes("myworkdayjobs.com"),
      getCompany: () => {
        const el = document.querySelector("[data-automation-id='navigationMenuLogo']");
        if (el) return el.textContent.trim() || el.getAttribute("aria-label");
        return location.hostname.match(/^([^.]+)\./)?.[1]?.replace(/-/g, " ") || null;
      },
      getBadgeAnchor: () => document.querySelector("[data-automation-id='job-posting-header'], h1"),
      getCards: () => document.querySelectorAll("[data-automation-id='compositeContainer']"),
      getCardCompany: () => null,
      getCardAnchor: (c) => c.querySelector("[data-automation-id='jobTitle']"),
    },
    {
      test: () => location.hostname.includes("ashbyhq.com"),
      getCompany: () => {
        const el = document.querySelector(".ashby-job-posting-company-name, header img");
        if (el) return el.textContent?.trim() || el.getAttribute("alt");
        return location.pathname.match(/^\/([^/]+)/)?.[1]?.replace(/-/g, " ") || null;
      },
      getBadgeAnchor: () => document.querySelector("h1, .ashby-job-posting-brief-title"),
      getCards: () => document.querySelectorAll(".ashby-job-posting-brief"),
      getCardCompany: () => document.querySelector(".ashby-job-posting-company-name")?.textContent?.trim(),
      getCardAnchor: (c) => c,
    },
    // Generic fallback — works on any /jobs or /careers page
    {
      test: () => {
        const url = location.href.toLowerCase();
        return url.includes("/jobs") || url.includes("/careers") || url.includes("/job/") || url.includes("apply");
      },
      getCompany: () => {
        const og = document.querySelector('meta[property="og:site_name"]')?.getAttribute("content");
        if (og) return og;
        const title = document.title.replace(/\s*[-–|·]\s*(careers|jobs|hiring|apply|join).*$/i, "").trim();
        if (title && title.length < 60) return title;
        return location.hostname.replace(/^(www|jobs|careers|apply|boards)\./i, "").split(".")[0].replace(/-/g, " ");
      },
      getBadgeAnchor: () => document.querySelector("h1, .job-title, [class*='company'], [class*='employer']"),
      getCards: () => document.querySelectorAll("[class*='job-card'], [class*='job-item'], [class*='opening'], li.job"),
      getCardCompany: () => null,
      getCardAnchor: (c) => c.querySelector("h2, h3, a"),
    },
  ];

  function getExtractor() {
    return EXTRACTORS.find(e => e.test()) || EXTRACTORS[EXTRACTORS.length - 1];
  }

  // ── API CALL ──────────────────────────────────────────────
  async function fetchScore(companyName) {
    const key = companyName.toLowerCase().trim();
    if (key in sessionCache) return sessionCache[key];

    try {
      const res = await fetch(`${API_BASE}/score/${encodeURIComponent(companyName)}`);
      if (!res.ok) throw new Error(`API ${res.status}`);
      const data = await res.json();
      sessionCache[key] = data;
      return data;
    } catch (err) {
      console.warn(`[OfferPulse] "${companyName}":`, err.message);
      sessionCache[key] = null;
      return null;
    }
  }

  // ── SCORE COLOR ───────────────────────────────────────────
  function colorForScore(s) {
    if (s >= 70) return { bg: "#D8F3DC", tx: "#1B4332", dot: "#2D6A4F", border: "#2D6A4F30" };
    if (s >= 40) return { bg: "#FFF3CD", tx: "#7B5E00", dot: "#BA7517", border: "#BA751730" };
    return { bg: "#FFE5E5", tx: "#7B1D1D", dot: "#A32D2D", border: "#A32D2D30" };
  }

  // ── BUILD BADGE ───────────────────────────────────────────
  function buildBadge(data, compact = false) {
    const c   = colorForScore(data.score);
    const lca = data.lca?.analysis;
    const trend    = data.trend || "—";
    const trendNum = parseInt(trend);
    const trendStr = !isNaN(trendNum)
      ? (trendNum > 0 ? `▲ +${Math.abs(trendNum)}` : trendNum < 0 ? `▼ ${trendNum}` : "—")
      : "—";
    const trendCol = trendNum > 0 ? "#2D6A4F" : trendNum < 0 ? "#A32D2D" : "#888";

    const wrap = document.createElement("div");
    wrap.className = "op-wrap";
    wrap.setAttribute("data-op-injected", "true");

    if (compact) {
      // List view — compact single line
      wrap.innerHTML = `
        <div class="op-badge op-compact" style="background:${c.bg};border-color:${c.border}">
          <span class="op-dot" style="background:${c.dot}"></span>
          <strong style="color:${c.tx}">${data.score}</strong>
          <span class="op-sep">·</span>
          <span style="color:${c.tx};font-size:11px;font-weight:600">${data.recommendation}</span>
          ${lca?.certifiedFilings > 0
            ? `<span class="op-lca-pill" style="color:${c.tx};border-color:${c.dot}40">
                H-1B: ${lca.certifiedFilings} LCAs
               </span>`
            : ""}
          <button class="op-why" style="color:${c.tx};border-color:${c.dot}50">why?</button>
        </div>`;
    } else {
      // Detail view — full badge with LCA section
      const lcaSection = lca && lca.certifiedFilings > 0 ? `
        <div class="op-lca-bar" style="background:${c.bg};border-top:1px solid ${c.dot}20">
          <span class="op-lca-icon">H-1B</span>
          <span class="op-lca-stat"><strong>${lca.certifiedFilings}</strong> LCAs filed</span>
          <span class="op-lca-divider">·</span>
          <span class="op-lca-stat"><strong>${lca.recentFilings}</strong> last 12mo</span>
          <span class="op-lca-divider">·</span>
          <span class="op-lca-stat">avg <strong>$${Math.round((lca.avgSalary||0)/1000)}k</strong></span>
          <span class="op-lca-divider">·</span>
          <span class="op-lca-stat">${lca.approvalRate}% approved</span>
          ${lca.activelySponsoring
            ? `<span class="op-lca-active" style="color:${c.dot}">● actively sponsoring</span>`
            : `<span class="op-lca-inactive">○ no recent filings</span>`}
        </div>` : (lca !== null ? `
        <div class="op-lca-bar op-lca-none" style="border-top:1px solid ${c.dot}20">
          <span class="op-lca-icon" style="opacity:0.5">H-1B</span>
          <span style="font-size:11px;color:#999">No LCA filings found — may not sponsor</span>
        </div>` : "");

      wrap.innerHTML = `
        <div class="op-badge" style="background:${c.bg};border-color:${c.border}">
          <div class="op-badge-main">
            <span class="op-dot" style="background:${c.dot}"></span>
            <strong class="op-score" style="color:${c.tx}">${data.score}</strong>
            <span class="op-sep">·</span>
            <span class="op-rec" style="color:${c.tx}">${data.recommendation}</span>
            <span class="op-trend" style="color:${trendCol}">${trendStr}</span>
            <span class="op-conf" style="color:${c.tx}88">${data.confidence}</span>
            ${data.visaFriendly === true
              ? `<span class="op-visa-tag" style="background:${c.dot}18;color:${c.dot}">✓ H-1B friendly</span>`
              : data.visaFriendly === false
              ? `<span class="op-visa-tag" style="background:#88888818;color:#888">H-1B unclear</span>`
              : ""}
            <button class="op-why" style="color:${c.tx};border-color:${c.dot}50">why?</button>
          </div>
          ${lcaSection}
        </div>`;
    }

    wrap.querySelector(".op-why").addEventListener("click", e => {
      e.preventDefault(); e.stopPropagation();
      showTooltip(wrap, data);
    });

    return wrap;
  }

  function buildLoadingBadge() {
    const d = document.createElement("div");
    d.className = "op-wrap";
    d.setAttribute("data-op-injected", "true");
    d.innerHTML = `<div class="op-badge op-loading"><span class="op-spinner"></span><span style="font-size:11px;color:#888">Scoring + checking H-1B...</span></div>`;
    return d;
  }

  // ── TOOLTIP ───────────────────────────────────────────────
  function showTooltip(anchor, data) {
    document.querySelectorAll(".op-tooltip").forEach(t => t.remove());

    const c    = colorForScore(data.score);
    const sigs = data.signals || {};
    const lca  = data.lca?.analysis;

    const sigRows = [
      ["Posting velocity",  sigs.posting_velocity],
      ["Headcount growth",  sigs.headcount_growth],
      ["Funding recency",   sigs.funding_recency],
      ["Layoff risk (inv)", sigs.layoff_risk],
      ["News sentiment",    sigs.news_sentiment],
      ["LCA activity",      sigs.lca_activity],
    ].filter(([, v]) => v != null);

    // LCA top roles
    const lcaRoles = lca?.topRoles?.slice(0, 4) || [];
    const lcaStates = lca?.topStates?.slice(0, 3) || [];

    const tip = document.createElement("div");
    tip.className = "op-tooltip";
    tip.innerHTML = `
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:4px">
        <strong style="font-size:13px;color:#111">${data.company}</strong>
        <span style="font-size:22px;font-weight:700;color:${c.tx}">${data.score}</span>
      </div>
      <div style="font-size:11px;color:#666;margin-bottom:8px">${data.industry||""} · ${data.trend||"—"}pts · ${data.confidence} confidence</div>
      ${data.summary ? `<div style="font-size:12px;color:#333;line-height:1.5;margin-bottom:10px;padding:8px;background:#f8f8f8;border-radius:6px">${data.summary}</div>` : ""}

      <div style="font-size:10px;font-weight:600;color:#999;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:6px">Hiring signals</div>
      <div style="display:flex;flex-direction:column;gap:5px;margin-bottom:12px">
        ${sigRows.map(([n, v]) => `
          <div style="display:flex;align-items:center;gap:7px;font-size:11px">
            <span style="width:130px;color:#555;flex-shrink:0">${n}</span>
            <div style="flex:1;height:3px;border-radius:2px;background:#e8e8e8;overflow:hidden;position:relative">
              <div style="height:100%;width:${v}%;background:${v>=70?"#2D6A4F":v>=40?"#BA7517":"#A32D2D"};position:absolute;left:0;top:0;border-radius:2px"></div>
            </div>
            <span style="font-size:10px;color:#888;width:20px;text-align:right">${v}</span>
          </div>`).join("")}
      </div>

      ${lca ? `
      <div style="background:#F0F7FF;border-radius:8px;padding:10px 12px;margin-bottom:10px">
        <div style="font-size:10px;font-weight:600;color:#185FA5;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:8px">H-1B / LCA Filing Data</div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-bottom:8px">
          <div style="font-size:11px"><span style="color:#555">Total filings</span><br><strong style="color:#111;font-size:14px">${lca.certifiedFilings?.toLocaleString()}</strong></div>
          <div style="font-size:11px"><span style="color:#555">Last 12 months</span><br><strong style="color:${lca.activelySponsoring?"#2D6A4F":"#888"};font-size:14px">${lca.recentFilings}</strong></div>
          <div style="font-size:11px"><span style="color:#555">Avg salary</span><br><strong style="color:#111;font-size:13px">$${((lca.avgSalary||0)/1000).toFixed(0)}k</strong></div>
          <div style="font-size:11px"><span style="color:#555">Approval rate</span><br><strong style="color:#111;font-size:13px">${lca.approvalRate}%</strong></div>
        </div>
        ${lcaRoles.length ? `
          <div style="font-size:10px;color:#555;margin-bottom:4px">Top sponsored roles</div>
          <div style="display:flex;flex-wrap:wrap;gap:4px;margin-bottom:6px">
            ${lcaRoles.map(r => `<span style="font-size:10px;padding:2px 7px;background:#E6F1FB;color:#185FA5;border-radius:10px">${r.title} (${r.count})</span>`).join("")}
          </div>` : ""}
        ${lcaStates.length ? `
          <div style="font-size:10px;color:#555;margin-bottom:4px">Top hiring states</div>
          <div style="font-size:11px;color:#333">${lcaStates.map(s=>`${s.state} (${s.count})`).join(" · ")}</div>` : ""}
        ${data.visaNote ? `<div style="font-size:11px;color:#185FA5;margin-top:6px;border-top:1px solid #C8E0F7;padding-top:6px">${data.visaNote}</div>` : ""}
      </div>` : ""}

      <div style="font-size:10px;color:#aaa;text-align:right;border-top:1px solid #f0f0f0;padding-top:7px">
        The Offer Pulse · AI-scored · LCA: h1bdata.info + myvisajobs + h1bgrader
      </div>`;

    document.body.appendChild(tip);

    const rect = anchor.getBoundingClientRect();
    tip.style.top  = (rect.bottom + window.scrollY + 6) + "px";
    tip.style.left = Math.max(8, Math.min(rect.left + window.scrollX, window.innerWidth - 310)) + "px";

    setTimeout(() => {
      document.addEventListener("click", () => tip.remove(), { once: true });
    }, 50);
  }

  // ── INJECT ────────────────────────────────────────────────
  async function injectBadge(anchor, companyName, compact = false) {
    if (!anchor) return;
    if (anchor.parentElement?.querySelector("[data-op-injected]")) return;

    const loader = buildLoadingBadge();
    anchor.insertAdjacentElement("afterend", loader);

    const data = await fetchScore(companyName);
    loader.remove();

    if (data && !data.error) {
      anchor.insertAdjacentElement("afterend", buildBadge(data, compact));
    }
  }

  async function detect() {
    const ex = getExtractor();
    const company = ex.getCompany();
    const anchor  = ex.getBadgeAnchor();
    if (company && anchor && !anchor.parentElement?.querySelector("[data-op-injected]")) {
      injectBadge(anchor, company, false);
    }
    ex.getCards().forEach(card => {
      if (card.querySelector("[data-op-injected]")) return;
      const co = ex.getCardCompany(card) || company;
      const an = ex.getCardAnchor(card);
      if (co && an) injectBadge(an, co, true);
    });
  }

  let debounce;
  new MutationObserver(() => { clearTimeout(debounce); debounce = setTimeout(detect, 800); })
    .observe(document.body, { childList: true, subtree: true });

  setTimeout(detect, 1000);
})();
