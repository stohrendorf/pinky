import type { MixerBus } from "./mixer";
import type { Project } from "./types";

import { createMixer, defaultChannel } from "./mixer";

/** Production choices only: never rewrite the score, patches or automation. */
export function mixDemo(
  p: Project,
  profile: "monsoon" | "winter" | "pocket",
): Project {
  const mixer = createMixer(p.instruments.map((inst) => inst.id));
  const family = { monsoon: "0001", winter: "0002", pocket: "0003" }[profile];
  const group = (
    name: string,
    effect: MixerBus["effect"] = "none",
  ): MixerBus => {
    const bus: MixerBus = {
      ...defaultChannel(),
      id: `47e4ac00-${family}-4a13-9281-${String(mixer.buses.length + 1).padStart(12, "0")}`,
      name,
      reverb: 0,
      effect,
      delayTime: (60 / p.bpm) * 0.75,
      feedback: 0.25,
    };
    mixer.buses.push(bus);
    return bus;
  };
  // The existing master lanes still shape the piece; these are the manual
  // values restored on Stop. No extra loudness drive or flattened crescendos.
  for (const param of ["vol", "rev", "tilt"] as const) {
    const first = p.automation?.find(
      (lane) => lane.target === "master" && lane.param === param,
    )?.points[0];
    if (first) {
      mixer.master[param] = first.value;
    }
  }

  if (profile === "monsoon") {
    const drums = group("Taiko & hand drums"),
      bronze = group("Bronze ensemble");
    const voices = group("Breath & voice"),
      weather = group("Weather");
    const plucks = group("Kora & handpan"),
      echo = group("Temple echo", "delay");
    echo.highpass = 350;
    echo.tilt = -3;
    echo.pan = -0.25;
    echo.reverb = 0.35;
    weather.highpass = 45;
    for (const inst of p.instruments) {
      const strip = mixer.channels[inst.id],
        name = inst.name;
      strip.reverb = 0.75;
      if (name.startsWith("Drums/") || name.endsWith("Ceng-ceng")) {
        strip.output = drums.id;
        strip.reverb = name.endsWith("Odaiko") ? 0.12 : 0.3;
      } else if (name.startsWith("Bass/")) {
        strip.reverb = 0;
      } else if (name.startsWith("FX/")) {
        strip.output = weather.id;
        strip.reverb = name.includes("Thunder") ? 0.15 : 0.55;
      } else if (name.startsWith("Winds/") || name.startsWith("Vocals/")) {
        strip.output = voices.id;
        strip.reverb = name.startsWith("Vocals/") ? 0.6 : 1;
      } else if (name.endsWith("Kora") || name.endsWith("Handpan")) {
        strip.output = plucks.id;
        strip.reverb = 0.7;
        strip.sends = [
          { busId: echo.id, level: name.endsWith("Kora") ? 0.08 : 0.06 },
        ];
      } else {
        strip.output = bronze.id;
        strip.reverb = name.endsWith("Gong Ageng") ? 0.5 : 0.9;
      }
    }
  } else if (profile === "winter") {
    const strings = group("Ripieno strings"),
      continuo = group("Continuo"),
      winds = group("Venti");
    winds.highpass = 80;
    for (const inst of p.instruments) {
      const strip = mixer.channels[inst.id];
      if (inst.name.endsWith("Solo Violin")) {
        strip.reverb = 0.65;
      } else if (inst.name.includes("/Venti/")) {
        strip.output = winds.id;
        strip.reverb = 0.75;
      } else if (
        inst.name.endsWith("Violone") ||
        inst.name.endsWith("Harpsichord") ||
        inst.name.endsWith("Violoncelli")
      ) {
        strip.output = continuo.id;
        strip.reverb = inst.name.endsWith("Violone") ? 0.15 : 0.5;
      } else {
        strip.output = strings.id;
        strip.reverb = inst.name.endsWith("pizz.") ? 0.55 : 1;
      }
    }
  } else {
    const drums = group("Pocket drums"),
      harmony = group("Keys & guitar"),
      echo = group("Slap echo", "delay");
    drums.compressor = { enabled: true, threshold: -10, ratio: 1.5 };
    echo.delayTime = 0.11;
    echo.feedback = 0.15;
    echo.highpass = 450;
    echo.tilt = -4;
    for (const inst of p.instruments) {
      const strip = mixer.channels[inst.id];
      strip.reverb = 0.7;
      if (inst.name.startsWith("Drums/")) {
        strip.output = drums.id;
        strip.reverb = inst.name.includes("Kick") ? 0.05 : 0.25;
      } else if (inst.name.startsWith("Bass/")) {
        strip.reverb = 0;
      } else {
        strip.output = harmony.id;
        if (inst.name.startsWith("Keys/") || inst.name.startsWith("Guitar/")) {
          strip.sends = [{ busId: echo.id, level: 0.07 }];
        }
      }
    }
  }
  p.mixer = mixer;
  return p;
}
