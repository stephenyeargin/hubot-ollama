// ESLint flat config for ESLint v9
// Uses FlatCompat to load existing shareable configs like airbnb-base
import globals from 'globals';
import pluginImport from 'eslint-plugin-import';
import pluginN from 'eslint-plugin-n';
import pluginPromise from 'eslint-plugin-promise';

// Custom rule groups for clarity
const baseRules = {
  // Core quality
  'eqeqeq': ['warn', 'smart'],
  'curly': ['warn', 'multi-line'],
  'no-console': ['warn', { allow: ['warn', 'error'] }],
  'no-unused-vars': ['warn', { args: 'after-used', ignoreRestSiblings: true }],
  'no-implicit-coercion': 'warn',
  'prefer-const': 'warn',
  'object-shorthand': ['warn', 'always'],
  'arrow-body-style': ['warn', 'as-needed'],
  // Import hygiene
  'import/order': ['warn', {
    'groups': ['builtin', 'external', 'internal', 'parent', 'sibling', 'index'],
    'newlines-between': 'always',
    'alphabetize': { order: 'asc', caseInsensitive: true },
  }],
  'import/no-duplicates': 'warn',
  'import/newline-after-import': ['warn', { count: 1 }],
  // Node best practices
  'n/no-process-exit': 'warn',
  'promise/no-return-wrap': 'warn',
};

export default [
  // Global ignores
  {
    ignores: ['node_modules/**', 'test-results/**', 'eslint.config.*'],
  },
  // Environments and parser options
  {
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'commonjs', // CommonJS project
      globals: {
        ...globals.node,
        ...globals.jest,
      },
    },
  },
  // Plugin recommended configs
  pluginImport.flatConfigs.recommended,
  pluginN.configs['flat/recommended'],
  pluginPromise.configs['flat/recommended'],
  // Project-specific rules and stricter defaults
  {
    linterOptions: {
      reportUnusedDisableDirectives: true,
    },
    rules: {
      ...baseRules,
      'no-param-reassign': ['error', { props: false }],
    },
  },
  // Test file overrides
  {
    files: ['test/**'],
    languageOptions: {
      globals: {
        ...globals.jest,
      },
    },
    rules: {
      'n/no-unpublished-require': 'off',
      'n/no-unpublished-import': 'off',
      'no-console': 'off', // Allow console in tests
    },
  },
];
