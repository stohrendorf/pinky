import { describe, expect, it } from "vitest";

import {
  componentMarkup,
  components,
  componentSource,
  eachBlocks,
  elements,
  hasAttribute,
  styleRules,
  textContent,
} from "../test/svelte-semantics";

const toolbar = componentSource(new URL("./TopBar.svelte", import.meta.url));
const markup = componentMarkup(toolbar);

describe("TopBar desktop layout", () => {
  it("offers the shared demo registry with current-song state and descriptions on hover", () => {
    const list = elements(markup, "div").find((node) =>
      hasAttribute(node, "class", "demo-list"),
    )!;
    expect(eachBlocks([list])).toHaveLength(1);
    const item = elements([list], "button").find((node) =>
      hasAttribute(node, "class", "demo-item"),
    )!;
    expect(hasAttribute(item, "aria-pressed")).toBe(true);
    expect(hasAttribute(item, "title")).toBe(true);
    expect(hasAttribute(item, "disabled")).toBe(true);
    expect(
      components(markup, "Dialog").some((node) =>
        hasAttribute(node, "title", "Demo songs"),
      ),
    ).toBe(false);
  });

  it("keeps project commands structured in the main menu beside direct transport", () => {
    for (const label of ["Project", "Export", "Demos"]) {
      const group = elements(markup, "section").find((node) =>
        hasAttribute(node, "aria-label", label),
      );
      expect(group).toBeDefined();
    }
    const transport = elements(markup, "div").find((node) =>
      hasAttribute(node, "aria-label", "Transport and timing"),
    );
    expect(hasAttribute(transport!, "role", "group")).toBe(true);
    expect(elements(markup, "details")).toHaveLength(0);
    expect(components(markup, "InstrumentPanel")).toHaveLength(0);
  });

  it("uses the brand as the main-menu trigger and keeps the GitHub icon separate", () => {
    const brand = elements(markup, "button").find((node) =>
      hasAttribute(node, "class", "brand main-menu-toggle"),
    )!;
    expect(brand).toBeDefined();
    expect(textContent(brand)).toBe("Pinky");
    expect(hasAttribute(brand, "aria-controls", "main-menu")).toBe(true);
    expect(hasAttribute(brand, "aria-expanded")).toBe(true);
    expect(hasAttribute(brand, "onclick")).toBe(true);
    const github = elements(markup, "a").find((node) =>
      hasAttribute(node, "href", "https://github.com/stohrendorf/pinky"),
    )!;
    expect(github).toBeDefined();
    expect(hasAttribute(github, "aria-label", "Pinky on GitHub")).toBe(true);
    expect(hasAttribute(github, "title", "Pinky on GitHub")).toBe(true);
    expect(
      elements([github], "i").some((node) =>
        hasAttribute(node, "class", "fa-brands fa-github"),
      ),
    ).toBe(true);
    const help = componentMarkup(
      componentSource(new URL("./Shortcuts.svelte", import.meta.url)),
    );
    const link = elements(help, "a").find((node) =>
      hasAttribute(node, "href", "https://github.com/stohrendorf/pinky"),
    )!;
    expect(link).toBeDefined();
    expect(hasAttribute(link, "rel", "noopener noreferrer")).toBe(true);
    expect(hasAttribute(link, "target", "_blank")).toBe(true);
    expect(textContent(link)).toBe("Source and issues on GitHub");
  });

  it("keeps a single compact desktop row rather than wrapping into a mobile header", () => {
    const styles = styleRules(toolbar);
    expect(styles.get(".topbar-main")?.get("height")).toBe("48px");
    for (const selector of [
      ".topbar-main",
      ".session-group",
      ".transport-controls",
    ]) {
      expect(styles.get(selector)?.get("flex-wrap")).not.toBe("wrap");
    }
  });

  it("has one browser-save action in the main menu and announces confirmation", () => {
    const saves = elements(markup, "button").filter(
      (node) => textContent(node) === "Save to browser",
    );
    expect(saves).toHaveLength(1);
    expect(
      elements([saves[0]], "i").map((node) =>
        hasAttribute(node, "aria-hidden", "true"),
      ),
    ).toEqual([true, true]);
    const feedback = elements(markup, "span").find((node) =>
      hasAttribute(node, "class", "saved-flash"),
    )!;
    expect(hasAttribute(feedback, "aria-live", "polite")).toBe(true);
    expect(styleRules(toolbar).get(".saved-flash")?.get("position")).toBe(
      "absolute",
    );
  });

  it("uses named nonmodal main-menu and Audio panels without permanent help paragraphs", () => {
    const toggles = elements(markup, "button").filter((node) =>
      hasAttribute(node, "aria-controls", "topbar-panel"),
    );
    expect(toggles.map(textContent)).toEqual(["Audio"]);
    for (const toggle of toggles) {
      expect(hasAttribute(toggle, "aria-expanded")).toBe(true);
      expect(hasAttribute(toggle, "aria-haspopup", "dialog")).toBe(true);
    }
    expect(toolbar).toContain(
      "id={activePanel === 'main' ? 'main-menu' : 'topbar-panel'}",
    );
    expect(toolbar).toContain('role="dialog"');
    expect(toolbar).not.toContain("aria-modal");
    const mainMenu = elements(markup, "div").find((node) =>
      hasAttribute(node, "class", "main-menu"),
    )!;
    expect(elements([mainMenu], "p")).toHaveLength(0);
    expect(styleRules(toolbar).get(".toolbar-panel")?.get("overflow")).toBe(
      "auto",
    );
  });

  it("keeps master and performance controls in the flat Audio panel", () => {
    const audio = elements(markup, "div").find((node) =>
      hasAttribute(node, "class", "audio-controls"),
    )!;
    expect(elements([audio], "h3").map(textContent)).toEqual([
      "Master",
      "Performance",
    ]);
    expect(components([audio], "Slider")).toHaveLength(1);
    expect(hasAttribute(elements([audio], "fieldset")[0], "disabled")).toBe(
      true,
    );
    expect(
      elements([audio], "input").some((node) =>
        hasAttribute(node, "type", "range"),
      ),
    ).toBe(true);
  });

  it("keeps Mixer and shortcut help directly available", () => {
    const mixer = components(markup, "Button").find(
      (node) => textContent(node) === "Mixer",
    )!;
    expect(
      elements([mixer], "i").some((node) =>
        hasAttribute(node, "class", "fa fa-chart-simple"),
      ),
    ).toBe(true);
    expect(
      components(markup, "IconButton").some((node) =>
        hasAttribute(node, "title", "Keyboard shortcuts (?)"),
      ),
    ).toBe(true);
  });
});
