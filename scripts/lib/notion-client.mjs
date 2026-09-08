// Notion REST APIへの薄いラッパー。
// @notionhq/client のような公式SDKは使わず、素のfetchで直接呼んでいます。
// 理由: SDKのメジャーバージョンによってメソッド名や返り値の形が変わりやすく、
//       将来Notion側の仕様変更に追従しにくいため。エンドポイントとヘッダーだけ
//       合わせれば動く素のfetchのほうが、長期的にメンテしやすいと判断しました。

// 2026-08時点での最新版。データベースは「データソース」経由でのクエリが必須になった
// 2025-09-03以降のバージョンを使う必要があります（それより古いバージョンを指定すると
// 従来の /v1/databases/{id}/query が使えてしまいますが、将来的に廃止される可能性があります）。
export const NOTION_API_VERSION = "2026-03-11";
const NOTION_API_BASE = "https://api.notion.com/v1";

class NotionApiError extends Error {
  constructor(message, status, body) {
    super(message);
    this.name = "NotionApiError";
    this.status = status;
    this.body = body;
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Notion APIを叩く共通関数。429（レート制限）は自動リトライします。
 */
export async function notionRequest(token, method, path, body) {
  const url = `${NOTION_API_BASE}/${path}`;
  const maxRetries = 5;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const res = await fetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        "Notion-Version": NOTION_API_VERSION,
        "Content-Type": "application/json",
      },
      body: body ? JSON.stringify(body) : undefined,
    });

    if (res.status === 429) {
      const retryAfter = Number(res.headers.get("retry-after")) || 1;
      console.warn(
        `  [notion] レート制限。${retryAfter}秒待って再試行します… (${attempt + 1}/${maxRetries})`,
      );
      await sleep(retryAfter * 1000);
      continue;
    }

    if (res.status >= 500 && attempt < maxRetries) {
      const backoff = 2 ** attempt * 500;
      console.warn(`  [notion] サーバーエラー(${res.status})。${backoff}ms後に再試行します…`);
      await sleep(backoff);
      continue;
    }

    if (!res.ok) {
      let errBody = null;
      try {
        errBody = await res.json();
      } catch {
        // ignore
      }
      throw new NotionApiError(
        `Notion API error ${res.status} ${method} ${path}: ${errBody?.message || res.statusText}`,
        res.status,
        errBody,
      );
    }

    return res.json();
  }

  throw new NotionApiError(`Notion API: リトライ上限に達しました (${method} ${path})`, 0, null);
}

/**
 * データベースIDから、単一データソースのIDを取得する。
 * 2025-09-03以降のNotion APIでは、データベース本体ではなく
 * 「データソース」に対してクエリを投げる必要があるため必須の手順。
 */
export async function resolveDataSourceId(token, databaseId) {
  const db = await notionRequest(token, "GET", `databases/${databaseId}`);
  const dataSources = db.data_sources || [];
  if (dataSources.length === 0) {
    throw new Error(
      `データベース ${databaseId} にデータソースが見つかりません。データベースIDが正しいか確認してください。`,
    );
  }
  if (dataSources.length > 1) {
    console.warn(
      `  [notion] データベース ${databaseId} は複数のデータソースを持っています。最初のもの（${dataSources[0].name}）を使用します。`,
    );
  }
  return dataSources[0].id;
}

/**
 * データソース内の全ページを取得する（ページネーション込み）。
 * filter/sort に失敗した場合は呼び出し側でフォールバックできるよう、そのままthrowする。
 */
export async function queryAllPages(token, dataSourceId, { filter, sorts } = {}) {
  const pages = [];
  let cursor = undefined;
  do {
    const body = { page_size: 100 };
    if (filter) body.filter = filter;
    if (sorts) body.sorts = sorts;
    if (cursor) body.start_cursor = cursor;

    const res = await notionRequest(token, "POST", `data_sources/${dataSourceId}/query`, body);
    pages.push(...res.results);
    cursor = res.has_more ? res.next_cursor : undefined;
  } while (cursor);

  return pages;
}

/**
 * ブロックの子要素を再帰的にすべて取得する。
 * child_page / child_database はサブページへのリンクなので中身までは追わない。
 */
export async function fetchBlockChildrenRecursive(token, blockId, depth = 0) {
  if (depth > 12) {
    console.warn(`  [notion] ネストが深すぎるため打ち切ります (blockId=${blockId})`);
    return [];
  }

  const blocks = [];
  let cursor = undefined;
  do {
    const qs = new URLSearchParams({ page_size: "100" });
    if (cursor) qs.set("start_cursor", cursor);
    const res = await notionRequest(token, "GET", `blocks/${blockId}/children?${qs.toString()}`);
    blocks.push(...res.results);
    cursor = res.has_more ? res.next_cursor : undefined;
  } while (cursor);

  for (const block of blocks) {
    const isTrashed = block.in_trash || block.archived;
    if (isTrashed) continue;
    if (block.has_children && block.type !== "child_page" && block.type !== "child_database") {
      block._children = await fetchBlockChildrenRecursive(token, block.id, depth + 1);
    } else {
      block._children = [];
    }
  }

  return blocks.filter((b) => !(b.in_trash || b.archived));
}

// ------------------------------------------------------------
// リレーションプロパティの名前解決
//
// タグ・メインタグ・カテゴリ等が「マスタータグ」「マスターカテゴリ」のような
// 別データベースとのリレーションになっている場合、プロパティの値には
// 関連ページのID（relation配列）しか入っておらず、表示名（タイトル）が直接は取れない。
// そのため関連ページを個別に取得してタイトルを解決する。
//
// 同じページを何度も取得しないよう、プロセス内（1回のnpm run実行内）でキャッシュする。
// 万が一取得に失敗しても、記事・資料本体のビルドは止めたくないため、
// 失敗時は警告を出してnull/空配列にフォールバックする（例外を投げない）。
// ------------------------------------------------------------

const relationTitleCache = new Map();

/**
 * ページIDからタイトルプロパティの文字列を取得する（リレーション先ページの名前解決用）。
 */
export async function getPageTitleById(token, pageId) {
  if (relationTitleCache.has(pageId)) return relationTitleCache.get(pageId);
  try {
    const page = await notionRequest(token, "GET", `pages/${pageId}`);
    const titleProp = Object.values(page.properties || {}).find((p) => p.type === "title");
    const title = (titleProp?.title || []).map((t) => t.plain_text).join("").trim() || null;
    relationTitleCache.set(pageId, title);
    return title;
  } catch (err) {
    console.warn(`  [notion] リレーション先ページ(${pageId})の名前取得に失敗しました: ${err.message}`);
    relationTitleCache.set(pageId, null);
    return null;
  }
}

/**
 * relation型プロパティの関連ページ名を配列で取得する（複数選択のタグ等を想定）。
 * プロパティが存在しない・relation型でない場合は空配列を返す。
 */
export async function getRelationNames(token, page, propertyName) {
  const prop = page.properties?.[propertyName];
  if (!prop || prop.type !== "relation") return [];
  const ids = (prop.relation || []).map((r) => r.id);
  const names = await Promise.all(ids.map((id) => getPageTitleById(token, id)));
  return names.filter((n) => !!n);
}

/**
 * relation型プロパティの先頭1件だけ名前を取得する（メインタグ・カテゴリ等、単一選択想定のものに使う）。
 */
export async function getFirstRelationName(token, page, propertyName) {
  const names = await getRelationNames(token, page, propertyName);
  return names[0] || null;
}

export { NotionApiError };
