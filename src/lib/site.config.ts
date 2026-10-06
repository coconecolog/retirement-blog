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
export const THEMES = [
  { name: '働き方とこれからのこと' },
  { name: 'お金と暮らし' },
  { name: '自分の小さなメディア' },
];

// お問い合わせフォーム（GoogleフォームのURL）。空欄の間はお問い合わせページに「準備中」と表示されます。
export const CONTACT_FORM_URL = '';

// GA4 / Search Console / Clarity の計測ID。
// 発行後に環境変数（.env / Cloudflare Pages の環境変数）で上書きしてください。
export const ANALYTICS = {
  gaMeasurementId: import.meta.env.PUBLIC_GA_MEASUREMENT_ID ?? '',
  clarityProjectId: import.meta.env.PUBLIC_CLARITY_PROJECT_ID ?? '',
  googleSiteVerification: import.meta.env.PUBLIC_GOOGLE_SITE_VERIFICATION ?? '',
};
