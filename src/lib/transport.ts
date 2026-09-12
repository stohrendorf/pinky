// Transport — sequencing driven by the sample-accurate AudioWorklet clock
import { get } from "svelte/store";

import type { TimingMap } from "./timing";
import type { Instrument, InstrumentParams, Pattern, Project } from "./types";

import {
  instrumentOverrides,
  masterAutomation,
  mixerAutomation,
} from "./automation";
import * as eng from "./engine";
import { isLegatoTarget, legatoTransition } from "./legato";
import { STEPS, transposePitch } from "./notes";
import {
  curStep,
  playing,
  playMode,
  project,
  selPatId,
  songCursor,
  songLabel,
  songPos,
} from "./project";
import { barAt, createTimingMap } from "./timing";

let step = 0;
let songMode = false;
let playPatId: string | null = null;

/* ---- lookahead scheduling ----
 * The audio clock is a plain ~20 ms pulse; every pulse we queue every step that
 * starts inside the next LOOKAHEAD seconds. A main-thread hiccup (GC, layout,
 * a dialog opening) shorter than the window therefore can't produce a gap —
 * with the old "one worklet tick per 16th" design every hiccup was audible.
 * The window is kept short on purpose: a voice's nodes start running the moment
 * they are connected, so scheduling further ahead literally means more of the
 * graph running before it is even heard. At 110 BPM 250 ms meant two whole
 * 16ths of not-yet-audible voices carried along in the dense sections; 150 ms
 * is still seven clock pulses of hiccup tolerance and cuts that overhead. */
const LOOKAHEAD = 0.15;
let nextStepTime = 0; // audio time of `step`
let endTime: number | null = null; // audio time the song is over (song mode)

/* The playhead is UI, not timing: updating a store inside the scheduling path
 * would put a Svelte re-render (and its layout) right in the middle of it.
 * Scheduled steps are parked here and published from a rAF loop once the audio
 * has actually reached them — which also makes the playhead show what you hear
 * instead of what is queued. */
const uiQueue: { step: number; time: number }[] = [];
let uiRaf = 0;
let uiStep = -1;

const stepDur = (): number => {
  const p = get(project);
  return 60 / (p?.bpm || 112) / 4;
};

let timingKey = "";
let songTiming = createTimingMap({ bpm: 112 });

function timingFor(p: Project): TimingMap {
  const key = JSON.stringify([p.bpm, p.conductor?.tempos]);
  if (timingKey !== key) {
    timingKey = key;
    songTiming = createTimingMap(p);
  }
  return songTiming;
}

// Mute/solo: a muted instrument is never scheduled, and as soon as anything is
// soloed everything that isn't soloed goes quiet (same rule for arranger lanes).
function audibleInstruments(instruments: Instrument[]): Instrument[] {
  const anySolo = instruments.some((i) => i.solo);
  return instruments.filter((i) => !i.mute && (!anySolo || i.solo));
}

function noteOnForClip(
  inst: Instrument,
  pitch: string,
  time: number,
  params: InstrumentParams,
  velocity: number,
  voiceScope: string | null,
  pitchMultiplier: number,
): void {
  if (pitchMultiplier !== 1) {
    eng.noteOnAt(
      inst.id,
      pitch,
      time,
      params,
      velocity,
      voiceScope ?? undefined,
      pitchMultiplier,
    );
  } else if (voiceScope) {
    eng.noteOnAt(inst.id, pitch, time, params, velocity, voiceScope);
  } else {
    eng.noteOnAt(inst.id, pitch, time, params, velocity);
  }
}

function glideForClip(
  inst: Instrument,
  from: string,
  to: string,
  time: number,
  duration: number,
  curve: InstrumentParams["legatoCurve"],
  voiceScope: string | null,
  pitchMultiplier: number,
): void {
  if (pitchMultiplier !== 1) {
    eng.glideAt(
      inst.id,
      from,
      to,
      time,
      duration,
      curve,
      voiceScope ?? undefined,
      pitchMultiplier,
    );
  } else if (voiceScope) {
    eng.glideAt(inst.id, from, to, time, duration, curve, voiceScope);
  } else {
    eng.glideAt(inst.id, from, to, time, duration, curve);
  }
}

