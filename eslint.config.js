import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: ['dist/**', 'node_modules/**', 'prototype/**', 'playwright-report/**', 'test-results/**'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['schemas/**/*.ts', 'src/**/*.ts', 'tests/**/*.ts'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: {
        ...globals.browser,
        ...globals.es2022,
      },
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      'no-empty': ['error', { allowEmptyCatch: false }],
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['*prototype*'],
              message: '严禁在生产代码中引用阶段 2 一次性灰盒原型 prototype/ 目录！',
            },
          ],
        },
      ],
    },
  },
  {
    // SDD-G 最高红线：src/core/** 强制无头解耦（零 DOM / 零 Canvas / 零 window / 零 Math.random）
    files: ['src/core/**/*.ts'],
    languageOptions: {
      globals: {
        ...globals.es2022,
      },
    },
    rules: {
      'no-restricted-globals': [
        'error',
        { name: 'window', message: 'src/core 严禁访问 window（无头解耦红线）' },
        { name: 'document', message: 'src/core 严禁访问 document（无头解耦红线）' },
        { name: 'localStorage', message: 'src/core 严禁访问 localStorage（无头解耦红线）' },
        { name: 'sessionStorage', message: 'src/core 严禁访问 sessionStorage（无头解耦红线）' },
        { name: 'requestAnimationFrame', message: 'src/core 严禁调用 requestAnimationFrame（无头解耦红线）' },
        { name: 'cancelAnimationFrame', message: 'src/core 严禁调用 cancelAnimationFrame（无头解耦红线）' },
        { name: 'AudioContext', message: 'src/core 严禁调用 AudioContext（无头解耦红线）' },
        { name: 'performance', message: 'src/core 严禁依赖浏览器 performance 时钟，请消费固定 dt' },
      ],
      'no-restricted-properties': [
        'error',
        {
          object: 'Math',
          property: 'random',
          message: 'src/core 严禁使用 Math.random()，必须使用注入的 SeededRNG！',
        },
      ],
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: [
                '*prototype*',
                '**/presentation/**',
                '**/ui/**',
                '**/input/**',
                '**/storage/**',
                '**/main*',
              ],
              message: 'src/core 严禁逆向依赖表现层、UI、输入、存储或宿主入口！',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['tests/**/*.ts'],
    languageOptions: {
      globals: {
        ...globals.node,
        ...globals.browser,
      },
    },
  },
);
