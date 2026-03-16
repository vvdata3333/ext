// ============================================================
// The Offer Pulse — Backend API v2
// Now includes: Live signals + Claude AI scoring + LCA/H-1B data
//
// LCA data sources:
//   - h1bdata.info       (free, no auth, HTML scrape)
//   - myvisajobs.com     (free, HTML scrape)
//   - h1bgrader.com      (free, HTML/API scrape)
//
// POST /score            { company }  → full score + LCA data
// GET  /score/:company               → same, cached 24h
// GET  /lca/:company                 → LCA data only, cached 7d
// POST /score/batch      { companies } → up to 10 at once
// ============================================================

import express from "express";
import cors from "cors";
import Anthropic from "@anthropic-ai/sdk";
import NodeCache from "node-cache";
import * as cheerio from "cheerio";

const app       = express();
const cache     = new NodeCache({ stdTTL: 86400 });   // 24h score cache
const lcaCache  = new NodeCache({ stdTTL: 604800 });  // 7d LCA cache
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

app.use(cors());
app.use(express.json());

// ── FETCH HELPER ───────────────────────────────────────────
async function fetchHtml(url, timeoutMs = 7000) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
      },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.text();
  } finally {
    clearTimeout(id);
  }
}

// ── LCA ANALYSIS ──────────────────────────────────────────
function analyzeLCARows(rows) {
  if (!rows.length) return null;

  const certified = rows.filter(r =>
    r.caseStatus && r.caseStatus.toLowerCase().includes("certif")
  );
  const salaries = certified
    .map(r => r.baseSalary)
    .filter(s => s > 10000 && s < 10000000);

  const avgSalary = salaries.length
    ? Math.round(salaries.reduce((a, b) => a + b, 0) / salaries.length)
    : 0;

  // Top roles by count
  const roleCounts = {};
  certified.forEach(r => {
    if (r.jobTitle) roleCounts[r.jobTitle] = (roleCounts[r.jobTitle] || 0) + 1;
  });
  const topRoles = Object.entries(roleCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
    .map(([title, count]) => ({ title, count }));

  // Top states
  const stateCounts = {};
  certified.forEach(r => {
    if (r.location) {
      const parts = r.location.split(",");
      const state = (parts[1] || parts[0]).trim().replace(/\s+\d+.*$/, "").trim();
      if (state) stateCounts[state] = (stateCounts[state] || 0) + 1;
    }
  });
  const topStates = Object.entries(stateCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([state, count]) => ({ state, count }));

  // Recent filings (last 12 months)
  const oneYearAgo = new Date();
  oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);
  const recentCount = certified.filter(r => {
    try { return r.submitDate && new Date(r.submitDate) > oneYearAgo; }
    catch { return false; }
  }).length;

  return {
    totalFilings:       rows.length,
    certifiedFilings:   certified.length,
    deniedFilings:      rows.length - certified.length,
    approvalRate:       rows.length ? Math.round((certified.length / rows.length) * 100) : 0,
    recentFilings:      recentCount,
    avgSalary,
    salaryRange: {
      min: salaries.length ? Math.min(...salaries) : 0,
      max: salaries.length ? Math.max(...salaries) : 0,
    },
    topRoles,
    topStates,
    sponsorsH1B:        certified.length > 0,
    activelySponsoring: recentCount > 0,
  };
}

// ── SOURCE 1: h1bdata.info ─────────────────────────────────
// Table columns: Employer | Job Title | Base Salary | Location | Submit Date | Start Date | Case Status
async function fetchFromH1BData(company) {
  const rows = [];
  try {
    const encoded = encodeURIComponent(company.toUpperCase());
    const url = `https://h1bdata.info/index.php?em=${encoded}&job=&city=&year=All`;
    const html = await fetchHtml(url, 9000);
    const $ = cheerio.load(html);

    $("table tbody tr, #h1bdata tbody tr").each((i, row) => {
      const cells = $(row).find("td").map((_, td) => $(td).text().trim()).get();
      if (cells.length >= 7) {
        rows.push({
          employer:   cells[0],
          jobTitle:   cells[1].toUpperCase(),
          baseSalary: parseInt(cells[2].replace(/[^0-9]/g, "")) || 0,
          location:   cells[3],
          submitDate: cells[4],
          startDate:  cells[5],
          caseStatus: cells[6],
          source:     "h1bdata.info",
        });
      }
    });
  } catch (err) {
    console.warn("[LCA h1bdata.info]", err.message);
  }
  return rows;
}

