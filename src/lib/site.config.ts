// サイト全体の基本設定。
// ここを編集するだけでサイト名・説明文・SNS計測IDなどを差し替えられます。

export const SITE = {
  title: '50代から育てるポートフォリオ',
  // 検索結果・OGPに使われる説明文。仮の文言なので確定後に差し替えてください。
  description:
    '50代からの、老後に向けた最後の攻めと資産の守り方を学ぶサイト。投資・資産形成の基礎から出口戦略まで。',
  // astro.config.mjs の `site` と揃えてください（独自ドメイン確定後に変更）
  url: 'https://retirement-blog.pages.dev',
  locale: 'ja-JP',
  postsPerPage: 9,
};

// ヘッダーのサブタイトル（ロゴ下の小さな英字）
export const SITE_DESCRIPTOR = 'TIME · MONEY · SMALL MEDIA';

// ヘッダーのナビゲーション
export const NAV = [
  { label: '実験ログ', href: '/blog' },
  { label: '3つのテーマ', href: '/#themes' },
  { label: 'このサイトについて', href: '/about' },
];

// 3つのテーマ（Notionのマスターカテゴリ名と完全に一致させてください）
// color はテーマごとの淡い背景色（global.css の --color-theme-* と対応）
export const THEMES = [
  { name: '働き方とこれからのこと', color: 'var(--color-theme-work)' },
  { name: 'お金と暮らし', color: 'var(--color-theme-money)' },
  { name: '自分の小さなメディア', color: 'var(--color-theme-media)' },
];

// テーマ名から背景色を取り出す（見つからなければ砂色）
export function themeColor(name: string | null | undefined): string {
  return THEMES.find((t) => t.name === name)?.color ?? 'var(--color-sand)';
}

// 記事ページの末尾に出す一言・注意書き・「記録する人」欄
export const ARTICLE_SIGNATURE = '急がない。でも、止まらない。';
export const ARTICLE_DISCLAIMER =
  'このログは個人の考え方と体験の記録で、特定の金融商品や個別銘柄の購入を勧めるものではありません。契約や運用の判断が必要な場合は、条件を確認し、必要に応じて専門家に相談してください。';
export const AUTHOR_PROFILE = {
  label: '記録する人',
  headline: '会社員を続けながら、\nこれからの働き方を試しています。',
  bio: '50代、会社員。専門家ではありません。だからこそ、調べ、試し、迷った道筋まで共有します。時間と収入を、自分のペースで育てるための小さな作業机です。',
};

// お問い合わせフォーム（GoogleフォームのURL）。空欄の間はお問い合わせページに「準備中」と表示されます。
export const CONTACT_FORM_URL = '';

// GA4 / Search Console / Clarity の計測ID。
// 発行後に環境変数（.env / Cloudflare Pages の環境変数）で上書きしてください。
export const ANALYTICS = {
  gaMeasurementId: import.meta.env.PUBLIC_GA_MEASUREMENT_ID ?? '',
  clarityProjectId: import.meta.env.PUBLIC_CLARITY_PROJECT_ID ?? '',
  googleSiteVerification: import.meta.env.PUBLIC_GOOGLE_SITE_VERIFICATION ?? '',
};
