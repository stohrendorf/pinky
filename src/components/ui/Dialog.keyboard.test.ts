import { describe, expect, it, vi } from "vitest";

import {
  componentFunction,
  componentSource,
} from "../../test/svelte-semantics";

const source = componentSource(new URL("./Dialog.svelte", import.meta.url));

function fixture() {
  const first = {
    matches: () => false,
    checkVisibility: () => true,
    focus: vi.fn(),
  };
  const last = { ...first, focus: vi.fn() };
  const hidden = { ...first, checkVisibility: () => false, focus: vi.fn() };
  const disabled = { ...first, matches: () => true, focus: vi.fn() };
  const dialogEl = {
    querySelectorAll: () => [disabled, first, last, hidden],
    focus: vi.fn(),
  };
  const document: { activeElement: unknown } = { activeElement: last };
  const close = vi.fn();
  const handle = componentFunction<(event: object) => void>(
    source,
    "handleKey",
    {
      dialogEl,
      document,
      close,
    },
  );
  const event = {
    key: "Tab",
    shiftKey: false,
    defaultPrevented: false,
    preventDefault: vi.fn(),
    stopPropagation: vi.fn(),
  };
  return { first, last, dialogEl, document, close, handle, event };
}

describe("Dialog keyboard containment", () => {
  it("wraps Tab from the last usable control to the first", () => {
    const f = fixture();
    f.handle(f.event);
    expect(f.first.focus).toHaveBeenCalledOnce();
    expect(f.event.preventDefault).toHaveBeenCalledOnce();
  });

  it("wraps Shift+Tab from the first control and initial dialog focus", () => {
    const f = fixture();
    f.event.shiftKey = true;
    f.document.activeElement = f.first;
    f.handle(f.event);
    f.document.activeElement = f.dialogEl;
    f.handle(f.event);
    expect(f.last.focus).toHaveBeenCalledTimes(2);
  });

  it("contains editor shortcuts without preventing normal button activation", () => {
    const f = fixture();
    f.event.key = " ";
    f.handle(f.event);
    expect(f.event.stopPropagation).toHaveBeenCalledOnce();
    expect(f.event.preventDefault).not.toHaveBeenCalled();
  });

  it("respects child key handlers and dismisses on Escape", () => {
    const f = fixture();
    f.event.defaultPrevented = true;
    f.handle(f.event);
    expect(f.first.focus).not.toHaveBeenCalled();
    f.event.defaultPrevented = false;
    f.event.key = "Escape";
    f.handle(f.event);
    expect(f.close).toHaveBeenCalledOnce();
  });
});
