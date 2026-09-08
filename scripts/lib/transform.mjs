import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { resolveDataSourceId, queryAllPages } from "./notion-client.mjs";

// ============================================================
// Notionのプロパティ名（このサイトの仕様書どおりの名称）
// ここを変えるとNotion側のプロパティ名を変更したときに対応できます。
// ============================================================
export const PROP = {
  title: "タイトル",
  tags: "タグ",
  // カテゴリは「マスターカテゴリ」DBとのリレーションプロパティ（複数選択可）。
  // 値の解決には getRelationNames（notion-client.mjs）を使う。
  category: "カテゴリ",
  publishedAt: "公開日",
  updatedAt: "更新日",
  // 通常は未入力のままでOK。ここに画像をアップロードした記事だけ、その画像がサムネイルとして
  // 優先的に使われる（未入力の記事は generateFallbackThumbnail() が自動生成した画像になる）。
  thumbnail: "サムネイル画像",
  // 旧「公開」チェックボックス（boolean）を、同じプロパティ名のまま3値のセレクトに変更したもの。
  // 選択肢は POST_STATUS を参照。値はNotion側で完全一致させること。
  status: "公開",
  slug: "Slug",
  description: "ディスクリプション",
  // サムネイル画像が未設定の記事で、自動生成サムネイルに乗せる文言。「テキスト」プロパティ。
  // 未入力の場合はタイトルをそのまま使う。
  thumbnailTitle: "サムネ用タイトル",
  // 自動生成サムネイルの補足文言（1行）。「テキスト」プロパティ。未入力なら表示しない。
  thumbnailSubtitle: "サムネ用サブタイトル",
  // 記事冒頭に表示する「この記事でわかること」ボックスの箇条書き。「テキスト」プロパティ（複数行）。
  // 1行につき1項目。未入力ならボックス自体を表示しない。
  keyPoints: "記事の要点",
};

// 記事DBの「ステータス」セレクトプロパティの選択肢名。Notion側もこの文字列と完全一致させる。
// 運用イメージ: 未公開 → 公開（新規公開／編集完了のタイミング） → 公開後の編集中（編集中はサイトを更新しない） → 公開 → …
export const POST_STATUS = {
  unpublished: "未公開",
  published: "公開",
  editing: "公開後の編集中",
};

// 「マスターカテゴリ」DB（記事DB・資料DBの「カテゴリ」リレーション先）自体のプロパティ名。
// カテゴリ名（タイトル）・説明文・代表記事のスラッグを、カテゴリ一覧・カテゴリページ表示のために取得する。
export const CATEGORY_PROP = {
  name: "カテゴリ",
  description: "説明文",
  // 2026-09-08にNotion側のプロパティ名を「代表記事（Slug）」から「代表記事」に変更したため追従。
  representativeSlug: "代表記事",
  // 自動生成サムネイルの背景画像。「テキスト」プロパティとして追加し、GitHubリポジトリの
  // public/images/category-backgrounds/ にアップロードした画像のファイル名を入力する運用にする
  // （資料ファイル・資料サムネイルと同じ方式。差し替えたい時は同じファイル名で再アップロードするだけでよい）。
  backgroundImage: "背景画像ファイル名",
  // 上の画像が未設定・見つからない場合のフォールバック用の背景色。「セレクト」プロパティとして追加し、
  // Notion標準の色から選ぶ（選択肢名は何でもよい。実際に使うのは getSelectColor() で取れる色そのもの）。
  // どちらも未設定のカテゴリ・該当カテゴリが無い記事はグレー系の既定色になる。
  themeColor: "テーマカラー",
  // カテゴリ一覧・サイドバー等での表示順（数値、小さい順）。マスターカテゴリDBのこの数値を
  // 変更するだけで、サイト側の並び順がそのまま追従する（2026-09-08追加。経緯はrunbook参照）。
  order: "並び順",
};