// ── SOURCE 2: myvisajobs.com ───────────────────────────────
// Table: Visa Type | Company | Job Title | Location | Salary | Submit Date | Decision
async function fetchFromMyVisaJobs(company) {
  const rows = [];
  try {
    const encoded = encodeURIComponent(company);
    const url = `https://www.myvisajobs.com/Search_H1B_LCA.aspx?KW=${encoded}&PT=LC`;
    const html = await fetchHtml(url, 9000);
    const $ = cheerio.load(html);

    $("table tr").each((i, row) => {
      if (i === 0) return; // skip header
      const cells = $(row).find("td").map((_, td) => $(td).text().trim()).get();
      if (cells.length >= 5) {
        // Find salary cell — it contains $ or numbers
        const salaryCellIdx = cells.findIndex(c => /^\$?[\d,]+$/.test(c.replace(/[^0-9$,]/g, "")) && c.length > 3);
        const salary = salaryCellIdx >= 0
          ? parseInt(cells[salaryCellIdx].replace(/[^0-9]/g, "")) || 0
          : 0;

        // Last cell is usually status
        const status = cells[cells.length - 1];
        const jobTitle = cells[2] || cells[1] || "";

        if (jobTitle && jobTitle.length > 2) {
          rows.push({
            employer:   company,
            jobTitle:   jobTitle.toUpperCase(),
            baseSalary: salary,
            location:   cells[3] || "",
            submitDate: cells[5] || cells[4] || "",
            caseStatus: status.toLowerCase().includes("certif") ? "Certified" : status,
            source:     "myvisajobs.com",
          });
        }
      }
    });
  } catch (err) {
    console.warn("[LCA myvisajobs.com]", err.message);
  }
  return rows;
}

// ── SOURCE 3: h1bgrader.com ────────────────────────────────
// Provides grade + aggregate stats for employer
async function fetchFromH1BGrader(company) {
  let summary = null;
  try {
    // Try JSON search API
    const encoded = encodeURIComponent(company);
    const apiUrl = `https://h1bgrader.com/api/v1/employers/search?q=${encoded}&limit=5`;
    const text = await fetchHtml(apiUrl, 7000);

    try {
      const data = JSON.parse(text);
      const employers = Array.isArray(data) ? data
        : data.employers || data.results || data.data || [];

      const best = employers.find(e =>
        e.name && e.name.toLowerCase().replace(/[^a-z0-9]/g, "").includes(
          company.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 6)
        )
      ) || employers[0];

      if (best) {
        summary = {
          grade:        best.grade || best.employer_grade || null,
          totalCases:   best.total_cases || best.total_applications || best.filings || 0,
          approvalRate: best.approval_rate || best.certified_rate || null,
          avgWage:      best.avg_wage || best.average_wage || best.median_wage || 0,
          source:       "h1bgrader.com",
        };
      }
    } catch {
      // JSON parse failed — scrape HTML fallback
      const $ = cheerio.load(text);
      const name_match = $(".employer-name, .company-name, h1, h2").first().text().trim();
      const grade      = $(".grade, .employer-grade, .rating").first().text().trim();
      const total      = parseInt($(".total-cases, .total-filings").first().text().replace(/[^0-9]/g, "")) || 0;

      if (name_match && total > 0) {
        summary = { grade, totalCases: total, source: "h1bgrader.com (html)" };
      }
    }
  } catch (err) {
    console.warn("[LCA h1bgrader.com]", err.message);
  }
  return summary;
}

