import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const colorPicker = readFileSync(
  fileURLToPath(new URL("./ColorPicker.svelte", import.meta.url)),
  "utf8",
);

describe("ColorPicker accessibility", () => {
  it("gives every preset swatch a name and selected state", () => {
    expect(colorPicker).toContain("aria-label={`Select ${c} color`}");
    expect(colorPicker).toContain("aria-pressed={value === c}");
    expect(colorPicker).toContain('type="button"');
  });
});
