// Notionデータベースから「公開」フラグが立っている記事だけをビルド時に取得するモジュール。
//
// Notion側のプロパティ名は下の PROP をそのまま使う想定です。
// ご自身のNotionデータベースでプロパティ名を変えた場合は、ここだけ書き換えれば動きます。

import { Client } from '@notionhq/client';
import { NotionToMarkdown } from 'notion-to-md';
import { marked, Renderer } from 'marked';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { SITE } from './site.config';

const NOTION_TOKEN = process.env.NOTION_TOKEN;
const NOTION_DATABASE_ID = process.env.NOTION_DATABASE_ID;

// 「タグ」「メインタグ」はどちらもこのマスターDB（マスタータグ）へのリレーション。
// 「カテゴリ」は別のマスターDB（マスターカテゴリ）へのリレーション。
// どちらも記事側のプロパティはリレーションの「関連ページID」しか持たないため、
// ここでマスターDB側を丸ごと取得してID→名前のマップを作り、突き合わせて名前を取得する。
const MASTER_TAG_DATABASE_ID = '3c616da1dade80389f77e9c03497a0d8';
const MASTER_CATEGORY_DATABASE_ID = '3c616da1dade80169c43e77f1ad6444b';
// マスターDB側で、タグ名・カテゴリ名が入っているタイトル列の名前。
const MASTER_TAG_TITLE_PROP = 'タグ';
const MASTER_CATEGORY_TITLE_PROP = 'カテゴリ';

// マスターカテゴリDB側の追加プロパティ名(説明文・自動サムネイル背景画像)。
// 「サムネ用タイトル」「サムネ用サブタイトル」は記事側のプロパティで、
// 表記ゆれ（「サムネ用」/「サムネイル用」）があっても拾えるよう候補を複数持たせている。
const MASTER_CATEGORY_DESCRIPTION_PROP = '説明文';
const MASTER_CATEGORY_BACKGROUND_PROP = '背景画像ファイル名';
const THUMBNAIL_TITLE_PROP_CANDIDATES = ['サムネ用タイトル', 'サムネイル用タイトル'];
const THUMBNAIL_SUBTITLE_PROP_CANDIDATES = ['サムネ用サブタイトル', 'サムネイル用サブタイトル'];

// 執筆者マスターDB（別データベース、記事側からはリレーションで参照）。
const MASTER_AUTHOR_DATABASE_ID = '3d516da1dade8015965fdce867c279e4';
const MASTER_AUTHOR_TITLE_PROP = '名前';
const MASTER_AUTHOR_ROLE_PROP = '肩書';
const MASTER_AUTHOR_EXPERTISE_PROP = '主な経験分野';
const MASTER_AUTHOR_BIO_PROP = '執筆者紹介文';
const MASTER_AUTHOR_SLUG_PROP = 'Slug';
const MASTER_AUTHOR_IMAGE_PROP = '執筆者画像';
// SNSリンクは現状すべて空欄（準備中）の想定。空欄の場合はサイト側で「準備中」と表示する。
const MASTER_AUTHOR_SNS_PROPS = {
  x: 'X',
  threads: 'Threads',
  instagram: 'Instagram',
  linkedin: 'LinkedIn',
  facebook: 'Facebook',
  youtube: 'YouTube',
} as const;

// サムネイル画像の保存先。
// 本来は public/ 配下に置きたいところだが、Astroはビルド開始時の早い段階で public/ の中身を
// dist/ へコピーしてしまい、その後（getStaticPathsの実行中）に public/ へファイルを書き足しても
// 出力には反映されない。そのためビルド出力先（dist/）に直接書き込む。
// `npm run build`（= astro build）はプロジェクトのルートディレクトリで実行される前提。
const THUMBNAIL_DIR = path.join(process.cwd(), 'dist', 'thumbnails') + path.sep;
// 執筆者画像も同じ理由でビルド出力先（dist/）に直接書き込む。
const AUTHOR_IMAGE_DIR = path.join(process.cwd(), 'dist', 'authors') + path.sep;

const EXT_BY_CONTENT_TYPE: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/svg+xml': 'svg',
};

export const PROP = {
  title: 'タイトル',
  // マスタータグDBへのリレーション（複数選択可）。
  tags: 'タグ',
  publishedAt: '公開日',
  updatedAt: '更新日',
  thumbnail: 'サムネイル画像',
  published: '公開',
  // 半角英数字とハイフンで指定するURL用のスラッグ。空欄ならページIDを自動で使う。
  slug: 'スラッグ',
  // 検索結果・OGPに使うメタディスクリプション。空欄なら本文からの自動抜粋を使う。
  description: 'ディスクリプション',
  // 記事ページの「この記事でわかること」ボックスに表示する要点。空欄なら非表示。
  summary: '記事の要点',
  // 「同じメインタグの記事」欄に何を並べるかを決めるプロパティ。マスタータグDBへのリレーション。
  // 複数選択できてしまうが、従来通り「1記事につき1つ」の運用を前提に、先頭の1件だけを使う。
  // 空欄ならその記事は関連記事欄の対象にならない。
  mainTag: 'メインタグ',
  // サイドバーの「カテゴリ」欄に使う、マスターカテゴリDBへのリレーション（複数選択可）。
  category: 'カテゴリ',
  // 執筆者マスターDBへのリレーション。複数選択できてしまうが、1記事につき1人の運用を前提に先頭の1件だけを使う。
  author: '執筆者',
} as const;

export type TocItem = {
  id: string;
  text: string;
  // 見出し3（H3）は、直前の見出し2（H2）の下にネストして持たせる。
  children: TocItem[];
};

export type AuthorSns = {
  x: string | null;
  threads: string | null;
  instagram: string | null;
  linkedin: string | null;
  facebook: string | null;
  youtube: string | null;
};

export type Author = {
  id: string;
  slug: string;
  name: string;
  role: string | null;
  expertise: string | null;
  bio: string | null;
  image: string | null;
  sns: AuthorSns;
};

