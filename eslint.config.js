import eslint from '@eslint/js';
import perfectionist from 'eslint-plugin-perfectionist';
import svelte from 'eslint-plugin-svelte';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
    {
        ignores: ['dist/**', 'node_modules/**']
    },
    eslint.configs.recommended,
    ...tseslint.configs.recommended,
    ...tseslint.configs.stylistic,
    ...tseslint.configs.recommendedTypeChecked.map(config => ({
        ...config,
        files: ['src/**/*.ts']
    })),
    ...svelte.configs['flat/recommended'],
    {
        files: ['**/*.{js,mjs,ts,svelte}'],
        plugins: {
            perfectionist
        },
        languageOptions: {
            globals: {
                ...globals.browser,
                ...globals.es2022,
                ...globals.node
            }
        },
        rules: {
            'array-callback-return': 'error',
            'arrow-body-style': ['error', 'as-needed'],
            'curly': ['error'],
            'eqeqeq': ['error', 'always'],
            'indent': ['error', 4, {ImportDeclaration: 1}],
            'object-curly-newline': ['error', {ImportDeclaration: 'always'}],
            'no-console': 'warn',
            '@typescript-eslint/no-empty-function': ['error', {allow: ['arrowFunctions']}],
            'no-var': 'error',
            'object-shorthand': ['error', 'always'],
            'perfectionist/sort-imports': ['error', {newlinesBetween: 1, type: 'alphabetical'}],
            'prefer-const': ['error', {destructuring: 'all'}],
            'quotes': ['error', 'single', {avoidEscape: true}],
            'semi': ['error', 'always'],
            'keyword-spacing': 'error',
            '@typescript-eslint/no-explicit-any': 'warn',
            '@typescript-eslint/no-unused-expressions': 'warn',
            '@typescript-eslint/no-unused-vars': ['warn', {argsIgnorePattern: '^_', varsIgnorePattern: '^_'}],
            'no-undef': 'error',
        }
    },
    {
        files: ['**/*.test.{js,ts,svelte}'],
        rules: {
            'no-console': 'off',
            '@typescript-eslint/no-unused-vars': 'error'
        }
    },
    {
        files: ['**/*.svelte'],
        languageOptions: {
            parserOptions: {
                parser: tseslint.parser
            }
        },
        rules: {
            'svelte/no-at-html-tags': 'error',
            'svelte/first-attribute-linebreak': ['error', {multiline: 'below', singleline: 'beside'}],
            'svelte/max-attributes-per-line': ['error', {multiline: 1, singleline: 4}],
            'svelte/require-each-key': 'warn',
            'svelte/no-reactive-reassign': 'warn',
            'svelte/no-reactive-functions': 'warn',
            'svelte/prefer-svelte-reactivity': 'warn',
            'svelte/infinite-reactive-loop': 'warn',
            'svelte/no-immutable-reactive-statements': 'warn',
            'svelte/sort-attributes': ['error', {alphabetical: true}],
            'svelte/no-unused-svelte-ignore': 'warn'
        }
    },
    {
        // the promo bounce is a Node CLI — it reports on the console
        files: ['promo/*.mjs'],
        rules: {
            'no-console': 'off'
        }
    },
    {
        files: ['src/lib/clock-worklet.js'],
        languageOptions: {
            globals: {
                AudioWorkletProcessor: 'readonly',
                currentFrame: 'readonly',
                currentTime: 'readonly',
                registerProcessor: 'readonly',
                sampleRate: 'readonly'
            }
        }
    },
    {
        files: ['src/**/*.ts'],
        languageOptions: {
            parserOptions: {
                projectService: true,
                tsconfigRootDir: import.meta.dirname
            }
        },
        rules: {
            '@typescript-eslint/no-explicit-any': 'error',
            '@typescript-eslint/no-unsafe-assignment': 'warn',
            '@typescript-eslint/no-unsafe-call': 'warn',
            '@typescript-eslint/no-unsafe-member-access': 'warn',
            '@typescript-eslint/no-unsafe-return': 'warn',
            '@typescript-eslint/no-unsafe-argument': 'warn',
            '@typescript-eslint/no-floating-promises': 'warn',
            '@typescript-eslint/no-unnecessary-type-assertion': 'warn',
            '@typescript-eslint/unbound-method': 'warn',
            '@typescript-eslint/restrict-plus-operands': 'warn'
        }
    },
    {
        files: ['src/**/*.js', 'src/**/*.ts', 'src/**/*.svelte'],
        rules: {
            'quotes': ['error', 'single', {avoidEscape: true}],
            'semi': ['error', 'always'],
            '@typescript-eslint/no-explicit-any': 'error'
        }
    }
);