import { describe, expect, it } from "vitest";

import { createAudioRandom } from "./audio-random";

describe("audio random source", () => {
  it("replays the same audio variation sequence for independently built graphs", () => {
    const first = createAudioRandom();
    const second = createAudioRandom();

    expect(Array.from({ length: 8 }, first)).toEqual(
      Array.from({ length: 8 }, second),
    );
  });
});
