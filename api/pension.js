// 연기금 수급 프록시 — 네이버 증권 모바일 API
// GET /api/pension            → 전체 데이터
// GET /api/pension?probe=1    → 원본 응답 그대로 반환 (구조 확인용)

const UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1";
const TREND = "https://m.stock.naver.com/api/index/KOSPI/trend?pageSize=40";

async function getText(url) {
  const r = await fetch(url, {
    headers: { "User-Agent": UA, "Referer": "https://m.stock.naver.com/", "Accept": "application/json", "Accept-Language": "ko-KR,ko;q=0.9" },
  });
  const t = await r.text();
  return { status: r.status, text: t };
}
const num = (v) => { const n = Number(String(v ?? "").replace(/[,\s]/g, "")); return isNaN(n) ? 0 : n; };

// 응답에서 배열 찾기 (형태가 어떻든 대응)
function findArray(j) {
  if (Array.isArray(j)) return j;
  if (!j || typeof j !== "object") return [];
  for (const k of ["trends", "result", "list", "data", "items", "content"]) {
    if (Array.isArray(j[k])) return j[k];
    if (j[k] && Array.isArray(j[k].list)) return j[k].list;
  }
  // 한 단계 더 깊이
  for (const k in j) if (Array.isArray(j[k])) return j[k];
  return [];
}
function pensionOf(r) {
  for (const k of Object.keys(r)) {
    if (/pension|연기금/i.test(k)) return num(r[k]);
  }
  return null;
}

module.exports = async (req, res) => {
  const out = { ok: false, ts: Date.now() };

  // 원본 그대로 보여주기
  if (req.query.probe) {
    try {
      const { status, text } = await getText(TREND);
      out.status = status;
      out.len = text.length;
      out.raw = text.slice(0, 1200);   // 앞부분 그대로
    } catch (e) { out.error = String(e.message); }
    res.status(200).json(out);
    return;
  }

  try {
    const { status, text } = await getText(TREND);
    if (status !== 200) { out.error = "status " + status; res.status(200).json(out); return; }
    let j; try { j = JSON.parse(text); } catch (e) { out.error = "parse"; res.status(200).json(out); return; }
    const arr = findArray(j);
    const rows = arr.map((r) => ({
      d: String(r.bizdate || r.localTradedAt || r.date || r.dt || ""),
      indi: num(r.personalValue ?? r.individualValue ?? r.individual),
      foreign: num(r.foreignValue ?? r.foreignerValue ?? r.foreigner),
      inst: num(r.institutionalValue ?? r.organValue ?? r.organ),
      pension: pensionOf(r),
      kospi: num(r.closePrice ?? r.closeVal ?? r.ncv ?? r.nv ?? r.closeValue),
    })).filter((x) => x.d);

    if (rows.length) {
      const asc = rows.slice().reverse();
      const hasP = asc.some((x) => x.pension != null);
      const val = (x) => (x.pension != null ? x.pension : x.inst);
      out.pensionSource = hasP ? "pension" : "institution";
      out.daily = asc.map((x) => ({ d: fmtDate(x.d), pension: Math.round(val(x) / 1e8), kospi: x.kospi || null }));
      const last5 = asc.slice(-5);
      out.who = [
        { key: "pension", v: Math.round(last5.reduce((s, x) => s + val(x), 0) / 1e8) },
        { key: "foreign", v: Math.round(last5.reduce((s, x) => s + x.foreign, 0) / 1e8) },
        { key: "inst", v: Math.round(last5.reduce((s, x) => s + x.inst, 0) / 1e8) },
        { key: "indi", v: Math.round(last5.reduce((s, x) => s + x.indi, 0) / 1e8) },
      ];
      out.ok = true;
    } else { out.note = "행 없음"; out.keys = arr[0] ? Object.keys(arr[0]) : []; }
  } catch (e) { out.error = String(e.message || e); }

  res.setHeader("Cache-Control", "s-maxage=1800, stale-while-revalidate=7200");
  res.status(200).json(out);
};

function fmtDate(s) {
  s = String(s);
  if (/^\d{8}$/.test(s)) return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
  return s.slice(0, 10).replace(/\./g, "-");
}
