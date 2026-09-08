// ビルド前に実行するスクリプト。Notionから「公開」チェックがオンの記事だけを取得し、
// 画像はすべてローカルにダウンロードした上で .notion-cache/posts.json に書き出す。
// Astro側（src/lib/posts.ts）はこのJSONを読むだけで、ビルド中にNotionへは一切アクセスしない。
//
// 実行方法: npm run fetch-notion （npm run build の中で自動的に呼ばれます）
// 必要な環境変数: NOTION_TOKEN, NOTION_DATABASE_ID
// 任意の環境変数: NOTION_CATEGORIES_DATABASE_ID・NOTION_TAGS_DATABASE_ID
//   （いずれも未設定でもビルドは止まらず、対応する機能が空になるだけ）

import fs from "node:fs/promises";
import path from "node:path";
import {
  resolveDataSourceId,
  queryAllPages,
  fetchBlockChildrenRecursive,
  getRelationNames,
} from "./lib/notion-client.mjs";
import {
  PROP,
  CATEGORY_PROP,
  TAG_PROP,
  POST_STATUS,
  getTitleText,
  getRichTextPlain,
  getStatusOrSelectName,
  getSelectColor,
  getNumber,
  getDateISO,
  getFirstFileUrl,
  resolveSlug,
  makeAnchorFactory,
  transformBlocks,
  downloadImage,
  generateFallbackThumbnail,
  resolveCategoryBackgroundDataUri,
  extractExcerpt,
  buildNotionLinkMap,
  splitBulletLines,
} from "./lib/transform.mjs";

const CACHE_DIR = path.resolve(process.cwd(), ".notion-cache");
const CACHE_FILE = path.join(CACHE_DIR, "posts.json");
// 「公開後の編集中」記事が、編集中もサイト上は前回公開時点の内容のまま保たれるようにするためのスナップショット。
// GitHub Actions側でこのファイルだけをビルドをまたいでキャッシュ復元/保存する（.github/workflows/deploy.yml参照）。
const SNAPSHOT_FILE = path.join(CACHE_DIR, "posts-status-snapshot.json");

async function writeEmptyCache(reason) {
  console.warn(`\n[fetch-notion] ${reason}`);
  console.warn("[fetch-notion] 記事0件のダミーキャッシュを書き出してビルドを継続します。\n");
  await fs.mkdir(CACHE_DIR, { recursive: true });
  await fs.writeFile(
    CACHE_FILE,
    JSON.stringify(
      { generatedAt: new Date().toISOString(), posts: [], categories: [], tags: [], error: reason },
      null,
      2,
    ),
  );
}

/**
 * マスターカテゴリDB（記事DBの「カテゴリ」リレーション先）を取得する。
 * NOTION_CATEGORIES_DATABASE_ID が未設定の場合は、カテゴリページ機能を使っていないとみなし、
 * 記事の取得は止めずに空配列を返す（カテゴリナビ・カテゴリページが空で表示されるだけで、サイト自体は壊れない）。
 *
 * 各カテゴリページ本文（「説明文」プロパティより下に書かれている記事本文）もブロックとして取得し、
 * カテゴリページ下部にそのカテゴリの解説記事として表示できるようにする。
 */
