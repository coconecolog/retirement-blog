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
          padding: '80px',
          backgroundColor: '#3d5a80',
          color: '#ffffff',
          fontFamily: 'Noto Sans JP',
        },
        children: [
          {
            type: 'div',
            props: {
              style: { fontSize: 28, opacity: 0.85, letterSpacing: 2 },
              children: SITE.title,
            },
          },
          {
            type: 'div',
            props: {
              style: {
                fontSize: 56,
                fontWeight: 700,
                lineHeight: 1.4,
                display: '-webkit-box',
                WebkitLineClamp: 3,
                WebkitBoxOrient: 'vertical',
                overflow: 'hidden',
              },
              children: post.title,
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