// `transpose` = the clip's semitone shift (one number instead of a duplicated
// pattern for "the same hook a fourth up"); `pitchMultiplier` then applies an
// optional exact harmonic ratio. `over` = automated params for this step (a
// patched copy of the instrument's params).
export function schedulePatternNotes(
  pat: Pattern,
  patStep: number,
  time: number,
  dur: number,
  instruments: Instrument[],
  transpose = 0,
  over: Map<string, InstrumentParams> | null = null,
  elapsed: (steps: number) => number = (steps) => steps * dur,
  voiceScope: string | null = null,
  gain = 1,
  clipStepsRemaining = Infinity,
  pitchMultiplier = 1,
): void {
  const ratio =
    Number.isFinite(pitchMultiplier) && pitchMultiplier > 0
      ? pitchMultiplier
      : 1;
  instruments.forEach((inst) => {
    const notes = pat.tracks[inst.id];
    if (!notes) {
      return;
    }
    const params = over?.get(inst.id) || inst.params;
    notes.forEach((n) => {
      if (n.start === patStep) {
        const pitch = transpose ? transposePitch(n.pitch, transpose) : n.pitch;
        if (!pitch) {
          return;
        } // shifted out of the note range
        const incoming = notes.some(
          (source) =>
            source.legatoTo?.start === n.start &&
            source.legatoTo.pitch === n.pitch &&
            isLegatoTarget(source, n.start) &&
            (!transpose || !!transposePitch(source.pitch, transpose)),
        );
        const target = notes.find(
          (candidate) =>
            candidate.start === n.legatoTo?.start &&
            candidate.pitch === n.legatoTo?.pitch,
        );
        const targetPitch =
          target &&
          isLegatoTarget(n, target.start) &&
          target.start - n.start < clipStepsRemaining
            ? transpose
              ? transposePitch(target.pitch, transpose)
              : target.pitch
            : null;

        if (!incoming) {
          const velocity = (n.vel ?? 1) * Math.max(0, Math.min(1, gain));
          noteOnForClip(inst, pitch, time, params, velocity, voiceScope, ratio);
        }
        if (target && targetPitch) {
          const glide = legatoTransition(
            n,
            target.start,
            dur,
            params.legatoCurve,
          );
          const glideTime = Math.max(
            0.005,
            elapsed(target.start - n.start) - elapsed(n.len),
          );
          glideForClip(
            inst,
            pitch,
            targetPitch,
            time + elapsed(n.len),
            glideTime,
            glide.curve,
            voiceScope,
            ratio,
          );
          return;
        }
        // A terminal linked note owns the release for the complete
        // chain. An adjacent jump to a different pitch must also hold to
        // the boundary, otherwise its early release creates an audible gap.
        // Other ordinary notes retain the slightly early release that
        // prevents stacked same-pitch notes from clicking together.
        const jumpsToNextPitch = notes.some(
          (candidate) =>
            candidate.start === n.start + n.len && candidate.pitch !== n.pitch,
        );
        const releaseSteps =
          n.len > clipStepsRemaining
            ? clipStepsRemaining
            : n.len * (incoming || jumpsToNextPitch ? 1 : 0.9);
        const offAt = time + elapsed(releaseSteps);
        if (voiceScope) {
          eng.noteOffAt(inst.id, pitch, offAt, voiceScope);
        } else {
          eng.noteOffAt(inst.id, pitch, offAt);
        }
      }
    });
  });
}

// Master-FX automation: ramp towards the lane value over roughly one step, so a
// drawn curve comes out as a sweep instead of a staircase.
function playMasterAutomation(
  p: Project,
  step: number,
  time: number,
  dur: number,
): void {
  masterAutomation(p, step).forEach((m) =>
    eng.automateMaster(m.param, m.value, time, dur / 3),
  );
}

function playMixerAutomation(
  p: Project,
  step: number,
  time: number,
  dur: number,
): void {
  mixerAutomation(p, step).forEach((m) =>
    eng.automateMixer(m.target.id, m.param, m.value, time, dur / 3),
  );
}

// Instrument automation: the notes starting on this step are played with the
// patched params (`over`), and everything of that instrument that is *already*
// sounding is re-tuned to the same values — otherwise a sweep under a held pad
// chord would be inaudible until the next note.
function playInstrumentAutomation(
  over: Map<string, InstrumentParams> | null,
  time: number,
  dur: number,
): void {
  over?.forEach((params, id) =>
    eng.automateInstrument(id, params, time, dur / 3),
  );
}

// Song length in steps (the arranger's right edge)
export function songLengthSteps(p: Project): number {
  return Math.max(0, ...p.arrangement.map((c) => c.start + c.len));
}

// One 16th step, scheduled to sound at `at` (absolute audio time)
function scheduleStep(
  p: Project,
  s: number,
  at: number,
  dur: number,
  insts: Instrument[],
): void {
  if (songMode) {
    scheduleSongStep(p, s, at, dur, insts, timingFor(p));
  } else {
    const pat = p.patterns.find((pt) => pt.id === playPatId) || p.patterns[0];
    const patSteps = pat.steps || STEPS;
    schedulePatternNotes(pat, s % patSteps, at, dur, insts);
  }
}

