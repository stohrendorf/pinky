/* Real offline frame telemetry in Firefox, or Chromium with pause APIs masked. */
import assert from "node:assert/strict";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, firefox } from "playwright-core";
import { createServer } from "vite";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const browserName = process.argv[2] ?? "firefox";
assert.ok(
  ["firefox", "chromium"].includes(browserName),
  "Choose firefox or chromium",
);
const server = await createServer({
  root,
  logLevel: "silent",
  server: { host: "127.0.0.1", port: 0 },
});
let browser;
try {
  await server.listen();
  if (browserName === "firefox") {
    browser = await firefox.launch();
  } else if (process.env.PINKY_BROWSER) {
    browser = await chromium.launch({
      executablePath: process.env.PINKY_BROWSER,
      args: ["--mute-audio"],
    });
  } else {
    for (const channel of ["chrome", "msedge", "chromium"]) {
      try {
        browser = await chromium.launch({ channel, args: ["--mute-audio"] });
        break;
      } catch {
        /* next installed browser */
      }
    }
  }
  assert.ok(browser, "Install a supported browser first");
  const page = await browser.newPage({
    viewport: { width: 1000, height: 800 },
  });
  const errors = [],
    downloads = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("download", (download) => downloads.push(download));
  await page.addInitScript((maskPause) => {
    const NativeOfflineContext = window.OfflineAudioContext;
    window.testContexts = [];
    window.OfflineAudioContext = class extends NativeOfflineContext {
      constructor(...args) {
        super(...args);
        window.testContexts.push(this);
        if (maskPause) {
          Object.defineProperty(this, "suspend", { value: undefined });
          Object.defineProperty(this, "resume", { value: undefined });
        }
      }
    };
  }, browserName === "chromium");
  await page.goto(server.resolvedUrls.local[0]);
  const expectedFrames = await page.evaluate(async (steps) => {
    const model = await import("/src/lib/project.ts");
    const p = model.newEmptyProject(),
      id = p.instruments[0].id;
    p.bpm = 120;
    p.instruments[0].params = {
      ...p.instruments[0].params,
      voices: 3,
      detune: 8,
      vib: 0,
      noise: 0,
      tone: 1,
      q: 10,
      gain: 0.06,
      rel: 0.08,
      partials: Array.from({ length: 6 }, (_, i) => ({
        ratio: i + 1,
        level: 1 / (i + 1),
      })),
    };
    p.patterns[0].steps = 32;
    p.patterns[0].tracks[id] = Array.from({ length: 8 }, (_, i) =>
      ["C5", "E5", "G5", "B5"].map((pitch) => ({
        pitch,
        start: i * 4,
        len: 3,
      })),
    ).flat();
    p.arrangement[0].len = steps;
    model.project.set(p);
    model.selPatId.set(p.patterns[0].id);
    model.selInstId.set(id);
    window.testSong = JSON.parse(JSON.stringify(p));
    window.testProgress = [];
    (await import("/src/lib/render.ts")).exportProgress.subscribe((state) => {
      if (state) {
        window.testProgress.push({
          ...state,
          nativeState: window.testContexts.at(-1)?.state,
        });
      }
    });
    return Math.ceil(
      ((steps * 60) / 120 / 4 + 3 + 1.5 * p.instruments[0].params.rel) * 44100,
    );
  }, 128);
  // Initialize and later verify the same live engine survives an export.
  await page.getByRole("button", { name: "Play pattern", exact: true }).click();
  await page.getByRole("button", { name: "Stop", exact: true }).click();
  const exportButton = page.getByRole("button", {
    name: "Audio (.wav)",
    exact: true,
  });
  const dialog = page.getByRole("dialog", { name: "Export WAV", exact: true });
  const downloadEvent = page.waitForEvent("download", { timeout: 120000 });
  void downloadEvent.catch(() => {});
  await page.getByRole("button", { name: "Export", exact: true }).click();
  await exportButton.click();
  await page.waitForFunction(
    () =>
      window.testProgress.some(
        (state) =>
          state.stage === "rendering" &&
          state.progress > 0 &&
          state.progress < 1 &&
          state.etaSeconds > 0,
      ),
    undefined,
    { timeout: 60000 },
  );
  assert.match(await dialog.innerText(), /Approx\. .* left in this stage/);
  assert.match(
    await dialog.innerText(),
    /Cancellation waits for rendering to finish/,
  );
  assert.notEqual(await dialog.locator("progress").getAttribute("value"), null);
  const download = await downloadEvent;
  await dialog.waitFor({ state: "hidden" });
  const chunks = [];
  for await (const chunk of await download.createReadStream()) {
    chunks.push(chunk);
  }
  const wav = Buffer.concat(chunks);
  assert.equal(wav.toString("ascii", 0, 4), "RIFF");
  assert.equal(wav.readUInt32LE(24), 44100);
  assert.equal(
    wav.length,
    44 + expectedFrames * 4,
    "exact duration, including tails and latency trim",
  );
  assert.ok(
    wav.subarray(44).some((value) => value !== 0),
    "real engine audio, not just progress",
  );
  const rendered = await page.evaluate(() =>
    window.testProgress.filter((state) => state.stage === "rendering"),
  );
  const values = rendered
    .filter((state) => typeof state.progress === "number")
    .map((state) => state.progress);
  assert.ok(
    values.some((value) => value > 0.1 && value < 0.9),
    "meaningful intermediate audio frames",
  );
  assert.ok(
    values.every((value, i) => i === 0 || value >= values[i - 1]),
    "no percentage regressions",
  );
  assert.equal(values.at(-1), 1);
  assert.ok(
    rendered.some(
      (state) =>
        state.nativeState === "running" &&
        state.progress > 0 &&
        state.progress < 1,
    ),
    "messages arrive DURING native rendering, not just afterward",
  );
  assert.ok(
    rendered.every((state) => state.canSuspend === false),
    "native Firefox requires no masked APIs",
  );
  assert.equal(downloads.length, 1);

  await page.evaluate(() => {
    window.testProgress = [];
  });
  await page.getByRole("button", { name: "Export", exact: true }).click();
  await exportButton.click();
  await page.waitForFunction(() =>
    window.testProgress.some(
      (state) => state.stage === "rendering" && state.progress > 0.01,
    ),
  );
  await page.keyboard.press("Escape");
  assert.match(
    await dialog.locator(".status").innerText(),
    /waiting for this browser to finish/,
  );
  await dialog.waitFor({ state: "hidden", timeout: 120000 });
  const cancelled = await page.evaluate(async () => ({
    state: window.testContexts.at(-1).state,
    busy: (await import("/src/lib/engine.ts")).isRendering(),
    encoded: window.testProgress.some((state) => state.stage === "encoding"),
    cancelled: window.testProgress.some((state) => state.cancelling),
  }));
  assert.deepEqual(cancelled, {
    state: "closed",
    busy: false,
    encoded: false,
    cancelled: true,
  });
  assert.equal(downloads.length, 1, "cancellation never downloads");
  await page.getByRole("button", { name: "Play pattern", exact: true }).click();
  await page.getByRole("button", { name: "Mixer", exact: true }).click();
  await page.waitForFunction(
    () =>
      Number(
        document
          .querySelector('[role="meter"][aria-label="Master L peak"]')
          ?.getAttribute("aria-valuenow") ?? -60,
      ) > -60,
  );
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Stop", exact: true }).click();
  await page.evaluate(async () => {
    const p = JSON.parse(JSON.stringify(window.testSong));
    p.arrangement[0].len = 8;
    window.testProgress = [];
    (await import("/src/lib/project.ts")).project.set(p);
  });
  const retry = page.waitForEvent("download", { timeout: 60000 });
  void retry.catch(() => {});
  await page.getByRole("button", { name: "Export", exact: true }).click();
  await exportButton.click();
  await retry;
  await dialog.waitFor({ state: "hidden" });
  assert.equal(downloads.length, 2);
  assert.deepEqual(errors, []);
  console.log(
    JSON.stringify(
      {
        browser: browserName,
        version: browser.version(),
        updates: values.length,
        etaSamples: rendered.filter((state) => state.etaSeconds > 0).length,
        wavBytes: wav.length,
        cancelled,
        checks:
          "in-flight frames, ETA, WAV duration/audio, Escape, no cancelled download, playback, retry",
      },
      null,
      2,
    ),
  );
} catch (error) {
  console.error("Export progress browser check failed:", error);
  const page = browser?.contexts()[0]?.pages()[0];
  if (page && !page.isClosed()) {
    console.error(
      await page
        .evaluate(() => ({
          progress: window.testProgress?.slice(-5),
          rendering: window.testProgress
            ?.filter((state) => state.stage === "rendering")
            .slice(-5),
          contexts: window.testContexts?.map((context) => ({
            state: context.state,
            time: context.currentTime,
          })),
        }))
        .catch(() => null),
    );
  }
  throw error;
} finally {
  await browser?.close();
  await server.close();
}
