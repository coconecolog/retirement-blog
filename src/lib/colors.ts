// Notionのテキストカラー/背景色をCSSに変換するためのマップ。

const TEXT_COLORS: Record<string, string> = {
  gray: "#6b7280",
  brown: "#92725a",
  orange: "#d9730d",
  yellow: "#cb912f",
  green: "#448361",
  blue: "#337ea9",
  purple: "#9065b0",
  pink: "#c14c8a",
  red: "#e03e3e",
};

const BG_COLORS: Record<string, string> = {
  gray_background: "#f1f1ef",
  brown_background: "#f4eeee",
  orange_background: "#fbecdd",
  yellow_background: "#fbf3db",
  green_background: "#edf3ec",
  blue_background: "#e7f3f8",
  purple_background: "#f6f3f9",
  pink_background: "#fbf2f5",
  red_background: "#fdebec",
};

/** Notionのcolor annotationからCSSのstyle文字列を返す（該当なしはundefined）。 */
export function notionColorToStyle(color: string | null | undefined): string | undefined {
  if (!color) return undefined;
  if (color in BG_COLORS) return `background-color:${BG_COLORS[color]}`;
  if (color in TEXT_COLORS) return `color:${TEXT_COLORS[color]}`;
  return undefined;
}
