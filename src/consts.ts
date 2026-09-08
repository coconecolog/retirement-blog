// サイト全体の定数。文言を変えたいときはこのファイルを編集してください。

// SITE_URL は astro.config.mjs の `site` と必ず同じ値にしてください（内部リンク判定・OGP・sitemapに影響）。
export const SITE_URL = import.meta.env.PUBLIC_SITE_URL || "https://mktg-ax.pages.dev";

export const SITE_NAME = "MKTG.AX";
export const SITE_TAGLINE = "経営層・マーケティング責任者のための分析ツール&情報メディア";
export const SITE_DESCRIPTION =
  "経営層・営業責任者・マーケティング責任者向けに、マーケティング分析ツールや実践的な施策・マーケット情報を発信するメディアです。";

export const DEFAULT_OG_IMAGE = "/open-graph/default.png";

// グローバルナビゲーション。children に項目を入れるとヘッダーでプルダウンとして表示される
// （Footer.astroは独自の構成のため、この配列は参照していません。フッターのリンクを変えたい場合はFooter.astroを直接編集してください）。
interface NavChild {
  href: string;
  icon: string;
  label: string;
  description: string;
}

export const NAV_LINKS: { href: string; label: string; children: NavChild[] }[] = [
  { href: "/", label: "トップ", children: [] },
  { href: "/blog", label: "ブログ", children: [] },
  { href: "/contact", label: "お問い合わせ", children: [] },
];

export const POSTS_PER_PAGE = 10;

// カテゴリページ・タグページで1ページに表示する記事数（ブログ一覧とは別に6件区切りにしたいため分けている）
export const CATEGORY_TAG_PAGE_SIZE = 6;

// お問い合わせ先メールアドレス（仮の値です。実際のアドレスに書き換えてください）
export const CONTACT_EMAIL = "info@example.com";

// 個人情報保護方針（/privacy）に記載する事業者情報（仮の値です。確定次第、実際の内容に書き換えてください）
export const OPERATOR_REPRESENTATIVE = "準備中";
export const OPERATOR_ADDRESS = "準備中";

// アクセス解析（未設定の項目はタグを出力しない）
// GTM_ID を設定すると、GA4の直接埋め込みタグの代わりにGoogleタグマネージャー(GTM)を読み込む
// （Analytics.astro側で「GTM設定時はGA4直書きタグを出さない」ようにしており、二重計測を防いでいる）。
// GA4の実際の計測タグは、GTMの管理画面側で「GA4設定タグ」として別途作成する必要がある（コード変更は不要）。
export const GTM_ID = import.meta.env.PUBLIC_GTM_ID || "";
export const GA4_ID = import.meta.env.PUBLIC_GA4_ID || "";
export const CLARITY_ID = import.meta.env.PUBLIC_CLARITY_ID || "";
export const GSC_VERIFICATION = import.meta.env.PUBLIC_GSC_VERIFICATION || "";
