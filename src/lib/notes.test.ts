import { describe, expect, it } from "vitest";

import { noteInfoByName, transposePitch } from "./notes";

describe("extended playback notes", () => {
  it("transposes beyond the visible piano range and resolves its frequency", () => {
    expect(transposePitch("G8", 19)).toBe("D10");
    expect(noteInfoByName("D10")?.freq).toBeCloseTo(9397.27, 2);
  });

  it("continues to reject malformed or unrepresentable note names", () => {
    expect(transposePitch("H9", 1)).toBeNull();
    expect(noteInfoByName("H9")).toBeUndefined();
  });
});
