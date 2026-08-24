// Google Analytics（GA4）から、直近のページビュー数が多い記事の並び順（記事ページのスラッグの配列）を取得するモジュール。
//
// 「人気記事一覧」に使う。Notion側にはページビュー数のデータがないため、GA4のData APIをビルド時に呼び出して取得する。
//
// 必要な環境変数（GitHub Secretsで設定）:
// ・GA4_PROPERTY_ID … GA4の「プロパティID」（数字のみ。測定ID「G-XXXXXXX」とは別物）
// ・GA4_SERVICE_ACCOUNT_KEY … Google Cloudのサービスアカウントの認証情報（JSONファイルの中身をそのまま1行の文字列として）
//
// どちらか片方でも未設定・取得エラー時は、例外を投げずに空配列を返す（呼び出し側で「最新記事で埋める」等のフォールバックを行う前提）。
import { BetaAnalyticsDataClient } from '@google-analytics/data';

// GA4のページパス（例: "/blog/nisa-guide-2026" や "/blog/nisa-guide-2026/"）からスラッグ部分だけを取り出す。
// "/blog/"配下ではない・スラッグが空のパスはnullを返す。
function extractBlogSlug(pagePath: string | null | undefined): string | null {
  if (!pagePath) return null;
  const match = pagePath.match(/^\/blog\/([^/?#]+)\/?$/);
  return match ? decodeURIComponent(match[1]) : null;
}

// 直近28日間で、ページビュー数が多い順に「/blog/xxx」のスラッグを並べて返す（重複なし）。
// limitは「候補として何件取得するか」（一覧ページや存在しない記事等が混ざる分、実際に欲しい件数より多めに取る想定）。
export async function getPopularSlugsByPageviews(limit = 20): Promise<string[]> {
  const propertyId = process.env.GA4_PROPERTY_ID;
  const rawKey = process.env.GA4_SERVICE_ACCOUNT_KEY;

  if (!propertyId || !rawKey) {
    console.warn(
      '[analytics] GA4_PROPERTY_ID / GA4_SERVICE_ACCOUNT_KEY が未設定です。人気記事一覧は最新記事で代用されます。'
    );
    return [];
  }

  try {
    const credentials = JSON.parse(rawKey);
    const client = new BetaAnalyticsDataClient({ credentials });

    const [response] = await client.runReport({
      property: `properties/${propertyId}`,
      dateRanges: [{ startDate: '28daysAgo', endDate: 'today' }],
      dimensions: [{ name: 'pagePath' }],
      metrics: [{ name: 'screenPageViews' }],
      orderBys: [{ metric: { metricName: 'screenPageViews' }, desc: true }],
      limit,
    });

    const slugs: string[] = [];
    for (const row of response.rows ?? []) {
      const pagePath = row.dimensionValues?.[0]?.value;
      const slug = extractBlogSlug(pagePath);
      if (slug && !slugs.includes(slug)) slugs.push(slug);
    }
    return slugs;
  } catch (err) {
    console.warn('[analytics] GA4からの人気記事データの取得に失敗しました。最新記事で代用されます。', err);
    return [];
  }
}
