import { render, screen } from "@testing-library/svelte";
import { describe, expect, it } from "vitest";

import { DEFAULT_PARAMS } from "../lib/instruments";
import FilterPreview from "./FilterPreview.svelte";

describe("FilterPreview", () => {
  it("renders an accessible, dense response curve and redraws it for changed inputs", () => {
    const params = { ...DEFAULT_PARAMS };
    const { rerender } = render(FilterPreview, { note: "C4", params });
    const curve = screen.getByRole("img", { name: "Filter curve for C4" });
    const path = curve.querySelector("path.response");
    const commands = path?.getAttribute("d")?.match(/[ML] /g) ?? [];

    expect(screen.getByLabelText("Filter response preview")).not.toBeNull();
    expect(commands.length).toBeGreaterThan(300);

    const initialPath = path?.getAttribute("d");
    rerender({ note: "A4", params: { ...params, q: 5, tone: 0.25 } });

    const updatedCurve = screen.getByRole("img", {
      name: "Filter curve for A4",
    });
    expect(
      updatedCurve.querySelector("path.response")?.getAttribute("d"),
    ).not.toBe(initialPath);
  });
});