export type Post = {
  id: string;
  slug: string;
  title: string;
  tags: string[];
  publishedAt: string;
  updatedAt: string;
  thumbnail: string | null;
  html: string;
  toc: TocItem[];
  excerpt: string;
  description: string;
  summary: string | null;
  mainTag: string | null;
  categories: string[];
  author: Author | null;
};

let cachedPosts: Post[] | null = null;

function getClient() {
  if (!NOTION_TOKEN || !NOTION_DATABASE_ID) {
    console.warn(
      '[notion] NOTION_TOKEN / NOTION_DATABASE_ID が未設定です。.env または GitHub Secrets / Cloudflare Pages の環境変数を確認してください。記事は0件で出力されます。'
    );
    return null;
  }
  // NOTION_API_BASE_URL は通常未設定でOK（テスト時のモックサーバー差し替え用）
  const baseUrl = process.env.NOTION_API_BASE_URL;
  return new Client({ auth: NOTION_TOKEN, ...(baseUrl ? { baseUrl } : {}) });
}

function getPlainTitle(prop: any): string {
  return prop?.title?.map((t: any) => t.plain_text).join('') || '無題の記事';
}

function getThumbnail(prop: any): string | null {
  const file = prop?.files?.[0];
  if (!file) return null;
  if (file.type === 'external') return file.external?.url ?? null;
  if (file.type === 'file') return file.file?.url ?? null;
  return null;
}

// Notion page id（ハイフン付きUUID）からハイフンを除いたものをスラッグとして使用（フォールバック用）。
function toSlug(pageId: string): string {
  return pageId.replace(/-/g, '');
}

// サムネイル画像のURL（Notionにアップロードしたファイル、またはCanva等からダウンロードして
// Notionにアップロードしたファイル）を実際にダウンロードし、サイト自身のファイルとして保存する。
//
// これが必要な理由:
// ・Notionにアップロードしたファイルの参照URLは1時間ほどで失効するため、ビルド時にそのURLを
//   そのままサイトに埋め込むと、公開後しばらくして画像が表示されなくなる。
// ・ここで画像を取得できた場合のみサイトのファイルとして保存し、失敗した場合（URLの指す先が
//   画像ファイルでない等）は null を返して呼び出し側でプレースホルダー表示にフォールバックする。
async function downloadThumbnail(url: string, pageId: string): Promise<string | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) {
      console.warn(`[notion] サムネイル画像の取得に失敗しました（HTTP ${res.status}）: ${url}`);
      return null;
    }
    const contentType = res.headers.get('content-type')?.split(';')[0]?.trim() ?? '';
    const ext = EXT_BY_CONTENT_TYPE[contentType];
    if (!ext) {
      console.warn(
        `[notion] サムネイル画像のURLの中身が画像ファイルではないようです（Content-Type: ${
          contentType || '不明'
        }）。Notionのサムネイル画像プロパティには画像ファイルそのものを直接アップロードしてください。URL: ${url}`
      );
      return null;
    }
    if (!existsSync(THUMBNAIL_DIR)) {
      mkdirSync(THUMBNAIL_DIR, { recursive: true });
    }
    const filename = `${toSlug(pageId)}.${ext}`;
    const buffer = Buffer.from(await res.arrayBuffer());
    writeFileSync(`${THUMBNAIL_DIR}${filename}`, buffer);
    return `/thumbnails/${filename}`;
  } catch (err) {
    console.warn(`[notion] サムネイル画像の取得中にエラーが発生しました: ${url}`, err);
    return null;
  }
}

// 執筆者画像も、サムネイル画像と同じ理由（NotionアップロードURLが失効する）でダウンロードして保存する。
async function downloadAuthorImage(url: string, pageId: string): Promise<string | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) {
      console.warn(`[notion] 執筆者画像の取得に失敗しました（HTTP ${res.status}）: ${url}`);
      return null;
    }
    const contentType = res.headers.get('content-type')?.split(';')[0]?.trim() ?? '';
    const ext = EXT_BY_CONTENT_TYPE[contentType];
    if (!ext) {
      console.warn(
        `[notion] 執筆者画像のURLの中身が画像ファイルではないようです（Content-Type: ${
          contentType || '不明'
        }）。執筆者マスターDBの執筆者画像プロパティには画像ファイルそのものを直接アップロードしてください。URL: ${url}`
      );
      return null;
    }
    if (!existsSync(AUTHOR_IMAGE_DIR)) {
      mkdirSync(AUTHOR_IMAGE_DIR, { recursive: true });
    }
    const filename = `${toSlug(pageId)}.${ext}`;
    const buffer = Buffer.from(await res.arrayBuffer());
    writeFileSync(`${AUTHOR_IMAGE_DIR}${filename}`, buffer);
    return `/authors/${filename}`;
  } catch (err) {
    console.warn(`[notion] 執筆者画像の取得中にエラーが発生しました: ${url}`, err);
    return null;
  }
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// リンク先がサイト外（他のドメイン）かどうかを判定する。
// SITE.url（src/lib/site.config.ts）を基準にするため、独自ドメインを設定したときはそちらを
// 変更するだけで、ここは自動的に正しく判定されるようになる（このファイルを直す必要はない）。
function isExternalUrl(href: string): boolean {
  // まずhref単体を絶対URLとして解釈する（Notionのリンクはほぼ常に絶対URL）。
  // SITE.urlの値が万一不正な形式でも、hrefさえ解釈できれば判定を続けられるようにする。
  let target: URL;
  try {
    target = new URL(href);
  } catch {
    try {
      target = new URL(href, SITE.url);
    } catch {
      return false;
    }
  }
  if (target.protocol !== 'http:' && target.protocol !== 'https:') return false;

  try {
    const site = new URL(SITE.url);
    return target.hostname !== site.hostname;
  } catch {
    // SITE.urlが不正な形式で自サイトのホスト名がわからない場合は、
    // 安全側として「サイト外」として扱う（新しいタブで開く）。
    return true;
  }
}

// サイト外リンクにだけ target="_blank" を付ける（サイト内リンクは同じウィンドウで遷移させる）。
function linkTargetAttrs(href: string): string {
  return isExternalUrl(href) ? ' target="_blank" rel="noopener noreferrer"' : '';
}