// 「マスタータグ」DB（記事DB・資料DBの「タグ」リレーション先）自体のプロパティ名。
// マスターカテゴリDBと同じ構成（タグ名・説明文・代表記事のスラッグ）で、タグページ表示のために取得する。
export const TAG_PROP = {
  name: "タグ",
  description: "説明文",
  // 2026-09-08にNotion側のプロパティ名を「代表記事（Slug）」から「代表記事」に変更したため追従。
  representativeSlug: "代表記事",
};

// ------------------------------------------------------------
// プロパティ抽出ヘルパー
// ------------------------------------------------------------

function getProperty(page, name) {
  return page.properties?.[name];
}

export function getTitleText(page, name) {
  const prop = getProperty(page, name);
  if (!prop || prop.type !== "title") return "";
  return (prop.title || []).map((t) => t.plain_text).join("");
}

export function getRichTextPlain(page, name) {
  const prop = getProperty(page, name);
  if (!prop || prop.type !== "rich_text") return "";
  return (prop.rich_text || []).map((t) => t.plain_text).join("");
}

export function getCheckbox(page, name) {
  const prop = getProperty(page, name);
  if (!prop || prop.type !== "checkbox") return false;
  return !!prop.checkbox;
}

/** 数値プロパティを取得する。未入力・プロパティ自体が無い場合は null を返す。 */
export function getNumber(page, name) {
  const prop = getProperty(page, name);
  if (!prop || prop.type !== "number") return null;
  return typeof prop.number === "number" ? prop.number : null;
}

export function getMultiSelectNames(page, name) {
  const prop = getProperty(page, name);
  if (!prop || prop.type !== "multi_select") return [];
  return (prop.multi_select || []).map((o) => o.name);
}

/**
 * 日付系プロパティを柔軟に取得する。
 * date / created_time / last_edited_time / formula(date) のいずれでも拾える。
 * 見つからない場合は null を返す（呼び出し側でページ自体の created_time 等にフォールバックする）。
 */
export function getDateISO(page, name) {
  const prop = getProperty(page, name);
  if (!prop) return null;
  if (prop.type === "date") return prop.date?.start || null;
  if (prop.type === "created_time") return prop.created_time || null;
  if (prop.type === "last_edited_time") return prop.last_edited_time || null;
  if (prop.type === "formula" && prop.formula?.type === "date") {
    return prop.formula.date?.start || null;
  }
  return null;
}

/** files プロパティの先頭のURLを取得する（Notionアップロード / 外部URLどちらも対応）。 */
export function getFirstFileUrl(page, name) {
  const prop = getProperty(page, name);
  if (!prop || prop.type !== "files") return null;
  const file = (prop.files || [])[0];
  if (!file) return null;
  if (file.type === "external") return file.external.url;
  if (file.type === "file") return file.file.url;
  return null;
}

// ------------------------------------------------------------
// スラッグ
// ------------------------------------------------------------

const SAFE_SLUG_RE = /^[a-zA-Z0-9-_]+$/;

/**
 * カスタムスラッグが安全な形式（半角英数・ハイフン・アンダースコアのみ）ならそれを使い、
 * 空欄・不正な形式の場合はNotionのページID（ハイフン付き32桁）を使う。
 */
export function resolveSlug(customSlug, pageId, titleForWarning) {
  const trimmed = (customSlug || "").trim();
  if (trimmed === "") return pageId;
  if (!SAFE_SLUG_RE.test(trimmed)) {
    console.warn(
      `  [notion] 「${titleForWarning}」のスラッグ「${trimmed}」は半角英数・ハイフン・アンダースコア以外の文字を含むため、ページIDを代わりに使用します。`,
    );
    return pageId;
  }
  return trimmed;
}

// ------------------------------------------------------------
// 見出しの目次アンカーID
// ------------------------------------------------------------

