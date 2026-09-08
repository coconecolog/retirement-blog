// .notion-cache/posts.json （scripts/fetch-notion.mjs が生成）の型定義。
// スクリプト側（JS）とAstro側（TS）で二重管理になっているので、
// 片方の形を変えたらもう片方も忘れずに直してください。

export interface RichTextItem {
  text: string;
  href: string | null;
  bold: boolean;
  italic: boolean;
  strikethrough: boolean;
  underline: boolean;
  code: boolean;
  color: string | null;
}

export interface BlockNode {
  id: string;
  type: string;
  level?: number;
  richText?: RichTextItem[];
  anchor?: string;
  toggleable?: boolean;
  children?: BlockNode[];
  checked?: boolean;
  emoji?: string | null;
  language?: string;
  caption?: string;
  src?: string;
  alt?: string;
  visibleCaption?: string | null;
  hasColumnHeader?: boolean;
  hasRowHeader?: boolean;
  rows?: { cells: RichTextItem[][] }[];
  url?: string;
  name?: string;
  expression?: string;
}

export interface Post {
  id: string;
  slug: string;
  title: string;
  description: string;
  tags: string[];
  /** 「マスターカテゴリ」DBとのリレーションから解決したカテゴリ名の先頭1件（未設定ならnull）。カード等の単一バッジ表示用。 */
  category: string | null;
  /** 「マスターカテゴリ」DBとのリレーションから解決した全カテゴリ名（複数選択可）。カテゴリページの絞り込みはこちらを使う。 */
  categories: string[];
  /** 「記事の要点」プロパティ（複数行テキスト）を1行ずつに分割した配列。記事冒頭の「この記事でわかること」ボックスに使う。空配列なら非表示。 */
  keyPoints: string[];
  publishedAt: string;
  updatedAt: string;
  thumbnail: string | null;
  blocks: BlockNode[];
}

// マスターカテゴリDB（Notion）1件分。記事DBの「カテゴリ」リレーション先そのもの。
// representativeSlug は「代表記事Slug」プロパティの値で、
// 対応する記事が見つからない場合は null として扱う。
export interface Category {
  name: string;
  description: string;
  representativeSlug: string | null;
  /** 自動生成サムネイルの背景色（画像未設定時のフォールバック）。「テーマカラー」セレクトプロパティの値。未設定ならnull */
  themeColor: string | null;
  /** 自動生成サムネイルの背景画像ファイル名（public/images/category-backgrounds/ 配下）。未設定なら空文字 */
  backgroundImageFilename: string;
  /** 表示順（「並び順」プロパティ、小さい順）。未設定ならnull（末尾に表示される） */
  order: number | null;
  /** カテゴリページ本文（Notion側で「説明文」より下に書かれた解説記事）のブロック。カテゴリページ下部に表示する。 */
  blocks: BlockNode[];
}

// マスタータグDB（Notion）1件分。記事DB・資料DBの「タグ」リレーション先そのもの。
// マスターカテゴリと同じ構成（自動生成サムネイル用のテーマカラー・背景画像プロパティは無い）。
export interface Tag {
  name: string;
  description: string;
  representativeSlug: string | null;
  /** タグページ本文（Notion側で「説明文」より下に書かれた解説文）のブロック。タグページ下部に表示する。 */
  blocks: BlockNode[];
}

export interface PostsCache {
  generatedAt: string;
  posts: Post[];
  categories: Category[];
  tags: Tag[];
  error?: string;
}

export interface TocItem {
  anchor: string;
  text: string;
  level: number;
  children: TocItem[];
}

