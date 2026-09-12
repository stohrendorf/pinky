import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const scope = readFileSync(
  fileURLToPath(new URL("./Scope.svelte", import.meta.url)),
  "utf8",
);
const engine = readFileSync(
  fileURLToPath(new URL("../lib/engine.ts", import.meta.url)),
  "utf8",
);

describe("Scope frequency sampling", () => {
  it("retains live narrow-band centers and renders the nearest FFT bin", () => {
    expect(scope).toContain(
      "quadraticFrequencySamples(CURVE_PTS, nyq * 0.5, 1, anchors)",
    );
    expect(scope).toContain(
      "Math.round(Math.pow(i / bars, 2) * fft.length * 0.5)",
    );
  });

  it("uses an FFT resolution that can distinguish low resonances", () => {
    expect(engine).toContain("export const SCOPE_FFT_SIZE = 8192;");
    expect(engine).toContain("fftSize: SCOPE_FFT_SIZE");
    expect(engine).toContain("smoothingTimeConstant: 0");
  });

  it("uses the FFT window's midpoint when reading scheduled voice state", () => {
    expect(scope).toContain("activeVoiceBands(analyser.fftSize / (2 * fs))");
    expect(engine).toContain("analyserWindowSeconds = 0");
  });

  it("includes the direct mixer high-pass, tilt, and fader path in the prediction", () => {
    expect(scope).toContain("function directMixerTerms(");
    expect(scope).toContain("highpassTerms(out, n, strip.highpass, fs)");
    expect(scope).toContain("gain *= strip.volume");
    expect(scope).toContain("mixerPower *= termsAt(ch.mixerTerms, k, cw, c2w)");
  });

  it("uses the engine pink-noise source response instead of an idealized 1/f approximation", () => {
    expect(scope).toContain("pinkNoisePower(f, fs)");
    expect(scope).not.toContain("1000 / Math.max(20, f)");
  });

  it("reuses the response calculation for the dots", () => {
    expect(scope).toMatch(
      /const spectrumPower\s*=\s*\(\s*cw:\s*number,\s*sw:\s*number,\s*c2w:\s*number,\s*s2w:\s*number,?\s*\)\s*:\s*number\s*=>/,
    );
    expect(scope).toMatch(
      /const pow\s*=\s*spectrumPower\(cw, sw, c2w, s2w\)\s*\*\s*pinkNoisePower\(f, fs\)\s*\*\s*gMaster/,
    );
  });

  it("keeps every authored voice band and sums the shared noise source coherently", () => {
    expect(scope).toContain("const MAX_BANDS = 32;");
    expect(scope).toContain("const scale = level * Math.sqrt(mixerPower);");
    expect(scope).toContain("real += scale * response[0];");
    expect(scope).toContain("imaginary += scale * response[1];");
    expect(scope).toContain("return real * real + imaginary * imaginary;");
  });

  it("selects exact narrow-band anchors by audible weight", () => {
    expect(scope).toContain("const anchorCandidates:");
    expect(scope).toContain(
      "weight: voice.level * voice.env * Math.pow(10, band.gain / 40),",
    );
    expect(scope).toContain(".sort((a, b) => b.weight - a.weight)");
  });

  it("evaluates each filter before chaining it so very low notes cannot underflow", () => {
    expect(scope).toContain(
      "const filterReal = (br * ar + bi * ai) / denominator;",
    );
    expect(scope).toContain("real -= 1;");
  });

  it("uses the normalized high-pass denominator in the direct mixer model", () => {
    expect(scope).toContain("(2 * a1 * (a0 + a2)) / (a0 * a0)");
  });
});
