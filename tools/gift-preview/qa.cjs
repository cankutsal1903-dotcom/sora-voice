// Optional isolated web QA; requires a local preview server and a headless Chromium CDP port.
const fs = require("node:fs");
const path = require("node:path");
const pause = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

async function main() {
  const origin = process.env.SORA_PREVIEW_ORIGIN || "http://127.0.0.1:8092";
  const cdpOrigin = process.env.SORA_PREVIEW_CDP || "http://127.0.0.1:9227";
  const targets = await fetch(`${cdpOrigin}/json`).then((response) => response.json());
  const page = targets.find((target) => target.type === "page");
  if (!page) throw new Error("No Chromium page available");
  const socket = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
  let serial = 0;
  const pending = new Map();
  const exceptions = [];
  socket.onmessage = ({ data }) => {
    const message = JSON.parse(data);
    if (message.method === "Runtime.exceptionThrown") exceptions.push(message.params.exceptionDetails);
    if (!message.id) return;
    const callback = pending.get(message.id);
    if (!callback) return;
    pending.delete(message.id);
    if (message.error) callback.reject(new Error(JSON.stringify(message.error)));
    else callback.resolve(message.result);
  };
  const command = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++serial;
    pending.set(id, { resolve, reject });
    socket.send(JSON.stringify({ id, method, params }));
  });
  const evaluate = async (expression) => {
    const result = await command("Runtime.evaluate", { expression, returnByValue: true });
    if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
    return result.result.value;
  };
  await command("Page.enable");
  await command("Runtime.enable");
  await command("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await command("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "no-preference" }] });
  const output = path.join(__dirname, "qa");
  fs.mkdirSync(output, { recursive: true });
  const results = [];
  for (const id of ["minik_kalp", "kahve_molasi", "ferrari", "efsanevi_anka", "kraliyet_sahnesi"]) {
    await command("Page.navigate", { url: `${origin}/?scene=1&gift=${id}&play=1` });
    for (let attempt = 0; attempt < 80; attempt++) {
      if (await evaluate("document.images.length>=2 && [...document.images].every(i=>i.complete&&i.naturalWidth>0)")) break;
      await pause(100);
    }
    await pause(750);
    const trajectory = `(()=>{const image=[...document.images].at(-1);if(!image)return null;let node=image.parentElement;while(node&&getComputedStyle(node).transform==='none')node=node.parentElement;const r=image.getBoundingClientRect();return {transform:node&&getComputedStyle(node).transform,opacity:node&&getComputedStyle(node).opacity,x:r.x,y:r.y,w:r.width,h:r.height}})()`;
    const firstFrame = await evaluate(trajectory);
    const beforeScreenshot = await command("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
    fs.writeFileSync(path.join(output, `${id}-early.png`), Buffer.from(beforeScreenshot.data, "base64"));
    await pause(550);
    const secondFrame = await evaluate(trajectory);
    const state = await evaluate(`({title:document.body.innerText, images:[...document.images].map(i=>({loaded:i.complete&&i.naturalWidth>0,src:i.currentSrc})), width:innerWidth,height:innerHeight})`);
    const screenshot = await command("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
    fs.writeFileSync(path.join(output, `${id}.png`), Buffer.from(screenshot.data, "base64"));
    results.push({ id, images: state.images.length, allImagesLoaded: state.images.every((image) => image.loaded), viewport: [state.width, state.height], hasControls: state.title.includes("Oynat"), hasAnimationLabel: state.title.includes("Önizleme"), firstFrame, secondFrame, transformChanged: firstFrame?.transform !== secondFrame?.transform });
  }
  await command("Page.navigate", { url: origin });
  await pause(1600);
  const gallery = await evaluate("({images:document.images.length, unloaded:[...document.images].filter(i=>!i.complete||!i.naturalWidth).length, cards:document.querySelectorAll('[aria-label$=\"efektini oynat\"]').length})");
  console.log(JSON.stringify({ scenes: results, gallery, exceptions }, null, 2));
  socket.close();
  if (exceptions.length || gallery.cards !== 34 || gallery.unloaded > 0 || results.some((result) => !result.allImagesLoaded || !result.hasControls || !result.transformChanged)) process.exitCode = 1;
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
