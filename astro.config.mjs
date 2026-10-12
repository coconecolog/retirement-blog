import { defineConfig } from 'astro/config';
import tailwindcss from '@tailwindcss/vite';
import sitemap from '@astrojs/sitemap';

// TODO: 独自ドメインが決まったら site を実際のURLに変更してください（OGP・サイトマップ・RSSの絶対URL生成に使われます）
export default defineConfig({
  site: 'https://coconeco-log.com',
  output: 'static',
  integrations: [
    sitemap({
      // サイト内検索ページは検索結果に載せる必要がないため、サイトマップから除外
      filter: (page) => !page.includes('/search'),
    }),
  ],
  vite: {
    plugins: [tailwindcss()],
  },
});
