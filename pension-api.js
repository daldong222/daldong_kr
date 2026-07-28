// 연기금 수급 프록시 (KRX 정보데이터시스템)
// GET /api/pension            → 전체 데이터
// GET /api/pension?probe=1    → 연결 진단용
//
// KRX는 공식 오픈API가 아니라 웹 요청 형식이라 언제든 막힐 수 있음.
// 실패 시 ok:false 와 함께 어떤 단계에서 막혔는지 반환.

const KRX = "http://data.krx.co.kr/comm/bldAttendant/getJsonData.cmd";
const HDR = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0 Safari/537.36",
  "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
  "Referer": "http://data.krx.co.kr/contents/MDC/MDI/mdiLoader/index.cmd",
  "Accept": "application/json, text/javascript, */*; q=0.01",
  "X-Requested-With": "XMLHttpRequest",
};

async function krx(params) {
  const body = new URLSearchParams(params).toString();
  const r = await fetch(KRX, { method: "POST", headers: HDR, body });
  if (!r.ok) throw new Error("krx " + r.status);
  const t = await r.text();
  try { return JSON.parse(t); } catch (e) { throw new Error("parse:" + t.slice(0, 60)); }
}

const ymd = (d) => {
  const x = new Date(d);
  return `${x.getFullYear()}${String(x.getMonth() + 1).padStart(2, "0")}${String(x.getDate()).padStart(2, "0")}`;
};
const num = (s) => { const v = Number(String(s ?? "").replace(/[,\s]/g, "")); return isNaN(v) ? 0 : v; };
// 최근 영업일 추정 (주말 제외)
function lastBizDay(back = 0) {
  const d = new Date(Date.now() + 9 * 3600e3); // KST
  d.setDate(d.getDate() - back);
  while (d.getDay() === 0 || d.getDay() === 6) d.setDate(d.getDate() - 1);
  return d;
}

// ① 투자자별 일별 매매동향 (코스피) — 기간 조회
async function dailyTrend(days = 40) {
  const to = lastBizDay(0), from = new Date(to.getTime() - days * 1.6 * 864e5);
  const d = await krx({
    bld: "dbms/MDC/STAT/standard/MDCSTAT02203",
    locale: "ko_KR",
    inqTpCd: "1",            // 일별
    trdVolVal: "2",          // 거래대금
    askBid: "3",             // 순매수
    strtDd: ymd(from),
    endDd: ymd(to),
    mktId: "STK",            // 코스피
    etf: "EF", etn: "EN", elw: "EW",
    money: "1", csvxls_isNo: "false",
  });
  const rows = d.output || d.OutBlock_1 || [];
  return rows.map((r) => ({
    d: String(r.TRD_DD || "").replace(/\//g, "-"),
    pension: num(r.TRDVAL_5 ?? r.TRDVAL5),   // 연기금등
    foreign: num(r.TRDVAL_9 ?? r.TRDVAL9),   // 외국인
    inst: num(r.TRDVAL_7 ?? r.TRDVAL7),      // 기관합계
    indi: num(r.TRDVAL_8 ?? r.TRDVAL8),      // 개인
  })).filter((x) => x.d);
}

// ② 투자자별 종목 순매수 상위 (연기금)
async function topStocks() {
  const dd = ymd(lastBizDay(0));
  const d = await krx({
    bld: "dbms/MDC/STAT/standard/MDCSTAT02401",
    locale: "ko_KR",
    mktId: "STK",
    invstTpCd: "7050",       // 연기금 등
    strtDd: dd, endDd: dd,
    askBid: "3", trdVolVal: "2", money: "1",
    detailView: "1", csvxls_isNo: "false",
  });
  const rows = d.output || d.OutBlock_1 || [];
  return rows.map((r) => ({
    code: r.ISU_SRT_CD || r.ISU_CD || "",
    name: r.ISU_NM || r.ISU_ABBRV || "",
    val: num(r.NETBID_TRDVAL ?? r.TRDVAL3 ?? r.NETBID_TRDVOL),
  })).filter((x) => x.name);
}

// ③ 코스피 종가 (차트 겹치기용)
async function kospiClose(days = 40) {
  const to = lastBizDay(0), from = new Date(to.getTime() - days * 1.6 * 864e5);
  const d = await krx({
    bld: "dbms/MDC/STAT/standard/MDCSTAT00301",
    locale: "ko_KR",
    tboxindIdx_finder_equidx0_0: "코스피",
    indIdx: "1", indIdx2: "001",
    strtDd: ymd(from), endDd: ymd(to),
    share: "2", money: "3", csvxls_isNo: "false",
  });
  const rows = d.output || d.OutBlock_1 || [];
  const m = {};
  rows.forEach((r) => { m[String(r.TRD_DD || "").replace(/\//g, "-")] = num(r.CLSPRC_IDX); });
  return m;
}

module.exports = async (req, res) => {
  const out = { ok: false, ts: Date.now(), steps: {} };

  // 진단 모드
  if (req.query.probe) {
    try { const t = await dailyTrend(10); out.steps.dailyTrend = { n: t.length, sample: t.slice(-2) }; }
    catch (e) { out.steps.dailyTrend = { error: String(e.message) }; }
    try { const s = await topStocks(); out.steps.topStocks = { n: s.length, sample: s.slice(0, 3) }; }
    catch (e) { out.steps.topStocks = { error: String(e.message) }; }
    res.status(200).json(out); return;
  }

  try {
    const [trend, stocks, kospi] = await Promise.all([
      dailyTrend(40).catch((e) => { out.steps.trend = String(e.message); return []; }),
      topStocks().catch((e) => { out.steps.stocks = String(e.message); return []; }),
      kospiClose(40).catch(() => ({})),
    ]);

    if (trend.length) {
      const asc = trend.slice().sort((a, b) => a.d.localeCompare(b.d)).slice(-30);
      out.daily = asc.map((x) => ({
        d: x.d,
        pension: Math.round(x.pension / 1e8),        // 억원
        kospi: kospi[x.d] || null,
      }));
      const last5 = asc.slice(-5);
      out.who = [
        { key: "pension", v: Math.round(last5.reduce((s, x) => s + x.pension, 0) / 1e8) },
        { key: "foreign", v: Math.round(last5.reduce((s, x) => s + x.foreign, 0) / 1e8) },
        { key: "inst", v: Math.round(last5.reduce((s, x) => s + x.inst, 0) / 1e8) },
        { key: "indi", v: Math.round(last5.reduce((s, x) => s + x.indi, 0) / 1e8) },
      ];
      out.ok = true;
    }

    if (stocks.length) {
      const sorted = stocks.slice().sort((a, b) => b.val - a.val);
      out.buy = sorted.filter((x) => x.val > 0).slice(0, 8)
        .map((x) => ({ n: x.name, c: x.code, v: Math.round(x.val / 1e8) }));
      out.sell = sorted.filter((x) => x.val < 0).slice(-6).reverse()
        .map((x) => ({ n: x.name, c: x.code, v: Math.round(x.val / 1e8) }));
      out.ok = true;
    }
  } catch (e) {
    out.error = String(e.message || e);
  }

  res.setHeader("Cache-Control", "s-maxage=1800, stale-while-revalidate=7200");
  res.status(200).json(out);
};