async function fetchCategories(token, linkMap) {
  const databaseId = process.env.NOTION_CATEGORIES_DATABASE_ID;
  if (!databaseId) {
    console.warn(
      "[fetch-notion] NOTION_CATEGORIES_DATABASE_ID が未設定のため、カテゴリ一覧は空のまま続行します。",
    );
    return [];
  }

  console.log("[fetch-notion] カテゴリ一覧を取得中…");
  const dataSourceId = await resolveDataSourceId(token, databaseId);
  const rawPages = await queryAllPages(token, dataSourceId, {});

  const categories = [];
  for (const page of rawPages) {
    const name = getTitleText(page, CATEGORY_PROP.name) || "(無題カテゴリ)";
    const description = getRichTextPlain(page, CATEGORY_PROP.description);
    const representativeSlugRaw = getRichTextPlain(page, CATEGORY_PROP.representativeSlug).trim();
    // サムネイル自動生成の背景として使う。「背景画像ファイル名」が実在すればそれを優先し、
    // 無ければ「テーマカラー」セレクトプロパティの色でグラデーションにフォールバックする。
    const backgroundImageFilename = getRichTextPlain(page, CATEGORY_PROP.backgroundImage).trim();
    const themeColor = getSelectColor(page, CATEGORY_PROP.themeColor);
    const order = getNumber(page, CATEGORY_PROP.order);

    const rawBlocks = await fetchBlockChildrenRecursive(token, page.id);
    const makeAnchor = makeAnchorFactory();
    const blocks = await transformBlocks(rawBlocks, makeAnchor, page.id, linkMap);

    categories.push({
      name,
      description,
      representativeSlug: representativeSlugRaw || null,
      themeColor,
      backgroundImageFilename,
      order,
      blocks,
    });
  }

  // 並び順は「並び順」プロパティ（数値、小さい順）を正としてソートする。マスターカテゴリDBで
  // この数値を変更するだけで、サイト側の表示順がそのまま追従する。
  //
  // 過去の経緯（2026-09-08時点）: マスターカテゴリDBには当初この専用プロパティが無く、Notion
  // APIにはテーブル表示上の手動並び順を取得する手段も無いため、代わりに「代表記事（Slug）」
  // （kiji1, kiji2, …のように記事の作成順と揃えて命名する運用だった）を並び順の代用にしていた。
  // その後カテゴリ名を一括リネームした際に「代表記事（Slug）」の大半が空欄・別形式（記事ページへの
  // メンション）に変わり、この代用ロジックが機能しなくなって表示順が崩れる不具合が発生した。
  // 「並び順」を追加したことで、以後はカテゴリ側のデータ内容（代表記事欄の書き方等）に一切左右され
  // ない。「並び順」が未設定のカテゴリ（今後の新規追加時など）は、後方互換のフォールバックとして
  // 代表記事Slugの自然順 → それも無ければNotion取得順、の順に末尾へ並べる。
  const withOrder = categories.filter((c) => c.order != null);
  const withoutOrder = categories.filter((c) => c.order == null);
  withOrder.sort((a, b) => a.order - b.order);

  const collator = new Intl.Collator("en", { numeric: true, sensitivity: "base" });
  const withSlug = withoutOrder.filter((c) => c.representativeSlug);
  const withoutSlug = withoutOrder.filter((c) => !c.representativeSlug);
  withSlug.sort((a, b) => collator.compare(a.representativeSlug, b.representativeSlug));

  return [...withOrder, ...withSlug, ...withoutSlug];
}

/**
 * マスタータグDB（記事DB・資料DBの「タグ」リレーション先）を取得する。
 * マスターカテゴリと同じ構成・同じ理由で、NOTION_TAGS_DATABASE_ID が未設定の場合は
 * タグページの解説文機能を使っていないとみなし、空配列を返す（タグ一覧・記事の取得は止めない）。
 *
 * 各タグページ本文（「説明文」プロパティより下に書かれている解説文）もブロックとして取得し、
 * タグページ下部にそのタグの解説として表示できるようにする。
 */
async function fetchTags(token, linkMap) {
  const databaseId = process.env.NOTION_TAGS_DATABASE_ID;
  if (!databaseId) {
    console.warn(
      "[fetch-notion] NOTION_TAGS_DATABASE_ID が未設定のため、タグ解説は空のまま続行します。",
    );
    return [];
  }

  console.log("[fetch-notion] タグ一覧を取得中…");
  const dataSourceId = await resolveDataSourceId(token, databaseId);
  const rawPages = await queryAllPages(token, dataSourceId, {});

  const tags = [];
  for (const page of rawPages) {
    const name = getTitleText(page, TAG_PROP.name) || "(無題タグ)";
    const description = getRichTextPlain(page, TAG_PROP.description);
    const representativeSlugRaw = getRichTextPlain(page, TAG_PROP.representativeSlug).trim();

    const rawBlocks = await fetchBlockChildrenRecursive(token, page.id);
    const makeAnchor = makeAnchorFactory();
    const blocks = await transformBlocks(rawBlocks, makeAnchor, page.id, linkMap);

    tags.push({
      name,
      description,
      representativeSlug: representativeSlugRaw || null,
      blocks,
    });
  }

  return tags;
}

