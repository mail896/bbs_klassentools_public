import js from '@eslint/js';
import globals from 'globals';
export default [
  { ignores: ['**/node_modules/**'] },
  js.configs.recommended,
  { files: ['public/*.{js,mjs}'], languageOptions: { globals: globals.browser } },
  {
    files: ['backend/*.mjs', 'tests/*.{mjs,cjs}', 'eslint.config.js', 'scripts/*.mjs'],
    languageOptions: { globals: globals.node },
  },
  { files: ['tests/*.{mjs,cjs}'], languageOptions: { globals: globals.browser } },
  {
    rules: {
      'no-unused-vars': ['error', { args: 'after-used', caughtErrors: 'none' }],
      'no-empty': ['error', { allowEmptyCatch: true }],
    },
  },
];
