import { fireEvent, render, screen } from "@testing-library/svelte";
import { describe, expect, it, vi } from "vitest";

import ColorPicker from "./ColorPicker.svelte";

describe("ColorPicker accessibility", () => {
  it("names preset swatches and updates the selected color", async () => {
    const onchange = vi.fn();
    render(ColorPicker, { value: "#53d8fb", onchange });

    const selected = screen.getByRole("button", {
      name: "Select #53d8fb color",
    });
    const alternative = screen.getByRole("button", {
      name: "Select #ff9f43 color",
    });

    expect(selected.getAttribute("aria-pressed")).toBe("true");
    expect(alternative.getAttribute("aria-pressed")).toBe("false");
    expect(alternative.getAttribute("type")).toBe("button");

    await fireEvent.click(alternative);

    expect(onchange).toHaveBeenCalledWith("#ff9f43");
    expect(selected.getAttribute("aria-pressed")).toBe("false");
    expect(alternative.getAttribute("aria-pressed")).toBe("true");
  });
});
