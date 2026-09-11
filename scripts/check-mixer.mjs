/* Repeatable browser/native Web Audio integration checks. Uses installed
 * Chrome/Edge or PINKY_BROWSER, with an isolated profile and no saved-song edits. */
import assert from "node:assert/strict";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import { createServer } from "vite";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const server = await createServer({
  root,
  logLevel: "error",
  server: { host: "127.0.0.1", port: 0 },
});
let browser;
try {
  await server.listen();
  if (process.env.PINKY_BROWSER) {
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
        /* try installed alternatives */
      }
    }
  }
  if (!browser) {
    throw new Error(
      "Install Chrome/Edge or set PINKY_BROWSER to a Chromium executable.",
    );
  }
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
  });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(server.resolvedUrls.local[0]);
  await page.getByRole("button", { name: "Mixer", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: "+ Group", exact: true }).click();
  await dialog.getByLabel("Bus name", { exact: true }).fill("Test group");
  await dialog.getByLabel("Bus name", { exact: true }).press("Tab");
  const state = await page.evaluate(async () => {
    const { project } = await import("/src/lib/project.ts");
    let p;
    const unsubscribe = project.subscribe((value) => {
      p = value;
    });
    unsubscribe();
    return {
      id: p.instruments[0].id,
      name: p.instruments[0].name,
      bus: p.mixer.buses[0].id,
    };
  });
  await dialog
    .getByRole("button", { name: `${state.name} settings`, exact: true })
    .click();
  await dialog
    .getByLabel(`${state.name} output`, { exact: true })
    .selectOption(state.bus);
  await dialog
    .getByRole("button", { name: `Mute ${state.name}`, exact: true })
    .click();
  assert.equal(
    await dialog
      .getByRole("button", {
        name: `Mute ${state.name}`,
        exact: true,
      })
      .getAttribute("aria-pressed"),
    "true",
  );
  await dialog
    .getByRole("button", { name: "Test group settings", exact: true })
    .click();
  await dialog.getByRole("button", { name: "Delete bus", exact: true }).click();
  await dialog
    .getByRole("button", { name: `${state.name} settings`, exact: true })
    .click();
  assert.equal(
    await dialog
      .getByLabel(`${state.name} output`, { exact: true })
      .inputValue(),
    "master",
  );
  await page.keyboard.press("Escape");

  const result = await page.evaluate(async () => {
    const engine = await import("/src/lib/engine.ts");
    const { scheduleRange } = await import("/src/lib/transport.ts");
    const { newEmptyProject, buildDemoProject } =
      await import("/src/lib/project.ts");
    const { addMixerBus, createMixer } = await import("/src/lib/mixer.ts");
    const { MixerAudio, MasterLimiter, loadLimiter, limiterLatencyFrames } =
      await import("/src/lib/mixer-audio.ts");
    const { DEFAULT_PARAMS } = await import("/src/lib/instruments.ts");
    const check = (ok, message) => {
      if (!ok) {
        throw new Error(message);
      }
    };
    const clone = (value) => JSON.parse(JSON.stringify(value));
    const measure = (buffer, from = 0) => {
      let peak = 0,
        sum = 0,
        count = 0;
      for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
        for (const v of buffer
          .getChannelData(ch)
          .subarray(Math.round(from * buffer.sampleRate))) {
          check(Number.isFinite(v), "non-finite audio");
          peak = Math.max(peak, Math.abs(v));
          sum += v * v;
          count++;
        }
      }
      return {
        peak,
        rms: Math.sqrt(sum / Math.max(1, count)),
        frames: buffer.length,
      };
    };
    // Exact scaling/isolation checks use a fixed probe through the same
    // native strips and limiter. Resonant synthesis is tested below using
    // actual demo scores; its cancellation path is not bit-deterministic
    // across native contexts, even with identical noise/humanization seeds.
    const rawBounce = async (p) => {
      const rate = 48000,
        frames = 57600,
        latency = limiterLatencyFrames(rate);
      const c = new OfflineAudioContext(2, frames + latency, rate);
      await loadLimiter(c);
      const sum = new GainNode(c),
        gain = new GainNode(c, { gain: p.mixer.master.vol });
      const impulse = c.createBuffer(2, rate, rate);
      for (let ch = 0; ch < 2; ch++) {
        const samples = impulse.getChannelData(ch);
        for (let i = 0; i < samples.length; i++) {
          samples[i] = Math.sin(i * (13 + ch)) * Math.exp(-i / 8000);
        }
      }
      const reverb = new ConvolverNode(c, { buffer: impulse });
      const send = new GainNode(c, { gain: p.mixer.master.rev });
      const limiter = new MasterLimiter(c, p.mixer.master, false);
      sum.connect(gain);
      gain.connect(limiter.node);
      limiter.node.connect(c.destination);
      reverb.connect(send);
      send.connect(sum);
      const graph = new MixerAudio(c, sum, reverb, false);
      graph.configure(p.mixer);
      for (const inst of p.instruments) {
        const probe = c.createBuffer(2, 6000, rate);
        for (let ch = 0; ch < 2; ch++) {
          const samples = probe.getChannelData(ch);
          for (let i = 0; i < samples.length; i++) {
            const envelope = Math.min(1, i / 144, (samples.length - i) / 720);
            samples[i] =
              2 *
              inst.params.gain *
              envelope *
              Math.sin((2 * Math.PI * (440 + 110 * ch) * i) / rate);
          }
        }
        const source = new AudioBufferSourceNode(c, { buffer: probe });
        source.connect(graph.voiceInput(inst.id));
        source.start();
      }
      try {
        const rendered = await c.startRendering(),
          trimmed = new AudioBuffer({
            numberOfChannels: 2,
            length: frames,
            sampleRate: rate,
          });
        if (limiter.error) {
          throw limiter.error;
        }
        for (let ch = 0; ch < 2; ch++) {
          trimmed.copyToChannel(
            rendered.getChannelData(ch).subarray(latency),
            ch,
          );
        }
        return trimmed;
      } finally {
        graph.dispose();
        limiter.dispose();
      }
    };
    const bounce = async (p, from = 0, to = 4, seconds = 1.2) => {
      const random = Math.random;
      let seed = 12345;
      Math.random = () => {
        seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
        return seed / 4294967296;
      };
      try {
        return await engine.renderOffline(
          seconds,
          48000,
          () => scheduleRange(p, from, to),
          {
            mixer: p.mixer,
            instrumentIds: p.instruments.map((inst) => inst.id),
            master: { vol: 0.8, rev: 0.18, tilt: 0 },
          },
        );
      } finally {
        Math.random = random;
      }
    };
    const p = newEmptyProject(),
      id = p.instruments[0].id;
    p.bpm = 120;
    p.instruments[0].params = {
      ...DEFAULT_PARAMS,
      tone: 1,
      q: 12,
      partials: [
        { ratio: 1, level: 1 },
        { ratio: 2, level: 0.4 },
      ],
      att: 0.003,
      dec: 0.03,
      sus: 0.8,
      rel: 0.03,
      gain: 3,
      pan: 0,
      voices: 1,
      vib: 0,
    };
    p.patterns[0].steps = 4;
    p.patterns[0].tracks[id] = ["C5", "E5", "G5"].map((pitch) => ({
      pitch,
      start: 0,
      len: 1,
      vel: 1,
    }));
    p.arrangement[0].len = 4;
    p.mixer.master = { ...p.mixer.master, limiter: false, vol: 1, rev: 0 };
    p.mixer.channels[id].reverb = 0;
    const dry = await rawBounce(p),
      dryLevel = measure(dry);
    check(dryLevel.peak > 0.01, "dry audio must be audible");
    check(
      dryLevel.frames === 57600,
      "limiter delay must be trimmed to requested length",
    );
    for (let repeat = 0; repeat < 5; repeat++) {
      const again = measure(await rawBounce(p));
      check(
        Math.abs(again.peak - dryLevel.peak) < 1e-5,
        `repeated probe renders must agree: ${JSON.stringify({ dryLevel, again })}`,
      );
    }
    const half = clone(p);
    half.mixer.channels[id].volume = 0.5;
    const halfLevel = measure(await rawBounce(half));
    check(
      Math.abs(halfLevel.peak / dryLevel.peak - 0.5) < 1e-5,
      `channel fader scales actual audio: ${JSON.stringify({
        dryLevel,
        halfLevel,
      })}`,
    );
    const grouped = clone(p),
      group = addMixerBus(grouped.mixer);
    group.volume = 0.5;
    grouped.mixer.channels[id].output = group.id;
    const groupLevel = measure(await rawBounce(grouped));
    check(
      groupLevel.peak / dryLevel.peak > 0.45 &&
        groupLevel.peak / dryLevel.peak < 0.55,
      "group fader scales audio",
    );
    grouped.mixer.channels[id].reverb = 1;
    grouped.mixer.master.rev = 1;
    group.mute = true;
    check(
      measure(await rawBounce(grouped)).peak === 0,
      "group mute cuts dry and wet",
    );
    const solo = clone(p),
      second = clone(p.instruments[0]);
    second.id = crypto.randomUUID();
    second.params.gain = 20;
    solo.instruments.push(second);
    solo.mixer = createMixer(
      solo.instruments.map((inst) => inst.id),
      false,
    );
    solo.mixer.master.vol = 1;
    solo.mixer.master.rev = 0;
    solo.mixer.channels[id].solo = true;
    solo.patterns[0].tracks[second.id] = clone(p.patterns[0].tracks[id]);
    const soloLevel = measure(await rawBounce(solo));
    check(
      Math.abs(soloLevel.peak / dryLevel.peak - 1) < 1e-5,
      `solo excludes unrelated instrument: ${JSON.stringify({
        dryLevel,
        soloLevel,
      })}`,
    );
    const echoSong = clone(p),
      echo = addMixerBus(echoSong.mixer, "delay");
    echo.delayTime = 0.25;
    echo.feedback = 0.4;
    echoSong.mixer.channels[id].sends = [{ busId: echo.id, level: 0.4 }];
    const wet = await rawBounce(echoSong);
    check(
      measure(wet, 0.5).rms > measure(dry, 0.5).rms + 0.001,
      "echo actually rings after dry note",
    );
    const hot = clone(echoSong);
    hot.mixer.master = {
      ...hot.mixer.master,
      limiter: true,
      driveDb: 18,
      ceilingDb: -3,
      rev: 1,
    };
    hot.mixer.channels[id].reverb = 1;
    const limited = measure(await rawBounce(hot));
    check(
      limited.peak > 0.5 && limited.peak <= 10 ** (-3 / 20) + 1e-6,
      "final limiter catches dry + wet overload",
    );
    const synthLimited = measure(await bounce(hot));
    check(
      synthLimited.peak > 0.5 && synthLimited.peak <= 10 ** (-3 / 20) + 1e-6,
      "engine overload respects the same final ceiling",
    );
    const saved = { ...engine.master };
    try {
      await engine.renderOffline(0.1, 48000, () => {
        throw new Error("test scheduling failure");
      });
    } catch (error) {
      check(
        error.message === "test scheduling failure",
        "expected scheduling rejection",
      );
    }
    check(
      !engine.isRendering() &&
        JSON.stringify(saved) === JSON.stringify(engine.master),
      "failed export restores live state",
    );
    const demos = [];
    for (const [song, from, to] of [
      ["monsoon", 804, 820],
      ["winter", 1760, 1776],
      ["pocket", 128, 144],
    ]) {
      const demo = buildDemoProject(song);
      const seconds = ((to - from) * 60) / demo.bpm / 4 + 2;
      const level = measure(await bounce(demo, from, to, seconds));
      check(level.peak > 0.005, `${song} must be audible`);
      check(
        level.peak <= 10 ** (-1 / 20) + 1e-6,
        `${song} exceeds limiter ceiling`,
      );
      demos.push({
        song,
        peakDb: 20 * Math.log10(level.peak),
        rmsDb: 20 * Math.log10(level.rms),
      });
    }
    return {
      dry: dryLevel,
      half: halfLevel,
      group: groupLevel,
      limiterPeakDb: 20 * Math.log10(limited.peak),
      demos,
    };
  });
  await page.evaluate(async () => {
    const { newEmptyProject, project, selPatId, selInstId } =
      await import("/src/lib/project.ts");
    const p = newEmptyProject();
    p.patterns[0].tracks[p.instruments[0].id] = [
      { pitch: "C5", start: 0, len: 16 },
    ];
    project.set(p);
    selPatId.set(p.patterns[0].id);
    selInstId.set(p.instruments[0].id);
  });
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
  const meters = await page.evaluate(async () =>
    (await import("/src/lib/engine.ts")).mixerMeters(),
  );
  assert.ok(
    meters.master.peak.some((value) => value > 0),
    "live master meter responds after offline rendering",
  );
  assert.ok(
    Object.values(meters.channels).some((channel) => channel.peak > 0),
    "live channel meter responds",
  );
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Stop", exact: true }).click();
  await page.evaluate(async () =>
    (await import("/src/lib/project.ts")).loadDemoProject("monsoon"),
  );
  await page.getByRole("button", { name: "Mixer", exact: true }).click();
  if (process.argv.includes("--screenshot")) {
    await page.screenshot({ path: join(root, "mixer-check.png") });
  }
  assert.deepEqual(errors, [], "browser runtime errors");
  console.log(
    JSON.stringify(
      {
        browser: browser.version(),
        ui: "routing, mute, delete and live meters passed",
        audio: result,
      },
      null,
      2,
    ),
  );
} finally {
  await browser?.close();
  await server.close();
}
