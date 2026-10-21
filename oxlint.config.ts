import type {OxlintConfig} from 'oxlint'

// oxlint-disable max-lines -- one entry per rule, and a split list hides which rules are on
import {defineConfig} from 'oxlint'

// ADR 0005: the app drives the Provider SDKs directly. `@tanstack/ai-client`
// stays open, since the ADR keeps it as a later option.
const NO_AI_LIBRARY = {
  group: [
    'ai',
    'ai/*',
    '@ai-sdk/*',
    '@tanstack/ai',
    '@tanstack/ai-anthropic',
    '@tanstack/ai-openai',
    '@tanstack/ai-react',
    '@openai/codex-sdk',
    'langchain',
    'langchain/*',
    '@langchain/*',
  ],
  message:
    'No AI library: drive the Provider SDKs directly and map them into the contract (ADR 0005).',
}

// ADR 0015: vendor SDK types stay inside their Provider host.
const VENDOR_SDK = {
  group: ['@anthropic-ai/claude-agent-sdk', '@anthropic-ai/claude-agent-sdk/*'],
  message:
    'Vendor SDKs stay inside app/provider-host, which translates them into the contract (ADR 0015).',
}

const LUCIDE_ICON_SUFFIX = {
  group: ['lucide-react'],
  allowImportNamePattern: 'Icon$|^Lucide|^createLucideIcon$',
  message:
    'Import lucide icons with the Icon suffix, e.g. HomeIcon instead of Home.',
}

type RestrictedImports = NonNullable<
  OxlintConfig['rules']
>['no-restricted-imports']

function restrictedImports(input: {vendorSdk: boolean}): RestrictedImports {
  const {vendorSdk} = input

  return [
    'error',
    {
      patterns: [
        NO_AI_LIBRARY,
        LUCIDE_ICON_SUFFIX,
        ...(vendorSdk ? [] : [VENDOR_SDK]),
      ],
    },
  ]
}

