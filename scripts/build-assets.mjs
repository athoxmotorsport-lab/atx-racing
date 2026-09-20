/**
 * ATX Racing build: preserve CSS cascade and JS execution order.
 * Run: npm install --no-save --no-package-lock terser@5.36.0 clean-css@5.3.3
 *      node scripts/build-assets.mjs
 */
import { readdir, readFile, writeFile } from "node:fs/promises";
import { basename, extname, dirname, join } from "node:path";
import CleanCSS from "clean-css";
import { minify as minifyJS } from "terser";

const root = process.cwd();
const version = "20260920-polish1";
const core = ["style.css", "enhancements.css", "premium-shell.css", "atx-experience.css"];
const home = ["style.css", "enhancements.css", "home-experience.css", "premium-shell.css", "atx-experience.css"];
const sources = new Set(home);
const decodeAsset = href => href.split("?")[0].replace(/^(\.\.\/)+/, "");
const read = name => readFile(join(root, name), "utf8");
const write = (name, data) => writeFile(join(root, name), data, "utf8");
const minCSS = new CleanCSS({ level: 1, rebase: false, inline: ["none"], format: false });

for (const [name, files] of [["atx-core.min.css", core], ["atx-home.min.css", home]]) {
  const concatenated = (await Promise.all(files.map(read))).join("\n/* ---- atx css boundary ---- */\n");
  const result = minCSS.minify(concatenated);
  if (result.errors.length || !result.styles || result.styles.length >= concatenated.length) {
    throw new Error("CSS minification failed for " + name + ": " + result.errors.join("; "));
  }
  await write(name, result.styles);
  console.log("CSS", name, concatenated.length, "->", result.styles.length);
}
const alertCSS = await read("race-alerts.css");
const alertResult = minCSS.minify(alertCSS);
if (alertResult.errors.length || !alertResult.styles) throw new Error(alertResult.errors.join("; "));
await write("race-alerts.min.css", alertResult.styles);
console.log("CSS race-alerts.min.css", alertCSS.length, "->", alertResult.styles.length);

// Each script remains a separate deferred script to preserve its own IIFE and
// the DOMContentLoaded order of main, premium shell and race alerts.
const javaScriptFiles = (await readdir(root))
  .filter(name => extname(name) === ".js" && !name.endsWith(".min.js")).sort();
for (const name of javaScriptFiles) {
  const source = await read(name);
  const result = await minifyJS(source, {
    compress: false, mangle: false,
    format: { comments: false, beautify: false, semicolons: true }
  });
  if (!result.code || result.error) throw new Error("JS minification failed: " + name);
  const dest = name.replace(/\.js$/, ".min.js");
  await write(dest, result.code);
  console.log("JS", name, source.length, "->", result.code.length);
}

const allHTML = [];
async function findHTML(folder) {
  for (const dirent of await readdir(join(root, folder), { withFileTypes: true })) {
    if (dirent.isDirectory() && dirent.name === "events") {
      await findHTML(join(folder, dirent.name));
    } else if (dirent.isFile() && dirent.name.endsWith(".html")) {
      allHTML.push(join(folder, dirent.name).replace(/^\.\//, ""));
    }
  }
}
await findHTML(".");
let pagesChanged = 0;
for (const path of allHTML) {
  let html = await read(path);
  const original = html;
  const prefix = dirname(path) === "." ? "" : "../";
  const hasBaseCSS = /href=["'](?:\.\.\/)?style\.css\?/.test(html);
  const isHome = basename(path) === "index.html";
  const bundle = isHome ? "atx-home.min.css" : "atx-core.min.css";
  let replacedBase = false;
  let baseParts = 0;
  // Replace in place at first stylesheet and remove the others.
  html = html.replace(/<link\b[^>]*\brel=["']stylesheet["'][^>]*>/gi, tag => {
    const href = tag.match(/\bhref=(["'])(.*?)\1/i)?.[2];
    if (!href) return tag;
    const file = decodeAsset(href);
    if (sources.has(file)) {
      if (!hasBaseCSS) throw new Error("Unexpected CSS part in " + path + ": " + file);
      if (!isHome && file === "home-experience.css") throw new Error("Home CSS on non-home page " + path);
      baseParts++;
      if (replacedBase) return "";
      replacedBase = true;
      return '<link rel="stylesheet" href="' + prefix + bundle + "?v=" + version + '">';
    }
    if (file === "race-alerts.css") {
      return tag.replace(href, prefix + "race-alerts.min.css?v=" + version);
    }
    return tag;
  });
  if (hasBaseCSS && baseParts !== (isHome ? home.length : core.length)) {
    throw new Error("Unexpected number of CSS files in " + path + ": " + baseParts);
  }
  if (hasBaseCSS !== replacedBase) throw new Error("Missing bundled CSS in " + path);

  html = html.replace(/<script\b[^>]*\bsrc=(["'])(.*?)\1[^>]*><\/script>/gi, tag => {
    const match = tag.match(/\bsrc=(["'])(.*?)\1/i);
    if (!match) return tag;
    const href = match[2];
    const name = decodeAsset(href);
    if (!javaScriptFiles.includes(name)) return tag;
    const clean = prefix + name.replace(/\.js$/, ".min.js") + "?v=" + version;
    return tag.replace(href, clean);
  });
  if (html !== original) { await write(path, html); pagesChanged++; }
}
console.log("PAGES", pagesChanged, "/", allHTML.length, "updated");