function scheduleSongStep(
  p: Project,
  s: number,
  at: number,
  dur: number,
  insts: Instrument[],
  timing: TimingMap,
): void {
  const over = instrumentOverrides(p, s);
  playMasterAutomation(p, s, at, dur);
  playMixerAutomation(p, s, at, dur);
  playInstrumentAutomation(over, at, dur);
  const anyLaneSolo = p.tracks.some((t) => t.solo);
  const position = s + swingOffset(p, s);
  const elapsed = (steps: number) =>
    timing.secondsBetween(position, position + steps);
  p.arrangement.forEach((clip) => {
    const lane = p.tracks[clip.track];
    if (lane && (lane.mute || (anyLaneSolo && !lane.solo))) {
      return;
    }
    const relStep = s - clip.start;
    if (relStep >= 0 && relStep < clip.len) {
      const pat = p.patterns.find((pt) => pt.id === clip.patternId);
      if (!pat) {
        return;
      }
      const patSteps = pat.steps || STEPS;
      schedulePatternNotes(
        pat,
        relStep % patSteps,
        at,
        dur,
        insts,
        clip.transpose ?? 0,
        over,
        elapsed,
        `${clip.id}:${Math.floor(relStep / patSteps)}`,
        clip.gain ?? 1,
        clip.len - relStep,
        clip.partial ?? 1,
      );
    }
  });
}

const swingOffset = (p: Project, s: number): number =>
  s % 2 === 1 ? Math.max(0, Math.min(1, p.swing || 0)) / 3 : 0;

// Called on every clock pulse: queue everything that starts within the window.
function pump(now: number): void {
  const p = get(project);
  if (!p) {
    return;
  }
  if (endTime !== null && now >= endTime) {
    // backstop: rAF is frozen in a background tab
    stopTransport();
    songLabel.set("Song finished");
    return;
  }
  const timing = timingFor(p);
  const insts = audibleInstruments(p.instruments);
  // Swing/shuffle: every 2nd 16th is pushed late (`swing` 1 = a triplet, 2:1
  // feel). Applied to the scheduled note times — the grid itself stays
  // rock-steady, so the groove is sample-accurate.
  const maxSteps = songMode ? songLengthSteps(p) : 0;
  const horizon = now + LOOKAHEAD;
  let guard = 256; // never spin, whatever the tempo/BPM edit does

  while (endTime === null && nextStepTime < horizon && guard-- > 0) {
    // fell behind (tab was frozen, tempo raised): re-anchor instead of
    // dumping a burst of steps at once
    if (nextStepTime < now) {
      nextStepTime = now;
    }
    const dur = songMode ? timing.secondsBetween(step, step + 1) : stepDur();
    const offset = swingOffset(p, step);
    const at =
      nextStepTime +
      (songMode ? timing.secondsBetween(step, step + offset) : offset * dur);
    scheduleStep(p, step, at, dur, insts);
    uiQueue.push({ step, time: at + eng.outputLatency() });

    nextStepTime += dur;
    step++;
    if (songMode) {
      const lp = p.loop;
      if (lp && lp.end > lp.start && step >= lp.end && step - 1 < lp.end) {
        step = Math.max(0, Math.round(lp.start));
      } else if (maxSteps > 0 && step >= maxSteps) {
        endTime = nextStepTime + eng.outputLatency(); // let the last step reach the output
      }
    }
  }
}

/* Playhead + end-of-song, driven by the audio clock but rendered on a frame
 * boundary — deliberately outside the scheduling path. */
function uiFrame(): void {
  uiRaf = requestAnimationFrame(uiFrame);
  const now = eng.audioTime();
  let s = -1;
  while (uiQueue.length && uiQueue[0].time <= now) {
    s = uiQueue.shift()!.step;
  }
  if (s >= 0 && s !== uiStep) {
    uiStep = s;
    curStep.set(s);
    const p = get(project);
    if (songMode && p) {
      const pos = barAt(p, s);
      const name = p.conductor?.sections.findLast(
        (marker) => marker.step <= s,
      )?.name;
      songLabel.set(
        `${name ? name + " · " : ""}${pos.bar}:${pos.beat} · ${timingFor(p).bpmAt(s).toFixed(1)} BPM`,
      );
    }
  }
  if (endTime !== null && now >= endTime) {
    stopTransport();
    songLabel.set("Song finished");
  }
}

function startTransport(startStep = 0): void {
  step = startStep;
  uiStep = -1;
  endTime = null;
  uiQueue.length = 0;
  nextStepTime = eng.audioTime() + 0.06; // a beat of headroom for the first step
  playing.set(true);
  eng.setTickHandler(pump);
  eng.clockStart();
  if (!uiRaf) {
    uiRaf = requestAnimationFrame(uiFrame);
  }
}

