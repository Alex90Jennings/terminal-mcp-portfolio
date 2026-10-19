import nextCoreWebVitals from 'eslint-config-next/core-web-vitals';
import nextTypeScript from 'eslint-config-next/typescript';
import jsxA11y from 'eslint-plugin-jsx-a11y';

/** One config for the whole repository: Next.js, React hooks, jsx-a11y and typescript-eslint rules. */
const config = [
  {
    ignores: ['**/node_modules/**', '**/.next/**', '**/generated/**', '**/playwright-report/**', '**/test-results/**', '**/next-env.d.ts'],
  },
  ...nextCoreWebVitals,
  ...nextTypeScript,
  {
    settings: { next: { rootDir: 'apps/web/' } },
    rules: {
      // eslint-config-next registers jsx-a11y but enables only a few of its rules.
      ...jsxA11y.flatConfigs.recommended.rules,
      '@typescript-eslint/consistent-type-imports': ['error', { fixStyle: 'inline-type-imports' }],
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      'jsx-a11y/no-autofocus': 'error',
      eqeqeq: ['error', 'always'],
      'no-console': ['error', { allow: ['warn', 'error', 'log'] }],
    },
  },
];

export default config;
