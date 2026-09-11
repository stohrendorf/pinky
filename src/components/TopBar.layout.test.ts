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

  it("separates project, downloads and transport without hiding their commands", () => {
    for (const label of ["Project", "Download", "Transport and timing"]) {
      const group = elements(markup, "div").find((node) =>
        hasAttribute(node, "aria-label", label),
      );
      expect(group).toBeDefined();
      expect(hasAttribute(group!, "role", "group")).toBe(true);
    }
    expect(elements(markup, "details")).toHaveLength(0);
    expect(components(markup, "InstrumentPanel")).toHaveLength(0);
  });

  it("keeps the brand noninteractive and exposes the source through a separate GitHub icon", () => {
    const brand = elements(markup, "span").find((node) =>
      hasAttribute(node, "class", "brand"),
    )!;
    expect(brand).toBeDefined();
    expect(textContent(brand)).toBe("Pinky");
    for (const attribute of ["href", "onclick", "tabindex", "aria-expanded"]) {
      expect(hasAttribute(brand, attribute)).toBe(false);
    }
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

  it("has only one Save action and announces confirmation without reserving header space", () => {
    const saves = components(markup, "Button").filter(
      (node) => textContent(node) === "Save",
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

  it("uses named nonmodal panels with no nested settings or permanent help paragraphs", () => {
    const toggles = elements(markup, "button").filter((node) =>
      hasAttribute(node, "aria-controls", "topbar-panel"),
    );
    expect(toggles.map(textContent)).toEqual(["Demos", "Audio"]);
    for (const toggle of toggles) {
      expect(hasAttribute(toggle, "aria-expanded")).toBe(true);
      expect(hasAttribute(toggle, "aria-haspopup", "dialog")).toBe(true);
    }
    const panel = elements(markup, "div").find((node) =>
      hasAttribute(node, "id", "topbar-panel"),
    )!;
    expect(hasAttribute(panel, "role", "dialog")).toBe(true);
    expect(hasAttribute(panel, "aria-label")).toBe(true);
    expect(hasAttribute(panel, "aria-modal")).toBe(false);
    expect(elements([panel], "p")).toHaveLength(0);
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
