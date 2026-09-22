import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { worldGTPoints } from "../supabase/functions/_shared/worldgt-scoring.ts";

const event1="race-1", event2="race-2";
const teamAssignments=[
  ["Dylan","ATX Motorsport Team 1"],["Tim","ATX Motorsport Team 1"],
  ["X1","Team X"],["X2","Team X"],["C1","Team 3"],["C2","Team 3"],
  ["B1","ATX Motorsport Team 2"],["B2","ATX Motorsport Team 2"],
].map(([driver_id,team_name])=>({event_id:event1,driver_id,team_name}));
const res=(event_id,driver_id,finish_position,best_lap_ms,status="classified")=>({event_id,driver_id,finish_position,best_lap_ms,status});
const results=[
  res(event1,"Dylan",1,101000),res(event1,"Tim",1,100000),
  res(event1,"X1",2,101500),res(event1,"X2",2,102100),
  res(event1,"C1",3,104000),res(event1,"C2",3,105000),
  res(event1,"B1",4,106000),res(event1,"B2",4,107000),
];
const score=worldGTPoints(results,teamAssignments);
const team1=score.entries.find(e=>e.team_name==="ATX Motorsport Team 1");
assert(team1,"Team 1 not present");
assert.equal(team1.points,52,"Team 1 P1 and +2 fastest lap");
assert.equal(score.driverPoints.get(event1+"|Dylan")?.points,52);
assert.equal(score.driverPoints.get(event1+"|Tim")?.points,52);
assert.equal(score.entries.find(e=>e.team_name==="Team X")?.points,36);
assert.equal(score.driverPoints.get(event1+"|X2")?.points,36);
assert.equal(score.entries.find(e=>e.team_name==="Team 3")?.points,30);
assert.equal(score.driverPoints.get(event1+"|C1")?.points,30);
assert.equal(score.entries.find(e=>e.team_name==="ATX Motorsport Team 2")?.points,24);
assert.equal(score.entries.length,4,"The four racing teams must not be grouped by parent organisation");
assert.equal(score.entries.reduce((total,entry)=>total+entry.points,0),142,"Crew points counted once, not doubled for drivers");
const unmappedFastest=worldGTPoints([...results,res(event1,"unmapped",5,99000)],teamAssignments);
assert.equal(unmappedFastest.entries.find(e=>e.team_name==="ATX Motorsport Team 1")?.points,50,
  "A quicker but unmapped crew must prevent a false fastest-lap bonus");
assert.equal(unmappedFastest.driverPoints.has(event1+"|unmapped"),false,
  "Never invent an association between an unassigned pilot and a team");
const otherRace=worldGTPoints([
  ...results,res(event2,"Dylan",3,103000),res(event2,"Tim",3,102000),
],[
  ...teamAssignments,{event_id:event2,driver_id:"Dylan",team_name:"Team X"},
  {event_id:event2,driver_id:"Tim",team_name:"Team X"},
]);
assert.equal(otherRace.driverPoints.get(event2+"|Dylan")?.points,32,
  "Team membership follows the actual event; fastest lap and P3 belong to the new team");
assert.equal(otherRace.entries.find(e=>e.team_name==="ATX Motorsport Team 1")?.points,52,
  "Membership changes must not rewrite the preceding round");
const disqualified=worldGTPoints([res(event1,"Dylan",1,100000,"dsq")],teamAssignments);
assert.equal(disqualified.entries.length,0,"DSQ must not score WorldGT points");
const allSix=worldGTPoints(Array.from({length:6},(_,i)=>res(event1,"pilot"+i,1,102000+i*100)),Array.from({length:6},(_,i)=>({event_id:event1,driver_id:"pilot"+i,team_name:"Endurance Team"})));
assert.equal(allSix.entries[0].points,52);
assert(allSix.entries[0].driver_ids.every(driver=>allSix.driverPoints.get(event1+"|"+driver)?.points===52),
  "Each of the six endurance drivers must receive the crew's points and bonus");
console.log("WORLDGT: crew results, identical driver awards, bonus, unmapped teams, DSQ and six-driver endurance OK");

const pages={
  "gtworld.html":["data-course-page=\"WGT\"","atx-points-grid","calendrier-complet-wgt.webp","stands ouverts toute la course","id=\"calendrier\"","id=\"classement\""],
  "daily-race.html":["data-course-page=\"DR\"","data-cat-recent"],
  "open-lobby.html":["data-course-page=\"BA\"","data-cat-recent","ballade-atx.webp","Deux arrêts aux stands sont obligatoires"],
  "calendrier.html":["data-calendar-journey","data-calendar-category=\"WGT\"","data-recent-category=\"CALENDAR\""],
  "classement.html":["data-ranking-journey","data-race-category=\"WGT\"","data-race-category=\"BA\""],
  "course.html":["data-event-journey","data-event-results","id=\"resultats\"","data-event-points-note"],
};
for(const [path,markers] of Object.entries(pages)){
  const content=await readFile(path,"utf8");
  for(const marker of markers)assert(content.includes(marker),path+": missing "+marker);
}
const main=await readFile("main.min.js","utf8");
const shell=await readFile("premium-shell.min.js","utf8");
const detailApi=await readFile("supabase/functions/public-event/index.ts","utf8");
const standingsApi=await readFile("supabase/functions/public-leaderboard/index.ts","utf8");
const worldApi=await readFile("supabase/functions/public-gtworld/index.ts","utf8");
for(const marker of ["atx:eventcategory","data-event-ranking","data-calendar-results","data-recent-category","data-ranking-journey","team_results"]){
  assert(main.includes(marker),"Main route missing "+marker);
}
for(const marker of ["gtworld.html","daily-race.html","open-lobby.html","classement.html#circuit","classement.html#driver","fx-course-tabs","atx:rankingcategory"]){
  assert(shell.includes(marker),"Side navigation missing "+marker);
}
for(const [name,source] of [["detail",detailApi],["standings",standingsApi],["WorldGT",worldApi]])
  assert(source.includes('worldGTPoints'),"Scoring helper not shared by "+name+" endpoint");
assert(!((await readFile("gtworld.html","utf8")).includes("wgt-points-exemple")),"Internal scoring example must not appear in WorldGT presentation");assert((await readFile("reglement.html","utf8")).includes("stands ouverts toute la course"),"WGT Sprint option A must be retained");assert(standingsApi.includes('requestedCategory === "BA"'),"BA standings must have an independent API category");
const categoryScript=await readFile("category-sections.min.js","utf8");for(const marker of ["public-event","public-leaderboard?category=","[data-cat-calendar]","[data-cat-drivers]","[data-cat-teams]"]){assert(categoryScript.includes(marker),"Inline category sections missing "+marker)}console.log("ROUTES: three pages with concept / calendar / standings; global circuit and pilot best laps preserved");
