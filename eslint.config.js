import js from '@eslint/js';
import globals from 'globals';

export default [
  { ignores: ['node_modules/**', 'dist/**', 'site/**', 'macos/**', 'workspace/**', 'docs/**'] },
  js.configs.recommended,
  {
    files: ['**/*.{js,mjs}'],
    languageOptions: { ecmaVersion: 2024, sourceType: 'module', globals: { ...globals.node } },
    rules: {
      // Mevcut kod tabanı için başlangıç seviyesi: gerçek hatalar error, stil uyarı
      'no-unused-vars': ['warn', { args: 'none', caughtErrors: 'none' }],
      'no-empty': ['error', { allowEmptyCatch: true }],
      'no-control-regex': 'off',
      'no-useless-escape': 'warn',
      // Mevcut borç: çeviri tablolarındaki yinelenen anahtarlar ve metin içi NBSP; ayrı PR'da temizlenecek
      'no-dupe-keys': 'warn',
      'no-irregular-whitespace': 'warn',
    },
  },
  { files: ['web/**/*.js'], languageOptions: { globals: { ...globals.browser, Chart: 'readonly' } } },
];
