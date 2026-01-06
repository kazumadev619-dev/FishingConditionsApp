import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import pluginReact from 'eslint-plugin-react';
import eslintPluginNext from '@next/eslint-plugin-next';
import eslintConfigPrettier from 'eslint-config-prettier';
import eslintPluginReactHooks from 'eslint-plugin-react-hooks';

export default [
  // グローバルignore設定
  {
    ignores: [
      '**/build/',
      '**/bin/',
      '**/dist/',
      '**/obj/',
      '**/out/',
      '**/.next/',
      '**/node_modules/',
    ],
  },

  // JavaScript/CommonJS configuration
  {
    files: ['**/*.{js,mjs,cjs}'],
    name: 'eslint/recommended-javascript',
    rules: js.configs.recommended.rules,
  },

  // TypeScript configuration (TypeScriptファイルにのみ適用)
  {
    files: ['**/*.{ts,mts,cts,tsx}'],
    name: 'eslint/recommended-typescript',
    ...js.configs.recommended,
  },
  ...tseslint.configs.recommended.map((config) => ({
    ...config,
    files: ['**/*.{ts,mts,cts,tsx}'],
  })),

  // React configuration (JSX/TSXファイルにのみ適用)
  {
    files: ['**/*.{jsx,tsx}'],
    name: 'eslint/recommended-react',
    plugins: {
      react: pluginReact,
    },
    rules: pluginReact.configs['jsx-runtime'].rules,
    settings: {
      react: {
        version: 'detect',
        runtime: 'automatic',
      },
    },
  },
  {
    files: ['**/*.{jsx,tsx}'],
    name: 'react/hooks/recommended',
    plugins: {
      'react-hooks': eslintPluginReactHooks,
    },
    rules: eslintPluginReactHooks.configs.recommended.rules,
  },

  // Next.js configuration (Next.js関連ファイルに適用)
  {
    files: ['**/*.{js,mjs,cjs,ts,mts,cts,jsx,tsx}'],
    name: 'next/core-web-vitals',
    plugins: {
      '@next/next': eslintPluginNext,
    },
    rules: {
      ...eslintPluginNext.configs.recommended.rules,
      ...eslintPluginNext.configs['core-web-vitals'].rules,
    },
  },

  // Prettier configuration
  {
    name: 'prettier/config',
    ...eslintConfigPrettier,
  },

  // Project config files (CommonJS)
  {
    files: ['commitlint.config.js'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'commonjs',
      globals: {
        module: 'writable',
        require: 'readonly',
      },
    },
  },
  // Project config files (ESM)
  {
    files: ['postcss.config.js', 'next.config.mjs'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: {
        process: 'readonly',
      },
    },
  },

  // Project custom rules (TypeScriptファイルのみ)
  {
    files: ['**/*.{ts,mts,cts,tsx}'],
    name: 'project-custom',
    rules: {
      '@typescript-eslint/no-empty-object-type': 'off',
      '@typescript-eslint/no-explicit-any': 'warn',
    },
  },
];
