// サイト全体の基本設定。
// ここを編集するだけでサイト名・説明文・SNS計測IDなどを差し替えられます。

export const SITE = {
  title: '資産の守り方',
  // 検索結果・OGPに使われる説明文。仮の文言なので確定後に差し替えてください。
  description:
    '50代からの、老後に向けた最後の攻めと資産の守り方を学ぶサイト。投資・資産形成の基礎から出口戦略まで。',
  // astro.config.mjs の `site` と揃えてください（独自ドメイン確定後に変更）
  url: 'https://example.com',
  locale: 'ja-JP',
  postsPerPage: 9,
};

export const NAV = [
  { label: 'トップ', href: '/' },
  { label: 'ブログ', href: '/blog/1' },
  { label: 'ABOUT', href: '/about' },
];

// GA4 / Search Console / Clarity の計測ID。
// 発行後に環境変数（.env / Cloudflare Pages の環境変数）で上書きしてください。
export const ANALYTICS = {
  gaMeasurementId: import.meta.env.PUBLIC_GA_MEASUREMENT_ID ?? '',
  clarityProjectId: import.meta.env.PUBLIC_CLARITY_PROJECT_ID ?? '',
  googleSiteVerification: import.meta.env.PUBLIC_GOOGLE_SITE_VERIFICATION ?? '',
};
