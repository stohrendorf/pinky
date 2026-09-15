import { fireEvent, render, screen } from "@testing-library/svelte";
import { describe, expect, it, vi } from "vitest";

import Slider from "./Slider.svelte";

describe("Slider", () => {
  it("updates its rendered value for external changes and reports input changes", async () => {
    const onchange = vi.fn();
    const props = {
      label: "Level",
      min: 0,
      max: 1,
      step: 0.01,
      value: 0.25,
      onchange,
    };
    const { rerender } = render(Slider, props);
    const range = screen.getByRole("slider", { name: /level/i });

    expect((range as HTMLInputElement).value).toBe("0.25");
    expect(screen.getByText("0.25")).not.toBeNull();

    rerender({ ...props, value: 0.75 });

    expect((range as HTMLInputElement).value).toBe("0.75");
    expect(screen.getByText("0.75")).not.toBeNull();

    await fireEvent.input(range, { target: { value: "0.5" } });
    expect(onchange).toHaveBeenCalledWith(0.5);
  });
});