const config: OxlintConfig = {
  ignorePatterns: [
    '**/dist/**',
    '**/.tsout/**',
    '.agents/**',
    '.claude/**',
    'skills-lock.json',
    // Copied from dmmulroy/anti-slop and kept as upstream wrote it. See
    // UPSTREAM.md beside it.
    'tooling/oxlint/anti-slop/**',
  ],

  jsPlugins: [
    './tooling/oxlint/uz/index.ts',
    {name: 'anti-slop', specifier: './tooling/oxlint/anti-slop/index.ts'},
  ],

  // https://oxc.rs/docs/guide/usage/linter/plugins.html#supported-plugins
  // Each plugin's recommended rules are enabled automatically.
  plugins: [
    'eslint',
    'import',
    'oxc',
    'promise',
    'react',
    'typescript',
    'unicorn',
    'vitest',
  ],
  categories: {
    correctness: 'error',
    suspicious: 'error',
    perf: 'error',
  },
  options: {
    typeAware: true,
    maxWarnings: 0,
    // A disable comment that no longer suppresses anything fails the run.
    reportUnusedDisableDirectives: 'error',
  },
  env: {
    builtin: true,
  },
  overrides: [
    {
      files: ['app/renderer/src/**'],
      env: {browser: true},
      rules: {
        'uz/no-hardcoded-colors': 'error',
      },
    },
    {
      files: ['app/renderer/src/modules/theme/**'],
      rules: {
        'uz/no-hardcoded-colors': 'off',
      },
    },
    {
      files: [
        'app/main/**',
        'app/preload/**',
        'app/provider-host/**',
        'scripts/**',
        'shell/**',
        'tooling/**',
      ],
      env: {node: true},
    },
    {
      files: ['app/provider-host/**'],
      rules: {
        'no-restricted-imports': restrictedImports({vendorSdk: true}),
      },
    },
    {
      // Each of these tools reads its config or plugin from the default export.
      files: [
        '**/vite.config.ts',
        'oxlint.config.ts',
        'vitest.config.ts',
        'tooling/oxlint/uz/index.ts',
      ],
      rules: {
        'import/no-default-export': 'off',
      },
    },
    {
      files: ['**/*.d.ts'],
      rules: {
        'import/unambiguous': 'off',
      },
    },
    {
      // Command-line tools: their output is the console.
      files: ['scripts/**', 'tooling/**'],
      rules: {
        'no-console': 'off',
      },
    },
    {
      files: ['**/*.test.*'],
      rules: {
        'max-lines': 'off',
        // A fake stands in for a callback the unit hands it, often a no-op.
        'no-empty-function': 'off',
        // A test narrows a fake to the type the unit takes. Prefer shoehorn's
        // `fromPartial` where it fits.
        'typescript/no-unsafe-type-assertion': 'off',
        // `expect(fake.method)` references the method unbound by design.
        'typescript/unbound-method': 'off',
      },
    },
    {
      // A literal's value is a union of primitives, and typeof is how a rule
      // tells them apart.
      files: ['tooling/oxlint/**'],
      rules: {
        'anti-slop/no-runtime-typeof': 'off',
      },
    },
    {
      // A lint rule's test holds the code it lints as strings.
      files: ['tooling/oxlint/**/*.test.ts'],
      rules: {
        'no-template-curly-in-string': 'off',
      },
    },
  ],
  rules: {
    complexity: ['error', {max: 15}],

    // A named function is a declaration. An arrow stays an inline callback.
    'func-style': ['error', 'declaration', {allowArrowFunctions: false}],

    ////////////
    // eslint //
    ////////////

    'accessor-pairs': 'error',
    'array-callback-return': 'error',
    // Replaced by the type-aware typescript/switch-exhaustiveness-check.
    'default-case': 'off',
    'default-case-last': 'error',
    eqeqeq: 'error',
    'max-lines': [
      'warn',
      {max: 400, skipBlankLines: true, skipComments: false},
    ],
    'no-alert': 'error',
    'no-array-constructor': 'error',
    'no-await-in-loop': 'off',
    'no-bitwise': 'warn',
    'no-console': 'error',
    'no-else-return': 'error',
    'no-empty': 'error',
    'no-empty-function': 'warn',
    'no-extend-native': 'error',
    'no-extra-bind': 'error',
    'no-fallthrough': 'error',
    'no-implicit-coercion': [
      'error',
      {boolean: false, number: false, string: true},
    ],
    'no-labels': 'error',
    'no-multi-assign': 'error',
    'no-negated-condition': 'warn',
    'no-new-func': 'error',
    'no-object-constructor': 'error',
    'no-promise-executor-return': 'error',
    'no-proto': 'error',
    'no-restricted-imports': restrictedImports({vendorSdk: false}),
    'no-return-assign': 'error',
    'no-script-url': 'error',
    'no-sequences': 'error',
    'no-shadow': 'warn',
    'no-template-curly-in-string': 'warn',
    'no-underscore-dangle': 'off',
    'no-unexpected-multiline': 'warn',
    'no-unneeded-ternary': 'warn',
    'no-var': 'error',
    'object-shorthand': 'warn',
    'prefer-const': 'warn',
    'prefer-destructuring': 'warn',
    'prefer-object-has-own': 'warn',
    'prefer-rest-params': 'error',
    'preserve-caught-error': 'error',
    radix: 'error',
    // oxfmt sorts the declarations, this sorts the names inside the braces.
    'sort-imports': ['error', {ignoreDeclarationSort: true}],
    'symbol-description': 'error',
    yoda: 'error',

    ////////////////
    // typescript //
    ////////////////

    'typescript/adjacent-overload-signatures': 'error',
    'typescript/array-type': ['warn', {default: 'array', readonly: 'array'}],
    'typescript/ban-ts-comment': [
      'error',
      {
        'ts-check': false,
        'ts-nocheck': false,
        'ts-expect-error': 'allow-with-description',
        'ts-ignore': false,
      },
    ],
    'typescript/consistent-indexed-object-style': ['error', 'record'],
    'typescript/consistent-type-definitions': ['error', 'interface'],
    'typescript/consistent-type-exports': 'error',
    'typescript/consistent-type-imports': 'error',
    'typescript/dot-notation': 'error',
    'typescript/no-confusing-non-null-assertion': 'error',
    'typescript/no-empty-interface': 'error',
    'typescript/no-empty-object-type': 'error',
    'typescript/no-explicit-any': ['error', {fixToUnknown: true}],
    'typescript/no-floating-promises': 'error',
    'typescript/no-generated-empty-object-type': 'error',
    'typescript/no-import-type-side-effects': 'error',
    'typescript/no-inferrable-types': 'error',
    'typescript/no-misused-promises': 'error',
    'typescript/no-non-null-assertion': 'error',
    'typescript/no-require-imports': 'error',
    'typescript/no-unnecessary-condition': 'error',
    'typescript/no-unsafe-type-assertion': 'error',
    'typescript/prefer-for-of': 'warn',
    'typescript/prefer-nullish-coalescing': 'warn',
    'typescript/prefer-optional-chain': 'warn',
    'typescript/prefer-reduce-type-parameter': 'error',
    'typescript/prefer-ts-expect-error': 'error',
    'typescript/promise-function-async': 'error',
    'typescript/restrict-plus-operands': [
      'error',
      {
        allowBoolean: false,
        allowNullish: false,
        allowNumberAndString: false,
        allowRegExp: false,
      },
    ],
    'typescript/switch-exhaustiveness-check': [
      'error',
      {requireDefaultForNonUnion: true},
    ],
    'typescript/unified-signatures': 'error',

    /////////////
    // unicorn //
    /////////////

    'unicorn/error-message': 'error',
    'unicorn/explicit-timer-delay': ['error', 'always'],
    'unicorn/import-style': [
      'error',
      {checkExportFrom: true, checkImport: false},
    ],
    'unicorn/new-for-builtins': 'error',
    'unicorn/no-anonymous-default-export': 'error',
    'unicorn/no-array-fill-with-reference-type': 'error',
    'unicorn/no-document-cookie': 'error',
    'unicorn/no-instanceof-array': 'error',
    'unicorn/no-lonely-if': 'error',
    'unicorn/no-new-buffer': 'error',
    'unicorn/no-null': 'off',
    'unicorn/no-typeof-undefined': 'error',
    'unicorn/no-useless-iterator-to-array': 'error',
    'unicorn/prefer-array-find': 'error',
    'unicorn/prefer-array-some': 'error',
    'unicorn/prefer-at': 'error',
    'unicorn/prefer-date-now': 'error',
    'unicorn/prefer-default-parameters': 'error',
    'unicorn/prefer-export-from': 'error',
    'unicorn/prefer-global-this': 'error',
    'unicorn/prefer-includes': 'error',
    'unicorn/prefer-keyboard-event-key': 'error',
    'unicorn/prefer-logical-operator-over-ternary': 'error',
    'unicorn/prefer-math-min-max': 'error',
    'unicorn/prefer-node-protocol': 'error',
    'unicorn/prefer-set-has': 'off',
    'unicorn/prefer-single-call': 'error',
    'unicorn/prefer-string-replace-all': 'error',
    'unicorn/prefer-string-trim-start-end': 'error',
    'unicorn/prefer-ternary': 'error',
    'unicorn/require-number-to-fixed-digits-argument': 'error',
    'unicorn/require-post-message-target-origin': 'off',
    'unicorn/switch-case-braces': ['error', 'avoid'],
    'unicorn/text-encoding-identifier-case': 'error',
    'unicorn/throw-new-error': 'error',

    ///////////
    // react //
    ///////////

    'react/button-has-type': 'error',
    'react/checked-requires-onchange-or-readonly': 'error',
    'react/exhaustive-deps': 'off', // replaced by react/exhaustive-effect-dependencies
    'react/hook-use-state': 'error',
    'react/iframe-missing-sandbox': 'error',
    'react/jsx-boolean-value': ['error', 'never'],
    'react/jsx-curly-brace-presence': ['error', {propElementValues: 'always'}],
    'react/jsx-fragments': ['error', 'syntax'],
    'react/jsx-key': 'error',
    'react/jsx-no-comment-textnodes': 'error',
    'react/jsx-no-constructed-context-values': 'error',
    'react/jsx-no-duplicate-props': 'error',
    'react/jsx-no-script-url': 'error',
    'react/jsx-no-target-blank': 'error',
    'react/jsx-no-useless-fragment': 'error',
    'react/jsx-pascal-case': 'error',
    'react/jsx-props-no-spread-multi': 'error',
    'react/no-array-index-key': 'warn',
    'react/no-danger': 'error',
    'react/no-danger-with-children': 'error',
    'react/no-namespace': 'error',
    'react/no-object-type-as-default-prop': 'error',
    'react/no-react-children': 'error',
    'react/no-render-return-value': 'error',
    'react/no-unescaped-entities': 'error',
    'react/no-unknown-property': 'error',
    'react/no-unstable-nested-components': 'error',
    'react/only-export-components': ['error', {allowConstantExport: true}],
    'react/prefer-function-component': 'error',
    'react/react-in-jsx-scope': 'off',
    // The Rules of React, from the React Compiler's checks. They hold with or
    // without the compiler in the build.
    'react/capitalized-calls': 'error',
    'react/error-boundaries': 'error',
    'react/exhaustive-effect-dependencies': 'error',
    'react/globals': 'error',
    'react/hooks': 'error',
    'react/immutability': 'error',
    'react/incompatible-library': 'error',
    'react/memo-dependencies': 'error',
    'react/no-deriving-state-in-effects': 'error',
    'react/purity': 'error',
    'react/refs': 'error',
    'react/rule-suppression': 'error',
    'react/rules-of-hooks': 'off', // replaced by react/hooks
    'react/self-closing-comp': 'error',
    'react/set-state-in-effect': 'error',
    'react/set-state-in-render': 'error',
    'react/static-components': 'error',
    'react/style-prop-object': 'error',
    'react/use-memo': 'error',
    'react/void-dom-elements-no-children': 'error',
    'react/void-use-memo': 'error',

    /////////
    // oxc //
    /////////

    'oxc/branches-sharing-code': 'error',
    'oxc/misrefactored-assign-op': 'error',
    'oxc/no-accumulating-spread': 'error',
    'oxc/no-barrel-file': 'error',
    'oxc/no-const-enum': 'error',

    ////////////
    // import //
    ////////////

    'import/consistent-type-specifier-style': ['error', 'prefer-top-level'],
    'import/default': 'error',
    'import/export': 'error',
    'import/newline-after-import': 'error',
    'import/no-absolute-path': 'error',
    'import/no-cycle': 'error',
    'import/no-default-export': 'error',
    'import/no-duplicates': 'error',
    'import/no-empty-named-blocks': 'error',
    'import/no-mutable-exports': 'error',
    'import/no-self-import': 'error',
    'import/no-unassigned-import': ['error', {allow: ['**/*.css']}],
    // Every package sets `"type": "module"`, so every file is already a module
    // and this rule can only report false positives.
    'import/unambiguous': 'off',

    /////////////
    // promise //
    /////////////

    'promise/always-return': 'warn',
    'promise/no-multiple-resolved': 'error',
    'promise/no-nesting': 'error',
    'promise/no-new-statics': 'error',
    'promise/no-promise-in-callback': 'error',
    'promise/no-return-in-finally': 'error',
    'promise/no-return-wrap': 'error',
    'promise/param-names': 'error',
    'promise/prefer-catch': 'error',

    ////////////////////////
    // uz (see jsPlugins) //
    ////////////////////////

    'uz/module-boundaries': 'error',
    // Top level, not a test override: it reads only `it`/`test` callbacks.
    'uz/no-fixture-assertion': 'error',
    'uz/tsx-under-ui': 'error',

    ///////////////
    // anti-slop //
    ///////////////

    'anti-slop/no-array-filter-map': 'error',
    'anti-slop/no-chained-type-assertions': 'error',
    'anti-slop/no-known-value-widening': 'error',
    'anti-slop/no-module-mocking': 'error',
    'anti-slop/no-object-parameters': 'error',
    'anti-slop/no-reduce-accumulator-copy': 'error',
    'anti-slop/no-reflect-apply': 'error',
    'anti-slop/no-reflect-get': 'error',
    'anti-slop/no-runtime-typeof': ['error', {allowInTypeGuards: true}],
    'anti-slop/no-shape-in-symbol-names': 'error',
    'anti-slop/no-unknown-parameters': 'error',
    'anti-slop/no-unknown-returns': 'error',
    'anti-slop/no-unknown-type-aliases': 'error',
    'anti-slop/no-unsafe-dictionary-type': 'error',
    'anti-slop/no-widen-then-assert': 'error',
    'anti-slop/require-readable-spacing': 'error',
  },
}

export default defineConfig(config)
