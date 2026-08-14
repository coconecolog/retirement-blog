// public/ogp-default.png を一度だけ生成するスクリプト（トップ/ABOUT/ブログ一覧など、記事に紐づかないページ用）。
// デザインやサイト名を変えたら `node scripts/generate-default-ogp.mjs` を再実行してください。

import satori from 'satori';
import { Resvg } from '@resvg/resvg-js';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const fontRegular = readFileSync(
  fileURLToPath(new URL('../node_modules/@fontsource/noto-sans-jp/files/noto-sans-jp-japanese-400-normal.woff', import.meta.url))
);
const fontBold = readFileSync(
  fileURLToPath(new URL('../node_modules/@fontsource/noto-sans-jp/files/noto-sans-jp-japanese-700-normal.woff', import.meta.url))
);

const SITE_TITLE = '資産の守り方';
const TAGLINE = '老後に向けた、最後の攻めと資産の守り方を学ぶ';

const svg = await satori(
  {
    type: 'div',
    props: {
      style: {
        width: '1200px',
        height: '630px',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        gap: '24px',
        padding: '80px',
        backgroundColor: '#3d5a80',
        color: '#ffffff',
        fontFamily: 'Noto Sans JP',
      },
      children: [
        { type: 'div', props: { style: { fontSize: 64, fontWeight: 700 }, children: SITE_TITLE } },
        { type: 'div', props: { style: { fontSize: 30, opacity: 0.85 }, children: TAGLINE } },
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
writeFileSync(new URL('../public/ogp-default.png', import.meta.url), png);
console.log('generated public/ogp-default.png');
