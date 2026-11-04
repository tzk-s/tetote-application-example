import { resolve } from 'node:path';
import { defineConfig } from 'vite';

export default defineConfig({
  css: {
    preprocessorOptions: {
      scss: {
        // 各 SCSS から `@use 'global' as *;` で共通の値と mixin を読めるようにする
        loadPaths: [resolve(import.meta.dirname, 'src/styles')],
      },
    },
  },
  build: {
    // 募集一覧・職種別詳細・応募フォームの 3 画面を、それぞれ独立した HTML として出力する
    rollupOptions: {
      input: {
        list: resolve(import.meta.dirname, 'index.html'),
        detail: resolve(import.meta.dirname, 'job.html'),
        entry: resolve(import.meta.dirname, 'entry.html'),
      },
    },
  },
});
