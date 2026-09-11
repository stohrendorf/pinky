import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const palette = readFileSync(
  fileURLToPath(new URL("./app.css", import.meta.url)),
  "utf8",
);
const sequencer = readFileSync(
  fileURLToPath(new URL("./components/Sequencer.svelte", import.meta.url)),
  "utf8",
);

describe("shared UI palette", () => {
  it("defines semantic tokens for editor-specific visual states", () => {
    expect(palette).toContain("--color-canvas-deep:");
    expect(palette).toContain("--color-text-subtle:");
    expect(palette).toContain("--color-text-faint:");
    expect(palette).toContain("--color-error:");
    expect(palette).toContain("--color-playhead:");
  });

  it("keeps piano-roll styling on semantic palette tokens", () => {
    expect(sequencer).not.toContain("#1b1b2b");
    expect(sequencer).not.toContain("#24243a");
    expect(sequencer).not.toContain("#202032");
    expect(sequencer).not.toContain("#151525");
    expect(sequencer).toContain("var(--color-surface-input)");
    expect(sequencer).toContain("var(--color-accent-selection)");
  });

  it("applies the shared scrollbar theme in both standard and WebKit browsers", () => {
    expect(palette).toContain(
      "scrollbar-color: var(--color-border) var(--color-surface-deep);",
    );
    expect(palette).toContain("scrollbar-width: thin;");
    expect(palette).toContain("*::-webkit-scrollbar-thumb");
    expect(palette).toContain("border-radius: 999px;");
    expect(palette).toContain("background: var(--color-border);");
  });
});