// Notionのリッチテキスト配列（太字・リンクなどの書式付きテキスト）を、書式を保ったままインラインHTMLに変換する。
// キャプションなどで「一部の文字だけにリンクが貼ってある」ケースでも、そのリンクを保持するために使う。
function richTextToInlineHtml(richText: any[]): string {
  return (richText ?? [])
    .map((t: any) => {
      const raw: string = t.plain_text ?? '';
      let html = escapeHtml(raw).replace(/\n/g, '<br>\n');
      const ann = t.annotations ?? {};
      if (ann.code) html = `<code>${html}</code>`;
      if (ann.bold) html = `<strong>${html}</strong>`;
      if (ann.italic) html = `<em>${html}</em>`;
      if (ann.strikethrough) html = `<s>${html}</s>`;
      if (ann.underline) html = `<u>${html}</u>`;
      const href: string | null = t.href ?? null;
      if (href) html = `<a href="${escapeHtml(href)}"${linkTargetAttrs(href)}>${html}</a>`;
      return html;
    })
    .join('');
}

// Notionの「表（テーブル）」ブロックをMarkdownの表記法ではなく、独自のHTML（table/thead/tbody）に変換する。
//
// これが必要な理由:
// 標準の変換では、表のセルの中で改行（Shift+Enterでの改行や、セル内の複数行のテキスト）が含まれていると、
// Markdownの表の記法（1行1レコード）が崩れてしまい、表そのものが正しく組み立てられなくなる不具合があった
// （セルが別の行にはみ出す、太字の**が記号のまま表示される、など）。
// ここではMarkdownを経由せず直接HTMLを組み立てるため、セル内の改行や太字・リンクなどの書式が保たれる。
async function tableToHtml(notion: Client, block: any): Promise<string> {
  const table = block.table ?? {};
  // Notionの表ブロックの設定（「列の見出し」「行の見出し」）をそのまま反映する。
  // どちらもオン/オフ独立していて、片方だけ・両方・どちらもなし、すべてのパターンがありうる。
  const hasColumnHeader: boolean = !!table.has_column_header;
  const hasRowHeader: boolean = !!table.has_row_header;
  if (!block.has_children) return '';

  let rows: any[] = [];
  try {
    const res: any = await notion.blocks.children.list({ block_id: block.id, page_size: 100 });
    rows = (res.results ?? []).filter((r: any) => r.type === 'table_row');
  } catch (err) {
    console.warn(`[notion] 表の行の取得に失敗しました: ${block.id}`, err);
    return '';
  }
  if (rows.length === 0) return '';

  // 行ごとに「セルのHTML文字列の配列」を作る（文字列に結合してから分割する、といったことはしない。
  // セルの中身自体にスペースが含まれるため、結合してから分割すると壊れてしまう）。
  const rowsCells: string[][] = rows.map((row: any) => {
    const cells: any[][] = row.table_row?.cells ?? [];
    return cells.map((cell) => richTextToInlineHtml(cell ?? []));
  });

  let bodyStart = 0;
  let theadHtml = '';
  if (hasColumnHeader && rowsCells.length > 0) {
    // 1行目を列の見出し行として<thead>に入れる。
    theadHtml = `<thead><tr>${rowsCells[0].map((c) => `<th scope="col">${c}</th>`).join('')}</tr></thead>`;
    bodyStart = 1;
  }

  const bodyRowsHtml = rowsCells
    .slice(bodyStart)
    .map((cells) => {
      const cellsHtml = cells
        .map((c, i) =>
          // 行の見出しが有効な場合、各行の1列目だけ<th>にする（2列目以降は通常のセル）。
          hasRowHeader && i === 0 ? `<th scope="row">${c}</th>` : `<td>${c}</td>`
        )
        .join('');
      return `<tr>${cellsHtml}</tr>`;
    })
    .join('');

  return `\n<table class="notion-table">${theadHtml}<tbody>${bodyRowsHtml}</tbody></table>\n\n`;
}

// Notionの「見出し4」ブロックをHTMLの<h4>にそのまま変換する。
// notion-to-mdは見出し1〜3までしか標準対応していないため、これがないと見出し4は素の段落（<p>）になってしまう。
function heading4ToHtml(block: any): string {
  const heading = block.heading_4 ?? {};
  const html = richTextToInlineHtml(heading.rich_text ?? []);
  return `\n<h4 class="notion-heading-4">${html}</h4>\n\n`;
}

// コールアウトブロックの中で改行（Enter）を押して段落を追加すると、Notion上ではその段落は
// コールアウトブロックの「子ブロック」として保存される（コールアウト自身のrich_textには含まれない）。
// そのため、子ブロックがある場合はAPIから取得し、段落として追記する。
// ここでは段落・箇条書きなど、rich_textを持つ単純なブロックのみ対応する（表・画像等のネストは非対応）。
async function calloutChildrenToHtml(notion: Client, blockId: string): Promise<string> {
  try {
    const res: any = await notion.blocks.children.list({ block_id: blockId, page_size: 100 });
    const parts: string[] = [];
    for (const child of res.results ?? []) {
      const childType = child.type;
      const richText = child[childType]?.rich_text;
      if (!richText) continue;
      const html = richTextToInlineHtml(richText);
      if (html.trim()) parts.push(`<p>${html}</p>`);
    }
    return parts.join('\n');
  } catch (err) {
    console.warn(`[notion] コールアウト内の続きの段落の取得に失敗しました: ${blockId}`, err);
    return '';
  }
}

// Notionの「コールアウト」ブロックをMarkdownの引用（>）ではなく、独自のHTML（div.notion-callout）に変換する。
// これにより、記事ページ側で「引用ブロック」と見た目を区別できるようにする（コールアウトは枠線・斜体なし）。
async function calloutToHtml(notion: Client, block: any): Promise<string> {
  const callout = block.callout ?? {};
  const icon = callout.icon;
  const emoji = icon?.type === 'emoji' ? `${icon.emoji} ` : '';
  const firstLineHtml = richTextToInlineHtml(callout.rich_text ?? []);
  let bodyHtml = `<p>${emoji}${firstLineHtml}</p>`;
  if (block.has_children) {
    const childrenHtml = await calloutChildrenToHtml(notion, block.id);
    if (childrenHtml) bodyHtml += `\n${childrenHtml}`;
  }
  return `\n<div class="notion-callout">\n${bodyHtml}\n</div>\n\n`;
}

