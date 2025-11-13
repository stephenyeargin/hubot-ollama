// ESLint flat config for ESLint v9
// Uses FlatCompat to load existing shareable configs like airbnb-base
import globals from 'globals';
import pluginImport from 'eslint-plugin-import';
import pluginN from 'eslint-plugin-n';
import pluginPromise from 'eslint-plugin-promise';

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
  // Project-specific rules that were in .eslintrc.js
  {
    rules: {
      'no-param-reassign': ['error', { props: false }],
    },
  },
  // Test file overrides
  {
    files: ['test/**'],
    rules: {
      'n/no-unpublished-require': 'off',
      'n/no-unpublished-import': 'off',
    },
  },
];
