import {chromium} from "playwright";
import {mkdir} from "node:fs/promises";
const origin="https://athoxmotorsport-lab.github.io/atx-racing/";
const routes=["index.html","gtworld.html","daily-race.html","open-lobby.html","calendrier.html","classement.html","profil-pilote.html","archives.html","reglement.html","confidentialite.html","course.html?event=2026-09-20-kyalami-kyalami-174121-eeae70d0","event-admin.html","events/monza-2026-09-09.html","events/nurburgring-gp-2026-09-11.html","resultats-jour-01-monza.html","resultats-jour-02-paul-ricard.html"];
await mkdir("audit-screenshots",{recursive:true});
const browser=await chromium.launch({headless:true});
const findings=[];
for(const device of [{name:"desktop",width:1440,height:900},{name:"mobile",width:390,height:844}]){
 const context=await browser.newContext({viewport:{width:device.width,height:device.height},deviceScaleFactor:1,reducedMotion:"reduce"});
 for(const route of routes){
  const page=await context.newPage(),issues=[],consoleErrors=[],httpErrors=[];
  page.on("pageerror",e=>consoleErrors.push(e.message.slice(0,220)));
  page.on("response",res=>{if(res.status()>=400&&res.url().startsWith(origin))httpErrors.push(res.status()+" "+res.url().slice(0,110))});
  try{
   const response=await page.goto(origin+route,{waitUntil:"domcontentloaded",timeout:25000});
   await page.waitForTimeout(1100);
   const metrics=await page.evaluate(()=>{
    const nav=document.querySelector(".fx-primary-nav");
    const links=nav?[...nav.querySelectorAll(":scope > a")]:[];
    const rects=links.map(x=>({label:x.textContent.trim(),x:Math.round(x.getBoundingClientRect().x),y:Math.round(x.getBoundingClientRect().y),height:Math.round(x.getBoundingClientRect().height)}));
    const brand=document.querySelector(".side-brand");
    const menu=document.querySelector(".atx-mobile-nav-toggle");
    const heading=document.querySelector("main h1");
    const logo=document.querySelector(".side-brand .brand");
    const image=document.querySelector(".home-brand-banner img");
    const main=document.querySelector("main");
    return {title:document.title,navDisplay:nav?getComputedStyle(nav).display:null,navDirection:nav?getComputedStyle(nav).flexDirection:null,navRects:rects,headerHeight:Math.round(document.querySelector(".side-nav")?.getBoundingClientRect().height??0),menuVisible:!!menu&&getComputedStyle(menu).display!=="none",menuExpanded:menu?.getAttribute("aria-expanded")??null,scrollOverflow:Math.round(document.documentElement.scrollWidth-document.documentElement.clientWidth),overflowElements:[...document.querySelectorAll("body *")].map(el=>({tag:el.tagName.toLowerCase(),className:typeof el.className==="string"?el.className.slice(0,100):"",right:Math.round(el.getBoundingClientRect().right),left:Math.round(el.getBoundingClientRect().left),scrollWidth:el.scrollWidth})).filter(x=>x.right>document.documentElement.clientWidth+10||x.left< -10).sort((a,b)=>b.right-a.right).slice(0,8),navTiming:(()=>{const n=performance.getEntriesByType("navigation")[0];return n?{domContentLoadedMs:Math.round(n.domContentLoadedEventEnd),loadMs:Math.round(n.loadEventEnd),transferBytes:n.transferSize}:null})(),fontLoadState:document.fonts.status,mainVisible:!!main&&main.getBoundingClientRect().width>150,h1Font:heading?getComputedStyle(heading).fontFamily:null,logoVisible:!!logo&&logo.getBoundingClientRect().width>0,bannerPresent:!!image,bannerDecoded:!!image&&image.complete&&image.naturalWidth>0,activeLinks:links.filter(x=>x.matches(".active,[aria-current=page]")).map(x=>({label:x.textContent.trim(),decoration:getComputedStyle(x).textDecorationLine,border:getComputedStyle(x).borderTopWidth}))};
   });
   const isShared=!route.startsWith("resultats-jour-");
   if(isShared&&device.name==="desktop"){
    if(metrics.navDisplay!=="flex")issues.push("Desktop navigation not flex");
    if(metrics.navDirection!=="row")issues.push("Desktop navigation not horizontal");
    if(metrics.navRects.length>2&&Math.max(...metrics.navRects.map(x=>x.y))-Math.min(...metrics.navRects.map(x=>x.y))>14)issues.push("Desktop menu wraps across rows");
    if(metrics.headerHeight>175)issues.push("Desktop header too tall");
   }
   if(isShared&&device.name==="mobile"){
    if(!metrics.menuVisible)issues.push("Mobile menu toggle invisible");
    if(metrics.menuExpanded!=="false")issues.push("Mobile menu not collapsed initially");
   }
   if(metrics.scrollOverflow>4)issues.push("Horizontal viewport overflow "+metrics.scrollOverflow+"px");
   if(!metrics.mainVisible)issues.push("Main content not visible");
   if(route==="index.html"&&!metrics.bannerDecoded)issues.push("Homepage banner not decoded");
   if(httpErrors.length)issues.push("Local HTTP failures");
   if(consoleErrors.length)issues.push("JavaScript page errors");
   const filename="audit-screenshots/"+device.name+"-"+route.split("?")[0].replaceAll("/","_")+".png";
   await page.screenshot({path:filename,fullPage:false,animations:"disabled"});
   const detail={device:device.name,route,http:response?.status(),issues,consoleErrors:consoleErrors.slice(0,3),httpErrors:httpErrors.slice(0,3),...metrics};
   console.log("ATX_AUDIT "+JSON.stringify(detail));
   if(issues.length)findings.push({device:device.name,route,issues});
  }catch(e){findings.push({device:device.name,route,issues:[String(e).slice(0,230)]});console.error("ATX_AUDIT_ERROR "+device.name+" "+route+" "+String(e).slice(0,240))}
  finally{await page.close()}
 }
 await context.close()
}
await browser.close();
console.log("ATX_AUDIT_SUMMARY "+JSON.stringify({pages:routes.length,devices:2,findings}));
if(findings.length)process.exitCode=1;