export function makeAnchorFactory() {
  const used = new Map();
  return function makeAnchor(text) {
    let base = (text || "heading")
      .toLowerCase()
      .trim()
      .replace(/[^\p{L}\p{N}]+/gu, "-")
      .replace(/^-+|-+$/g, "");
    if (base === "") base = "heading";
    const count = used.get(base) || 0;
    used.set(base, count + 1);
    return count === 0 ? base : `${base}-${count}`;
  };
}

// ------------------------------------------------------------
// リッチテキスト → シンプルな構造に変換
// ------------------------------------------------------------

/**
 * linkMap を渡すと、Notionの「@」メンションでページを選んで貼ったリンクを、
 * Notion内部のURLではなくサイト内の実URL（/blog/xxx, /resources/xxx）に変換する
 * （buildNotionLinkMap() の返り値である Map<NotionページID, サイト内URL> を渡す）。
 * メンション先がマップに無い（未公開・対象外のページ等）場合はリンクなしの単なるテキストにする。
 */
export function transformRichText(richText, linkMap) {
  if (!Array.isArray(richText)) return [];
  return richText.map((t) => {
    const a = t.annotations || {};
    let href = t.href || t.text?.link?.url || null;
    if (t.type === "mention" && t.mention?.type === "page" && t.mention.page?.id) {
      href = linkMap?.get(t.mention.page.id) || null;
    }
    return {
      text: t.plain_text || "",
      href,
      bold: !!a.bold,
      italic: !!a.italic,
      strikethrough: !!a.strikethrough,
      underline: !!a.underline,
      code: !!a.code,
      color: a.color && a.color !== "default" ? a.color : null,
    };
  });
}

export function richTextToPlain(richText) {
  if (!Array.isArray(richText)) return "";
  return richText.map((t) => t.plain_text || "").join("");
}

// ------------------------------------------------------------
// 画像キャプション/altの3パターン判定
//   1) 空欄            → alt無し・キャプション非表示
//   2) "alt:" で始まる  → 残りの文をaltとしてのみ使用（画面には非表示）
//   3) それ以外（空でない） → altとしても画面表示キャプションとしても使用
// ------------------------------------------------------------

export function resolveImageCaption(captionRichText) {
  const raw = richTextToPlain(captionRichText).trim();
  if (raw === "") {
    return { alt: "", visibleCaption: null };
  }
  if (raw.toLowerCase().startsWith("alt:")) {
    const alt = raw.slice(4).trim();
    return { alt, visibleCaption: null };
  }
  return { alt: raw, visibleCaption: raw };
}

// ------------------------------------------------------------
// 画像ダウンロード（Notionの署名付きURLは数時間で失効するため、
// ビルド時にすべてローカルへ保存して public/ 配下から配信する）
// ------------------------------------------------------------

const CONTENT_TYPE_EXT = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/gif": "gif",
  "image/webp": "webp",
  "image/svg+xml": "svg",
  "image/avif": "avif",
};

function guessExtFromUrl(url) {
  const clean = url.split("?")[0];
  const ext = path.extname(clean).replace(".", "").toLowerCase();
  if (["jpg", "jpeg", "png", "gif", "webp", "svg", "avif"].includes(ext)) {
    return ext === "jpeg" ? "jpg" : ext;
  }
  return null;
}

const IMAGE_OUT_DIR = path.resolve(process.cwd(), "public/images/notion");

// 同一URLの重複ダウンロードを避けるためのキャッシュ
const downloadCache = new Map();

/**
 * 画像をダウンロードして public/images/notion/ に保存し、
 * サイト内から参照できる絶対パス（例: /images/notion/xxxx.jpg）を返す。
 * 失敗した場合は null を返し、呼び出し側でフォールバック表示にする。
 */
