import { ESLint } from "eslint";
import { fileURLToPath } from "node:url";
import { format } from "prettier";
import * as sveltePlugin from "prettier-plugin-svelte";
import { describe, expect, it } from "vitest";

describe("ESLint formatting", () => {
  it("formats short Svelte imports on one line", async () => {
    const eslint = new ESLint({
      overrideConfigFile: fileURLToPath(
        new URL("../../eslint.config.js", import.meta.url),
      ),
    });
    const config: unknown = await eslint.calculateConfigForFile(
      "src/components/FormattingFixture.svelte",
    );
    const formatted = await format(
      `<script lang="ts">
    import {first, second} from './values';
</script>
`,
      { parser: "svelte", plugins: [sveltePlugin] },
    );

    expect(config).toMatchObject({ rules: { "prettier/prettier": [2] } });
    expect(formatted).toMatch(
      /import \{ first, second \} from ["']\.\/values["'];/,
    );
  });
});
