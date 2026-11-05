// Screenshots of the app and landing at true desktop and phone sizes, via Chrome DevTools emulation.
// Usage: node scripts/screens.mjs <outDir> <waitSeconds> <name=url> [<name=url> ...]
// Each URL is captured twice: <name>-desktop.png (1360 wide) and <name>-phone.png (390 wide, mobile emulation, 2x).
// Read-only: it only loads pages.
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const CHROME = process.env.CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const [outDir, waitArg, ...pairs] = process.argv.slice(2);
if (!outDir || !pairs.length) { console.error("usage: node scripts/screens.mjs <outDir> <waitSeconds> name=url ..."); process.exit(1); }
const waitMs = Number(waitArg || 9) * 1000;
mkdirSync(outDir, { recursive: true });
const port = 9333 + Math.floor(Math.random() * 300);
const chrome = spawn(CHROME, ["--headless=new", "--disable-gpu", "--hide-scrollbars", `--remote-debugging-port=${port}`, `--user-data-dir=${mkdtempSync(join(tmpdir(), "flatstock-shots-"))}`, "about:blank"], { stdio: "ignore" });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function connect() {
  for (let i = 0; i < 50; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
      const page = list.find((t) => t.type === "page");
      if (page) return page.webSocketDebuggerUrl;
    } catch { /* not up yet */ }
    await sleep(200);
  }
  throw new Error("Chrome did not start");
}

const ws = new WebSocket(await connect());
await new Promise((resolve) => ws.addEventListener("open", resolve));
let nextId = 1;
const pending = new Map();
ws.addEventListener("message", (event) => {
  const message = JSON.parse(event.data);
  if (message.id && pending.has(message.id)) { pending.get(message.id)(message); pending.delete(message.id); }
});
const send = (method, params = {}) => new Promise((resolve) => { const id = nextId++; pending.set(id, resolve); ws.send(JSON.stringify({ id, method, params })); });

for (const pair of pairs) {
  const [name, url] = [pair.slice(0, pair.indexOf("=")), pair.slice(pair.indexOf("=") + 1)];
  for (const [label, width, mobile] of [["desktop", 1360, false], ["phone", Number(process.env.PHONE_WIDTH || 390), true]]) {
    await send("Emulation.setDeviceMetricsOverride", { width, height: mobile ? 844 : 860, deviceScaleFactor: mobile ? 2 : 1, mobile });
    await send("Page.enable");
    await send("Page.navigate", { url });
    await sleep(waitMs);
    const metrics = await send("Runtime.evaluate", { expression: "Math.max(document.documentElement.scrollHeight, document.body.scrollHeight)", returnByValue: true });
    const overflow = await send("Runtime.evaluate", { expression: "document.documentElement.scrollWidth - document.documentElement.clientWidth", returnByValue: true });
    const height = Math.min(Math.ceil(metrics.result.result.value), 9000);
    // Scroll through the page once so scroll-triggered reveals fire, then back to the top.
    for (let y = 0; y < height; y += 500) { await send("Runtime.evaluate", { expression: `window.scrollTo(0, ${y})` }); await sleep(120); }
    await send("Runtime.evaluate", { expression: "window.scrollTo(0, 0)" });
    await sleep(900);
    // Keep the viewport at phone/laptop height (so 100vh sections look right) and capture the whole page.
    await sleep(400);
    const shot = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: true, clip: { x: 0, y: 0, width, height, scale: 1 } });
    const file = join(outDir, `${name}-${label}.png`);
    writeFileSync(file, Buffer.from(shot.result.data, "base64"));
    // Optional: SEGMENT=1100 also writes <name>-<label>-<n>.png slices, handy for reviewing long pages.
    const seg = Number(process.env.SEGMENT || 0);
    for (let n = 0; seg && n * seg < height; n++) {
      const part = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: true, clip: { x: 0, y: n * seg, width, height: Math.min(seg, height - n * seg), scale: 1 } });
      writeFileSync(join(outDir, `${name}-${label}-${n}.png`), Buffer.from(part.result.data, "base64"));
    }
    console.log(`${file}  ${width}x${height}  horizontal overflow: ${overflow.result.result.value}px`);
  }
}
ws.close();
chrome.kill();
