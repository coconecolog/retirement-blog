export function formatDate(iso: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return new Intl.DateTimeFormat('ja-JP', { year: 'numeric', month: 'long', day: 'numeric' }).format(d);
}

// 「2026.10.02」形式の日付（新デザイン用）
export function formatDateDot(iso: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const parts = new Intl.DateTimeFormat('ja-JP', { timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(d);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  return `${get('year')}.${get('month')}.${get('day')}`;
}

// 本文の文字数から読了時間を概算する（1分あたり約500文字）。
export function estimateReadMinutes(html: string): number {
  const textLength = html.replace(/<[^>]*>/g, '').replace(/\s+/g, '').length;
  return Math.max(1, Math.round(textLength / 500));
}
