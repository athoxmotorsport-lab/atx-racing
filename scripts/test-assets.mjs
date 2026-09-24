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
assert.equal(htmlPaths.length, 14, "ATX keeps the 14 maintained HTML pages; legacy OL result pages are removed");
const requestedCSS = ["ranking-session-labels", "driver-ranking-premium", "team-ranking-premium", "profile-best-laps"];
for (const file of requestedCSS) {
  const minimized = await readFile(join(root, file + ".min.css"), "utf8");
  assert(minimized.length > 100, "Missing minified CSS: " + file);
}
const removedSources = ["style.css","enhancements.css","premium-shell.css","atx-experience.css","home-experience.css","ranking-session-labels.css","driver-ranking-premium.css","team-ranking-premium.css","profile-best-laps.css","main.js","home-experience.js","premium-shell.js","atx-experience.js","gtworld.js","admin-gtworld.js","admin-events-manager.js","ranking-session-labels.js","driver-ranking-premium.js","team-ranking-premium.js","profile-identity-enhancements.js","race-alerts.css","race-alerts.js"];
const rootFiles = await readdir(root);
for (const file of removedSources) assert(!rootFiles.includes(file), "Old source still tracked: " + file);
const minFiles = (await readdir(root)).filter(p => p.endsWith(".min.js"));
assert(minFiles.includes("main.min.js"));
for (const file of minFiles) execFileSync(process.execPath, ["--check", file]);
const expectedJS = ["category-sections","main","home-experience","premium-shell","atx-experience","gtworld","admin-gtworld","admin-events-manager","ranking-session-labels","driver-ranking-premium","team-ranking-premium","profile-identity-enhancements","race-alerts"];
for (const name of expectedJS) assert(minFiles.includes(name + ".min.js"), "Missing JS: " + name);
for (const path of htmlPaths) {
  const html = await readFile(join(root, path), "utf8");
  const isLegacy = path.startsWith("resultats-jour-");
  const head = html.split("</head>")[0];
  if (!isLegacy) {
    assert(head.includes(path === "index.html" ? "atx-home.min.css?" : "atx-core.min.css?"), "missing bundle " + path);
    assert(!/<link\b[^>]*\bhref=["'](?:\.\.\/)?(?:style|enhancements|premium-shell|atx-experience|home-experience)\.css\?/i.test(head), "unbundled CSS in " + path);
    assert(head.includes("race-alerts.min.css?"), "missing min alert CSS " + path);
    assert(head.includes("race-alerts.min.js?"), "missing min alert JS " + path);
    const targetCSS = path === "classement.html" ? requestedCSS.slice(0,3) : path === "profil-pilote.html" ? requestedCSS.slice(3) : [];
    for (const style of targetCSS) {
      assert(head.includes(style + ".min.css?"), "missing minified page CSS: " + style + " in " + path);
      assert(!head.includes('"' + style + ".css?"), "unminified CSS in " + path + ": " + style);
    }
  }
  for (const [, quote, src] of html.matchAll(/<script\b[^>]*\bsrc=(["'])(.*?)\1[^>]*><\/script>/gi)) {
    const localName = src.split("?")[0].split("/").at(-1);
    if (localName?.endsWith(".js") && !localName.endsWith(".min.js")) {
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
const homeMarkup = await readFile(join(root, "index.html"), "utf8");
assert(homeMarkup.includes('srcset="assets/brand/atx-racing-banner.webp"'), "Original hero WebP banner must remain");
assert(homeMarkup.includes('class="home-brand-mark" src="assets/brand/atx-racing-logo.webp"'), "Explicit hero logo missing");
for (const path of htmlPaths.filter(p => !p.startsWith("resultats-jour-"))) {
  const html = await readFile(join(root, path), "utf8");
  assert(html.includes("atx-clean-editorial.css?"), "Unified editorial CSS missing: " + path);
}
for (const file of ["atx-core.min.css", "atx-home.min.css"]) {
  const css = await readFile(join(root, file), "utf8");
  assert(css.includes("family=Rajdhani:wght@600;700"), "Condensed title font import missing: " + file);
  assert(css.includes("@keyframes atxSkinEnter"), "Single-entry animation missing: " + file);
  assert(css.includes("@media(prefers-reduced-motion:reduce)"), "Reduced-motion guard missing: " + file);
  assert(css.includes("font-variant-numeric:tabular-nums"), "Tabular numeric styling missing: " + file);
}
for (const file of ["atx-core.min.css", "atx-home.min.css"]) {
  const css = await readFile(join(root,file),"utf8");
  assert(!css.includes("fx-home-race-nav"),"Dead homepage component selector remains: "+file);
  assert(css.includes('.race-category-switch strong{font:900 21px Rajdhani,"Arial Narrow",sans-serif;letter-spacing:.08em}'),"Card titles must use Rajdhani: "+file);
}
assert(homeMarkup.includes('<nav class="race-category-switch"'),"Home categories must reuse the existing three-card grid");
assert(!homeMarkup.includes("fx-home-race-nav"),"Old broken homepage class remains");
const uiFontRule = 'h1,h2,h3,.brand,.nav-links,.side-links a,.eyebrow,.section-label,.event-date,.event-card h3,.btn{font-family:Rajdhani,"Arial Narrow",sans-serif!important}';
for (const path of ["atx-core.min.css", "atx-home.min.css"]) {
  const css = await readFile(join(root, path), "utf8");
  assert.equal(css.split(uiFontRule).length-1, 1, "All global identity fonts must have one authoritative Rajdhani rule in " + path);
  assert(!css.includes('.fx-primary-nav a[data-fx-section="BA"]'), "Ballade ATX must not have an unconditional navigation border in " + path);
  assert.equal((css.match(/\binfinite\b/g) || []).length, 1, "Only the news ticker may loop in " + path);
  assert(css.includes("animation:premiumTicker 38s linear infinite"), "News ticker animation must remain in " + path);
  assert(css.includes("font-family:ui-monospace"), "Timing and ranking figures must remain monospace in " + path);
}
const robotRules = await readFile(join(root, "robots.txt"), "utf8");
assert(robotRules.includes("Disallow: /preview-fxui/"), "Preview mirror must be disallowed in robots.txt");
assert(robotRules.includes("Disallow: /atx-racing/preview-fxui/"), "Actual GitHub Pages preview path must be included");
await assert.rejects(
  access(join(root, "preview-fxui")),
  { code: "ENOENT" },
  "Preview directory must be absent from the published site"
);
for(const path of ["index.html","gtworld.html","daily-race.html","open-lobby.html","calendrier.html","classement.html","archives.html","reglement.html"]){
  const html=await readFile(join(root,path),"utf8");
  const canonical=html.match(/<link rel="canonical" href="([^"]+)">/);
  assert(canonical,"Canonical URL missing on "+path);
  for(const lang of ["fr","en"]) assert(html.includes('<link rel="alternate" hreflang="'+lang+'" href="'+canonical[1]+'?lang='+lang+'">'),"Distinct bilingual hreflang missing on "+path+" "+lang);
}
console.log("STATIC: one Rajdhani authority, active-only Ballade border, ticker-only loop, preview directory absent and FR/EN markup OK");
console.log("STATIC: ATX skin references, existing banner, logo, condensed titles and motion guard OK");
console.log("STATIC: 14 HTML pages, bundles, local assets, script references and JS syntax OK");

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
const fixtureDriverId = "11111111-1111-4111-8111-111111111111";
const avatarPath = "/assets/brand/atx-racing-logo.webp";
const fixtureDriver = { driver_id: fixtureDriverId, id: fixtureDriverId, profile_id: fixtureDriverId, display_name:"ATX Test Pilot", avatar_url: avatarPath, performance_class:"alien", safety_class:"gold", safety_score:87, performance_score:101.5, progression:0.42, best_lap_ms:109321, points:10, rank:1, races:2, podiums:1, wins:1, team_name:"ATX Racing" };
const lapFor = (key, time, session) => ({ ...fixtureDriver, best_lap_ms:time, session_type:session, best_lap_session_type:session, car_model_name:"Ferrari 296 GT3", pace_percent:101.2 });
const fixtureCircuits = [
 {circuit_key:"monza",circuit_name:"Monza",reference_lap_ms:109321,reference_driver:"ATX Test Pilot",reference_session_type:"FP",drivers:[lapFor("monza",109321,"FP")]},
 {circuit_key:"barcelona",circuit_name:"Barcelona",reference_lap_ms:104501,reference_driver:"ATX Test Pilot",reference_session_type:"Q",drivers:[lapFor("barcelona",104501,"Q")]}
];
const fixtureSectors = [
 {driver_id:fixtureDriverId,circuit_key:"monza",best_lap_ms:109321,best_lap_session_type:"FP",best_sector_1_ms:33011,best_sector_2_ms:35011,best_sector_3_ms:41300},
 {driver_id:fixtureDriverId,circuit_key:"barcelona",best_lap_ms:104501,best_lap_session_type:"Q",best_sector_1_ms:31011,best_sector_2_ms:35000,best_sector_3_ms:38490}
];
const fixtureEvents = ["WGT","DR","BA"].map((category,index)=>({
 slug:"fixture-"+category.toLowerCase(), event_type:category==="WGT"?"sprint":category==="DR"?"daily_race":"special_event",
 status:"registration_open", title_fr:category+" · Monza", title_en:category+" · Monza",
 server_name:category==="BA"?"BALLADE ATX | Monza":"ATXRACING | "+category+" | Monza", circuit_name:"Monza",
 starts_at:new Date(Date.now()+(index+1)*86400000).toISOString(),
 duration_minutes:60,max_drivers:30,simgrid_url:"https://www.thesimgrid.com/communities/atxracing",
 image_url:"assets/brand/atx-racing-banner.webp",result_count:0
}));
const fixtureArchives = ["WGT","DR","BA"].map((category,index)=>({
 ...fixtureEvents[index],slug:"archive-"+category.toLowerCase(),
 status:"completed", starts_at:new Date(Date.now()-(index+1)*86400000).toISOString(), result_count:2
}));
const fixtureCourse = {
 event:{...fixtureEvents[0],event_schedule:[],car_class:"GT3",time_multiplier:1,
 mandatory_pit_stop:true,mandatory_tyre_change:false,mandatory_refuelling:false},
 is_worldgt:true,team_assignments_complete:true,
 results:[{driver_id:"dylan",driver:{display_name:"Dylan"},status:"classified",finish_position:1,points:25,laps_completed:30,best_lap_ms:100000},
 {driver_id:"tim",driver:{display_name:"Tim"},status:"classified",finish_position:1,points:25,laps_completed:30,best_lap_ms:101000}],
 team_results:[{team_name:"ATX Motorsport Team 1",members:["Dylan","Tim"],finish_position:1,
 best_lap_ms:100000,points:52,fastest_lap_bonus:2,laps_completed:30,car_model_name:"Ferrari 296 GT3"}],
 honours:[]
};
const premiumTeamFixture={team_name:"ATX Motorsport Team 1",rank:1,points:52,races:1,events:1,wins:1,podiums:1,drivers:2,performance_score:101.5};
const officialWorldGTFixture={standings:[{...premiumTeamFixture,sprint:1,endurance:0,fastest_laps:1}],events:[]};
const page = await browser.newPage();
page.on("pageerror", err => errors.push(err.message));
page.on("response", r => { if (r.url().startsWith(origin) && r.status() >= 400) errors.push("Local asset " + r.status() + ": " + r.url()); });
await page.route("https://twjpjzalyvbsdpbzhqln.supabase.co/functions/v1/**", async route => {
  const url=route.request().url();
  const body = url.includes("/public-event")
    ? (url.includes("slug=")?fixtureCourse:{events:fixtureEvents,today:[],archives:fixtureArchives,notifications:[{id:"smoke-record-1",type:"circuit_record",title_fr:"Record de test",title_en:"Test record",message_fr:"Temps de référence amélioré",message_en:"Reference lap improved",related_link:"classement.html#circuit"}]})
    : url.includes("/public-gtworld")
    ? officialWorldGTFixture
    : url.includes("/public-leaderboard")
    ? {drivers:[fixtureDriver],circuits:fixtureCircuits,teams:[premiumTeamFixture],honours:[]}
    : url.includes("/public-driver-sectors") ? {sectors:fixtureSectors}
    : url.includes("/public-driver-identities") ? {drivers:[fixtureDriver]}
    : url.includes("/public-driver?") ? {driver:fixtureDriver}
    : {drivers:[fixtureDriver],circuits:fixtureCircuits,teams:[],events:[],results:[]};
  await route.fulfill({status:200,contentType:"application/json",headers:{"access-control-allow-origin":origin},body:JSON.stringify(body)});
});
try {
  await page.goto(origin+"/index.html",{waitUntil:"domcontentloaded"});
  const categoryCards = page.locator(".race-category-switch > a");
  assert.equal(await categoryCards.count(),3,"Home must have three category cards");
  const cardGeometry = await page.locator(".race-category-switch").evaluate(nav=>{
    const computed=getComputedStyle(nav);
    const cards=[...nav.querySelectorAll(":scope > a")].map(a=>{
      const box=a.getBoundingClientRect();
      return {x:box.left,y:box.top,width:box.width,height:box.height,border:getComputedStyle(a).borderTopWidth,font:getComputedStyle(a.querySelector("strong")).fontFamily};
    });
    return {display:computed.display,columns:computed.gridTemplateColumns,cards};
  });
  assert.equal(cardGeometry.display,"grid","Home category switch must use a CSS grid");
  assert(cardGeometry.cards.every(card=>card.width>80&&card.height>40&&card.font.includes("Rajdhani")),"Home cards must be visible and use Rajdhani");
  assert(cardGeometry.cards[0].x<cardGeometry.cards[1].x&&cardGeometry.cards[1].x<cardGeometry.cards[2].x,"Desktop categories must appear in three separate columns");
  const banner = page.locator(".home-brand-banner picture img");
  const emblem = page.locator(".home-brand-mark");
  assert(await banner.isVisible(), "The original hero banner must be visible");
  assert(await emblem.isVisible(), "The new hero logo must be visible");
  assert(await banner.evaluate(img=>img.decode().then(()=>img.naturalWidth>0).catch(()=>false)), "Hero banner image failed to load");
  assert(await emblem.evaluate(img=>img.decode().then(()=>img.naturalWidth>0).catch(()=>false)), "Hero logo image failed to load");
  assert((await banner.evaluate(img=>img.currentSrc)).includes("atx-racing-banner.webp"), "The WebP banner is not used");
  assert((await page.locator(".hero h1").evaluate(el=>getComputedStyle(el).fontFamily)).includes("Rajdhani"), "Homepage title must use condensed lettering");
  for(const [selector,font] of [[".hero h1","Rajdhani"],[".side-links a[data-fx-section=home]","IBM Plex Mono"],[".home-next-event .event-date","IBM Plex Mono"],[".hero .btn","IBM Plex Mono"]]){
    const element=page.locator(selector).first();
    if(await element.count()) assert((await element.evaluate(el=>getComputedStyle(el).fontFamily)).includes(font),"Editorial typography not applied to "+selector);
  }
  const inactiveBallade=page.locator('.fx-primary-nav>a[data-fx-section="BA"]');
  await inactiveBallade.waitFor({timeout:10000});
  assert(!await inactiveBallade.evaluate(el=>el.classList.contains("active")),"Ballade ATX must not be marked active on the homepage");
  assert.equal(await inactiveBallade.evaluate(el=>getComputedStyle(el).borderTopWidth),"0px","Inactive Ballade must not have a nav frame");

  assert.equal(await page.locator(".hero h1").evaluate(el=>getComputedStyle(el).animationIterationCount),"1","Hero entrance must not loop");
  const reducedPage=await browser.newPage({reducedMotion:"reduce"});
  try{
    await reducedPage.goto(origin+"/index.html",{waitUntil:"domcontentloaded"});
    assert.equal(await reducedPage.locator(".hero h1").evaluate(el=>getComputedStyle(el).animationName),"none","Reduced motion must disable the entrance");
  }finally{await reducedPage.close()}
  console.log("BROWSER: original WebP banner and hero logo visible; condensed title, single entrance and reduced-motion fallback OK");
  await page.locator(".atx-alert-bell").waitFor();
  await page.locator("[data-home-next-poster]:not([hidden]) img").waitFor({timeout:15000});assert(await page.locator("[data-home-next-poster] img").evaluate(img=>img.complete&&img.naturalWidth>0),"Next event must show original calendar poster");
  assert(await page.locator(".utility-bar").count(),"header missing");
  const steam = await page.locator('[data-steam-login]').first().getAttribute("href");
  assert(steam && steam.includes("/functions/v1/auth-steam"),"Steam login link missing");
  await page.locator(".atx-alert-bell").click();
  await page.locator(".atx-alert-panel .atx-alert-item").first().waitFor();
  assert((await page.locator(".atx-alert-panel").innerText()).includes("Record"),"bell fails to display notification");
  const links=page.locator(".fx-primary-nav>a");assert.equal(await links.count(),8,"Navigation must include home, three race pages, full calendar, rankings, archives and rules");assert.equal(await page.locator('.fx-primary-nav>a[data-fx-section="calendar"]').getAttribute("href"),"calendrier.html","General calendar must be directly accessible");assert.equal(await page.locator(".fx-times-nav>a").count(),2,"Best laps must retain circuit and driver navigation");assert.equal(await page.locator(".side-nav-group-toggle").count(),0,"No old dropdown arrows");
  for(const [category,file] of [["WGT","gtworld.html"],["DR","daily-race.html"],["BA","open-lobby.html"]]){
    await page.goto(origin+"/"+file,{waitUntil:"domcontentloaded"});
    const navBA=page.locator('.fx-primary-nav>a[data-fx-section="BA"]');
    await navBA.waitFor({timeout:10000});
    assert.equal(await navBA.evaluate(el=>el.classList.contains("active")),category==="BA","Ballade ATX active state is incorrect on "+file);
    if(category!=="BA")assert.equal(await navBA.evaluate(el=>getComputedStyle(el).borderTopWidth),"0px","Unselected Ballade ATX must not have a nav frame on "+file);
    const root=page.locator('[data-course-page="'+category+'"]');
    await root.waitFor();
    assert.equal(await root.locator(".fx-course-tabs>a").count(),3,"Each course needs three inline tabs");
    assert.equal(await root.locator("#concept").count(),1,"Concept section missing on "+file);
    assert.equal(await root.locator("#calendrier").count(),1,"Calendar section missing on "+file);
    assert.equal(await root.locator("#classement").count(),1,"Standings section missing on "+file);
    await root.locator("#calendrier .event-card.fx-encoded-event").first().waitFor({timeout:15000});
    assert.equal(await root.locator("#calendrier .event-card").count(),1,"Calendar must include only "+category+" events");assert.equal(await root.locator("#calendrier .event-card").first().getAttribute("data-event-code"),category,"Encoded DR/WGT/BA category must be preserved");assert(await root.locator("#calendrier .event-image img").first().evaluate(img=>img.complete&&img.naturalWidth>0),"Existing original event poster must load");assert.equal(await root.locator("#calendrier .event-image").first().getAttribute("href"),"https://www.thesimgrid.com/communities/atxracing","Existing SimGrid link must remain");
    const firstLink=await root.locator("#calendrier .event-body .btn.primary").first().getAttribute("href");
    assert(firstLink.includes("fixture-"+category.toLowerCase()),"Calendar event should be from its own category");
    await root.locator('[data-cat-drivers] tr').first().waitFor({timeout:15000});
    assert((await root.locator('[data-cat-drivers] tr').first().innerText()).includes("ATX"),"Category's own driver standings must render");
    assert.equal(await root.locator('.fx-premium-drivers thead th').count(),8,"The premium eight-column driver layout must remain");
    assert.equal(await root.locator('[data-cat-drivers] tr[data-tier="alien"] .tier-pill[data-tier="alien"]').count(),1,"Alien tier badge and colour must remain");
    assert.equal(await root.locator('[data-cat-drivers] .pace-progress[role="progressbar"]').count(),1,"Premium pace gauge must remain");
    assert.equal(await root.locator('[data-cat-drivers] .safe-meter[role="progressbar"]').count(),1,"Premium SAFE gauge must remain");
    assert.equal(await root.locator('[data-cat-drivers] .tier-pill[data-tier="gold"]').count(),1,"Gold SAFE badge must remain");
    assert.equal(await root.locator(".fx-category-tier-legend [data-tier=alien]").count(),1,"The colour-coded tier legend must remain");
    if(category==="WGT"){await root.locator('[data-gtw-standings] tr.fx-premium-wgt-row').first().waitFor({timeout:15000});assert.equal(await root.locator('[data-gtw-standings] tr .tier-pill[data-tier="alien"]').count(),1,"WorldGT team must retain coloured Alien tier");assert.equal(await root.locator('[data-gtw-standings] tr .fx-inline-pace[role="progressbar"]').count(),1,"WorldGT team pace gauge missing");assert((await root.locator('[data-gtw-standings] tr').first().innerText()).includes("52"),"Official WorldGT team points must not change")}else{assert.equal(await root.locator(".fx-premium-teams thead th").count(),8,"Full premium team standings must remain");assert.equal(await root.locator(".fx-premium-team-row .tier-pill[data-tier=alien]").count(),1,"Team pace badge missing");assert.equal(await root.locator(".fx-team-pace .pace-progress[role=progressbar]").count(),1,"Team pace gauge missing")}

    await root.locator('.fx-course-tabs>a[href="#classement"]').click();
    assert(new URL(page.url()).pathname.endsWith("/"+file)&&page.url().endsWith("#classement"),"Inline standings must not navigate away");
    assert.equal(await page.locator('.fx-primary-nav>a.active').getAttribute("data-fx-section"),category,"Current race category not highlighted");
  }
  await page.goto(origin+"/calendrier.html",{waitUntil:"domcontentloaded"});await page.locator(".events-grid .event-card").first().waitFor({timeout:15000});assert.equal(await page.locator(".events-grid .event-card").count(),3,"General calendar must show WGT + DR + BA");assert.equal(await page.locator('[data-calendar-category="ALL"]').getAttribute("aria-current"),"page","General calendar must default to ALL");assert.equal(await page.locator(".events-grid .fx-calendar-code").count(),3,"All calendar cards must show WGT/DR/BA");assert.equal(await page.locator('.fx-primary-nav>a.active').getAttribute("data-fx-section"),"calendar","General calendar nav must be highlighted");await page.goto(origin+"/calendrier.html?type=BA",{waitUntil:"domcontentloaded"});await page.locator(".events-grid .event-card").first().waitFor({timeout:15000});assert.equal(await page.locator(".events-grid .event-card").count(),1,"Ballade ATX calendar must isolate BA events");assert.equal(await page.locator(".events-grid .event-card").first().getAttribute("data-event-code"),"BA");await page.goto(origin+"/calendrier.html?type=DR",{waitUntil:"domcontentloaded"});await page.locator(".events-grid .event-card").first().waitFor({timeout:15000});assert.equal(await page.locator(".events-grid .event-card").count(),1,"DR filter must include only Daily Race");assert.equal(await page.locator(".events-grid .event-card").first().getAttribute("data-event-code"),"DR");await page.goto(origin+"/calendrier.html",{waitUntil:"domcontentloaded"});assert.equal(await page.locator(".fx-times-nav>a").count(),2,"Best laps Circuit/Driver must remain intact");
  await page.goto(origin+"/open-lobby.html",{waitUntil:"domcontentloaded"});
  await page.locator(".fx-open-lobby-poster img").waitFor();
  assert((await page.locator(".fx-open-lobby-poster img").getAttribute("src")).includes("ballade-atx.webp"),"Ballade ATX poster source missing");
  assert(await page.locator(".fx-open-lobby-poster img").evaluate(img=>img.complete&&img.naturalWidth>=640),"Attached Ballade ATX poster is missing or invalid");
  assert((await page.locator("#concept").innerText()).includes("Deux fois par mois"),"Ballade ATX frequency missing");
  await page.goto(origin+"/gtworld.html",{waitUntil:"domcontentloaded"});
  assert.equal(await page.locator(".atx-points-position").count(),10,"WorldGT point scale must show P1 to P10");assert.equal(await page.locator(".atx-scoring-example").count(),0,"WorldGT must not show internal scoring explanation");
  await page.locator("#calendrier .event-body .btn.primary").first().click();
  await page.waitForURL(/course\.html\?event=fixture-wgt/);
  await page.locator("[data-event-results] tr").first().waitFor({timeout:15000});
  assert.equal(await page.locator("[data-event-results] tr").count(),1,"WorldGT must display one row per crew");
  const rowText=(await page.locator("[data-event-results] tr").first().innerText()).toLowerCase();
  assert(rowText.includes("dylan")&&rowText.includes("tim")&&rowText.includes("52")&&!rowText.includes("25"),"The two drivers must share the crew's official points");
  await page.locator("[data-event-journey]:not([hidden]) [data-event-calendar]").waitFor();
  assert.equal(await page.locator("[data-event-calendar]").getAttribute("href"),"calendrier.html?type=WGT");
  assert.equal(await page.locator(".fx-event-backlinks").count(),0,"Redundant legacy event backlinks must not be injected");
  await page.locator("[data-event-ranking]").click();
  await page.waitForURL(/gtworld\.html#classement-equipes$/);
  await page.locator("#classement [data-gtw-standings] tr").first().waitFor();
  await page.goto(origin+"/classement.html#circuit",{waitUntil:"domcontentloaded"});
  assert.equal(await page.locator(".fx-times-nav>a.active").getAttribute("data-fx-section"),"circuit","Best laps by circuit navigation must remain");
  const circuitCard=page.locator(".ranking-circuit-card.circuit-visual-card").first();
  await circuitCard.waitFor({timeout:15000});
  assert(await circuitCard.locator(".circuit-card-media img").count(),"Existing circuit thumbnail missing after skin");
  assert((await circuitCard.locator(".circuit-card-driver").innerText()).includes("ATX Test Pilot"),"Best-lap pilot name missing after skin");
  assert((await circuitCard.locator(".circuit-card-lap").innerText()).includes("1:49.321"),"Best-lap chrono missing after skin");
  assert((await circuitCard.locator(".circuit-card-lap").evaluate(el=>getComputedStyle(el).fontFamily)).includes("monospace"),"Lap times must remain monospace");
  await page.goto(origin+"/classement.html#driver",{waitUntil:"domcontentloaded"});
  assert.equal(await page.locator(".fx-times-nav>a.active").getAttribute("data-fx-section"),"driver","Best laps by pilot navigation must remain");
  console.log("BROWSER: three race pages contain own concept, calendar and standings; WorldGT crew results and global circuit/pilot best laps OK");
  await page.goto(origin+"/classement.html",{waitUntil:"domcontentloaded"});
  await page.locator(".atx-alert-bell").waitFor();
  await page.locator('[data-alltime-leaderboard]:not([hidden])').waitFor({timeout:15000});
  const pointsHeader=page.locator(".points-ranking-table th:nth-child(3)").first();
  assert.equal(await pointsHeader.evaluate(el=>getComputedStyle(el).textAlign),"right","Points column must be right-aligned");
  await page.locator('[data-race-category="WGT"]').click();
  await page.waitForURL(/type=WGT/);
  assert.equal(await page.locator('[data-race-category="WGT"]').getAttribute("aria-current"),"page");
  await page.evaluate(()=>{location.hash="circuit"});
  await page.waitForFunction(()=>!document.querySelector('[data-ranking-panel="circuit"]')?.hidden);
  await page.evaluate(() => {location.hash="driver"});
  await page.locator(".driver-track-row.has-time").first().waitFor({timeout:15000});
  assert.equal(await page.locator(".driver-track-row.has-time").count(),2,"pilot circuit rows missing");
  assert((await page.locator(".driver-track-row.has-time").first().innerText()).includes("1:49.321"),"pilot lap missing");
  assert(await page.locator(".driver-premium-avatar img").count(),"pilot avatar missing");
  assert(await page.locator(".driver-track-row .driver-track-media img").count(),"circuit images missing");
  assert(await page.locator(".driver-track-row").first().evaluate(el => getComputedStyle(el.querySelector(".driver-track-media")).height) !== "auto","circuit image height missing");
  console.log("BROWSER: leaderboard category, circuit and pilot filters, avatars and lap times OK");
  await page.goto(origin+"/profil-pilote.html?driver="+fixtureDriverId,{waitUntil:"domcontentloaded"});
  await page.locator(".profile-pb-card").first().waitFor({timeout:15000});
  assert.equal(await page.locator(".profile-pb-card").count(),2,"profile best lap cards missing");
  assert((await page.locator(".profile-pb-card").first().innerText()).includes("1:44.501"),"profile best lap time missing");
  assert((await page.locator(".profile-pb-lap").first().evaluate(el=>getComputedStyle(el).fontFamily)).includes("monospace"),"Pilot profile time must stay monospace");
  assert(await page.locator('[data-profile-best-laps-section]').isVisible(),"profile best lap section invisible");
  assert(await page.locator(".profile-pb-card").first().evaluate(el=>getComputedStyle(el).display) !== "none","profile CSS missing");
  console.log("BROWSER: public pilot profile and best laps FP/Q, profile CSS OK");
  for (const path of htmlPaths) {
    if (path === "index.html" || path === "classement.html") continue;
    await page.goto(origin+"/"+path,{waitUntil:"domcontentloaded"});
    if (!path.startsWith("resultats-jour-")) await page.locator(".atx-alert-bell").waitFor({timeout:10000});
  }
  assert.equal(errors.length,0,"Browser errors: "+errors.join("; "));
  console.log("BROWSER: all 14 HTML pages opened, no uncaught errors or missing local assets");
} finally {
  await browser.close();
  await new Promise(resolve=>server.close(resolve));
}
