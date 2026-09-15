import { fireEvent, render, screen } from "@testing-library/svelte";
import { describe, expect, it, vi } from "vitest";

import IconButton from "./IconButton.svelte";

describe("IconButton", () => {
  it("renders compact outlined actions with accessible state", async () => {
    const onclick = vi.fn();
    render(IconButton, {
      props: {
        ariaControls: "panel",
        ariaLabel: "Add instrument",
        icon: "fa-plus",
        onclick,
        pressed: true,
        size: "compact",
        variant: "outline",
      },
    });

    const button = screen.getByRole("button", { name: "Add instrument" });
    expect(button.className).toContain("icon-btn");
    expect(button.className).toContain("compact");
    expect(button.className).toContain("outline");
    expect(button.getAttribute("aria-controls")).toBe("panel");
    expect(button.getAttribute("aria-pressed")).toBe("true");

    await fireEvent.click(button);
    expect(onclick).toHaveBeenCalledOnce();
  });
});