// Notionの画像ブロックをMarkdownの画像記法ではなく、独自のHTML（figure/figcaption）に変換する。
//
// Notionの画像ブロックには「キャプション」欄が1つしかなく、alt（代替テキスト）専用の欄はない。
// そのため、このキャプション欄の入力ルールで両方をまかなう:
// ・空欄                     → altなし、キャプション非表示（従来通り画像のみ表示）
// ・「alt:」または「alt：」で始める → altのみ設定（キャプションは表示されない）
// ・それ以外の通常のテキスト        → そのテキストをaltとして設定し、キャプションとしても表示する
function imageToHtml(block: any): string {
  const image = block.image ?? {};
  const type = image.type;
  let src = '';
  if (type === 'external') src = image.external?.url ?? '';
  if (type === 'file') src = image.file?.url ?? '';
  if (!src) return '';

  const captionRichText: any[] = image.caption ?? [];
  const rawCaption: string = captionRichText.map((t: any) => t.plain_text).join('').trim();

  let alt = '';
  let visibleCaptionHtml: string | null = null;
  const altOnlyMatch = rawCaption.match(/^alt[:：]\s*([\s\S]*)$/i);
  if (altOnlyMatch) {
    alt = altOnlyMatch[1].trim();
  } else if (rawCaption) {
    alt = rawCaption;
    // キャプションの一部にリンクや太字などの書式が設定されている場合、それを保ったまま表示する。
    visibleCaptionHtml = richTextToInlineHtml(captionRichText);
  }

  const imgTag = `<img src="${escapeHtml(src)}" alt="${escapeHtml(alt)}" loading="lazy" />`;
  if (visibleCaptionHtml) {
    return `\n<figure class="notion-figure">\n${imgTag}\n<figcaption>${visibleCaptionHtml}</figcaption>\n</figure>\n\n`;
  }
  return `\n<figure class="notion-figure">\n${imgTag}\n</figure>\n\n`;
}

// 「スラッグ」プロパティ（rich_text）の値を取得し、URLとして安全な形に整形する。
// 半角英数字・ハイフン以外は取り除き、空欄なら null を返す（呼び出し側でページIDにフォールバック）。
function getCustomSlug(prop: any): string | null {
  const raw: string = prop?.rich_text?.map((t: any) => t.plain_text).join('') ?? '';
  const cleaned = raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  return cleaned || null;
}

// 「ディスクリプション」プロパティ（rich_text）の値をそのまま取得する。空欄なら null。
function getCustomText(prop: any): string | null {
  const raw: string = prop?.rich_text?.map((t: any) => t.plain_text).join('') ?? '';
  const trimmed = raw.trim();
  return trimmed || null;
}

// 候補となるプロパティ名を順に試し、最初に見つかった値を返す（表記ゆれ対策）。
function getFirstCustomText(props: any, names: string[]): string | null {
  for (const name of names) {
    const value = getCustomText(props?.[name]);
    if (value) return value;
  }
  return null;
}

// SNSリンクのプロパティは「URL」型・「テキスト」型のどちらで作られていても拾えるようにする。
function getUrlOrText(prop: any): string | null {
  const url: string = typeof prop?.url === 'string' ? prop.url.trim() : '';
  if (url) return url;
  return getCustomText(prop);
}

// ------------------------------------------------------------
// カテゴリ背景画像 → 自動生成サムネイル（MKTG.AXと同じ仕組み）
// ------------------------------------------------------------
//
// 記事に「サムネイル画像」が設定されていない場合、その記事の（先頭の）カテゴリに
// マスターカテゴリDBで登録した「背景画像ファイル名」があれば、それを背景に
// 「サムネ用タイトル」（未入力なら記事タイトル）「サムネ用サブタイトル」を重ねたSVG画像を
// ビルド時に生成して使う。画像はGitHubリポジトリの public/images/category-backgrounds/
// にアップロードしておく（資料ファイルと同じ運用）。

const CATEGORY_BACKGROUND_DIR = path.join(process.cwd(), 'public', 'images', 'category-backgrounds') + path.sep;
// public/ と同じ理由で、生成したサムネイルもビルド出力先（dist/）に直接書き込む。
const GENERATED_THUMBNAIL_DIR = path.join(process.cwd(), 'dist', 'images', 'generated') + path.sep;

const CATEGORY_BG_MIME_BY_EXT: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
};

const categoryBackgroundCache = new Map<string, string | null>();

// カテゴリの背景画像（public/images/category-backgrounds/ にアップロードされたファイル）を
// 読み込み、SVGに直接埋め込める data: URI にして返す。見つからない場合は null（呼び出し側は
// グラデーションにフォールバックする）。
function resolveCategoryBackgroundDataUri(filename: string | null | undefined): string | null {
  const trimmed = (filename || '').trim();
  if (!trimmed) return null;
  if (categoryBackgroundCache.has(trimmed)) return categoryBackgroundCache.get(trimmed) ?? null;

  const ext = path.extname(trimmed).toLowerCase();
  const mime = CATEGORY_BG_MIME_BY_EXT[ext];
  if (!mime) {
    console.warn(`[notion] 背景画像ファイル名「${trimmed}」の拡張子が非対応です（png/jpg/jpeg/webpのみ）。`);
    categoryBackgroundCache.set(trimmed, null);
    return null;
  }

  try {
    const buffer = readFileSync(`${CATEGORY_BACKGROUND_DIR}${trimmed}`);
    const dataUri = `data:${mime};base64,${buffer.toString('base64')}`;
    categoryBackgroundCache.set(trimmed, dataUri);
    return dataUri;
  } catch {
    console.warn(
      `[notion] 背景画像が見つかりません: public/images/category-backgrounds/${trimmed}（アップロード忘れ、またはファイル名のタイプミスがないか確認してください）`
    );
    categoryBackgroundCache.set(trimmed, null);
    return null;
  }
}