// ── DEDUPLICATE ROWS ───────────────────────────────────────
function dedupeRows(rows) {
  const seen = new Set();
  return rows.filter(r => {
    const key = `${r.jobTitle}|${r.submitDate}|${r.baseSalary}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// ── MAIN LCA PIPELINE ─────────────────────────────────────
async function fetchLCAData(company) {
  const cacheKey = `lca:${company.toLowerCase().trim()}`;
  const cached = lcaCache.get(cacheKey);
  if (cached) return { ...cached, from_cache: true };

  const [h1bRows, myvisaRows, graderSummary] = await Promise.all([
    fetchFromH1BData(company),
    fetchFromMyVisaJobs(company),
    fetchFromH1BGrader(company),
  ]);

  const allRows  = dedupeRows([...h1bRows, ...myvisaRows]);
  const analysis = analyzeLCARows(allRows);

  // Merge grader data into analysis if we have it
  if (graderSummary && analysis) {
    analysis.graderGrade        = graderSummary.grade;
    analysis.graderApprovalRate = graderSummary.approvalRate;
    if (graderSummary.avgWage && !analysis.avgSalary) {
      analysis.avgSalary = graderSummary.avgWage;
    }
  }

  const result = {
    company,
    dataAvailable:  allRows.length > 0 || graderSummary != null,
    recentFilings:  allRows.filter(r => r.source === "h1bdata.info").slice(0, 30),
    analysis,
    graderSummary,
    sources: {
      h1bdata:    h1bRows.length,
      myvisajobs: myvisaRows.length,
      h1bgrader:  graderSummary ? 1 : 0,
    },
    fetchedAt: new Date().toISOString(),
    from_cache: false,
  };

  lcaCache.set(cacheKey, result);
  return result;
}

// ── SIGNAL FETCHERS ────────────────────────────────────────
async function fetchNews(company) {
  try {
    const q = encodeURIComponent(`${company} hiring layoffs funding 2024 2025`);
    const html = await fetchHtml(`https://html.duckduckgo.com/html/?q=${q}`, 6000);
    const $ = cheerio.load(html);
    const snippets = [];
    $(".result__snippet").each((i, el) => { if (i < 8) snippets.push($(el).text().trim()); });
    return snippets.join(" | ");
  } catch { return ""; }
}

async function fetchLayoffSignal(company) {
  try {
    const q = encodeURIComponent(`site:layoffs.fyi ${company}`);
    const html = await fetchHtml(`https://html.duckduckgo.com/html/?q=${q}`, 5000);
    const text = cheerio.load(html).text().toLowerCase();
    return (text.includes(company.toLowerCase()) &&
      (text.includes("laid off") || text.includes("layoff") || text.includes("cut")))
      ? "Recent layoff signals found"
      : "No recent layoffs detected";
  } catch { return "Unknown"; }
}

async function fetchFundingSignal(company) {
  try {
    const q = encodeURIComponent(`${company} funding raised 2024 2025 series`);
    const html = await fetchHtml(`https://html.duckduckgo.com/html/?q=${q}`, 5000);
    const $ = cheerio.load(html);
    const snippets = [];
    $(".result__snippet").each((i, el) => { if (i < 4) snippets.push($(el).text().trim()); });
    return snippets.join(" | ");
  } catch { return ""; }
}

async function fetchJobPostingSignal(company) {
  try {
    const q = encodeURIComponent(company);
    const html = await fetchHtml(`https://www.indeed.com/jobs?q=${q}`, 5000);
    const $ = cheerio.load(html);
    const countText = $('[data-testid="searchCount"]').first().text();
    const count = html.match(/"jobCount":(\d+)/)?.[1] || countText.match(/[\d,]+/)?.[0] || "unknown";
    return `Active job postings: ${count}`;
  } catch { return "Job posting data unavailable"; }
}

// ── CLAUDE SCORING ─────────────────────────────────────────
async function scoreWithClaude(company, signals, lcaData) {
  const lca = lcaData?.analysis;
  const lcaSummary = lca
    ? `H-1B/LCA: ${lca.certifiedFilings} certified filings total, ` +
      `${lca.recentFilings} in last 12 months, ` +
      `avg salary $${lca.avgSalary?.toLocaleString() || "unknown"}, ` +
      `approval rate ${lca.approvalRate}%, ` +
      `actively sponsoring: ${lca.activelySponsoring}`
    : "LCA/H-1B data unavailable";

  const prompt = `You are The Offer Pulse hiring intent scoring engine.

Score "${company}" on hiring intent (0–100) given these live signals:

SIGNALS:
- News/context: ${signals.news || "No data"}
- Layoff signals: ${signals.layoffs}
- Funding signals: ${signals.funding || "No data"}
- Job postings: ${signals.jobs}
- ${lcaSummary}

SCORING RULES:
70–100: Actively hiring — strong signals
40–69: Mixed — some hiring but uncertainties
0–39: Low intent — layoffs, freeze, distress

PENALTIES: Confirmed layoffs (−20 to −30), freeze language (−20), bankruptcy (−35)
BOOSTS: Recent funding (+10 to +20), headcount growth (+10), high posting volume (+10), active LCA filings (+5)

Respond ONLY with valid JSON, no markdown, no explanation:
{
  "score": <0-100>,
  "confidence": "<High|Medium|Low>",
  "recommendation": "<Apply now|Selective|Wait|Avoid>",
  "trend": "<like '+8' or '-5' or 'flat'>",
  "industry": "<industry>",
  "summary": "<2 sentences>",
  "visaFriendly": <true|false>,
  "visaNote": "<1 sentence about H-1B sponsorship likelihood>",
  "signals": {
    "posting_velocity": <0-100>,
    "headcount_growth": <0-100>,
    "funding_recency": <0-100>,
    "layoff_risk": <0-100>,
    "news_sentiment": <0-100>,
    "lca_activity": <0-100>
  },
  "cached_at": "${new Date().toISOString()}"
}`;

  const response = await anthropic.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 700,
    messages: [{ role: "user", content: prompt }],
  });

  return JSON.parse(response.content[0].text.trim());
}