async function main() {
  const token = process.env.NOTION_TOKEN;
  const databaseId = process.env.NOTION_DATABASE_ID;

  if (!token || !databaseId) {
    await writeEmptyCache(
      "NOTION_TOKEN または NOTION_DATABASE_ID が設定されていません（.env / GitHub Secrets を確認してください）。",
    );
    return;
  }

  console.log("[fetch-notion] データソースIDを取得中…");
  const dataSourceId = await resolveDataSourceId(token, databaseId);

  console.log("[fetch-notion] 記事の一覧を取得中…");
  // 「公開」プロパティは元がチェックボックスで、型変換の選び方次第で「セレクト」「ステータス」
  // どちらの型にもなりうる（Notion側のフィルター指定にどちらの型キーを使うべきか確定できない）。
  // 記事数が少ないサイト規模なので、全件取得してJS側でステータス判定する方式に統一する。
  let allPages;
  try {
    allPages = await queryAllPages(token, dataSourceId, {
      sorts: [{ property: PROP.publishedAt, direction: "descending" }],
    });
  } catch (err) {
    console.warn(`[fetch-notion] ソート付きの取得に失敗しました: ${err.message}`);
    console.warn("[fetch-notion] ソートなしで全件取得します…");
    allPages = await queryAllPages(token, dataSourceId, {});
  }
  const rawPages = allPages.filter((p) => {
    const status = getStatusOrSelectName(p, PROP.status);
    return status === POST_STATUS.published || status === POST_STATUS.editing;
  });

  console.log(`[fetch-notion] 全${allPages.length}件中${rawPages.length}件が公開対象です。`);

  // 「公開後の編集中」記事は、Notion側の最新の下書きではなく前回公開時点の内容をそのまま使う。
  // そのための「前回の完成品」スナップショットを読み込む（GitHub Actionsのキャッシュで復元される想定。
  // 復元されていない場合＝初回や初めて編集中ステータスを使う記事は、公開履歴が無いものとして扱う）。
  let previousPostsById = new Map();
  try {
    const raw = await fs.readFile(SNAPSHOT_FILE, "utf-8");
    const previous = JSON.parse(raw);
    previousPostsById = new Map((previous.posts || []).map((p) => [p.id, p]));
    console.log(`[fetch-notion] 前回公開時点のスナップショットを${previousPostsById.size}件読み込みました。`);
  } catch {
    console.log("[fetch-notion] 前回公開時点のスナップショットが見つかりません（初回、または復元されていません）。");
  }

  // 本文中で「@」から他の記事・資料ページをメンションしてリンクを貼れるようにするための
  // NotionページID → サイト内URL のマップ。カテゴリ・記事のブロック変換より先に作っておく必要がある。
  console.log("[fetch-notion] 記事間リンク用のマップを作成中…");
  const linkMap = await buildNotionLinkMap(token);

  // 自動生成サムネイルの背景をカテゴリ名から引けるように、記事処理より先にカテゴリ一覧を取得しておく。
  const categories = await fetchCategories(token, linkMap);
  const tags = await fetchTags(token, linkMap);
  const categoryBackgroundMap = new Map();
  for (const c of categories) {
    const dataUri = await resolveCategoryBackgroundDataUri(c.backgroundImageFilename);
    categoryBackgroundMap.set(c.name, { dataUri, colorKey: c.themeColor });
  }

  const posts = [];
  for (const page of rawPages) {
    const title = getTitleText(page, PROP.title) || "(無題)";
    const status = getStatusOrSelectName(page, PROP.status);

    // rawPages は既にステータスで絞り込み済みだが、念のための二重チェック
    // （未設定・想定外の値は「未公開」と同じ扱いにして、意図せず公開されないようにする）。
    if (status !== POST_STATUS.published && status !== POST_STATUS.editing) {
      console.log(`  - ${title}（ステータスが「${status || "未設定"}」のためスキップ）`);
      continue;
    }

    // 「公開後の編集中」は、Notionの最新の下書きを一切見ずに前回公開時点のものをそのまま使い回す
    // （画像ダウンロードやブロック変換もスキップする）。編集中に半端な内容が公開されるのを防ぐため。
    if (status === POST_STATUS.editing) {
      const previousPost = previousPostsById.get(page.id);
      if (previousPost) {
        console.log(`  - ${title}（編集中のため前回公開時点の内容を維持）`);
        posts.push(previousPost);
      } else {
        console.warn(
          `  - ${title}（ステータスが「${POST_STATUS.editing}」ですが公開履歴が無いためスキップします。一度「${POST_STATUS.published}」にしてから編集中にしてください）`,
        );
      }
      continue;
    }

    console.log(`  - ${title}`);

    const slug = resolveSlug(getRichTextPlain(page, PROP.slug), page.id, title);
    // タグ・カテゴリは「マスタータグ」「マスターカテゴリ」DBとのリレーションプロパティ。
    // 値には関連ページのIDしか入っていないため、関連ページを取得して名前に解決する。
    const tags = await getRelationNames(token, page, PROP.tags);
    // カテゴリは複数選択可のリレーション。全件を categories に保持しつつ、
    // 単一バッジ表示用に先頭1件を category としても残す。
    const categories = await getRelationNames(token, page, PROP.category);
    const category = categories[0] || null;
    const publishedAt = getDateISO(page, PROP.publishedAt) || page.created_time;
    const updatedAt = getDateISO(page, PROP.updatedAt) || page.last_edited_time;
    // 「この記事でわかること」ボックス用の箇条書き。1行1項目、未入力ならボックスごと非表示。
    const keyPoints = splitBulletLines(getRichTextPlain(page, PROP.keyPoints));

    // 「サムネイル画像」に実ファイルがアップロードされていればそれを優先。
    // 未設定の場合は、カテゴリのテーマカラー＋「サムネ用タイトル/サブタイトル」から自動生成する。
    const thumbnailSourceUrl = getFirstFileUrl(page, PROP.thumbnail);
    let thumbnail = thumbnailSourceUrl ? await downloadImage(thumbnailSourceUrl, `thumb-${page.id}`) : null;
    if (!thumbnail) {
      const thumbnailTitle = getRichTextPlain(page, PROP.thumbnailTitle).trim() || title;
      const thumbnailSubtitle = getRichTextPlain(page, PROP.thumbnailSubtitle).trim();
      // 記事に複数カテゴリが設定されている場合も、他のカテゴリ表示と同じく最初の1件を使う。
      const background = categoryBackgroundMap.get(category) || { dataUri: null, colorKey: "default" };
      thumbnail = await generateFallbackThumbnail(page.id, background, thumbnailTitle, thumbnailSubtitle);
    }

    const rawBlocks = await fetchBlockChildrenRecursive(token, page.id);
    const makeAnchor = makeAnchorFactory();
    const blocks = await transformBlocks(rawBlocks, makeAnchor, page.id, linkMap);

    const description = getRichTextPlain(page, PROP.description).trim() || extractExcerpt(blocks);

    posts.push({
      id: page.id,
      slug,
      title,
      description,
      tags,
      category,
      categories,
      keyPoints,
      publishedAt,
      updatedAt,
      thumbnail,
      blocks,
    });
  }

  // スラッグの重複チェック（重複していると同じURLに2記事が衝突してビルドが壊れるため）
  const slugCounts = new Map();
  for (const p of posts) slugCounts.set(p.slug, (slugCounts.get(p.slug) || 0) + 1);
  for (const [slug, count] of slugCounts) {
    if (count > 1) {
      console.warn(
        `[fetch-notion] 警告: スラッグ "${slug}" が${count}件の記事で重複しています。Notion側で「スラッグ」を見直してください。`,
      );
    }
  }

  await fs.mkdir(CACHE_DIR, { recursive: true });
  const output = { generatedAt: new Date().toISOString(), posts, categories, tags };
  await fs.writeFile(CACHE_FILE, JSON.stringify(output, null, 2));

  // 今回の結果を「次回、編集中の記事が参照する前回公開時点のスナップショット」として保存する。
  // GitHub Actions側がこのファイルをキャッシュに保存し、次回のビルド開始時に復元する。
  await fs.writeFile(SNAPSHOT_FILE, JSON.stringify(output, null, 2));

  console.log(
    `[fetch-notion] 完了: 記事${posts.length}件・カテゴリ${categories.length}件・タグ${tags.length}件を .notion-cache/posts.json に書き出しました。`,
  );
}

main().catch((err) => {
  console.error("\n[fetch-notion] エラーが発生しました。ビルドを中止します:");
  console.error(err);
  // ここで空データにフォールバックしてビルドを続けてしまうと、Notion側の一時的な不調で
  // 「記事が0件の空サイト」を本番に上書きデプロイしてしまう危険がある。
  // それよりは今回のデプロイを止めて、前回公開したサイトをそのまま残すほうが安全なため、
  // 環境変数が未設定の場合（開発者がNotionなしでUI確認したいケース）以外は失敗させる。
  process.exit(1);
});