export async function downloadImage(url, idHint) {
  if (!url) return null;
  if (downloadCache.has(url)) return downloadCache.get(url);

  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const contentType = res.headers.get("content-type")?.split(";")[0]?.trim();
    const ext = CONTENT_TYPE_EXT[contentType] || guessExtFromUrl(url) || "jpg";

    const hash = crypto.createHash("sha1").update(url).digest("hex").slice(0, 16);
    const filename = `${idHint}-${hash}.${ext}`;
    const outPath = path.join(IMAGE_OUT_DIR, filename);

    await fs.mkdir(IMAGE_OUT_DIR, { recursive: true });
    const buffer = Buffer.from(await res.arrayBuffer());
    await fs.writeFile(outPath, buffer);

    const publicPath = `/images/notion/${filename}`;
    downloadCache.set(url, publicPath);
    return publicPath;
  } catch (err) {
    console.warn(`  [notion] 画像のダウンロードに失敗しました (${idHint}): ${err.message}`);
    downloadCache.set(url, null);
    return null;
  }
}

// ------------------------------------------------------------
// サムネイル画像未設定の記事用に、カテゴリの色＋記事タイトルから
// その場でSVG画像を自動生成する（画像アップロード・外部サービス・追加npm依存いずれも不要）。
// ------------------------------------------------------------

// Notionのセレクトプロパティが持つ色キーワード → 背景グラデーション（開始色・終了色）。
// 「テーマカラー」プロパティで選べる色はすべてここに用意してあるので、
// 新しいカテゴリを追加したときはNotion側で色を選ぶだけでよい（コード変更不要）。
const CATEGORY_COLOR_GRADIENTS = {
  default: ["#94a3b8", "#64748b"],
  gray: ["#9ca3af", "#6b7280"],
  brown: ["#b08968", "#8b5e34"],
  orange: ["#fb923c", "#ea580c"],
  yellow: ["#fbbf24", "#ca8a04"],
  green: ["#4ade80", "#15803d"],
  blue: ["#60a5fa", "#1d4ed8"],
  purple: ["#a78bfa", "#6c3fe8"],
  pink: ["#f472b6", "#db2777"],
  red: ["#f87171", "#b91c1c"],
};

