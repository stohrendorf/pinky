import { ESLint } from "eslint";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

describe("ESLint formatting", () => {
  it("formats short Svelte imports on one line", async () => {
    const eslint = new ESLint({
      fix: true,
      overrideConfigFile: fileURLToPath(
        new URL("../../eslint.config.js", import.meta.url),
      ),
    });
    const [result] = await eslint.lintText(
      `
<script lang="ts">
    import {first, second} from './values';
</script>
`,
      { filePath: "src/components/FormattingFixture.svelte" },
    );

    expect(result.output).toContain(
      "    import { first, second } from './values';",
    );
  });
});
