// 연기금 수급 프록시 — 네이버 증권 모바일 API (JSON)
// GET /api/pension            → 전체 데이터
// GET /api/pension?probe=1    → 연결 진단용
// 확인된 엔드포인트: m.stock.naver.com/api/index/KOSPI/trend

const UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1";
const TREND = "https://m.stock.naver.com/api/index/KOSPI/trend?pageSize=40";

async function getText(url) {
  const r = await fetch(url, {
    headers: { "User-Agent": UA, "Referer": "https://m.stock.naver.com/", "Accept": "application/json", "Accept-Language": "ko-KR,ko;q=0.9" },
  });
  const t = await r.text();
  if (!r.ok) throw new Error("naver " + r.status + ":" + t.slice(0, 40));
  return t;
}
async function getJSON(url) {
  const t = await getText(url);
  try { return JSON.parse(t); } catch (e) { throw new Error("parse:" + t.slice(0, 60)); }
}

// 문자열 숫자(부호·콤마 포함) → 정수(원)
const num = (v) => { const n = Number(String(v ?? "").replace(/[,\s]/g, "")); return isNaN(n) ? 0 : n; };

// 응답 배열에서 연기금 값을 여러 후보 필드명으로 탐색
function pensionOf(r) {
  const keys = ["pensionFundValue", "pensionValue", "pensionFund", "pension", "trustValue", "nationalPensionValue"];
  for (const k of keys) if (r[k] != null) return num(r[k]);
  return null; // 없으면 null
}

async function trend() {
  const j = await getJSON(TREND);
  const arr = Array.isArray(j) ? j : (j.trends || j.result || j.list || j.data || []);
  return arr.map((r) => {
    const p = pensionOf(r);
    return {
      d: String(r.bizdate || r.localTradedAt || r.date || ""),
      indi: num(r.personalValue ?? r.individualValue),
      foreign: num(r.foreignValue ?? r.foreignerValue),
      inst: num(r.institutionalValue ?? r.organValue),
      pension: p,                                  // null 가능
      kospi: num(r.closePrice ?? r.closeVal ?? r.ncv ?? r.nv),
    };
  }).filter((x) => x.d);
}

module.exports = async (req, res) => {
  const out = { ok: false, ts: Date.now(), steps: {} };

  if (req.query.probe) {
    try {
      const j = await getJSON(TREND);
      const arr = Array.isArray(j) ? j : (j.trends || j.result || j.list || j.data || []);
      out.steps.count = arr.length;
      out.steps.keys = arr[0] ? Object.keys(arr[0]) : [];
      out.steps.sample = arr.slice(0, 2);
    } catch (e) { out.steps.error = String(e.message); }
    res.status(200).json(out); return;
  }

  try {
    const rows = await trend();
    if (rows.length) {
      const asc = rows.slice().reverse();
      // 연기금 필드가 아예 없으면 기관값으로 대체하고 표시 (fallback)
      const hasPension = asc.some((x) => x.pension != null);
      const val = (x) => (x.pension != null ? x.pension : x.inst);
      out.pensionSource = hasPension ? "pension" : "institution"; // 화면에서 라벨 조정용
      out.daily = asc.map((x) => ({ d: fmtDate(x.d), pension: Math.round(val(x) / 1e8), kospi: x.kospi || null }));
      const last5 = asc.slice(-5);
      out.who = [
        { key: "pension", v: Math.round(last5.reduce((s, x) => s + val(x), 0) / 1e8) },
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

function fmtDate(s) {
  s = String(s);
  if (/^\d{8}$/.test(s)) return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
  return s.slice(0, 10).replace(/\./g, "-");
}
