import fs from "node:fs";
import path from "node:path";
import type { BlockNode, Category, Post, PostsCache, Tag, TocItem } from "./types";

const CACHE_PATH = path.resolve(process.cwd(), ".notion-cache/posts.json");

function loadCache(): PostsCache {
  try {
    const raw = fs.readFileSync(CACHE_PATH, "utf-8");
    const parsed = JSON.parse(raw) as PostsCache;
    // categories(記事の複数カテゴリ配列)・カテゴリ一覧・カテゴリ本文(blocks)は後から追加したフィールドなので、
    // 古いキャッシュ（未生成のもの）にも耐えるようにする
    const posts = (parsed.posts || []).map((p) => ({
      ...p,
      categories: p.categories || (p.category ? [p.category] : []),
      keyPoints: p.keyPoints || [],
    }));
    const categories = (parsed.categories || []).map((c) => ({ ...c, blocks: c.blocks || [] }));
    // タグ一覧(マスタータグDBの解説文・本文)も後から追加したフィールドなので、古いキャッシュにも耐えるようにする
    const tags = (parsed.tags || []).map((t) => ({ ...t, blocks: t.blocks || [] }));
    return { ...parsed, posts, categories, tags };
  } catch {
    console.warn(
      "[posts] .notion-cache/posts.json が見つかりません。先に `npm run fetch-notion` を実行してください。空のデータで続行します。",
    );
    return { generatedAt: new Date().toISOString(), posts: [], categories: [], tags: [] };
  }
}

const cache = loadCache();

/** 公開日の新しい順にソートされた全記事 */
export function getAllPosts(): Post[] {
  return [...cache.posts].sort(
    (a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime(),
  );
}

export function getPostBySlug(slug: string): Post | undefined {
  return cache.posts.find((p) => p.slug === slug);
}

export function getAllTags(): { name: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const post of cache.posts) {
    for (const tag of post.tags) {
      counts.set(tag, (counts.get(tag) || 0) + 1);
    }
  }
  return [...counts.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count);
}

export function getPostsByTag(tag: string): Post[] {
  return getAllPosts().filter((p) => p.tags.includes(tag));
}

/** マスタータグDBに登録されているタグ1件分（説明文・本文ブロック）。未登録のタグ名ならundefined。 */
export function getTagByName(name: string): Tag | undefined {
  return cache.tags.find((t) => t.name === name);
}

/** マスターカテゴリDBの全カテゴリ（Notion側の並び順のまま）。 */
export function getAllCategories(): Category[] {
  return cache.categories;
}

export function getCategoryByName(name: string): Category | undefined {
  return cache.categories.find((c) => c.name === name);
}

/** 指定カテゴリに属する記事（記事側の「カテゴリ」リレーションは複数選択可なので、いずれか1つでも一致すれば対象）。 */
export function getPostsByCategory(name: string): Post[] {
  return getAllPosts().filter((p) => p.categories.includes(name));
}

/** カテゴリページの「関連するテーマ・キーワード」用に、そのカテゴリの記事に付いているタグだけを集計する。 */
export function getCategoryTags(name: string): { name: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const post of getPostsByCategory(name)) {
    for (const tag of post.tags) {
      counts.set(tag, (counts.get(tag) || 0) + 1);
    }
  }
  return [...counts.entries()]
    .map(([tagName, count]) => ({ name: tagName, count }))
    .sort((a, b) => b.count - a.count);
}

/**
 * 人気記事（上位N件）。
 * TODO: Google Analyticsとの連携が済み次第、閲覧数ベースのランキングに差し替える。
 * 現在は連携準備が整うまでの仮実装として、公開日の新しい順で代用している。
 */
export function getPopularPosts(limit: number): Post[] {
  return getAllPosts().slice(0, limit);
}

/**
 * 見出し2・見出し3から目次を組み立てる（H3はH2の下にネスト）。
 * 見出し1・見出し4は目次に含めない（仕様どおり）。
 * column_list / column の中身は透過的にたどるが、toggle/callout/quoteの中は目次に含めない。
 */
export function buildToc(blocks: BlockNode[]): TocItem[] {
  const toc: TocItem[] = [];
  let currentH2: TocItem | null = null;

  function walk(nodes: BlockNode[]) {
    for (const node of nodes) {
      if (node.type === "heading_2" && node.anchor) {
        currentH2 = {
          anchor: node.anchor,
          text: (node.richText || []).map((r) => r.text).join(""),
          level: 2,
          children: [],
        };
        toc.push(currentH2);
      } else if (node.type === "heading_3" && node.anchor) {
        const item: TocItem = {
          anchor: node.anchor,
          text: (node.richText || []).map((r) => r.text).join(""),
          level: 3,
          children: [],
        };
        if (currentH2) currentH2.children.push(item);
        else toc.push(item);
      } else if (node.type === "column_list" || node.type === "column") {
        if (node.children) walk(node.children);
      }
    }
  }

  walk(blocks);
  return toc;
}

export const CACHE_GENERATED_AT = cache.generatedAt;
export const CACHE_ERROR = cache.error;
