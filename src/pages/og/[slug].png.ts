// 記事ごとのOGP画像をビルド時に自動生成するエンドポイント。
// タイトルとサイト名だけを使ったシンプルなカード画像を、記事1本ごとに1枚生成します。

import type { APIRoute } from 'astro';
import satori from 'satori';
import { Resvg } from '@resvg/resvg-js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { getAllPosts } from '../../lib/notion';
import { SITE } from '../../lib/site.config';

const fontRegular = readFileSync(
  fileURLToPath(new URL('../../../node_modules/@fontsource/noto-sans-jp/files/noto-sans-jp-japanese-400-normal.woff', import.meta.url))
);
const fontBold = readFileSync(
  fileURLToPath(new URL('../../../node_modules/@fontsource/noto-sans-jp/files/noto-sans-jp-japanese-700-normal.woff', import.meta.url))
);

export async function getStaticPaths() {
  const posts = await getAllPosts();
  return posts.map((post) => ({ params: { slug: post.slug }, props: { post } }));
}

export const GET: APIRoute = async ({ props }) => {
  const post = (props as any).post;

  const category: string = post.categories?.[0] ?? '';

  // 新デザインの配色（生成りの背景・ボルドーの文字・マスタードの線）
  const svg = await satori(
    {
      type: 'div',
      props: {
        style: {
          width: '1200px',
          height: '630px',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          padding: '72px 88px',
          backgroundColor: '#f6f0e5',
          borderLeft: '16px solid #6e2636',
          color: '#392a27',
          fontFamily: 'Noto Sans JP',
        },
        children: [
          {
            type: 'div',
            props: {
              style: { display: 'flex', alignItems: 'center', gap: '18px', fontSize: 26, fontWeight: 700, color: '#6e2636' },
              children: [
                { type: 'div', props: { style: { width: '56px', height: '4px', backgroundColor: '#c79a3b' } } },
                { type: 'div', props: { children: category || 'BLOG' } },
              ],
            },
          },
          {
            type: 'div',
            props: {
              style: {
                fontSize: 58,
                fontWeight: 700,
                lineHeight: 1.45,
                display: '-webkit-box',
                WebkitLineClamp: 3,
                WebkitBoxOrient: 'vertical',
                overflow: 'hidden',
              },
              children: post.title,
            },
          },
          {
            type: 'div',
            props: {
              style: { display: 'flex', alignItems: 'center', gap: '16px', fontSize: 28, color: '#6e2636' },
              children: [
                { type: 'div', props: { style: { width: '14px', height: '14px', borderRadius: '9999px', backgroundColor: '#c79a3b' } } },
                { type: 'div', props: { children: SITE.title } },
              ],
            },
          },
        ],
      },
    },
    {
      width: 1200,
      height: 630,
      fonts: [
        { name: 'Noto Sans JP', data: fontRegular, weight: 400, style: 'normal' },
        { name: 'Noto Sans JP', data: fontBold, weight: 700, style: 'normal' },
      ],
    }
  );

  const resvg = new Resvg(svg, { fitTo: { mode: 'width', value: 1200 } });
  const png = resvg.render().asPng();

  return new Response(png, {
    headers: { 'Content-Type': 'image/png' },
  });
};
