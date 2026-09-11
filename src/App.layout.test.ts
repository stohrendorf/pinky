import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const app = readFileSync(
  fileURLToPath(new URL("./App.svelte", import.meta.url)),
  "utf8",
);

describe("workspace controls", () => {
  it("leaves the global top bar free of editor-specific controls", () => {
    expect(app).toMatch(/<TopBar\s*\/>/);
    expect(app).not.toContain('class="workspace-heading"');
    expect(app).not.toContain("<h1>Arranger</h1>");
    expect(app).not.toContain('class="instrument-button"');
  });

  it("keeps pattern selection and editing commands inside the pattern editor", () => {
    const topBar = app.indexOf("<TopBar");
    const workspace = app.indexOf('class="workspace-main"');

    expect(topBar).toBeGreaterThan(-1);
    expect(workspace).toBeGreaterThan(topBar);
    expect(app).toMatch(/<PatternBar\s*\/>[\s\S]*<Playlist\b/);
  });

  it("places the compact preset controls in the instrument editor title bar", () => {
    expect(app).toContain(
      "import InstrumentPresetBar from './components/InstrumentPresetBar.svelte'",
    );
    expect(app).toMatch(
      /<Dialog[^>]*title="Instrument editor"[\s\S]*\{#snippet headerActions\(\)}[\s\S]*<InstrumentPresetBar\s*\/>/,
    );
  });

  it("keeps the entire instrument editor in one viewport without internal scrolling", () => {
    expect(app).toContain('bodyClass="instrument-editor-body"');
    expect(app).toContain('class="instrument-editor-layout"');
    expect(app).toMatch(
      /\.instrument-editor-layout\s*\{[\s\S]*grid-template-rows: minmax\(0, 1fr\) 72px;/,
    );
    expect(app).toMatch(
      /:global\(\.modal-body\.instrument-editor-body\)\s*\{[\s\S]*overflow: hidden;/,
    );
    expect(app).toMatch(
      /:global\(\.modal-body\.instrument-editor-body\)\s*\{[\s\S]*height: 100%;/,
    );
  });

  it("shares contextual editor ownership between the arranger and piano roll", () => {
    expect(app).toContain("let contextualEditor: string | null = $state(null)");
    expect(app).toMatch(/<Playlist\s+bind:contextualEditor\s*\/>/);
    expect(app).toContain("bind:contextualEditor");
    expect(app).toMatch(
      /onEditInstrument=\{\(\)\s*=>\s*\(?showInstrumentEditor\s*=\s*true\)?}/,
    );
  });

  it("allows the arranger and pattern editor panels to shrink with the viewport", () => {
    expect(app).toMatch(/\.workspace-main\s*\{[\s\S]*min-width:\s*0;/);
    expect(app).toMatch(
      /\.arranger-panel,\s*\.piano-roll-panel\s*\{[\s\S]*min-width:\s*0;/,
    );
  });

  it("uses a compact draggable splitter between the arranger and pattern editor", () => {
    expect(app).toContain('class="split-divider"');
    expect(app).toMatch(/<button[\s\S]*class="split-divider"/);
    expect(app).not.toContain('type="range"');
    expect(app).toContain("function startDividerDrag(event: PointerEvent)");
    expect(app).toContain("function resizeDivider(event: KeyboardEvent)");
    expect(app).toContain("onpointerdown={startDividerDrag}");
    expect(app).toContain("onkeydown={resizeDivider}");
    expect(app).toContain("onpointermove={dragDivider}");
    expect(app).toContain(
      "grid-template-rows: minmax(160px, calc((100% - 24px) * var(--arranger-ratio)))",
    );
    expect(app).toMatch(/\.split-divider\s*\{[\s\S]*cursor: row-resize;/);
    expect(app).toMatch(
      /\.split-divider\s*\{[\s\S]*border-top: 1px solid var\(--border\);/,
    );
  });
});
