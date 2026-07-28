// 연기금 수급 프록시 (네이버 금융 우회)
// GET /api/pension            → 전체 데이터
// GET /api/pension?probe=1    → 연결 진단용
// KRX 직접 접근(400:LOGOUT)이 막혀서 네이버로 우회.

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0 Safari/537.36";

async function getText(url) {
  const r = await fetch(url, {
    headers: {
      "User-Agent": UA,
      "Referer": "https://finance.naver.com/sise/",
      "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "ko-KR,ko;q=0.9,en;q=0.8",
    },
  });
  if (!r.ok) throw new Error("naver " + r.status);
  const buf = await r.arrayBuffer();
  try { return new TextDecoder("euc-kr").decode(buf); }
  catch (e) { return new TextDecoder("utf-8").decode(buf); }
}

const toNum = (txt) => {
  const neg = txt.includes("-") || txt.includes("bu_pdn") || txt.includes("nv01");
  const v = Number(txt.replace(/[^0-9]/g, ""));
  return isNaN(v) ? 0 : (neg ? -v : v);
};

// 코스피 투자자별 매매동향 일별
async function investorDaily() {
  const url = "https://finance.naver.com/sise/investorDealTrendDay.naver?bizdate=&sosok=01&page=1";
  const html = await getText(url);
  const rows = [];
  const trs = html.match(/<tr[^>]*>[\s\S]*?<\/tr>/g) || [];
  for (const tr of trs) {
    const dateM = tr.match(/(\d{2}\.\d{2}\.\d{2}|\d{4}\.\d{2}\.\d{2})/);
    if (!dateM) continue;
    const tds = tr.match(/<td[^>]*>[\s\S]*?<\/td>/g) || [];
    const cells = [];
    for (const td of tds) {
      const raw = td.replace(/<[^>]+>/g, "").replace(/&nbsp;/g, "").trim();
      if (/[\d]/.test(raw) && !/\./.test(raw.replace(/[\d,+-]/g, ""))) {
        const neg = td.includes("-") || raw.startsWith("-");
        const v = Number(raw.replace(/[^0-9]/g, ""));
        if (!isNaN(v)) cells.push(neg ? -v : v);
      }
    }
    // 네이버 열 순서: 개인, 외국인, 기관계, 금융투자, 보험, 투신, 은행, 기타금융, 연기금등, ...
    if (cells.length >= 4) {
      rows.push({
        d: dateM[1],
        indi: cells[0], foreign: cells[1], inst: cells[2],
        pension: cells.length >= 9 ? cells[8] : cells[cells.length - 1],
      });
    }
  }
  return rows;
}

module.exports = async (req, res) => {
  const out = { ok: false, ts: Date.now(), steps: {} };

  if (req.query.probe) {
    try {
      const url = "https://finance.naver.com/sise/investorDealTrendDay.naver?sosok=01";
      const html = await getText(url);
      out.steps.fetch = {
        len: html.length,
        hasTable: html.includes("<table"),
        hasPension: html.includes("연기금"),
        head: html.slice(0, 120).replace(/\s+/g, " "),
      };
      const rows = await investorDaily().catch((e) => { out.steps.parseErr = String(e.message); return []; });
      out.steps.parsed = { n: rows.length, sample: rows.slice(0, 3) };
    } catch (e) {
      out.steps.error = String(e.message);
    }
    res.status(200).json(out);
    return;
  }

  try {
    const rows = await investorDaily();
    if (rows.length) {
      const asc = rows.slice().reverse();
      out.daily = asc.map((x) => ({ d: x.d.replace(/\./g, "-"), pension: Math.round(x.pension / 1e8), kospi: null }));
      const last5 = asc.slice(-5);
      out.who = [
        { key: "pension", v: Math.round(last5.reduce((s, x) => s + x.pension, 0) / 1e8) },
        { key: "foreign", v: Math.round(last5.reduce((s, x) => s + x.foreign, 0) / 1e8) },
        { key: "inst", v: Math.round(last5.reduce((s, x) => s + x.inst, 0) / 1e8) },
        { key: "indi", v: Math.round(last5.reduce((s, x) => s + x.indi, 0) / 1e8) },
      ];
      out.ok = true;
    } else {
      out.steps.note = "행 파싱 실패";
    }
  } catch (e) {
    out.error = String(e.message || e);
  }

  res.setHeader("Cache-Control", "s-maxage=1800, stale-while-revalidate=7200");
  res.status(200).json(out);
};