function escapeXml(text) {
  return (text || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

// 半角英数字は0.55文字分、それ以外（全角文字）は1文字分として幅を見積もる簡易ロジック。
// きちんとしたフォント計測はできないが、日本語主体の見出しをそれっぽく折り返すには十分。
function estimateCharWidth(ch) {
  return /[ -~]/.test(ch) ? 0.55 : 1;
}

function wrapText(text, maxWidth, maxLines) {
  const chars = Array.from((text || "").trim());
  const lines = [];
  let current = "";
  let currentWidth = 0;

  for (const ch of chars) {
    const w = estimateCharWidth(ch);
    if (currentWidth + w > maxWidth && current) {
      lines.push(current);
      current = "";
      currentWidth = 0;
      if (lines.length === maxLines) break;
    }
    current += ch;
    currentWidth += w;
  }
  if (current && lines.length < maxLines) lines.push(current);

  // 収まりきらなかった場合は最終行を省略記号にする
  const consumedLength = lines.reduce((sum, l) => sum + l.length, 0);
  if (lines.length === maxLines && consumedLength < chars.length) {
    let last = lines[maxLines - 1];
    while (last.length > 1 && estimateCharWidth("…") + [...last].reduce((s, c) => s + estimateCharWidth(c), 0) > maxWidth) {
      last = last.slice(0, -1);
    }
    lines[maxLines - 1] = `${last}…`;
  }
  return lines;
}

const CATEGORY_BACKGROUND_DIR = path.resolve(process.cwd(), "public/images/category-backgrounds");
const categoryBackgroundCache = new Map();

const IMAGE_MIME_BY_EXT = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
};

/**
 * カテゴリの背景画像（GitHubリポジトリの public/images/category-backgrounds/ に
 * アップロードされたファイル）を読み込み、SVGにそのまま埋め込める data: URI にして返す。
 * SVGを<img>タグ経由で表示する場合、そのSVGの中から外部の画像ファイルを参照しても
 * ブラウザ側で読み込みがブロックされてしまうため、data: URIとして埋め込む必要がある
 * （検証済み。相対パス参照では真っ白な画像になってしまう）。
 * ファイルが見つからない場合はnullを返し、呼び出し側は色グラデーションにフォールバックする。
 * 同じファイルを何十記事からも参照するため、一度読み込んだ内容はキャッシュする。
 *
 * @param {string} filename 「背景画像ファイル名」に入力されたファイル名（例: "lead-gen.png"）
 */
export async function resolveCategoryBackgroundDataUri(filename) {
  const trimmed = (filename || "").trim();
  if (!trimmed) return null;
  if (categoryBackgroundCache.has(trimmed)) return categoryBackgroundCache.get(trimmed);

  const ext = path.extname(trimmed).toLowerCase();
  const mime = IMAGE_MIME_BY_EXT[ext];
  if (!mime) {
    console.warn(`  [notion] 背景画像ファイル名「${trimmed}」の拡張子が非対応です（png/jpg/jpeg/webpのみ）。`);
    categoryBackgroundCache.set(trimmed, null);
    return null;
  }

  const absolutePath = path.resolve(CATEGORY_BACKGROUND_DIR, trimmed);
  try {
    const buffer = await fs.readFile(absolutePath);
    const dataUri = `data:${mime};base64,${buffer.toString("base64")}`;
    categoryBackgroundCache.set(trimmed, dataUri);
    return dataUri;
  } catch {
    console.warn(
      `  [notion] 背景画像が見つかりません: public/images/category-backgrounds/${trimmed}（GitHubへのアップロード忘れ、またはファイル名のタイプミスがないか確認してください）`,
    );
    categoryBackgroundCache.set(trimmed, null);
    return null;
  }
}

const GENERATED_THUMBNAIL_OUT_DIR = path.resolve(process.cwd(), "public/images/generated");

/**
 * サムネイル画像が未設定の記事用に、カテゴリの背景（画像 or テーマカラー）を使ってSVG画像を生成する。
 * downloadImage() 同様、失敗してもビルドを止めずに null を返す（呼び出し側は既定画像にフォールバックする）。
 *
 * @param {string} idHint ファイル名の一意性を保つための接頭辞（通常はNotionページID）
 * @param {object} background { dataUri: resolveCategoryBackgroundDataUri()の戻り値, colorKey: CATEGORY_COLOR_GRADIENTSのキー }
 *   dataUriがあればそれを背景画像として使い、無ければcolorKeyのグラデーションを使う。
 * @param {string} title 大きく表示するテキスト（サムネ用タイトル。未入力なら記事タイトルを渡す）
 * @param {string} subtitle 補足として小さく表示するテキスト（空文字なら非表示）
 */
export async function generateFallbackThumbnail(idHint, background, title, subtitle) {
  try {
    const { dataUri, colorKey } = background || {};

    // サブタイトルを上・小さめ、メインタイトルを下・大きめに表示する。
    const titleFontSize = 66;
    const titleLineHeight = 82;
    const titleWrapWidth = 10;
    const subtitleFontSize = 42;
    const subtitleLineHeight = 56;
    const subtitleWrapWidth = 16;
    const blockGap = 20;

    const titleLines = wrapText(title, titleWrapWidth, 3);
    const subtitleLines = subtitle ? wrapText(subtitle, subtitleWrapWidth, 2) : [];

    const blockHeight =
      (subtitleLines.length > 0 ? subtitleLines.length * subtitleLineHeight + blockGap : 0) +
      titleLines.length * titleLineHeight;
    let cursorY = (675 - blockHeight) / 2;

    cursorY += subtitleLines.length > 0 ? subtitleLineHeight * 0.75 : titleLineHeight * 0.75;
    const subtitleTspans = subtitleLines
      .map((line) => {
        const tspan = `<tspan x="72" y="${cursorY.toFixed(1)}">${escapeXml(line)}</tspan>`;
        cursorY += subtitleLineHeight;
        return tspan;
      })
      .join("");

    if (subtitleLines.length > 0) cursorY += blockGap - subtitleLineHeight + titleLineHeight * 0.75;
    const titleTspans = titleLines
      .map((line) => {
        const tspan = `<tspan x="72" y="${cursorY.toFixed(1)}">${escapeXml(line)}</tspan>`;
        cursorY += titleLineHeight;
        return tspan;
      })
      .join("");

    // 背景画像があればそれをフルサイズで敷き、文字が読めるよう上に薄暗いオーバーレイを重ねる。
    // 画像が無ければ、これまでどおりカテゴリのテーマカラーのグラデーションにする。
    const backgroundMarkup = dataUri
      ? `<image href="${dataUri}" x="0" y="0" width="1200" height="675" preserveAspectRatio="xMidYMid slice" />
  <rect width="1200" height="675" fill="#000000" opacity="0.35" />`
      : (() => {
          const [colorFrom, colorTo] = CATEGORY_COLOR_GRADIENTS[colorKey] || CATEGORY_COLOR_GRADIENTS.default;
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
  ${subtitleLines.length > 0 ? `<text font-family="'Hiragino Sans','Yu Gothic',sans-serif" font-size="${subtitleFontSize}" font-weight="400" fill="#ffffff" fill-opacity="0.9">${subtitleTspans}</text>` : ""}
  <text font-family="'Hiragino Sans','Yu Gothic',sans-serif" font-size="${titleFontSize}" font-weight="700" fill="#ffffff">${titleTspans}</text>
</svg>`;

    await fs.mkdir(GENERATED_THUMBNAIL_OUT_DIR, { recursive: true });
    const filename = `thumb-${idHint}.svg`;
    await fs.writeFile(path.join(GENERATED_THUMBNAIL_OUT_DIR, filename), svg, "utf-8");
    return `/images/generated/${filename}`;
  } catch (err) {
    console.warn(`  [notion] 自動生成サムネイルの作成に失敗しました (${idHint}): ${err.message}`);
    return null;
  }
}

/**
 * ディスクリプションが未入力のときのフォールバック用に、
 * 本文の最初のテキストブロックから抜粋を作る。
 */
export function extractExcerpt(blocks, maxLen = 110) {
  for (const b of blocks) {
    // 見出しはタイトルと重複しがちなので除外し、段落・リストなど本文系のみを対象にする
    if (!b.richText || b.type.startsWith("heading_")) continue;
    const text = b.richText.map((r) => r.text).join("");
    const trimmed = text.trim();
    if (trimmed) {
      return trimmed.length > maxLen ? `${trimmed.slice(0, maxLen)}…` : trimmed;
    }
  }
  return "";
}

// ------------------------------------------------------------
// ブロック本体の変換（再帰）
// ------------------------------------------------------------

/**
 * Notionの生ブロック配列を、Astro側で扱いやすいシンプルな形に変換する。
 * makeAnchor はページ内で一意な見出しアンカーIDを発行する関数（makeAnchorFactory()の返り値）。
 * linkMap は「@メンションでページを選んで貼ったリンク」をサイト内URLに変換するための
 * Map<NotionページID, サイト内URL>（buildNotionLinkMap()の返り値）。未指定なら単にリンクなしになる。
 */
export async function transformBlocks(rawBlocks, makeAnchor, idHint, linkMap) {
  const out = [];
  for (const block of rawBlocks) {
    const node = await transformBlock(block, makeAnchor, idHint, linkMap);
    if (node) out.push(node);
  }
  return out;
}

async function transformBlock(block, makeAnchor, idHint, linkMap) {
  const type = block.type;
  const children = block._children || [];
  const base = { id: block.id, type };

  switch (type) {
    case "heading_1":
    case "heading_2":
    case "heading_3":
    case "heading_4": {
      const level = Number(type.split("_")[1]);
      const text = transformRichText(block[type].rich_text, linkMap);
      const plain = richTextToPlain(block[type].rich_text);
      return {
        ...base,
        level,
        richText: text,
        anchor: makeAnchor(plain),
        toggleable: !!block[type].is_toggleable,
        children: await transformBlocks(children, makeAnchor, idHint, linkMap),
      };
    }

    case "paragraph":
      return {
        ...base,
        richText: transformRichText(block.paragraph.rich_text, linkMap),
        children: await transformBlocks(children, makeAnchor, idHint, linkMap),
      };

    case "bulleted_list_item":
    case "numbered_list_item":
      return {
        ...base,
        richText: transformRichText(block[type].rich_text, linkMap),
        children: await transformBlocks(children, makeAnchor, idHint, linkMap),
      };

    case "to_do":
      return {
        ...base,
        richText: transformRichText(block.to_do.rich_text, linkMap),
        checked: !!block.to_do.checked,
        children: await transformBlocks(children, makeAnchor, idHint, linkMap),
      };

    case "toggle":
      return {
        ...base,
        richText: transformRichText(block.toggle.rich_text, linkMap),
        children: await transformBlocks(children, makeAnchor, idHint, linkMap),
      };

    case "callout": {
      const icon = block.callout.icon;
      return {
        ...base,
        richText: transformRichText(block.callout.rich_text, linkMap),
        emoji: icon?.type === "emoji" ? icon.emoji : null,
        children: await transformBlocks(children, makeAnchor, idHint, linkMap),
      };
    }

    case "quote":
      return {
        ...base,
        richText: transformRichText(block.quote.rich_text, linkMap),
        children: await transformBlocks(children, makeAnchor, idHint, linkMap),
      };

    case "divider":
      return base;

    case "code":
      return {
        ...base,
        richText: transformRichText(block.code.rich_text, linkMap),
        language: block.code.language || "plain text",
        caption: richTextToPlain(block.code.caption),
      };

    case "image": {
      const img = block.image;
      const sourceUrl = img.type === "external" ? img.external.url : img.file.url;
      const localSrc = await downloadImage(sourceUrl, `${idHint}-${block.id}`);
      const { alt, visibleCaption } = resolveImageCaption(img.caption);
      return { ...base, src: localSrc || sourceUrl, alt, visibleCaption };
    }

    case "table": {
      const rows = children
        .filter((c) => c.type === "table_row")
        .map((row) => ({
          cells: (row.table_row.cells || []).map((cell) => transformRichText(cell, linkMap)),
        }));
      return {
        ...base,
        hasColumnHeader: !!block.table.has_column_header,
        hasRowHeader: !!block.table.has_row_header,
        rows,
      };
    }

    case "bookmark":
    case "link_preview":
      return { ...base, url: block[type].url, caption: richTextToPlain(block[type]?.caption) };

    case "embed":
      return { ...base, url: block.embed.url };

    case "video":
    case "audio": {
      const media = block[type];
      const url = media.type === "external" ? media.external.url : media.file.url;
      return { ...base, url };
    }

    case "file":
    case "pdf": {
      const media = block[type];
      const url = media.type === "external" ? media.external.url : media.file.url;
      const name = media.name || (type === "pdf" ? "PDFファイル" : "添付ファイル");
      return { ...base, url, name };
    }

    case "equation":
      return { ...base, expression: block.equation.expression };

    case "column_list":
      return { ...base, children: await transformBlocks(children, makeAnchor, idHint, linkMap) };

    case "column":
      return { ...base, children: await transformBlocks(children, makeAnchor, idHint, linkMap) };

    case "table_of_contents":
      // 独自の目次コンポーネントを別途表示するため、インライン展開はしない
      return null;

    case "child_page":
    case "child_database":
    case "synced_block":
    case "breadcrumb":
    case "unsupported":
    default:
      console.warn(`  [notion] 未対応のブロックタイプ "${type}" をスキップしました (id=${block.id})`);
      return null;
  }
}

// ------------------------------------------------------------
// Notionの「@」メンションでページを選んで貼ったリンクを、サイト内の実URLに変換するための
// NotionページID → サイト内URL のマップ作り。
// ------------------------------------------------------------

/**
 * 記事DB・資料DBの「公開」がオンのページを軽くリスト取得し、
 * NotionページID → サイト内URL（/blog/xxx, /resources/xxx）のマップを作る。
 * サムネイル生成や本文取得はせず、スラッグ解決に必要な最小限のプロパティだけを見るため高速。
 * 記事本文中で「@」から他の記事・資料ページをメンションしてリンクを貼れるようにするための下準備。
 */
export async function buildNotionLinkMap(token) {
  const linkMap = new Map();

  const postsDbId = process.env.NOTION_DATABASE_ID;
  if (postsDbId) {
    try {
      const dataSourceId = await resolveDataSourceId(token, postsDbId);
      // 「公開」プロパティは元がチェックボックスで、型変換の選び方次第で「セレクト」「ステータス」
      // どちらの型にもなりうる。Notion側のフィルター指定でどちらの型キーを使うべきか確定できないため、
      // 全件取得してJS側で判定する（記事数が少ないサイト規模なので負荷は問題にならない）。
      const pages = await queryAllPages(token, dataSourceId, {});
      for (const page of pages) {
        const status = getStatusOrSelectName(page, PROP.status);
        if (status !== POST_STATUS.published && status !== POST_STATUS.editing) continue;
        const title = getTitleText(page, PROP.title) || "";
        const slug = resolveSlug(getRichTextPlain(page, PROP.slug), page.id, title);
        linkMap.set(page.id, `/blog/${slug}`);
      }
    } catch (err) {
      console.warn(`  [notion] 記事間リンク用の一覧取得に失敗しました（記事DB）: ${err.message}`);
    }
  }

  return linkMap;
}

export function getSelectName(page, name) {
  const prop = getProperty(page, name);
  if (!prop || prop.type !== "select") return null;
  return prop.select?.name || null;
}

/**
 * 「セレクト」プロパティ、またはNotion標準の「ステータス」プロパティ（select/status どちらの型でも）
 * から選択されている名前を取得する。チェックボックスから型変換すると、選んだ変換先によって
 * どちらの型になるか変わる（"ステータス"型にすると自動でTo-do/In progress/Complete風の色分けになる）ため、
 * どちらであっても同じように読めるようにしている。
 */
export function getStatusOrSelectName(page, name) {
  const prop = getProperty(page, name);
  if (!prop) return null;
  if (prop.type === "status") return prop.status?.name || null;
  if (prop.type === "select") return prop.select?.name || null;
  return null;
}

/**
 * セレクトプロパティに設定されている「色」（Notion標準の色キーワード。
 * default/gray/brown/orange/yellow/green/blue/purple/pink/red のいずれか）を取得する。
 * getSelectName() が返す選択肢の表示名（ユーザーが付けた文字列）とは別物なので注意。
 * 自動生成サムネイルの背景色（CATEGORY_COLOR_GRADIENTSのキー）に使う。
 */
export function getSelectColor(page, name) {
  const prop = getProperty(page, name);
  if (!prop || prop.type !== "select") return null;
  return prop.select?.color || null;
}

/**
 * 箇条書き想定のリッチテキスト（複数行テキスト）を改行で分割し、
 * 行頭の記号（・- * • など）を取り除いた配列にする。
 * 「ターゲット・目次」のような項目を画面表示用のリストに変換するために使う。
 */
export function splitBulletLines(text) {
  return (text || "")
    .split("\n")
    .map((line) => line.trim().replace(/^[・\-*•]\s*/, ""))
    .filter((line) => line.length > 0);
}

