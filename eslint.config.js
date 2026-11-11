import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist/', 'node_modules/', 'data/', 'public/', 'spike/'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      // PayPal and LLM payloads are untyped JSON at the boundary; they are narrowed in normalize/zod.
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },
);
