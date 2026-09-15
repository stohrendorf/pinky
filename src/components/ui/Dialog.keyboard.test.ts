import { cleanup, fireEvent, render, screen } from "@testing-library/svelte";
import { createRawSnippet, tick } from "svelte";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import Dialog from "./Dialog.svelte";

const controls = createRawSnippet(() => ({
  render: () =>
    '<div><button type="button">First</button><button disabled type="button">Disabled</button><button type="button">Last</button></div>',
}));

beforeAll(() => {
  if (!HTMLElement.prototype.checkVisibility) {
    Object.defineProperty(HTMLElement.prototype, "checkVisibility", {
      configurable: true,
      value: () => true,
    });
  }
});

afterEach(cleanup);

describe("Dialog keyboard containment", () => {
  it("contains Tab navigation among its visible, enabled controls", async () => {
    render(Dialog, { children: controls, show: true, title: "Editor" });
    await tick();

    const dialog = screen.getByRole("dialog", { name: "Editor" });
    const close = dialog.querySelector<HTMLButtonElement>(".close-btn")!;
    const first = screen.getByRole("button", { name: "First" });
    const last = screen.getByRole("button", { name: "Last" });

    expect(document.activeElement).toBe(dialog);

    last.focus();
    await fireEvent.keyDown(last, { key: "Tab" });
    expect(document.activeElement).toBe(close);

    close.focus();
    await fireEvent.keyDown(close, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(last);

    dialog.focus();
    await fireEvent.keyDown(dialog, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(last);
  });

  it("contains shortcut events without cancelling them and dismisses on Escape", async () => {
    const onclose = vi.fn();
    render(Dialog, {
      children: controls,
      onclose,
      show: true,
      title: "Editor",
    });

    const dialog = screen.getByRole("dialog", { name: "Editor" });
    const close = dialog.querySelector<HTMLButtonElement>(".close-btn")!;
    const shortcut = new KeyboardEvent("keydown", {
      bubbles: true,
      cancelable: true,
      key: " ",
    });
    const bodyHandler = vi.fn();
    document.body.addEventListener("keydown", bodyHandler);
    close.dispatchEvent(shortcut);
    document.body.removeEventListener("keydown", bodyHandler);

    expect(shortcut.defaultPrevented).toBe(false);
    expect(bodyHandler).not.toHaveBeenCalled();

    await fireEvent.keyDown(close, { key: "Escape" });
    expect(onclose).toHaveBeenCalledOnce();
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
