import {
    ESLint
} from 'eslint';
import {
    fileURLToPath
} from 'node:url';
import {
    describe, expect, it
} from 'vitest';

describe('ESLint formatting', () => {
    it('formats multiline Svelte imports with broken braces and indented specifiers', async () => {
        const eslint = new ESLint({
            fix: true,
            overrideConfigFile: fileURLToPath(new URL('../../eslint.config.js', import.meta.url))
        });
        const [result] = await eslint.lintText(`
<script lang="ts">
    import {first, second} from './values';
</script>
`, {filePath: 'src/components/FormattingFixture.svelte'});

        expect(result.output).toContain(`    import {
        first, second
    } from './values';`);
    });
});