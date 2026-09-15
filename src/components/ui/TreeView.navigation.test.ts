import { fireEvent, render, screen } from "@testing-library/svelte";
import { describe, expect, it, vi } from "vitest";

import TreeView from "./TreeView.svelte";

describe("TreeView folder navigation", () => {
  it("collapses folders and reveals only the selected item's ancestors", async () => {
    const onselect = vi.fn();
    const props = {
      items: [
        { id: "beat", name: "02 Main/Drums/beat" },
        { id: "outro", name: "03 Outro/outro" },
      ],
      onselect,
      selectedId: null,
      title: "Tracks",
      usedItemIds: new Set(["beat"]),
    };
    const { rerender } = render(TreeView, props);

    expect(screen.getByRole("tree", { name: "Tracks" })).not.toBeNull();
    expect(screen.getByTitle("02 Main")).not.toBeNull();
    expect(screen.getByTitle("02 Main/Drums")).not.toBeNull();
    expect(screen.getByTitle("02 Main/Drums/beat")).not.toBeNull();
    expect(screen.getByLabelText("Used in current pattern")).not.toBeNull();
    expect(screen.queryByTitle("Used in current pattern")).not.toBeNull();

    await fireEvent.click(screen.getByTitle("02 Main"));
    await fireEvent.click(screen.getByTitle("03 Outro"));
    expect(screen.queryByTitle("02 Main/Drums/beat")).toBeNull();
    expect(screen.queryByTitle("03 Outro/outro")).toBeNull();

    rerender({ ...props, selectedId: "beat" });
    expect(screen.getByTitle("02 Main/Drums/beat")).not.toBeNull();
    expect(screen.queryByTitle("03 Outro/outro")).toBeNull();

    await fireEvent.click(screen.getByTitle("02 Main/Drums/beat"));
    expect(onselect).toHaveBeenCalledWith("beat");
  });
});
