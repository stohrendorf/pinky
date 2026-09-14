import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  fileURLToPath(new URL("./ContextMenu.svelte", import.meta.url)),
  "utf8",
);

describe("ContextMenu", () => {
  it("keeps only one context menu active across the application", () => {
    expect(source).toContain(
      "const CONTEXT_MENU_OPEN_EVENT = 'pinky:context-menu-open'",
    );
    expect(source).toContain("const menuId = ++nextContextMenuId");
    expect(source).toContain("function handleOtherContextMenu(event: Event)");
    expect(source).toContain("onclose();");
    expect(source).toContain(
      "window.dispatchEvent(new CustomEvent(CONTEXT_MENU_OPEN_EVENT, { detail: menuId }))",
    );
    expect(source).toContain(
      "window.addEventListener(CONTEXT_MENU_OPEN_EVENT, handleOtherContextMenu)",
    );
  });
});
