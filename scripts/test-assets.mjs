import assert from "node:assert/strict";
import { readdir, readFile, access } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { createServer } from "node:http";
import { join, resolve, extname, dirname } from "node:path";
import { chromium } from "playwright";

const root = process.cwd();
const htmlPaths = [
  ...(await readdir(root)).filter(p => p.endsWith(".html")),
  ...(await readdir(join(root, "events"))).filter(p => p.endsWith(".html")).map(p => "events/" + p)
].sort();
assert.equal(htmlPaths.length, 16, "ATX expected 16 HTML pages");
const minFiles = (await readdir(root)).filter(p => p.endsWith(".min.js"));
assert(minFiles.includes("main.min.js"));
for (const file of minFiles) execFileSync(process.execPath, ["--check", file]);
const jsSource = (await readdir(root)).filter(p => p.endsWith(".js") && !p.endsWith(".min.js"));
for (const file of jsSource) assert(minFiles.includes(file.replace(/\.js$/, ".min.js")), "missing minified " + file);
for (const path of htmlPaths) {
  const html = await readFile(join(root, path), "utf8");
  const isLegacy = path.startsWith("resultats-jour-");
  const head = html.split("</head>")[0];
  if (!isLegacy) {
    assert(head.includes(path === "index.html" ? "atx-home.min.css?" : "atx-core.min.css?"), "missing bundle " + path);
    assert(!/<link\b[^>]*\bhref=["'](?:\.\.\/)?(?:style|enhancements|premium-shell|atx-experience|home-experience)\.css\?/i.test(head), "unbundled CSS in " + path);
    assert(head.includes("race-alerts.min.css?"), "missing min alert CSS " + path);
    assert(head.includes("race-alerts.min.js?"), "missing min alert JS " + path);
  }
  for (const [, quote, src] of html.matchAll(/<script\b[^>]*\bsrc=(["'])(.*?)\1[^>]*><\/script>/gi)) {
    if (jsSource.some(name => src.split("?")[0].endsWith("/" + name) || src.split("?")[0] === name)) {
      throw Error("original unminified script referenced in " + path + ": " + src);
    }
  }
  for (const [, quote, url] of html.matchAll(/\b(?:href|src)=(["'])(.*?)\1/gi)) {
    if (/^(?:https?:|data:|mailto:|#|\/\/)/.test(url)) continue;
    const file = url.split(/[?#]/)[0];
    if (!file || !/\.(?:js|css|webp|jpg|png|svg)$/.test(file)) continue;
    await access(resolve(root, dirname(path), file));
  }
}
for (const css of ["atx-core.min.css", "atx-home.min.css", "race-alerts.min.css"]) {
  const text = await readFile(join(root, css), "utf8");
  assert(text.length > 100);
  for (const m of text.matchAll(/url\(\s*['"]?([^"')]+)['"]?\s*\)/g)) {
    const path = m[1];
    if (/^(?:https?:|data:|\/\/)/.test(path)) continue;
    await access(join(root, path.split(/[?#]/)[0]));
  }
}
const shell = await readFile(join(root, "premium-shell.min.js"), "utf8");
assert(!shell.includes("race-alerts.css") && !shell.includes("race-alerts.js"), "old dynamic alert injection remains");
console.log("STATIC: 16 HTML pages, bundles, local assets, script references and JS syntax OK");

// Real Chromium against the built HTML, with API fixture, no changes to Supabase.
const mime = {".html":"text/html; charset=utf-8",".js":"text/javascript; charset=utf-8",".css":"text/css; charset=utf-8",".svg":"image/svg+xml",".webp":"image/webp",".jpg":"image/jpeg",".png":"image/png",".ico":"image/x-icon",".json":"application/json"};
const server = createServer(async (req,res) => {
  try {
    const pathname = decodeURIComponent(new URL(req.url || "/", "http://localhost").pathname);
    const path = resolve(root, "." + (pathname === "/" ? "/index.html" : pathname));
    if (!path.startsWith(root + "/")) { res.writeHead(403);res.end();return; }
    const data = await readFile(path);
    res.writeHead(200,{"content-type":mime[extname(path)]||"application/octet-stream","cache-control":"no-store"});
    res.end(data);
  } catch { res.writeHead(404);res.end("not found"); }
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const origin = "http://127.0.0.1:" + server.address().port;
const browser = await chromium.launch({headless:true,args:["--no-sandbox"]});
const errors=[];
const page = await browser.newPage();
page.on("pageerror", err => errors.push(err.message));
page.on("response", r => { if (r.url().startsWith(origin) && r.status() >= 400) errors.push("Local asset " + r.status() + ": " + r.url()); });
await page.route("https://twjpjzalyvbsdpbzhqln.supabase.co/functions/v1/**", async route => {
  const url=route.request().url();
  const body = url.includes("/public-event")
    ? {events:[],today:[],archives:[],notifications:[{id:"smoke-record-1",type:"circuit_record",title_fr:"Record de test",title_en:"Test record",message_fr:"Temps de référence amélioré",message_en:"Reference lap improved",related_link:"classement.html#circuit"}]}
    : url.includes("/public-leaderboard")
    ? {drivers:[],circuits:[],teams:[],honours:[]}
    : {drivers:[],circuits:[],teams:[],events:[],results:[]};
  await route.fulfill({status:200,contentType:"application/json",headers:{"access-control-allow-origin":origin},body:JSON.stringify(body)});
});
try {
  await page.goto(origin+"/index.html",{waitUntil:"domcontentloaded"});
  await page.locator(".atx-alert-bell").waitFor();
  assert(await page.locator(".utility-bar").count(),"header missing");
  const steam = await page.locator('[data-steam-login]').first.getAttribute("href");
  assert(steam && steam.includes("/functions/v1/auth-steam"),"Steam login link missing");
  await page.locator(".atx-alert-bell").click();
  await page.locator(".atx-alert-panel .atx-alert-item").first.waitFor();
  assert((await page.locator(".atx-alert-panel").innerText()).includes("Record"),"bell fails to display notification");
  const toggle=page.locator(".side-nav-group-toggle").first();
  await toggle.click();
  assert.equal(await toggle.getAttribute("aria-expanded"),"true","navigation toggle");
  console.log("BROWSER: homepage navigation, bell, notification content and Steam entry point OK");
  await page.goto(origin+"/classement.html",{waitUntil:"domcontentloaded"});
  await page.locator(".atx-alert-bell").waitFor();
  await page.locator('[data-alltime-leaderboard]:not([hidden])').waitFor({timeout:15000});
  await page.locator('[data-race-category="WGT"]').click();
  await page.waitForURL(/type=WGT/);
  assert.equal(await page.locator('[data-race-category="WGT"]').getAttribute("aria-current"),"page");
  await page.evaluate(()=>{location.hash="circuit"});
  await page.waitForFunction(()=>!document.querySelector('[data-ranking-panel="circuit"]')?.hidden);
  console.log("BROWSER: leaderboard category and circuit filters OK");
  for (const path of htmlPaths) {
    if (path === "index.html" || path === "classement.html") continue;
    await page.goto(origin+"/"+path,{waitUntil:"domcontentloaded"});
    if (!path.startsWith("resultats-jour-")) await page.locator(".atx-alert-bell").waitFor({timeout:10000});
  }
  assert.equal(errors.length,0,"Browser errors: "+errors.join("; "));
  console.log("BROWSER: all 16 HTML pages opened, no uncaught errors or missing local assets");
} finally {
  await browser.close();
  await new Promise(resolve=>server.close(resolve));
}
