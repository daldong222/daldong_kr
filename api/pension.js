court
<invoke name="bash_tool">
<parameter name="command">cd /mnt/user-data/outputs && cp pension-api.js pension-api.bak 2>/dev/null; python3 - <<'PY'
p="pension-api.js"; s=open(p,encoding="utf-8").read()
s=s.replace('const KRX = "http://data.krx.co.kr/comm/bldAttendant/getJsonData.cmd";',
'const KRX = "https://data.krx.co.kr/comm/bldAttendant/getJsonData.cmd";')
s=s.replace('"Referer": "http://data.krx.co.kr','"Referer": "https://data.krx.co.kr')
if '"Origin"' not in s:
s=s.replace('"X-Requested-With": "XMLHttpRequest",',
'"X-Requested-With": "XMLHttpRequest",\n  "Origin": "https://data.krx.co.kr",')
old='''async function krx(params) {
const body = new URLSearchParams(params).toString();
const r = await fetch(KRX, { method: "POST", headers: HDR, body });
if (!r.ok) throw new Error("krx " + r.status);
const t = await r.text();
try { return JSON.parse(t); } catch (e) { throw new Error("parse:" + t.slice(0, 60)); }
}'''
new='''let COOKIE = "";
async function ensureCookie() {
if (COOKIE) return;
try {
const r = await fetch("https://data.krx.co.kr/contents/MDC/MDI/mdiLoader/index.cmd?menuId=MDC0201", {
headers: { "User-Agent": HDR["User-Agent"], "Accept": "text/html" },
});
const sc = r.headers.get("set-cookie");
if (sc) COOKIE = sc.split(",").map((c) => c.split(";")[0].trim()).join("; ");
} catch (e) {}
}
async function krx(params) {
await ensureCookie();
const body = new URLSearchParams(params).toString();
const headers = Object.assign({}, HDR);
if (COOKIE) headers["Cookie"] = COOKIE;
const r = await fetch(KRX, { method: "POST", headers, body });
if (!r.ok) { const tx = await r.text().catch(() => ""); throw new Error("krx " + r.status + (tx ? ":" + tx.slice(0, 40) : "")); }
const t = await r.text();
try { return JSON.parse(t); } catch (e) { throw new Error("parse:" + t.slice(0, 60)); }
}'''
assert s.count(old)==1
s=s.replace(old,new)
open(p,"w",encoding="utf-8").write(s)
print("patched")
PY
node --check pension-api.js && echo OK</parameter>
<parameter name="description">Patch KRX API: https + cookie + origin</parameter>
