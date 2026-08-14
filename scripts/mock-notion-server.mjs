// テスト用のNotion APIモックサーバー。
// 実際のNotionワークスペースなしで、Notion連携パイプライン（取得→本文変換→ページ生成→OGP生成）を検証するために使う。
// 本番運用には不要（このスクリプトはリポジトリから削除して構いません）。

import http from 'node:http';

const PAGE_1 = {
  id: '11111111-1111-1111-1111-111111111111',
  created_time: '2026-01-01T00:00:00.000Z',
  last_edited_time: '2026-02-01T00:00:00.000Z',
  properties: {
    'タイトル': { title: [{ plain_text: '50代からのNISA活用術' }] },
    'タグ': { multi_select: [{ name: '投資' }, { name: 'NISA' }] },
    '公開日': { date: { start: '2026-02-01' } },
    '更新日': { date: { start: '2026-02-05' } },
    'サムネイル画像': { files: [{ type: 'external', external: { url: 'https://example.com/thumb1.jpg' } }] },
    '公開': { checkbox: true },
  },
};

const PAGE_2 = {
  id: '22222222-2222-2222-2222-222222222222',
  created_time: '2026-01-02T00:00:00.000Z',
  last_edited_time: '2026-01-20T00:00:00.000Z',
  properties: {
    'タイトル': { title: [{ plain_text: '退職金の受け取り方で変わる手取り額' }] },
    'タグ': { multi_select: [{ name: '退職金' }] },
    '公開日': { date: { start: '2026-01-20' } },
    '更新日': { date: { start: '2026-01-20' } },
    'サムネイル画像': { files: [] },
    '公開': { checkbox: true },
  },
};

const BLOCKS = {
  [PAGE_1.id]: [
    { object: 'block', id: 'b1', type: 'heading_2', has_children: false, heading_2: { rich_text: [{ plain_text: 'NISAとは', type: 'text', annotations: { bold: false, italic: false, strikethrough: false, underline: false, code: false, color: 'default' }, href: null }] } },
    { object: 'block', id: 'b2', type: 'paragraph', has_children: false, paragraph: { rich_text: [{ plain_text: '新NISAは非課税投資枠が拡大された制度です。', type: 'text', annotations: { bold: false, italic: false, strikethrough: false, underline: false, code: false, color: 'default' }, href: null }] } },
    { object: 'block', id: 'b3', type: 'bulleted_list_item', has_children: false, bulleted_list_item: { rich_text: [{ plain_text: 'つみたて投資枠は年間120万円', type: 'text', annotations: { bold: false, italic: false, strikethrough: false, underline: false, code: false, color: 'default' }, href: null }] } },
  ],
  [PAGE_2.id]: [
    { object: 'block', id: 'b4', type: 'paragraph', has_children: false, paragraph: { rich_text: [{ plain_text: '退職金は一時金・年金・併用で税金の計算方法が異なります。', type: 'text', annotations: { bold: false, italic: false, strikethrough: false, underline: false, code: false, color: 'default' }, href: null }] } },
  ],
};

const server = http.createServer((req, res) => {
  let body = '';
  req.on('data', (chunk) => (body += chunk));
  req.on('end', () => {
    res.setHeader('Content-Type', 'application/json');

    if (req.method === 'GET' && req.url.match(/\/v1\/databases\/[^/]+$/)) {
      res.end(JSON.stringify({ object: 'database', data_sources: [{ id: 'ds-1', name: 'default' }] }));
      return;
    }

    if (req.method === 'POST' && req.url.match(/\/v1\/data_sources\/.+\/query/)) {
      const parsed = body ? JSON.parse(body) : {};
      const cursor = parsed.start_cursor;
      if (!cursor) {
        res.end(JSON.stringify({ object: 'list', results: [PAGE_1], has_more: true, next_cursor: 'page2' }));
      } else {
        res.end(JSON.stringify({ object: 'list', results: [PAGE_2], has_more: false, next_cursor: null }));
      }
      return;
    }

    const blockMatch = req.url.match(/\/v1\/blocks\/([^/]+)\/children/);
    if (req.method === 'GET' && blockMatch) {
      const pageId = blockMatch[1];
      res.end(JSON.stringify({ object: 'list', results: BLOCKS[pageId] ?? [], has_more: false, next_cursor: null }));
      return;
    }

    res.statusCode = 404;
    res.end(JSON.stringify({ object: 'error', message: 'not found in mock' }));
  });
});

const port = 4111;
server.listen(port, () => {
  console.log(`mock notion server listening on http://127.0.0.1:${port}`);
});
