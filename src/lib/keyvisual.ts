// 記事ページのキービジュアル（ファーストビューのイラスト）を、ビルド時に自動で作る。
//
// 一覧カードと同じサムネイル画像（public/images/thumbnails/ の money-cups.png など）から
// 背景色を取り除き（透明にし）、イラストの部分だけを切り出して dist/images/keyvisual/ に書き出す。
// 背景の〇（カテゴリ色）は記事ページ側（src/pages/blog/[slug].astro）で重ねて表示する。
//
// サムネイルがNotionで直接アップロードした画像の場合は、写真などの背景を消すと崩れるため使わず、
// 記事IDから絵柄を決めて、共通の絵柄画像からキービジュアルを作る。
import sharp from 'sharp';
import path from 'node:path';
import { existsSync, mkdirSync, readdirSync } from 'node:fs';

export type KeyVisual = {
  src: string;
  width: number;
  height: number;
};

const PUBLIC_DIR = path.join(process.cwd(), 'public');
const POOL_DIR = path.join(PUBLIC_DIR, 'images', 'thumbnails');
// notion.ts のサムネイルと同じ理由で、ビルド出力先（dist/）に直接書き込む。
const OUTPUT_DIR = path.join(process.cwd(), 'dist', 'images', 'keyvisual');
// 書き出す画像の高さ（表示は200pxなので、高解像度画面向けに2倍）
const OUTPUT_HEIGHT = 400;
// 背景から少しでも離れた色を、どれだけ濃く（不透明に）残すか。1より大きいほど線がくっきりする。
const ALPHA_BOOST = 1.25;
// 切り出すときに、イラストの周りに残す余白（元画像のピクセル数）
const TRIM_PADDING = 12;

// 同じ元画像からは1回だけ作る
const cache = new Map<string, Promise<KeyVisual | null>>();

function hashPageId(pageId: string): number {
  let hash = 0;
  for (const ch of pageId.replace(/-/g, '')) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return hash;
}

// サムネイルのURLから、キービジュアルの元にする画像ファイルを決める
function resolveSourceFile(thumbnail: string | null, pageId: string): string | null {
  if (thumbnail && thumbnail.startsWith('/images/thumbnails/')) {
    const file = path.join(PUBLIC_DIR, thumbnail);
    if (existsSync(file)) return file;
  }
  // 絵柄画像以外（Notionでアップロードした画像など）の場合は、記事IDから絵柄を選ぶ
  if (!existsSync(POOL_DIR)) return null;
  const files = readdirSync(POOL_DIR)
    .filter((f) => /^common-.+\.(png|jpe?g|webp)$/i.test(f))
    .sort((a, b) => a.localeCompare(b, 'en', { numeric: true }));
  if (files.length === 0) return null;
  return path.join(POOL_DIR, files[hashPageId(pageId) % files.length]);
}

// 背景色を透明にする（いわゆる「色を透明に」）。線のにじみ部分も、背景色を差し引いた色＋半透明にする。
function removeBackground(data: Buffer, channels: number, bg: [number, number, number]): Buffer {
  const out = Buffer.alloc((data.length / channels) * 4);
  for (let i = 0, o = 0; i < data.length; i += channels, o += 4) {
    let alpha = 0;
    for (let c = 0; c < 3; c++) {
      const p = data[i + c];
      const b = bg[c];
      const a = p < b ? (b - p) / b : p > b ? (p - b) / (255 - b) : 0;
      if (a > alpha) alpha = a;
    }
    alpha = Math.min(1, alpha * ALPHA_BOOST);
    if (alpha < 0.04) {
      out[o + 3] = 0;
      continue;
    }
    for (let c = 0; c < 3; c++) {
      const v = bg[c] + (data[i + c] - bg[c]) / alpha;
      out[o + c] = Math.max(0, Math.min(255, Math.round(v)));
    }
    out[o + 3] = Math.round(alpha * 255);
  }
  return out;
}

// 透明でない部分を囲む範囲を求める
function findBounds(rgba: Buffer, width: number, height: number) {
  let left = width, top = height, right = -1, bottom = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (rgba[(y * width + x) * 4 + 3] > 10) {
        if (x < left) left = x;
        if (x > right) right = x;
        if (y < top) top = y;
        if (y > bottom) bottom = y;
      }
    }
  }
  if (right < 0) return null;
  left = Math.max(0, left - TRIM_PADDING);
  top = Math.max(0, top - TRIM_PADDING);
  right = Math.min(width - 1, right + TRIM_PADDING);
  bottom = Math.min(height - 1, bottom + TRIM_PADDING);
  return { left, top, width: right - left + 1, height: bottom - top + 1 };
}

async function build(sourceFile: string): Promise<KeyVisual | null> {
  try {
    const { data, info } = await sharp(sourceFile).removeAlpha().raw().toBuffer({ resolveWithObject: true });
    // 左上の色を背景色とみなす
    const bg: [number, number, number] = [data[0], data[1], data[2]];
    const rgba = removeBackground(data, info.channels, bg);
    const bounds = findBounds(rgba, info.width, info.height);
    if (!bounds) return null;

    const relative = path.relative(PUBLIC_DIR, sourceFile).replace(/[\\/]/g, '-').replace(/\.[^.]+$/, '');
    const filename = `${relative}.png`;
    if (!existsSync(OUTPUT_DIR)) mkdirSync(OUTPUT_DIR, { recursive: true });

    const outHeight = Math.min(OUTPUT_HEIGHT, bounds.height);
    const result = await sharp(rgba, { raw: { width: info.width, height: info.height, channels: 4 } })
      .extract(bounds)
      .resize({ height: outHeight })
      .png({ compressionLevel: 9 })
      .toFile(path.join(OUTPUT_DIR, filename));

    return { src: `/images/keyvisual/${filename}`, width: result.width, height: result.height };
  } catch (error) {
    console.warn(`[keyvisual] キービジュアルを作れませんでした（${sourceFile}）:`, error);
    return null;
  }
}

export function getKeyVisual(post: { id: string; thumbnail: string | null }): Promise<KeyVisual | null> {
  const sourceFile = resolveSourceFile(post.thumbnail, post.id);
  if (!sourceFile) return Promise.resolve(null);
  if (!cache.has(sourceFile)) cache.set(sourceFile, build(sourceFile));
  return cache.get(sourceFile)!;
}
