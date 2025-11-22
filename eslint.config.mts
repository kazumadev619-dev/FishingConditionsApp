import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import pluginReact from 'eslint-plugin-react';
import eslintPluginNext from '@next/eslint-plugin-next';
import eslintConfigPrettier from 'eslint-config-prettier';
import eslintPluginReactHooks from 'eslint-plugin-react-hooks';
import tailwindcss from 'eslint-plugin-tailwindcss';

export default [
  { files: ['**/*.{js,mjs,cjs,ts,mts,cts,jsx,tsx}'] },
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

  // Typescript configuration
  {
    name: 'eslint/recommended-typescript',
    rules: js.configs.recommended.rules,
  },
  ...tseslint.configs.recommended,

  // React configuration
  {
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
    name: 'react/hooks/recommended',
    plugins: {
      'react-hooks': eslintPluginReactHooks,
    },
    rules: eslintPluginReactHooks.configs.recommended.rules,
  },

  // Next.js configuration
  {
    name: 'next/core-web-vitals',
    plugins: {
      '@next/next': eslintPluginNext,
    },
    rules: {
      ...eslintPluginNext.configs.recommended.rules,
      ...eslintPluginNext.configs['core-web-vitals'].rules,
    },
  },

  // Tailwind CSS configuration
  {
    name: 'eslint/recommended-tailwindcss',
    plugins: {
      tailwindcss: tailwindcss,
    },
    rules: {
      'tailwindcss/classnames-order': 'warn',
      'tailwindcss/no-custom-classname': 'off',
    },
    settings: {
      tailwindcss: {
        config: './tailwind.config.ts',
      },
    },
  },

  // Prettier configuration
  {
    name: 'prettier/config',
    ...eslintConfigPrettier,
  },

  // Project config files
  {
    files: ['commitlint.config.js', 'postcss.config.js'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'commonjs',
      globals: {
        module: 'writable',
        require: 'readonly',
      },
    },
  },
  {
    files: ['next.config.mjs'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: {
        process: 'readonly',
      },
    },
  },

  // Project custom rules
  {
    name: 'project-custom',
    rules: {
      '@typescript-eslint/no-empty-object-type': 'off',
      '@typescript-eslint/no-explicit-any': 'warn',
    },
  },
];
