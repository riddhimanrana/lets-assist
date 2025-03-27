import { FlatCompat } from '@eslint/eslintrc';

const compat = new FlatCompat({
  baseDirectory: import.meta.dirname,
});

const eslintConfig = [
  ...compat.config({
    extends: ['next', 'prettier'],
    rules: {
      'react-hooks/exhaustive-deps': 'off',
      '@next/next/no-duplicate-head': 'off', // Disable the rule
    },
  }),
];

export default eslintConfig;