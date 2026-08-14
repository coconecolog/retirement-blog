import { defineConfig } from 'astro/config';
import tailwindcss from '@tailwindcss/vite';
import sitemap from '@astrojs/sitemap';

// TODO: 独自ドメインが決まったら site を実際のURLに変更してください（OGP・サイトマップ・RSSの絶対URL生成に使われます）
export default defineConfig({
  site: 'https://example.com',
  output: 'static',
  integrations: [sitemap()],
  vite: {
    plugins: [tailwindcss()],
  },
});
