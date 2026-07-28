// 네이버 금융 엔드포인트 진단 — 뭐가 열리는지 한 번에 테스트
// GET /api/probe
const UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1";

async function hit(url) {
  try {
    const r = await fetch(url, {
      headers: { "User-Agent": UA, "Referer": "https://m.stock.naver.com/", "Accept": "application/json", "Accept-Language": "ko-KR" },
    });
    const t = await r.text();
    return { status: r.status, len: t.length, raw: t.slice(0, 220).replace(/\s+/g, " ") };
  } catch (e) { return { error: String(e.message) }; }
}

module.exports = async (req, res) => {
  const E = {
    // 지수 (코스피/코스닥)
    kospiBasic: "https://m.stock.naver.com/api/index/KOSPI/basic",
    kosdaqBasic: "https://m.stock.naver.com/api/index/KOSDAQ/basic",
    // 투자자별 순매수 (당일)
    investorTrend: "https://m.stock.naver.com/api/index/KOSPI/trend?pageSize=5",
    // 업종
    upjong: "https://m.stock.naver.com/api/stocks/industry?pageSize=40",
    upjong2: "https://m.stock.naver.com/api/index/industry/list",
    // 시총 상위 / 거래대금 상위
    marketCap: "https://m.stock.naver.com/api/stocks/marketValue/KOSPI?page=1&pageSize=10",
    tradeAmount: "https://m.stock.naver.com/api/stocks/tradingValue/KOSPI?page=1&pageSize=10",
    // 외국인 순매수 상위
    foreignTop: "https://m.stock.naver.com/api/stocks/foreignTrade/KOSPI?page=1&pageSize=10",
    // 등락 종목 수
    updown: "https://m.stock.naver.com/api/index/KOSPI/upDownCount",
    // 환율
    fx: "https://m.stock.naver.com/front-api/marketIndex/productDetail?category=exchange&reutersCode=FX_USDKRW",
    fx2: "https://api.stock.naver.com/marketindex/exchange/FX_USDKRW",
  };
  const out = {};
  await Promise.all(Object.entries(E).map(async ([k, u]) => { out[k] = await hit(u); }));
  res.setHeader("Cache-Control", "no-store");
  res.status(200).json({ ts: Date.now(), results: out });
};
