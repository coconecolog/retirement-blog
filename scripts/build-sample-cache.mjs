// Notionをまだ設定していない段階でもサイトのデザイン・機能を確認できるように、
// サンプル記事データを .notion-cache/posts.json に書き出すスクリプト。
// 実行方法: npm run fetch-notion:sample
//
// このスクリプトはNotionへ一切アクセスしません。Notion APIの生ブロック形式を模した
// サンプルを scripts/lib/transform.mjs の変換ロジックに通しているだけです
// （＝本番と同じ変換コードでレンダリング結果を確認できます）。

import fs from "node:fs/promises";
import path from "node:path";
import { makeAnchorFactory, transformBlocks, extractExcerpt } from "./lib/transform.mjs";

function rt(text, annotations = {}) {
  return {
    type: "text",
    plain_text: text,
    href: annotations.href || null,
    text: { content: text, link: annotations.href ? { url: annotations.href } : null },
    annotations: {
      bold: !!annotations.bold,
      italic: !!annotations.italic,
      strikethrough: !!annotations.strikethrough,
      underline: !!annotations.underline,
      code: !!annotations.code,
      color: annotations.color || "default",
    },
  };
}

function block(type, payload, children = []) {
  return { id: `${type}-${Math.random().toString(36).slice(2, 8)}`, type, [type]: payload, _children: children };
}

const rawBlocks = [
  block("heading_1", { rich_text: [rt("サンプル記事: 見出しと装飾のプレビュー")] }),
  block("paragraph", {
    rich_text: [
      rt("これはNotion連携のサンプルです。"),
      rt("太字", { bold: true }),
      rt("・"),
      rt("斜体", { italic: true }),
      rt("・"),
      rt("コード", { code: true }),
      rt("・"),
      rt("リンク", { href: "https://example.com" }),
      rt("・"),
      rt("赤字", { color: "red" }),
      rt(" もこのとおり表示されます。"),
    ],
  }),

  block("heading_2", { rich_text: [rt("導入: このセクションは目次に表示されます")] }),
  block("paragraph", { rich_text: [rt("見出し2・見出し3は目次にネスト表示されます。")] }),

  block("heading_3", { rich_text: [rt("目次に入る見出し3-A")] }),
  block("paragraph", { rich_text: [rt("見出し3の配下テキストです。")] }),

  block("heading_3", { rich_text: [rt("目次に入る見出し3-B")] }),
  block("callout", { rich_text: [rt("コールアウトは背景ボックス・枠線と斜体なしで表示されます。")], icon: { type: "emoji", emoji: "💡" } }),
  block("quote", { rich_text: [rt("引用ブロックは枠線＋斜体で、コールアウトと見分けがつくようにしています。")] }),

  block("heading_4", { rich_text: [rt("見出し4もきちんとh4として表示されます")] }),
  block("paragraph", { rich_text: [rt("見出し4は目次には含まれませんが、本文中の小見出しとして使えます。")] }),

  block("heading_2", { rich_text: [rt("リスト・チェックリスト")] }),
  block("bulleted_list_item", { rich_text: [rt("箇条書き1")] }, [
    block("numbered_list_item", { rich_text: [rt("ネストした番号付きリスト")] }),
  ]),
  block("bulleted_list_item", { rich_text: [rt("箇条書き2")] }),
  block("to_do", { rich_text: [rt("完了済みタスク")], checked: true }),
  block("to_do", { rich_text: [rt("未完了タスク")], checked: false }),

  block(
    "toggle",
    { rich_text: [rt("トグル（クリックで開閉）")] },
    [block("paragraph", { rich_text: [rt("トグルの中身のテキストです。")] })],
  ),

  block("heading_2", { rich_text: [rt("画像のalt・キャプション判定")] }),
  block("image", {
    type: "external",
    external: { url: "https://placehold.jp/1200x630.png?text=caption-empty" },
    caption: [],
  }),
  block("image", {
    type: "external",
    external: { url: "https://placehold.jp/1200x630.png?text=alt-only" },
    caption: [rt("alt: 画面には表示されないalt専用テキスト")],
  }),
  block("image", {
    type: "external",
    external: { url: "https://placehold.jp/1200x630.png?text=visible-caption" },
    caption: [rt("画面にも表示される通常のキャプションです")],
  }),

  block("heading_2", { rich_text: [rt("表（列見出し・行見出し・セル内改行）")] }),
  block(
    "table",
    { table_width: 3, has_column_header: true, has_row_header: true },
    [
      block("table_row", { cells: [[rt("項目")], [rt("Before")], [rt("After")]] }),
      block("table_row", {
        cells: [
          [rt("CVR")],
          [rt("1.2%")],
          [rt("太字", { bold: true }), rt("2.4%\n（前月比+1.2pt）")],
        ],
      }),
      block("table_row", {
        cells: [[rt("CPA")], [rt("¥8,000")], [rt("¥5,200\n目標達成")]],
      }),
    ],
  ),

  block("heading_2", { rich_text: [rt("コード・区切り線・カラム")] }),
  block("code", { rich_text: [rt('console.log("hello")')], language: "javascript" }),
  block("divider", {}),
  block(
    "column_list",
    {},
    [
      block("column", {}, [block("paragraph", { rich_text: [rt("左カラム")] })]),
      block("column", {}, [block("paragraph", { rich_text: [rt("右カラム")] })]),
    ],
  ),

  block("bookmark", { url: "https://example.com", caption: [rt("参考リンクの例")] }),
];

async function main() {
  const makeAnchor = makeAnchorFactory();
  const blocks = await transformBlocks(rawBlocks, makeAnchor, "sample-page");
  const description = extractExcerpt(blocks);

  const posts = [
    {
      id: "sample-page-1",
      slug: "sample-post",
      title: "サンプル記事: 見出しと装飾のプレビュー",
      description,
      tags: ["サンプル", "使い方"],
      publishedAt: "2026-08-01T00:00:00.000Z",
      updatedAt: "2026-08-10T00:00:00.000Z",
      thumbnail: null,
      blocks,
    },
    {
      id: "sample-page-2",
      slug: "second-sample-post",
      title: "2件目のサンプル記事（一覧・タグ確認用）",
      description: "一覧ページやタグ絞り込み、ページネーションの見た目を確認するための2件目の記事です。",
      tags: ["サンプル"],
      publishedAt: "2026-07-15T00:00:00.000Z",
      updatedAt: "2026-07-15T00:00:00.000Z",
      thumbnail: null,
      blocks: [block("paragraph", { rich_text: [rt("本文サンプルです。")] })].map((b) => ({
        id: b.id,
        type: b.type,
        richText: [{ text: "本文サンプルです。", href: null, bold: false, italic: false, strikethrough: false, underline: false, code: false, color: null }],
        children: [],
      })),
    },
  ];

  const cacheDir = path.resolve(process.cwd(), ".notion-cache");
  await fs.mkdir(cacheDir, { recursive: true });
  await fs.writeFile(
    path.join(cacheDir, "posts.json"),
    JSON.stringify({ generatedAt: new Date().toISOString(), posts }, null, 2),
  );
  console.log(`[build-sample-cache] サンプル記事 ${posts.length}件を書き出しました。`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
