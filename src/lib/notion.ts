// Notionデータベースから「公開」フラグが立っている記事だけをビルド時に取得するモジュール。
//
// Notion側のプロパティ名は下の PROP をそのまま使う想定です。
// ご自身のNotionデータベースでプロパティ名を変えた場合は、ここだけ書き換えれば動きます。

import { Client } from '@notionhq/client';
import { NotionToMarkdown } from 'notion-to-md';
import { marked, Renderer } from 'marked';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const NOTION_TOKEN = process.env.NOTION_TOKEN;
const NOTION_DATABASE_ID = process.env.NOTION_DATABASE_ID;

// サムネイル画像の保存先。
// 本来は public/ 配下に置きたいところだが、Astroはビルド開始時の早い段階で public/ の中身を
// dist/ へコピーしてしまい、その後（getStaticPathsの実行中）に public/ へファイルを書き足しても
// 出力には反映されない。そのためビルド出力先（dist/）に直接書き込む。
// `npm run build`（= astro build）はプロジェクトのルートディレクトリで実行される前提。
const THUMBNAIL_DIR = path.join(process.cwd(), 'dist', 'thumbnails') + path.sep;

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
} as const;

export type TocItem = {
  id: string;
  text: string;
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

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// Notionの「コールアウト」ブロックをMarkdownの引用（>）ではなく、独自のHTML（div.notion-callout）に変換する。
// これにより、記事ページ側で「引用ブロック」と見た目を区別できるようにする（コールアウトは枠線・斜体なし）。
function calloutToHtml(block: any): string {
  const callout = block.callout ?? {};
  const icon = callout.icon;
  const emoji = icon?.type === 'emoji' ? `${icon.emoji} ` : '';
  const text: string = (callout.rich_text ?? []).map((t: any) => t.plain_text).join('');
  const html = escapeHtml(text).replace(/\n/g, '<br>\n');
  return `\n<div class="notion-callout">\n<p>${emoji}${html}</p>\n</div>\n\n`;
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

  const rawCaption: string = (image.caption ?? []).map((t: any) => t.plain_text).join('').trim();

  let alt = '';
  let visibleCaption: string | null = null;
  const altOnlyMatch = rawCaption.match(/^alt[:：]\s*([\s\S]*)$/i);
  if (altOnlyMatch) {
    alt = altOnlyMatch[1].trim();
  } else if (rawCaption) {
    alt = rawCaption;
    visibleCaption = rawCaption;
  }

  const imgTag = `<img src="${escapeHtml(src)}" alt="${escapeHtml(alt)}" loading="lazy" />`;
  if (visibleCaption) {
    const captionHtml = escapeHtml(visibleCaption).replace(/\n/g, '<br>\n');
    return `\n<figure class="notion-figure">\n${imgTag}\n<figcaption>${captionHtml}</figcaption>\n</figure>\n\n`;
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

// 本文のMarkdownをHTMLに変換すると同時に、見出し2（##）に自動でIDを振り、
// 目次（見出しのリスト）を作る。目次はブログ記事ページのキービジュアル下に表示する。
function renderContentWithToc(markdown: string): { html: string; toc: TocItem[] } {
  const toc: TocItem[] = [];
  let count = 0;
  const renderer = new Renderer();
  renderer.heading = function (this: any, { tokens, depth }: any) {
    const inner = this.parser.parseInline(tokens);
    if (depth === 2) {
      count += 1;
      const id = `heading-${count}`;
      const text = inner.replace(/<[^>]+>/g, '').trim();
      toc.push({ id, text });
      return `<h2 id="${id}">${inner}</h2>\n`;
    }
    return `<h${depth}>${inner}</h${depth}>\n`;
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
  // コールアウト・画像ブロックは独自のHTML変換にする（詳細は各関数のコメントを参照）。
  // 引用（quote）ブロックはここで変換を上書きしないため、従来通りの見た目（枠線・斜体）のまま。
  n2m.setCustomTransformer('callout', async (block: any) => calloutToHtml(block));
  n2m.setCustomTransformer('image', async (block: any) => imageToHtml(block));
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
      const tags: string[] = (props[PROP.tags]?.multi_select ?? []).map((t: any) => t.name);
      const publishedAt: string = props[PROP.publishedAt]?.date?.start ?? page.created_time;
      const updatedAt: string = props[PROP.updatedAt]?.date?.start ?? page.last_edited_time;
      const rawThumbnail = getThumbnail(props[PROP.thumbnail]);
      const thumbnail = rawThumbnail ? await downloadThumbnail(rawThumbnail, page.id) : null;

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
