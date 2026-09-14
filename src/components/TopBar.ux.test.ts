import { describe, expect, it, vi } from "vitest";

import {
  componentFunction,
  componentMarkup,
  components,
  componentSource,
  elements,
  hasAttribute,
  textContent,
} from "../test/svelte-semantics";

const source = componentSource(new URL("./TopBar.svelte", import.meta.url));
const markup = componentMarkup(source);

describe("TopBar main menu and desktop controls", () => {
  it("reflects live master volume and tilt automation without changing saved controls", () => {
    expect(source).toContain("import {onMount, tick} from 'svelte'");
    expect(source).toContain("masterState");
    expect(source).toContain("let liveMaster = $state");
    expect(source).toContain(
      "$playing ? {...masterParams, ...liveMaster} : masterParams",
    );
    expect(source).toContain("value={displayedMasterParams[s.id as MasterId]}");
  });

  it("keeps timing directly accessible while moving project commands behind the logo", () => {
    const main = elements(markup, "div").find((node) =>
      hasAttribute(node, "class", "topbar-main"),
    )!;
    const labels = components([main], "Button").map(textContent);
    expect(labels).toEqual(expect.arrayContaining(["Mixer"]));
    expect(labels).not.toEqual(expect.arrayContaining(["New", "Open", "Save"]));
    for (const label of ["Tempo (BPM)", "Swing (%)"]) {
      expect(
        elements([main], "input").some((node) =>
          hasAttribute(node, "aria-label", label),
        ),
      ).toBe(true);
    }
    expect(elements([main], "details")).toHaveLength(0);
  });

  it("uses named icons rather than visible text for transport", () => {
    const transport = elements(markup, "div").find((node) =>
      hasAttribute(node, "class", "transport-controls"),
    )!;
    expect(textContent(transport)).toBe("");
    const icons = components([transport], "IconButton");
    expect(icons).toHaveLength(3);
    for (const label of ["Play song", "Stop", "Back to start"]) {
      const icon = icons.find((node) => hasAttribute(node, "ariaLabel", label));
      expect(icon).toBeDefined();
      expect(hasAttribute(icon!, "title")).toBe(true);
    }
  });

  it("groups project, browser recovery, export, and demos in the logo main menu", () => {
    const trigger = elements(markup, "button").find((node) =>
      hasAttribute(node, "class", "brand main-menu-toggle"),
    )!;
    expect(trigger).toBeDefined();
    expect(textContent(trigger)).toContain("Pinky");
    expect(hasAttribute(trigger, "aria-controls", "main-menu")).toBe(true);
    expect(hasAttribute(trigger, "aria-expanded")).toBe(true);
    expect(hasAttribute(trigger, "aria-haspopup", "dialog")).toBe(true);
    const menu = elements(markup, "div").find((node) =>
      hasAttribute(node, "class", "main-menu"),
    )!;
    expect(menu).toBeDefined();
    const sections = elements([menu], "section");
    const projectSection = sections.find((node) =>
      hasAttribute(node, "aria-label", "Project"),
    )!;
    expect(elements([projectSection], "button").map(textContent)).toEqual([
      "New project",
      "Open project",
      "Save to browser",
      "Load browser save",
    ]);
    const exportSection = sections.find((node) =>
      hasAttribute(node, "aria-label", "Export"),
    )!;
    expect(elements([exportSection], "button").map(textContent)).toEqual([
      "Project file (.json)",
      "Audio (.wav)",
    ]);
    expect(
      sections.some((node) => hasAttribute(node, "aria-label", "Demos")),
    ).toBe(true);
  });

  it("closes the main menu after downloading a project, but blocks downloads during rendering", () => {
    const scope = {
      $project: {},
      $rendering: true,
      exportProject: vi.fn(),
      closePanel: vi.fn(),
    };
    const download = componentFunction<() => void>(
      source,
      "downloadProject",
      scope,
    );
    download();
    expect(scope.exportProject).not.toHaveBeenCalled();
    scope.$rendering = false;
    download();
    expect(scope.exportProject).toHaveBeenCalledOnce();
    expect(scope.closePanel).toHaveBeenCalledWith(true);
  });

  it("closes the main menu before rendering audio and clears its trigger focus only after completion", async () => {
    let finish!: () => void;
    const scope = {
      $project: {},
      $rendering: true,
      exportWav: vi.fn(
        () =>
          new Promise<void>((resolve) => {
            finish = resolve;
          }),
      ),
      closePanel: vi.fn(),
      panelButton: { blur: vi.fn() },
      tick: () => Promise.resolve(),
    };
    const download = componentFunction<() => Promise<void>>(
      source,
      "exportAudio",
      scope,
    );
    await download();
    expect(scope.exportWav).not.toHaveBeenCalled();
    scope.$rendering = false;
    const pending = download();
    expect(scope.closePanel).toHaveBeenCalledWith(false);
    expect(scope.exportWav).toHaveBeenCalledOnce();
    expect(scope.panelButton.blur).not.toHaveBeenCalled();
    finish();
    await pending;
    expect(scope.panelButton.blur).toHaveBeenCalledOnce();
  });

  it("opens either panel without changing the project and focuses an available control", async () => {
    const first = { focus: vi.fn() };
    const trigger = { focus: vi.fn() };
    const scope = {
      activePanel: null,
      panelButton: null,
      panelElement: { querySelector: vi.fn(() => first) },
      tick: () => Promise.resolve(),
      closePanel: vi.fn(),
      loadDemoProject: vi.fn(),
    };
    const toggle = componentFunction<(panel: string, button: object) => void>(
      source,
      "togglePanel",
      scope,
    );
    toggle("main", trigger);
    await Promise.resolve();
    expect(scope.activePanel).toBe("main");
    expect(scope.panelButton).toBe(trigger);
    expect(first.focus).toHaveBeenCalledOnce();
    expect(scope.loadDemoProject).not.toHaveBeenCalled();
    toggle("main", trigger);
    expect(scope.closePanel).toHaveBeenCalledWith(true);
    toggle("audio", trigger);
    expect(scope.activePanel).toBe("audio");
  });

  it("loads a clicked demo immediately and preserves the original project across exploration", () => {
    const scope = {
      $rendering: false,
      $project: { bpm: 123, patterns: [{ id: "original" }] },
      $activeDemo: null,
      $selInstId: "instrument",
      $selPatId: "original",
      $songCursor: 32,
      $lastPlayedPitch: "D4",
      demoRecovery: null as null | { project: { bpm: number } },
      stopTransport: vi.fn(),
      loadDemoProject: vi.fn(),
      closePanel: vi.fn(),
    };
    const load = componentFunction<(song: string) => void>(
      source,
      "demo",
      scope,
    );
    load("winter");
    expect(scope.stopTransport).toHaveBeenCalledOnce();
    expect(scope.loadDemoProject).toHaveBeenCalledWith("winter");
    expect(scope.closePanel).toHaveBeenCalledWith(true);
    expect(scope.demoRecovery?.project).toEqual(scope.$project);
    expect(scope.demoRecovery?.project).not.toBe(scope.$project);
    scope.$project.bpm = 90;
    load("toccata");
    expect(scope.demoRecovery?.project.bpm).toBe(123);
    scope.$rendering = true;
    load("axelf");
    expect(scope.loadDemoProject).toHaveBeenCalledTimes(2);
  });

  it("keeps the browser save in the project section instead of the demo list", () => {
    const menu = elements(markup, "div").find((node) =>
      hasAttribute(node, "class", "main-menu"),
    )!;
    const projectSection = elements([menu], "section").find((node) =>
      hasAttribute(node, "aria-label", "Project"),
    )!;
    expect(
      elements([projectSection], "button").some(
        (button) => textContent(button) === "Load browser save",
      ),
    ).toBe(true);
  });

  it("restores the project, selection and cursor and refuses restoration during rendering", () => {
    const recovery = {
      project: { bpm: 123 },
      activeDemo: null,
      selInstId: "i",
      selPatId: "p",
      songCursor: 32,
      lastPlayedPitch: "D4",
    };
    const scope = {
      $rendering: true,
      demoRecovery: recovery as typeof recovery | null,
      project: { set: vi.fn() },
      activeDemo: { set: vi.fn() },
      selInstId: { set: vi.fn() },
      selPatId: { set: vi.fn() },
      songCursor: { set: vi.fn() },
      lastPlayedPitch: { set: vi.fn() },
      stopTransport: vi.fn(),
      closePanel: vi.fn(),
    };
    const restore = componentFunction<() => void>(
      source,
      "restoreDemoProject",
      scope,
    );
    restore();
    expect(scope.project.set).not.toHaveBeenCalled();
    scope.$rendering = false;
    restore();
    for (const key of [
      "project",
      "activeDemo",
      "selInstId",
      "selPatId",
      "songCursor",
      "lastPlayedPitch",
    ] as const) {
      expect(scope[key].set).toHaveBeenCalledWith(recovery[key]);
    }
    expect(scope.stopTransport).toHaveBeenCalledOnce();
    expect(scope.demoRecovery).toBeNull();
    expect(scope.closePanel).toHaveBeenCalledWith(true);
    restore();
    expect(scope.project.set).toHaveBeenCalledOnce();
  });

  it("dismisses on outside interaction without stealing focus", () => {
    class Node {}

    const closePanel = vi.fn();
    const outside = componentFunction<(event: { target: Node }) => void>(
      source,
      "handleOutsidePointer",
      {
        Node,
        panelButton: { contains: () => false },
        panelElement: { contains: () => false },
        closePanel,
      },
    );
    outside({ target: new Node() });
    expect(closePanel).toHaveBeenCalledWith(false);
  });

  it("contains panel shortcuts, closes on Escape and leaves native controls alone", () => {
    const scope = { activePanel: "audio", closePanel: vi.fn() };
    const handle = componentFunction<(e: object) => void>(
      source,
      "handleMenuKeydown",
      scope,
    );
    const event = (key: string) => ({
      key,
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
    });
    const space = event(" ");
    handle(space);
    expect(space.stopPropagation).toHaveBeenCalledOnce();
    expect(space.preventDefault).not.toHaveBeenCalled();
    const escape = event("Escape");
    handle(escape);
    expect(escape.preventDefault).toHaveBeenCalledOnce();
    expect(scope.closePanel).toHaveBeenCalledWith(true);
  });

  it.each(["main"])(
    "navigates %s with arrows, Home and End without acting",
    (activePanel) => {
      const buttons = [
        { focus: vi.fn() },
        { focus: vi.fn() },
        { focus: vi.fn() },
      ];
      const scope = {
        activePanel,
        panelElement: { querySelectorAll: () => buttons },
        document: { activeElement: buttons[0] },
        loadDemoProject: vi.fn(),
      };
      const handle = componentFunction<(e: object) => void>(
        source,
        "handleMenuKeydown",
        scope,
      );
      for (const [key, index] of [
        ["ArrowDown", 1],
        ["ArrowUp", 2],
        ["End", 2],
        ["Home", 0],
      ] as const) {
        const event = {
          key,
          preventDefault: vi.fn(),
          stopPropagation: vi.fn(),
        };
        handle(event);
        expect(buttons[index].focus).toHaveBeenCalled();
        expect(event.preventDefault).toHaveBeenCalledOnce();
      }
      expect(scope.loadDemoProject).not.toHaveBeenCalled();
    },
  );

  it("clears toolbar-trigger focus when dismissal requests it so Space returns to transport", async () => {
    const opener = { blur: vi.fn() };
    const scope = {
      activePanel: "main" as string | null,
      panelButton: opener,
      tick: () => Promise.resolve(),
    };
    const close = componentFunction<(restore: boolean) => void>(
      source,
      "closePanel",
      scope,
    );
    close(false);
    await Promise.resolve();
    expect(scope.activePanel).toBeNull();
    expect(opener.blur).not.toHaveBeenCalled();
    scope.activePanel = "audio";
    close(true);
    await Promise.resolve();
    expect(scope.activePanel).toBeNull();
    expect(opener.blur).toHaveBeenCalledOnce();
  });

  it("does not replace a project if rendering begins while an import file is read", async () => {
    let finishRead!: (value: string) => void;
    const scope = {
      $rendering: false,
      stopTransport: vi.fn(),
      importProject: vi.fn(),
    };
    const input = {
      value: "song.json",
      files: [
        {
          text: () =>
            new Promise<string>((resolve) => {
              finishRead = resolve;
            }),
        },
      ],
    };
    const load = componentFunction<(event: object) => Promise<void>>(
      source,
      "importFile",
      scope,
    );
    const pending = load({ target: input });
    scope.$rendering = true;
    finishRead("{}");
    await pending;
    expect(input.value).toBe("");
    expect(scope.importProject).not.toHaveBeenCalled();
    expect(scope.stopTransport).not.toHaveBeenCalled();
  });

  it.each([true, false])(
    "clears demo recovery only after a successful import (%s)",
    async (valid) => {
      const recovery = { project: { bpm: 123 } };
      const scope = {
        $rendering: false,
        demoRecovery: recovery,
        importProject: vi.fn(() => valid),
        stopTransport: vi.fn(),
        showAlert: false,
        alertMessage: "",
      };
      const load = componentFunction<(event: object) => Promise<void>>(
        source,
        "importFile",
        scope,
      );
      await load({
        target: {
          value: "song.json",
          files: [{ text: () => Promise.resolve("{}") }],
        },
      });
      expect(scope.importProject).toHaveBeenCalledWith("{}");
      expect(scope.demoRecovery).toBe(valid ? null : recovery);
      expect(scope.showAlert).toBe(!valid);
    },
  );

  it("bounds swing and blocks edits while rendering", () => {
    const scope = { $project: { swing: 0 }, $rendering: false, touch: vi.fn() };
    const set = componentFunction<(v: number) => void>(
      source,
      "setSwing",
      scope,
    );
    set(150);
    expect(scope.$project.swing).toBe(1);
    set(-10);
    expect(scope.$project.swing).toBe(0);
    set(Number.NaN);
    scope.$rendering = true;
    set(50);
    expect(scope.touch).toHaveBeenCalledTimes(2);
  });
});
