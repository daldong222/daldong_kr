// 연기금 수급 프록시 — 네이버 증권 모바일 API (JSON)
// GET /api/pension            → 전체 데이터
// GET /api/pension?probe=1    → 연결 진단용

const UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1";

async function getJSON(url) {
  const r = await fetch(url, {
    headers: {
      "User-Agent": UA,
      "Referer": "https://m.stock.naver.com/",
      "Accept": "application/json",
      "Accept-Language": "ko-KR,ko;q=0.9",
    },
  });
  const t = await r.text();
  if (!r.ok) throw new Error("naver " + r.status + ":" + t.slice(0, 40));
  try { return JSON.parse(t); } catch (e) { throw new Error("parse:" + t.slice(0, 60)); }
}

const num = (v) => { const n = Number(String(v ?? "").replace(/[,\s]/g, "")); return isNaN(n) ? 0 : n; };

// 코스피 투자자별 매매동향 (일별)
// m.stock.naver.com 의 지수 투자자 매매동향 API
async function investorTrend() {
  // KOSPI 지수 코드: KOSPI
  const url = "https://m.stock.naver.com/api/index/KOSPI/trend?pageSize=30";
  const j = await getJSON(url);
  const arr = Array.isArray(j) ? j : (j.trends || j.result || j.list || []);
  return arr.map((r) => ({
    d: r.localTradedAt || r.bizdate || r.date || "",
    // 필드명은 응답에 따라 유연하게
    pension: num(r.pensionFund ?? r.pension ?? r.연기금 ?? r.trustAndPension),
    foreign: num(r.foreigner ?? r.foreign ?? r.외국인),
    inst: num(r.organ ?? r.institution ?? r.기관),
    indi: num(r.individual ?? r.person ?? r.개인),
    kospi: num(r.closePrice ?? r.closeVal ?? r.현재가),
  })).filter((x) => x.d);
}

module.exports = async (req, res) => {
  const out = { ok: false, ts: Date.now(), steps: {} };

  if (req.query.probe) {
    const tries = [
      "https://m.stock.naver.com/api/index/KOSPI/trend?pageSize=30",
      "https://m.stock.naver.com/api/index/KOSPI/investorTrend?pageSize=30",
      "https://api.stock.naver.com/index/KOSPI/investorTrend",
    ];
    for (const u of tries) {
      try {
        const r = await fetch(u, { headers: { "User-Agent": UA, "Referer": "https://m.stock.naver.com/", "Accept": "application/json" } });
        const t = await r.text();
        out.steps[u.slice(-40)] = { status: r.status, len: t.length, head: t.slice(0, 100).replace(/\s+/g, " ") };
      } catch (e) { out.steps[u.slice(-40)] = { error: String(e.message) }; }
    }
    res.status(200).json(out);
    return;
  }

  try {
    const rows = await investorTrend();
    if (rows.length) {
      const asc = rows.slice().reverse();
      out.daily = asc.map((x) => ({ d: String(x.d).slice(0, 10).replace(/\./g, "-"), pension: Math.round(x.pension / 1e8), kospi: x.kospi || null }));
      const last5 = asc.slice(-5);
      out.who = [
        { key: "pension", v: Math.round(last5.reduce((s, x) => s + x.pension, 0) / 1e8) },
        { key: "foreign", v: Math.round(last5.reduce((s, x) => s + x.foreign, 0) / 1e8) },
        { key: "inst", v: Math.round(last5.reduce((s, x) => s + x.inst, 0) / 1e8) },
        { key: "indi", v: Math.round(last5.reduce((s, x) => s + x.indi, 0) / 1e8) },
      ];
      out.ok = true;
    } else {
      out.steps.note = "데이터 없음";
    }
  } catch (e) {
    out.error = String(e.message || e);
  }

  res.setHeader("Cache-Control", "s-maxage=1800, stale-while-revalidate=7200");
  res.status(200).json(out);
};
