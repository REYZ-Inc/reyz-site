// REYZ — social-sharing cover, composed from the same Contour sculpture as the Home film.
// The sculpture is frame 0 of tools/render_brand_contour.cpp (the Home poster), so the shared
// link and the site show one infinity. No generated or third-party imagery.
//
//   c++ -std=c++17 -O3 tools/render_brand_contour.cpp -o /tmp/reyz-contour
//   node tools/render_og_cover.mjs /tmp/reyz-contour
//
// Fonts are the site's own (Inter, Noto Sans JP) from Google Fonts. Where that host is not
// reachable, pass a local stylesheet declaring the same two families as the third argument.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium } from 'playwright';

const [renderer, output = path.join(path.dirname(fileURLToPath(import.meta.url)), '../site/assets/og-contour-v1.png'), fontCss] = process.argv.slice(2);
if (!renderer) { console.error('usage: node tools/render_og_cover.mjs <contour renderer> [output.png] [font.css]'); process.exit(2); }
const WIDTH = 1200, HEIGHT = 630;
const work = mkdtempSync(path.join(tmpdir(), 'reyz-og-'));
try {
  const frame = path.join(work, 'contour.png');
  const rgb = execFileSync(renderer, ['0'], { maxBuffer: 1280 * 720 * 3 + 1024 });
  execFileSync('ffmpeg', ['-y', '-v', 'error', '-f', 'rawvideo', '-pixel_format', 'rgb24', '-video_size', '1280x720', '-i', '-', '-frames:v', '1', frame], { input: rgb });
  const fonts = fontCss ? pathToFileURL(path.resolve(fontCss)).href
    : 'https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500&family=Noto+Sans+JP:wght@300;400;500&display=block';
  const html = `<!doctype html><html lang="ja"><meta charset="utf-8"><link rel="stylesheet" href="${fonts}"><style>
    html,body{margin:0;width:${WIDTH}px;height:${HEIGHT}px;background:#0a0a0a;overflow:hidden}
    body{position:relative;color:#f4f4f2;font-family:Inter,"Noto Sans JP",sans-serif;-webkit-font-smoothing:antialiased}
    .glow{position:absolute;left:470px;top:20px;width:720px;height:520px;background:radial-gradient(closest-side,rgba(247,21,172,.10),rgba(247,21,172,0))}
    .contour{position:absolute;left:392px;top:58px;width:800px;height:450px;mix-blend-mode:screen}
    .logo{position:absolute;left:68px;top:60px;font-size:25px;font-weight:500;letter-spacing:.3em}
    .logo b{font-weight:500;color:#F715AC}.logo span{margin-left:.5em;font-size:15px;font-weight:400;letter-spacing:.12em;color:#9a9a98}
    h1{position:absolute;left:66px;bottom:62px;margin:0;font-size:54px;line-height:1.36;font-weight:400;letter-spacing:.04em}
    .line{position:absolute;right:68px;bottom:70px;font-size:13px;font-weight:400;letter-spacing:.3em;color:#b9b9b6}
  </style><div class="glow"></div><img class="contour" src="${pathToFileURL(frame).href}" alt="">
  <div class="logo">REY<b>Z</b><span>Inc.</span></div><h1>無限の可能性を<br>かたちに</h1><div class="line">CREATOR ECONOMY × AI</div></html>`;
  const page = path.join(work, 'cover.html');
  writeFileSync(page, html);
  const browser = await chromium.launch();
  try {
    const tab = await browser.newPage({ viewport: { width: WIDTH, height: HEIGHT }, deviceScaleFactor: 1 });
    await tab.goto(pathToFileURL(page).href, { waitUntil: 'load' });
    const families = await tab.evaluate(async () => {
      await Promise.all([document.fonts.load('500 25px Inter', 'REYZ'), document.fonts.load('400 54px "Noto Sans JP"', '無限の可能性をかたちに')]);
      await document.fonts.ready;
      return [...document.fonts].filter(font => font.status === 'loaded').map(font => font.family.replace(/"/g, ''));
    });
    // A cover in a fallback face is not the REYZ cover: stop instead of writing it.
    for (const family of ['Inter', 'Noto Sans JP']) if (!families.includes(family)) throw new Error('font not loaded: ' + family);
    await tab.screenshot({ path: output, type: 'png' });
  } finally { await browser.close(); }
  const size = readFileSync(output).length;
  console.log(JSON.stringify({ output, width: WIDTH, height: HEIGHT, bytes: size }));
} finally { rmSync(work, { recursive: true, force: true }); }
