import boundaries from 'eslint-plugin-boundaries'
import regexpPlugin from 'eslint-plugin-regexp'
import pluginSecurity from 'eslint-plugin-security'
import sonarjs from 'eslint-plugin-sonarjs'
import eslintPluginUnicorn from 'eslint-plugin-unicorn'
import unusedImports from 'eslint-plugin-unused-imports'
import { defineConfig, globalIgnores } from 'eslint/config'
import tseslint from 'typescript-eslint'

const eslintConfig = defineConfig([
  ...tseslint.configs.strictTypeChecked,
  ...tseslint.configs.stylisticTypeChecked,
  sonarjs.configs.recommended,
  eslintPluginUnicorn.configs.recommended,
  regexpPlugin.configs.recommended,
  pluginSecurity.configs.recommended,
  {
    files: ['**/*.ts', '**/*.mts'],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    plugins: {
      boundaries,
      'unused-imports': unusedImports,
    },
    linterOptions: {
      noInlineConfig: true,
      reportUnusedDisableDirectives: 'error',
    },
    settings: {
      'boundaries/elements': [
        {
          type: 'tests',
          pattern: 'cradle/**/__tests__/**',
        },
        {
          type: 'lib',
          pattern: 'cradle/lib/**',
        },
        {
          type: 'utils',
          pattern: 'cradle/utils/**',
        },
        {
          type: 'config',
          pattern: 'cradle/config/**',
        },
        {
          type: 'types',
          pattern: 'cradle/types/**',
        },
        {
          type: 'entry',
          pattern: 'cradle/index.ts',
        },
        {
          type: 'tools',
          pattern: 'cradle/tools/**',
        },
        {
          type: 'commands',
          pattern: 'cradle/commands/**',
        },
        {
          type: 'hooks',
          pattern: 'cradle/hooks/**',
        },
      ],
    },
    rules: {
      // Prefer TS-aware variants
      'no-unused-vars': 'off',
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          args: 'all',
          argsIgnorePattern: '^_',
          caughtErrors: 'all',
          caughtErrorsIgnorePattern: '^_',
          destructuredArrayIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          ignoreRestSiblings: true,
        },
      ],

      'no-use-before-define': 'off',
      '@typescript-eslint/no-use-before-define': [
        'error',
        {
          functions: false,
          classes: true,
          variables: true,
          enums: true,
          typedefs: true,
          ignoreTypeReferences: true,
        },
      ],

      'no-unused-expressions': 'off',
      '@typescript-eslint/no-unsafe-type-assertion': 'error',

      // Tighten common escape hatches
      '@typescript-eslint/consistent-type-imports': [
        'error',
        {
          prefer: 'type-imports',
          fixStyle: 'inline-type-imports',
        },
      ],
      '@typescript-eslint/consistent-type-exports': 'error',
      '@typescript-eslint/no-import-type-side-effects': 'error',
      '@typescript-eslint/require-array-sort-compare': [
        'error',
        { ignoreStringArrays: true },
      ],
      '@typescript-eslint/restrict-template-expressions': [
        'error',
        {
          allowNumber: true,
          allowBoolean: false,
          allowAny: false,
          allowNullish: false,
          allowRegExp: false,
        },
      ],
      '@typescript-eslint/prefer-readonly': 'error',
      '@typescript-eslint/ban-ts-comment': [
        'error',
        {
          'ts-expect-error': true,
        },
      ],
      '@typescript-eslint/max-params': ['error', { max: 7 }],

      // Script project rules
      'unused-imports/no-unused-imports': 'error',
      'boundaries/dependencies': [
        'error',
        {
          default: 'allow',
          rules: [
            {
              from: { type: 'lib' },
              disallow: { to: { type: 'tests' } },
            },
            {
              from: { type: 'utils' },
              disallow: { to: { type: 'tests' } },
            },
            {
              from: { type: 'config' },
              disallow: { to: { type: 'tests' } },
            },
            {
              from: { type: 'types' },
              disallow: { to: { type: 'tests' } },
            },
            {
              from: { type: 'entry' },
              allow: {
                to: {
                  type: [
                    'lib',
                    'utils',
                    'config',
                    'types',
                    'tools',
                    'commands',
                    'hooks',
                  ],
                },
              },
            },
          ],
        },
      ],
      'sonarjs/cognitive-complexity': ['error', 12],
      'sonarjs/aws-restricted-ip-admin-access': 'off',
      'no-console': ['error', { allow: ['warn', 'error'] }],
      'object-shorthand': ['error', 'always'],
      'prefer-template': 'error',
      complexity: ['error', 10],
      'max-lines-per-function': [
        'error',
        { max: 80, skipBlankLines: true, skipComments: true },
      ],
      'max-lines': [
        'error',
        { max: 500, skipBlankLines: true, skipComments: true },
      ],
      'security/detect-object-injection': 'off',
      'security/detect-non-literal-fs-filename': 'off',
      'max-params': 'off',
      'no-restricted-syntax': [
        'error',
        {
          selector: 'ExportNamedDeclaration[source]',
          message: 'Do not create pass-through re-export files.',
        },
        {
          selector: 'ExportAllDeclaration',
          message: 'Do not use export * barrel files.',
        },
        {
          selector:
            "TSTypeReference[typeName.name='ReturnType'] > TSTypeParameterInstantiation > TSTypeQuery > Identifier",
          message:
            'Do not use ReturnType<typeof fn> for local codebase functions. Define and export an explicit type instead.',
        },
        {
          selector:
            'CallExpression[callee.object.name=/^(it|test|describe)$/][callee.property.name=/^(skip|todo)$/]',
          message: 'Do not leave skipped or todo tests.',
        },
      ],
      'unicorn/prevent-abbreviations': [
        'error',
        {
          allowList: {
            // React conventions
            Props: true,
            props: true,
            Ref: true,
            ref: true,
            Refs: true,
            refs: true,
            params: true,
            Params: true,
            prev: true,
            utils: true,
            Utils: true,

            // Common React/TS component naming
            FC: true,
            JSX: true,
            CSS: true,
            HTML: true,
            SVG: true,
            DOM: true,
            UI: true,

            // TypeScript / bundler conventions
            env: true,
            Env: true,
            DB: true,
            db: true,

            // Common test/story conventions
            args: true,
            Args: true,

            // Common backend/API naming when used in React projects
            req: true,
            res: true,

            // Common callback/helper naming
            fn: true,
            Fn: true,

            // Error handling convention
            err: true,

            // Temporary values; allow only exact names
            temp: true,

            // Custom
            pageNum: true,
          },

          ignore: [
            // Files
            /^vite-env\.d$/u,
            /\.stories$/u,
            /\.test$/u,
            /\.spec$/u,
            /\.e2e$/u,

            // React hook dependency naming patterns
            /^set[A-Z]/u,

            // Generic component prop type names
            /Props$/u,
            /Ref$/u,
          ],

          checkProperties: false,
          checkShorthandProperties: false,
          checkDefaultAndNamespaceImports: 'internal',
          checkShorthandImports: 'internal',
        },
      ],
    },
  },
  {
    files: ['**/*.test.ts'],
    rules: {
      'max-lines-per-function': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/ban-ts-comment': 'off',
      'unicorn/no-null': 'off',
      '@typescript-eslint/no-unsafe-type-assertion': 'off',
    },
  },
  {
    files: ['cradle/config/shell-risk.ts'],
    rules: {
      'security/detect-non-literal-regexp': 'off',
    },
  },
  globalIgnores([
    '.dependency-cruiser.js',
    '*.config.mjs',
    'eslint.config.mjs',
    'dangerfile.ts',
    'dist/**',
    'coverage/**',
    '.opencode/**',
    '.worktrees/**',
    '.pi/**',
    'vitest.config.ts',
    'vitest.setup.ts',
    'vitest.strict-reporter.ts',
    'eslint-rules/**',
  ]),
])

export default eslintConfig
