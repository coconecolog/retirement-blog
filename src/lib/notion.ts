// Notionデータベースから「公開」フラグが立っている記事だけをビルド時に取得するモジュール。
//
// Notion側のプロパティ名は下の PROP をそのまま使う想定です。
// ご自身のNotionデータベースでプロパティ名を変えた場合は、ここだけ書き換えれば動きます。

import { Client } from '@notionhq/client';
import { NotionToMarkdown } from 'notion-to-md';
import { marked } from 'marked';

const NOTION_TOKEN = process.env.NOTION_TOKEN;
const NOTION_DATABASE_ID = process.env.NOTION_DATABASE_ID;

export const PROP = {
  title: 'タイトル',
  tags: 'タグ',
  publishedAt: '公開日',
  updatedAt: '更新日',
  thumbnail: 'サムネイル画像',
  published: '公開',
} as const;

export type Post = {
  id: string;
  slug: string;
  title: string;
  tags: string[];
  publishedAt: string;
  updatedAt: string;
  thumbnail: string | null;
  html: string;
  excerpt: string;
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

// Notion page id（ハイフン付きUUID）からハイフンを除いたものをスラッグとして使用。
// 記事タイトルを変更してもURLが変わらないので、SEO上安全です。
function toSlug(pageId: string): string {
  return pageId.replace(/-/g, '');
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
  const posts: Post[] = [];
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
      const thumbnail = getThumbnail(props[PROP.thumbnail]);

      let mdString = '';
      try {
        const mdBlocks = await n2m.pageToMarkdown(page.id);
        mdString = n2m.toMarkdownString(mdBlocks).parent ?? '';
      } catch (err) {
        console.error(`[notion] 本文の取得に失敗しました: ${title} (${page.id})`, err);
      }

      const html = await marked.parse(mdString || '');

      posts.push({
        id: page.id,
        slug: toSlug(page.id),
        title,
        tags,
        publishedAt,
        updatedAt,
        thumbnail,
        html,
        excerpt: makeExcerpt(mdString),
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
