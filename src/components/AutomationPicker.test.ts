import { cleanup, fireEvent, render, screen } from "@testing-library/svelte";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { Project } from "../lib/types";

import { autoParams } from "../lib/automation";
import { DEFAULT_PARAMS } from "../lib/instruments";
import { createMixer } from "../lib/mixer";
import AutomationPicker from "./AutomationPicker.svelte";

afterEach(cleanup);

function project(automation: Project["automation"] = []): Project {
  const instrument = {
    id: "lead",
    name: "Lead",
    color: "#53d8fb",
    params: { ...DEFAULT_PARAMS },
  };

  return {
    formatVersion: 1,
    instruments: [instrument],
    mixer: createMixer([instrument.id]),
    patterns: [],
    arrangement: [],
    tracks: [],
    automation,
    bpm: 120,
    zoom: { seq: { width: 24, height: 32 }, arr: { width: 24, height: 32 } },
  };
}

describe("automation lane chooser", () => {
  it("switches among accessible instrument, mixer, and global target tabs", async () => {
    render(AutomationPicker, { project: project() });

    const instruments = screen.getByRole("tab", { name: "Instruments" });
    expect(instruments.getAttribute("aria-selected")).toBe("true");
    expect(screen.getByRole("tree", { name: "Instruments" })).not.toBeNull();

    await fireEvent.click(screen.getByRole("tab", { name: "Mixer" }));
    expect(
      screen.getByRole("tree", { name: "Channels and buses" }),
    ).not.toBeNull();
    expect(screen.getByRole("button", { name: "Lead channel" })).not.toBeNull();

    await fireEvent.click(screen.getByRole("tab", { name: "Global FX" }));
    expect(screen.getByRole("button", { name: "Master FX" })).not.toBeNull();
  });

  it("adds the selected instrument parameter through its callback", async () => {
    const onadd = vi.fn();
    const fixture = project();
    const param = autoParams(fixture.instruments[0].id)[0].param;
    render(AutomationPicker, { project: fixture, onadd });

    await fireEvent.click(screen.getByRole("button", { name: "Add lane" }));

    expect(onadd).toHaveBeenCalledWith(fixture.instruments[0].id, param);
  });

  it("disables adding a lane that already exists", () => {
    const fixture = project();
    const param = autoParams(fixture.instruments[0].id)[0].param;
    fixture.automation = [
      { id: "existing", target: fixture.instruments[0].id, param, points: [] },
    ];
    render(AutomationPicker, { project: fixture, onadd: vi.fn() });

    const add = screen.getByRole("button", { name: "Add lane" });
    expect(add.hasAttribute("disabled")).toBe(true);
    expect(screen.getByText("This lane already exists.")).not.toBeNull();
  });
});
