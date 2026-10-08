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
  { label: 'このサイトについて', href: '/about' },
];

// 3つのテーマ（Notionのマスターカテゴリ名と完全に一致させてください）
// 3つのテーマの表示内容。name は Notionのマスターカテゴリ名と完全に一致させてください。
// color：テーマの淡い背景色／images：public/images/themes/ 内のイラスト
export type Theme = {
  // URLに使う英字（/blog/category/money など）
  key: 'work' | 'money' | 'media';
  name: string;
  // このテーマとして扱う、Notionの旧カテゴリ名
  aliases: string[];
  number: string;
  en: string;
  // トップの「3つの道」カードの表示（\n で改行）
  cardTitle: string;
  // カテゴリ名に必ず添えるサブタイトル（「｜」の位置で改行しやすくなります）
  subtitle: string;
  color: string;
  // テーマページ冒頭
  tagline: string;
  intro: string;
  caption: string;
  startHereNote: string;
  // 他のテーマページの「となりの道も、歩いてみる」に出す紹介文
  blurb: string;
  // ブログトップの「今日の読みはじめ」
  pathTitle: string;
  pathLead: string;
};

export const THEMES: Theme[] = [
  {
    key: 'work',
    name: '働き方とこれからのこと',
    aliases: [],
    number: '01',
    en: 'WORK & LIFE',
    cardTitle: '働き方と\nこれからのこと',
    subtitle: '8時間労働からの脱却｜自分時間のつくり方',
    color: 'var(--color-theme-work)',
    tagline: '働くことと、生きること。そのあいだに、私の余白を。',
    intro: '週5日・8時間を当たり前にしてきた毎日から、少しずつ距離を置いてみる。辞めるか、続けるかを急いで決めずに、これからの時間と暮らしを整える記録です。',
    caption: '急がない。でも、止まらない。',
    startHereNote: '大きな決断より、小さな一歩から。',
    blurb: '暮らしの輪郭が見えたら、働く時間も。辞めるか続けるかの前に、残したい余白を考えます。',
    pathTitle: '働く時間を、見つめる。',
    pathLead: 'まず、いつもの一週間に余白を。',
  },
  {
    key: 'money',
    name: 'お金と暮らし',
    aliases: ['銘柄選定・分析', '口座・ツール活用', '戦略・資産配分'],
    number: '02',
    en: 'MONEY & LIFE',
    cardTitle: 'お金と暮らし',
    subtitle: '50代からの資産運用｜「減らさない＆増やす」土台',
    color: 'var(--color-theme-money)',
    tagline: '増やす話の前に、いまの暮らしの現在地から。',
    intro: '気づけば積み上がってきた資産。ここから戦略的になるために、基礎から学んでいきます。残すお金、使いたいお金、試すためのお金を、私の暮らしの言葉で捉え直す記録です。',
    caption: '増やす前に、まず並べてみる。',
    startHereNote: '金額を評価するより、置き場所を知ることから。',
    blurb: '働く時間を考えたら、暮らしを支えるお金のことも。増やす前に、いまの置き場所から。',
    pathTitle: '暮らしのお金を、整える。',
    pathLead: '時間を変えたくなったら、お金の現在地へ。',
  },
  {
    key: 'media',
    name: '自分の小さなメディア',
    aliases: [],
    number: '03',
    en: 'MY SMALL MEDIA',
    cardTitle: '自分の小さな\nメディア',
    subtitle: '経験を型に変える｜Webストック収入',
    color: 'var(--color-theme-media)',
    tagline: '経験や好きなことに、私だけの小さな居場所を。',
    intro: '詳しくなくても、AIと話しながらなら一歩ずつ。作ってみたこと、困ったこと、直してみたことを、自分のペースで残します。速さや完成度より、自分の声が残る場所を育てる記録です。',
    caption: '小さく開いて、少しずつ育てる。',
    startHereNote: '全部わかってから、でなくてもいい。',
    blurb: '経験や好きなことを、小さな場所に置いてみる。自分の声が残る発信を、少しずつ。',
    pathTitle: '自分の居場所を、つくる。',
    pathLead: 'できた余白で、小さな発信を試してみる。',
  },
];

export function findTheme(name: string | null | undefined): Theme | undefined {
  return THEMES.find((t) => t.name === name);
}

// Notionのカテゴリ名（旧カテゴリ名を含む）を、3つのテーマ名にそろえる。どれにも当てはまらなければそのまま。
export function normalizeCategory(name: string): string {
  return THEMES.find((t) => t.name === name || t.aliases.includes(name))?.name ?? name;
}

// テーマページのURL（英字）。テーマ以外のカテゴリ名ならブログトップへ。
export function themeHref(name: string): string {
  const theme = findTheme(name);
  return theme ? `/blog/category/${theme.key}` : '/blog';
}

// ブログトップの文言
export const BLOG_PAGE = {
  eyebrow: 'BLOG  /  途中を綴る、実験ログ',
  title: '実験ログ',
  headline: '時間、お金、私の居場所。\n暮らしの問いを、ひとつずつ試してみる。',
  lead: '成功も、失敗も、まだ途中のことも。3つのテーマを行き来しながら、\n自分時間と暮らしのポートフォリオを育てる読みものです。',
  pathNote: '順に読んでも、気になる問いからでも。',
  pathFooter: '働き方からお金へ。お金から小さな挑戦へ。ひとつの暮らしを、違う角度から眺めます。',
  // 「IN PROGRESS」の枠（空欄にすると非表示）
  noteTitle: '編集の余白メモ',
  noteStatus: '試しているところ',
  noteHeadline: '正解を急ぐより、途中の私を残しておく。',
  noteBody: 'お金のノートを開く日も、サイトがうまく表示されない日も、同じ暮らしの続き。読み返したときに、自分が何を考えていたかがわかるように。小さな気づきから、また次の実験を始めます。',
  noteFoot: 'この実験ログの約束：教える人ではなく、試している本人として書く。',
};

// テーマ名から背景色を取り出す（見つからなければ砂色）
export function themeColor(name: string | null | undefined): string {
  return findTheme(name)?.color ?? 'var(--color-sand)';
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