function escapeXmlText(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function estimateCharWidth(ch: string): number {
  return /[ -~]/.test(ch) ? 0.55 : 1;
}

function wrapThumbnailText(text: string, maxWidth: number, maxLines: number): string[] {
  const chars = Array.from((text || '').trim());
  const lines: string[] = [];
  let current = '';
  let currentWidth = 0;

  for (const ch of chars) {
    const w = estimateCharWidth(ch);
    if (currentWidth + w > maxWidth && current) {
      lines.push(current);
      current = '';
      currentWidth = 0;
      if (lines.length === maxLines) break;
    }
    current += ch;
    currentWidth += w;
  }
  if (current && lines.length < maxLines) lines.push(current);

  // 最終行だけ1文字になってしまう見苦しい折り返し（widow）を避けるため、直前の行に戻す。
  // 多少maxWidthを超えても、1文字だけが宙に浮くよりは見た目が良い。
  if (lines.length >= 2 && lines[lines.length - 1].length === 1) {
    const orphan = lines.pop() as string;
    lines[lines.length - 1] += orphan;
  }

  const consumedLength = lines.reduce((sum, l) => sum + l.length, 0);
  if (lines.length === maxLines && consumedLength < chars.length) {
    let last = lines[maxLines - 1];
    while (last.length > 1 && estimateCharWidth('…') + [...last].reduce((s, c) => s + estimateCharWidth(c), 0) > maxWidth) {
      last = last.slice(0, -1);
    }
    lines[maxLines - 1] = `${last}…`;
  }
  return lines;
}

// 背景画像もテーマカラーも無い場合の既定グラデーション。
const DEFAULT_THUMBNAIL_GRADIENT: [string, string] = ['#3d5a80', '#2c4362'];

// サムネイル画像が未設定の記事用に、カテゴリの背景画像（無ければ既定グラデーション）に
// タイトル・サブタイトルを重ねたSVG画像をビルド出力先に生成する。失敗してもビルドを止めず null を返す。
function generateFallbackThumbnail(idHint: string, dataUri: string | null, title: string, subtitle: string | null): string | null {
  try {
    const titleFontSize = 66;
    const titleLineHeight = 82;
    // キャンバス幅1200px・左右余白72pxずつ・このフォントサイズでの実測に合わせた値
    // （ぎりぎりまで詰めて、早すぎる折り返しを避ける）。
    const titleWrapWidth = 15;
    const subtitleFontSize = 42;
    const subtitleLineHeight = 56;
    const subtitleWrapWidth = 22;
    const blockGap = 20;

    const titleLines = wrapThumbnailText(title, titleWrapWidth, 3);
    const subtitleLines = subtitle ? wrapThumbnailText(subtitle, subtitleWrapWidth, 2) : [];

    const blockHeight =
      (subtitleLines.length > 0 ? subtitleLines.length * subtitleLineHeight + blockGap : 0) +
      titleLines.length * titleLineHeight;
    let cursorY = (675 - blockHeight) / 2;

    cursorY += subtitleLines.length > 0 ? subtitleLineHeight * 0.75 : titleLineHeight * 0.75;
    const subtitleTspans = subtitleLines
      .map((line) => {
        const tspan = `<tspan x="72" y="${cursorY.toFixed(1)}">${escapeXmlText(line)}</tspan>`;
        cursorY += subtitleLineHeight;
        return tspan;
      })
      .join('');

    if (subtitleLines.length > 0) cursorY += blockGap - subtitleLineHeight + titleLineHeight * 0.75;
    const titleTspans = titleLines
      .map((line) => {
        const tspan = `<tspan x="72" y="${cursorY.toFixed(1)}">${escapeXmlText(line)}</tspan>`;
        cursorY += titleLineHeight;
        return tspan;
      })
      .join('');

    const backgroundMarkup = dataUri
      ? `<image href="${dataUri}" x="0" y="0" width="1200" height="675" preserveAspectRatio="xMidYMid slice" />
  <rect width="1200" height="675" fill="#000000" opacity="0.35" />`
      : (() => {
          const [colorFrom, colorTo] = DEFAULT_THUMBNAIL_GRADIENT;
          return `<defs>
    <linearGradient id="grad-${idHint}" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="${colorFrom}" />
      <stop offset="100%" stop-color="${colorTo}" />
    </linearGradient>
  </defs>
  <rect width="1200" height="675" fill="url(#grad-${idHint})" />
  <circle cx="1080" cy="80" r="220" fill="#ffffff" opacity="0.08" />
  <circle cx="1160" cy="600" r="140" fill="#ffffff" opacity="0.06" />`;
        })();

    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="675" viewBox="0 0 1200 675">
  ${backgroundMarkup}
  ${subtitleLines.length > 0 ? `<text font-family="'Hiragino Sans','Yu Gothic',sans-serif" font-size="${subtitleFontSize}" font-weight="400" fill="#ffffff" fill-opacity="0.9">${subtitleTspans}</text>` : ''}
  <text font-family="'Hiragino Sans','Yu Gothic',sans-serif" font-size="${titleFontSize}" font-weight="700" fill="#ffffff">${titleTspans}</text>
</svg>`;

    if (!existsSync(GENERATED_THUMBNAIL_DIR)) {
      mkdirSync(GENERATED_THUMBNAIL_DIR, { recursive: true });
    }
    const filename = `thumb-${idHint}.svg`;
    writeFileSync(`${GENERATED_THUMBNAIL_DIR}${filename}`, svg, 'utf-8');
    return `/images/generated/${filename}`;
  } catch (err) {
    console.warn(`[notion] 自動生成サムネイルの作成に失敗しました (${idHint})`, err);
    return null;
  }
}

type CategoryMeta = { description: string | null; backgroundImage: string | null; content: string };
let cachedCategoryMeta: Map<string, CategoryMeta> | null = null;

// マスターカテゴリDBを丸ごと取得し、カテゴリ名 → {説明文, 背景画像ファイル名, ページ本文のHTML} の
// マップを作る。カテゴリ一覧ページの説明文・本文表示と、自動生成サムネイルの背景画像選択で使う。
export async function getCategoryMeta(): Promise<Map<string, CategoryMeta>> {
  if (cachedCategoryMeta) return cachedCategoryMeta;

  const map = new Map<string, CategoryMeta>();
  const notion = getClient();
  if (!notion) {
    cachedCategoryMeta = map;
    return map;
  }

  const n2m = new NotionToMarkdown({ notionClient: notion });
  n2m.setCustomTransformer('heading_4', async (block: any) => heading4ToHtml(block));
  n2m.setCustomTransformer('callout', async (block: any) => calloutToHtml(notion, block));
  n2m.setCustomTransformer('image', async (block: any) => imageToHtml(block));
  n2m.setCustomTransformer('table', async (block: any) => tableToHtml(notion, block));

  try {
    const db: any = await notion.databases.retrieve({ database_id: MASTER_CATEGORY_DATABASE_ID });
    const dataSourceId: string | undefined = db?.data_sources?.[0]?.id;
    if (!dataSourceId) {
      console.warn('[notion] マスターカテゴリDBのデータソースが見つかりませんでした。');
      cachedCategoryMeta = map;
      return map;
    }
    let cursor: string | undefined = undefined;
    do {
      const res: any = await notion.dataSources.query({ data_source_id: dataSourceId, start_cursor: cursor });
      for (const page of res.results as any[]) {
        const name = getPlainTitle(page.properties?.[MASTER_CATEGORY_TITLE_PROP]);
        const description = getCustomText(page.properties?.[MASTER_CATEGORY_DESCRIPTION_PROP]);
        const backgroundImage = getCustomText(page.properties?.[MASTER_CATEGORY_BACKGROUND_PROP]);
        let content = '';
        try {
          const mdBlocks = await n2m.pageToMarkdown(page.id);
          const mdString = n2m.toMarkdownString(mdBlocks).parent ?? '';
          content = mdString ? (marked.parse(mdString) as string) : '';
        } catch (err) {
          console.warn(`[notion] マスターカテゴリ「${name}」の本文の取得に失敗しました。`, err);
        }
        if (name) map.set(name, { description, backgroundImage, content });
      }
      cursor = res.has_more ? res.next_cursor ?? undefined : undefined;
    } while (cursor);
  } catch (err) {
    console.warn('[notion] マスターカテゴリDBの詳細情報の取得に失敗しました。', err);
  }

  cachedCategoryMeta = map;
  return map;
}

let cachedAuthorsById: Map<string, Author> | null = null;
let cachedAuthorsBySlug: Map<string, Author> | null = null;

// 執筆者マスターDBを丸ごと取得し、ページID→執筆者情報、スラッグ→執筆者情報の両方のマップを作る。
// 記事側のリレーションはページIDしか持たないため、まずID側で引き、
// 執筆者ごとの一覧ページ（/blog/author/[slug]）はスラッグ側で引く。
async function loadAuthors(): Promise<{ byId: Map<string, Author>; bySlug: Map<string, Author> }> {
  if (cachedAuthorsById && cachedAuthorsBySlug) {
    return { byId: cachedAuthorsById, bySlug: cachedAuthorsBySlug };
  }

  const byId = new Map<string, Author>();
  const bySlug = new Map<string, Author>();
  const notion = getClient();
  if (!notion) {
    cachedAuthorsById = byId;
    cachedAuthorsBySlug = bySlug;
    return { byId, bySlug };
  }

  try {
    const db: any = await notion.databases.retrieve({ database_id: MASTER_AUTHOR_DATABASE_ID });
    const dataSourceId: string | undefined = db?.data_sources?.[0]?.id;
    if (!dataSourceId) {
      console.warn('[notion] 執筆者マスターDBのデータソースが見つかりませんでした。');
      cachedAuthorsById = byId;
      cachedAuthorsBySlug = bySlug;
      return { byId, bySlug };
    }

    let cursor: string | undefined = undefined;
    do {
      const res: any = await notion.dataSources.query({ data_source_id: dataSourceId, start_cursor: cursor });
      for (const page of res.results as any[]) {
        const props = page.properties;
        const name = getPlainTitle(props?.[MASTER_AUTHOR_TITLE_PROP]);
        const fallbackSlug = toSlug(page.id);
        const customSlug = getCustomSlug(props?.[MASTER_AUTHOR_SLUG_PROP]);
        const slug = customSlug || fallbackSlug;
        const role = getCustomText(props?.[MASTER_AUTHOR_ROLE_PROP]);
        const expertise = getCustomText(props?.[MASTER_AUTHOR_EXPERTISE_PROP]);
        const bio = getCustomText(props?.[MASTER_AUTHOR_BIO_PROP]);

        const rawImage = getThumbnail(props?.[MASTER_AUTHOR_IMAGE_PROP]);
        const image = rawImage ? await downloadAuthorImage(rawImage, page.id) : null;

        const sns: AuthorSns = {
          x: getUrlOrText(props?.[MASTER_AUTHOR_SNS_PROPS.x]),
          threads: getUrlOrText(props?.[MASTER_AUTHOR_SNS_PROPS.threads]),
          instagram: getUrlOrText(props?.[MASTER_AUTHOR_SNS_PROPS.instagram]),
          linkedin: getUrlOrText(props?.[MASTER_AUTHOR_SNS_PROPS.linkedin]),
          facebook: getUrlOrText(props?.[MASTER_AUTHOR_SNS_PROPS.facebook]),
          youtube: getUrlOrText(props?.[MASTER_AUTHOR_SNS_PROPS.youtube]),
        };

        const author: Author = { id: page.id, slug, name, role, expertise, bio, image, sns };
        byId.set(page.id, author);
        bySlug.set(slug, author);
      }
      cursor = res.has_more ? res.next_cursor ?? undefined : undefined;
    } while (cursor);
  } catch (err) {
    console.warn(
      '[notion] 執筆者マスターDBの取得に失敗しました。Notionの連携（インテグレーション）がこのDBに共有されているか確認してください。',
      err
    );
  }

  cachedAuthorsById = byId;
  cachedAuthorsBySlug = bySlug;
  return { byId, bySlug };
}

// 執筆者一覧（執筆者ごとの一覧ページの静的パス生成に使う）。
export async function getAllAuthors(): Promise<Author[]> {
  const { byId } = await loadAuthors();
  return Array.from(byId.values());
}

// スラッグから執筆者情報を取得する（/blog/author/[slug] ページ用）。
export async function getAuthorBySlug(slug: string): Promise<Author | null> {
  const { bySlug } = await loadAuthors();
  return bySlug.get(slug) ?? null;
}

// マスターDB（マスタータグ／マスターカテゴリ）を丸ごと取得し、ページID→名前（タイトル列の値）の
// マップを作る。記事側のリレーションプロパティは関連ページIDしか持たないため、
// この対応表と突き合わせて初めて「タグ」「カテゴリ」の名前がわかる。
async function fetchMasterNameMap(
  notion: Client,
  databaseId: string,
  titlePropName: string
): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  try {
    const db: any = await notion.databases.retrieve({ database_id: databaseId });
    const dataSourceId: string | undefined = db?.data_sources?.[0]?.id;
    if (!dataSourceId) {
      console.warn(`[notion] マスターDB（${databaseId}）のデータソースが見つかりませんでした。`);
      return map;
    }
    let cursor: string | undefined = undefined;
    do {
      const res: any = await notion.dataSources.query({ data_source_id: dataSourceId, start_cursor: cursor });
      for (const page of res.results as any[]) {
        const name = getPlainTitle(page.properties?.[titlePropName]);
        map.set(page.id, name);
      }
      cursor = res.has_more ? res.next_cursor ?? undefined : undefined;
    } while (cursor);
  } catch (err) {
    console.warn(
      `[notion] マスターDB（${databaseId}）の取得に失敗しました。Notionの連携（インテグレーション）がこのDBに共有されているか確認してください。`,
      err
    );
  }
  return map;
}

// リレーションプロパティ（関連ページIDの配列）を、マスターDBの対応表を使って名前の配列に変換する。
// 対応表に見つからないID（マスターDB未共有・削除済みページなど）は黙ってスキップする。
function getRelationNames(prop: any, nameMap: Map<string, string>): string[] {
  const relations: any[] = prop?.relation ?? [];
  return relations.map((r) => nameMap.get(r.id)).filter((name): name is string => !!name);
}

// 本文のMarkdownをHTMLに変換すると同時に、見出し2（##）・見出し3（###）に自動でIDを振り、
// 目次（見出しのリスト。見出し3は見出し2の下にネスト）を作る。目次はブログ記事ページのキービジュアル下に表示する。
function renderContentWithToc(markdown: string): { html: string; toc: TocItem[] } {
  const toc: TocItem[] = [];
  let h2Count = 0;
  let h3Count = 0;
  let orphanH3Count = 0;
  let currentH2: TocItem | null = null;
  const renderer = new Renderer();
  renderer.heading = function (this: any, { tokens, depth }: any) {
    const inner = this.parser.parseInline(tokens);
    const text = inner.replace(/<[^>]+>/g, '').trim();

    if (depth === 2) {
      h2Count += 1;
      h3Count = 0;
      const id = `heading-${h2Count}`;
      const item: TocItem = { id, text, children: [] };
      toc.push(item);
      currentH2 = item;
      return `<h2 id="${id}">${inner}</h2>\n`;
    }

    if (depth === 3) {
      let id: string;
      if (currentH2) {
        h3Count += 1;
        id = `${currentH2.id}-${h3Count}`;
        currentH2.children.push({ id, text, children: [] });
      } else {
        // 見出し2より前にいきなり見出し3が出てきた場合（想定外だが念のため）。
        // 目次には載せず、本文側にはIDだけ振っておく。
        orphanH3Count += 1;
        id = `heading-3-${orphanH3Count}`;
      }
      return `<h3 id="${id}">${inner}</h3>\n`;
    }

    return `<h${depth}>${inner}</h${depth}>\n`;
  };
  // 本文中の通常のリンクにも、サイト内/サイト外の判定を適用する（サイト外だけ新しいタブで開く）。
  renderer.link = function (this: any, { href, title, tokens }: any) {
    const text = this.parser.parseInline(tokens);
    const titleAttr = title ? ` title="${escapeHtml(title)}"` : '';
    return `<a href="${escapeHtml(href)}"${titleAttr}${linkTargetAttrs(href)}>${text}</a>`;
  };
  const html = marked.parse(markdown, { renderer }) as string;
  return { html, toc };
}

function makeExcerpt(markdown: string, length = 110): string {
  const plain = markdown
    .replace(/```[\s\S]*?```/g, '')
    .replace(/!\[.*?\]\(.*?\)/g, '')
    .replace(/\[(.*?)\]\(.*?\)/g, '$1')
    .replace(/[#*`>_\-]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return plain.length > length ? plain.slice(0, length) + '…' : plain;
}

export async function getAllPosts(): Promise<Post[]> {
  if (cachedPosts) return cachedPosts;

  const notion = getClient();
  if (!notion) {
    cachedPosts = [];
    return cachedPosts;
  }

  const n2m = new NotionToMarkdown({ notionClient: notion });
  // 見出し4・コールアウト・画像・表ブロックは独自のHTML変換にする（詳細は各関数のコメントを参照）。
  // 引用（quote）ブロックはここで変換を上書きしないため、従来通りの見た目（枠線・斜体）のまま。
  n2m.setCustomTransformer('heading_4', async (block: any) => heading4ToHtml(block));
  n2m.setCustomTransformer('callout', async (block: any) => calloutToHtml(notion, block));
  n2m.setCustomTransformer('image', async (block: any) => imageToHtml(block));
  n2m.setCustomTransformer('table', async (block: any) => tableToHtml(notion, block));
  const posts: Post[] = [];
  const usedSlugs = new Set<string>();
  let cursor: string | undefined = undefined;

  // Notion API 2025-09 以降、データベースは1つ以上の「データソース」を持つ構造になったため、
  // まずデータベースを取得してデフォルトのデータソースIDを特定してからクエリする。
  const db: any = await notion.databases.retrieve({ database_id: NOTION_DATABASE_ID as string });
  const dataSourceId: string | undefined = db?.data_sources?.[0]?.id;
  if (!dataSourceId) {
    console.error('[notion] データソースが見つかりませんでした。NOTION_DATABASE_ID を確認してください。');
    cachedPosts = [];
    return cachedPosts;
  }

  // 「タグ」「メインタグ」「カテゴリ」の名前解決に使うマスターDBの対応表を先に作っておく。
  // categoryMeta は自動生成サムネイルの背景画像選択にも使う。
  const [tagNameMap, categoryNameMap, categoryMeta, authorsById] = await Promise.all([
    fetchMasterNameMap(notion, MASTER_TAG_DATABASE_ID, MASTER_TAG_TITLE_PROP),
    fetchMasterNameMap(notion, MASTER_CATEGORY_DATABASE_ID, MASTER_CATEGORY_TITLE_PROP),
    getCategoryMeta(),
    loadAuthors().then((r) => r.byId),
  ]);

  do {
    const res: any = await notion.dataSources.query({
      data_source_id: dataSourceId,
      start_cursor: cursor,
      filter: {
        property: PROP.published,
        checkbox: { equals: true },
      },
      sorts: [{ property: PROP.publishedAt, direction: 'descending' }],
    });

    for (const page of res.results as any[]) {
      const props = page.properties;
      const title = getPlainTitle(props[PROP.title]);
      const tags: string[] = getRelationNames(props[PROP.tags], tagNameMap);
      const publishedAt: string = props[PROP.publishedAt]?.date?.start ?? page.created_time;
      const updatedAt: string = props[PROP.updatedAt]?.date?.start ?? page.last_edited_time;
      const categories: string[] = getRelationNames(props[PROP.category], categoryNameMap);
      const rawThumbnail = getThumbnail(props[PROP.thumbnail]);
      let thumbnail = rawThumbnail ? await downloadThumbnail(rawThumbnail, page.id) : null;
      // サムネイル画像が未設定の記事は、先頭のカテゴリの背景画像（無ければ既定グラデーション）に
      // 「サムネ用タイトル」（未入力なら記事タイトル）「サムネ用サブタイトル」を重ねた画像を自動生成する。
      if (!thumbnail) {
        // 先頭のカテゴリから順に、実際に背景画像ファイルが見つかるものを探す
        // （複数カテゴリがある記事で、先頭のカテゴリに画像未設定の場合のフォールバック）。
        let backgroundDataUri: string | null = null;
        for (const categoryName of categories) {
          const candidate = resolveCategoryBackgroundDataUri(categoryMeta.get(categoryName)?.backgroundImage);
          if (candidate) {
            backgroundDataUri = candidate;
            break;
          }
        }
        const thumbTitle = getFirstCustomText(props, THUMBNAIL_TITLE_PROP_CANDIDATES) || title;
        const thumbSubtitle = getFirstCustomText(props, THUMBNAIL_SUBTITLE_PROP_CANDIDATES);
        thumbnail = generateFallbackThumbnail(page.id, backgroundDataUri, thumbTitle, thumbSubtitle);
      }

      const fallbackSlug = toSlug(page.id);
      const customSlug = getCustomSlug(props[PROP.slug]);
      let slug = customSlug || fallbackSlug;
      if (usedSlugs.has(slug)) {
        console.warn(`[notion] スラッグ「${slug}」が重複しています。「${title}」はページIDのURLにフォールバックします。`);
        slug = fallbackSlug;
      }
      usedSlugs.add(slug);

      let mdString = '';
      try {
        const mdBlocks = await n2m.pageToMarkdown(page.id);
        mdString = n2m.toMarkdownString(mdBlocks).parent ?? '';
      } catch (err) {
        console.error(`[notion] 本文の取得に失敗しました: ${title} (${page.id})`, err);
      }

      const { html, toc } = renderContentWithToc(mdString || '');
      const excerpt = makeExcerpt(mdString);
      const customDescription = getCustomText(props[PROP.description]);
      const summary = getCustomText(props[PROP.summary]);
      // 「メインタグ」は複数選択できてしまうが、従来通り1記事につき1つの運用を前提に、先頭の1件だけを使う。
      const mainTag = getRelationNames(props[PROP.mainTag], tagNameMap)[0] ?? null;
      // 「執筆者」も同様に複数選択できてしまうが、1記事につき1人の運用を前提に先頭の1件だけを使う。
      const authorRelationIds: string[] = (props[PROP.author]?.relation ?? []).map((r: any) => r.id);
      const author: Author | null = authorRelationIds.length > 0 ? authorsById.get(authorRelationIds[0]) ?? null : null;

      posts.push({
        id: page.id,
        slug,
        title,
        tags,
        publishedAt,
        updatedAt,
        thumbnail,
        html,
        toc,
        excerpt,
        description: customDescription || excerpt,
        summary,
        mainTag,
        categories,
        author,
      });
    }

    cursor = res.has_more ? res.next_cursor ?? undefined : undefined;
  } while (cursor);

  cachedPosts = posts;
  return posts;
}

export async function getAllTags(): Promise<string[]> {
  const posts = await getAllPosts();
  const set = new Set<string>();
  for (const p of posts) for (const t of p.tags) set.add(t);
  return Array.from(set).sort();
}

// 「カテゴリ」が設定されている記事から、重複のない値の一覧を取得する（サイドバーのカテゴリ一覧・カテゴリ別ページ用）。
export async function getAllCategories(): Promise<string[]> {
  const posts = await getAllPosts();
  const set = new Set<string>();
  for (const p of posts) for (const c of p.categories) set.add(c);
  return Array.from(set).sort();
}