export function stopTransport(): void {
  playing.set(false);
  playMode.set("");
  songMode = false;
  endTime = null;
  uiQueue.length = 0;
  if (uiRaf) {
    cancelAnimationFrame(uiRaf);
    uiRaf = 0;
  }
  eng.clockStop();
  eng.resetMaster(); // undo whatever the automation lanes did to the master FX
  eng.resetMixer();
  curStep.set(-1);
  songPos.set(-1);
  songLabel.set("");
  eng.allNotesOff();
}

export async function playPattern(): Promise<void> {
  if (eng.isRendering()) {
    return;
  }
  await eng.ensureAudio();
  if (eng.isRendering()) {
    return;
  }
  const p = get(project);
  if (!p) {
    return;
  }
  if (get(playing)) {
    stopTransport();
  }
  eng.configureMixer(
    p.mixer,
    p.instruments.map((inst) => inst.id),
  );
  playPatId = get(selPatId);
  playMode.set("pattern");
  startTransport();
}

/* ---- song mode ---- */
export async function playSong(): Promise<void> {
  if (eng.isRendering()) {
    return;
  }
  const p = get(project);
  if (!p || !p.arrangement.length) {
    return;
  }
  await eng.ensureAudio();
  if (eng.isRendering()) {
    return;
  }
  if (get(playing)) {
    stopTransport();
  }
  eng.configureMixer(
    p.mixer,
    p.instruments.map((inst) => inst.id),
  );
  songMode = true;
  playMode.set("song");
  songPos.set(0);
  songLabel.set("Playing song");
  // start at the playback cursor; if a loop is set and the cursor is outside
  // of it, start at the loop instead
  const lp = p.loop;
  const cursor = Math.max(0, Math.round(get(songCursor)));
  let start =
    lp && lp.end > lp.start && (cursor < lp.start || cursor >= lp.end)
      ? Math.max(0, Math.round(lp.start))
      : cursor;
  if (start >= songLengthSteps(p)) {
    // stranded past the end (e.g. shorter song) → restart
    start = 0;
    songCursor.set(0);
  }
  startTransport(start);
}

/* ---- offline bounce ----
 * Schedules the whole song (or a step range) into the future of whatever
 * context the engine is currently feeding — that's an OfflineAudioContext
 * during a WAV render, where `audioTime()` is 0, so `time` doubles as the
 * note-off lead. Returns the length of the scheduled range in seconds. */
export function scheduleRange(p: Project, from: number, to: number): number {
  const range = rangeScheduler(p, from, to);
  for (let s = from; s < to; s++) {
    range.schedule(s);
  }
  return range.seconds;
}

function rangeScheduler(p: Project, from: number, to: number) {
  eng.configureMixer(
    p.mixer,
    p.instruments.map((inst) => inst.id),
  );
  const timing = createTimingMap(p),
    insts = audibleInstruments(p.instruments);
  return {
    seconds: Math.max(0, timing.secondsBetween(from, to)),
    schedule(s: number): void {
      const time = timing.secondsBetween(from, s + swingOffset(p, s));
      scheduleSongStep(
        p,
        s,
        time,
        timing.secondsBetween(s, s + 1),
        insts,
        timing,
      );
    },
  };
}

/** Same score as scheduleRange, with event-loop checkpoints so a long export
 * can paint progress and stop before allocating the remaining voice graph. */
export async function scheduleRangeAsync(
  p: Project,
  from: number,
  to: number,
  options: {
    signal?: AbortSignal;
    onProgress?: (progress: number) => void;
  } = {},
): Promise<number> {
  const check = () => {
    if (options.signal?.aborted) {
      throw new DOMException("Export cancelled", "AbortError");
    }
  };
  check();
  const range = rangeScheduler(p, from, to);
  options.onProgress?.(0);
  for (let start = from; start < to; start += 32) {
    check();
    const end = Math.min(start + 32, to);
    for (let s = start; s < end; s++) {
      range.schedule(s);
    }
    options.onProgress?.((end - from) / (to - from));
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }
  check();
  return range.seconds;
}

// Place the playback cursor; jumps there live when the song is playing.
export function seekSong(s: number): void {
  const pos = Math.max(0, Math.round(s));
  songCursor.set(pos);
  if (get(playing) && songMode) {
    eng.allNotesOff();
    step = pos;
    // drop the queued window and re-anchor the grid on "now"
    uiQueue.length = 0;
    endTime = null;
    nextStepTime = eng.audioTime() + 0.02;
    uiStep = pos;
    curStep.set(pos);
  }
}