// ── FULL PIPELINE ──────────────────────────────────────────
async function getScore(company) {
  const key = company.toLowerCase().trim();
  const cached = cache.get(key);
  if (cached) return { ...cached, from_cache: true };

  const [news, layoffs, funding, jobs, lcaData] = await Promise.all([
    fetchNews(company),
    fetchLayoffSignal(company),
    fetchFundingSignal(company),
    fetchJobPostingSignal(company),
    fetchLCAData(company),
  ]);

  const aiScore = await scoreWithClaude(company, { news, layoffs, funding, jobs }, lcaData);

  const result = { company, ...aiScore, lca: lcaData };
  cache.set(key, result);
  return { ...result, from_cache: false };
}

// ── ROUTES ─────────────────────────────────────────────────
app.get("/",                    (_, res) => res.json({ status: "ok", service: "The Offer Pulse API", version: "2.0.0" }));
app.post("/score",              async (req, res) => { try { res.json(await getScore(req.body.company?.trim())); } catch (e) { res.status(500).json({ error: e.message }); } });
app.get("/score/:company",      async (req, res) => { try { res.json(await getScore(decodeURIComponent(req.params.company).trim())); } catch (e) { res.status(500).json({ error: e.message }); } });
app.get("/lca/:company",        async (req, res) => { try { res.json(await fetchLCAData(decodeURIComponent(req.params.company).trim())); } catch (e) { res.status(500).json({ error: e.message }); } });
app.delete("/cache/:company",   (req, res) => { const k = decodeURIComponent(req.params.company).toLowerCase().trim(); cache.del(k); lcaCache.del(`lca:${k}`); res.json({ cleared: k }); });
app.post("/score/batch",        async (req, res) => {
  const { companies } = req.body;
  if (!Array.isArray(companies) || !companies.length) return res.status(400).json({ error: "companies array required" });
  if (companies.length > 10) return res.status(400).json({ error: "max 10 per batch" });
  const results = await Promise.allSettled(companies.map(c => getScore(c.trim())));
  res.json(results.map((r, i) => ({ company: companies[i], ...(r.status === "fulfilled" ? r.value : { error: r.reason?.message }) })));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Offer Pulse API v2 on port ${PORT}`));
