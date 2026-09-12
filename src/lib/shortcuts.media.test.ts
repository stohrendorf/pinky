import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const shortcuts = readFileSync(
  fileURLToPath(new URL("./shortcuts.ts", import.meta.url)),
  "utf8",
);

describe("multimedia shortcuts", () => {
  it("maps the standard media keys to transport actions", () => {
    expect(shortcuts).toMatch(
      /e\.key === "MediaPlayPause" \|\| e\.key === "MediaPlay"/,
    );
    expect(shortcuts).toContain("togglePlay(e.shiftKey);");
    expect(shortcuts).toMatch(
      /e\.key === "MediaTrackNext"[\s\S]*playPattern\(\);/,
    );
    expect(shortcuts).toMatch(
      /e\.key === "MediaTrackPrevious"[\s\S]*seekSong\(0\);/,
    );
    expect(shortcuts).toMatch(
      /e\.key === "MediaStop"[\s\S]*stopTransport\(\);/,
    );
  });

  it("handles media keys before the focused-input guard", () => {
    const mediaHandler = shortcuts.indexOf('if (e.key === "MediaPlayPause"');
    const focusedInputGuard = shortcuts.indexOf(
      "const t = e.target as HTMLElement | null;",
    );
    expect(mediaHandler).toBeGreaterThan(-1);
    expect(mediaHandler).toBeLessThan(focusedInputGuard);
  });
});
