# 資産の守り方サイト（Astro × Notion × Cloudflare Pages）

50代前後の方に向けた、資産運用・出口戦略の情報サイトです。記事はNotionで書き、公開フラグをONにすると自動的にサイトへ反映されます。

```
[Notion データベース] --(API・ビルド時に取得)--> [GitHub Actions] --(30分おき/手動)--> [Cloudflare Pages]
```

- 記事データはGitリポジトリには保存されません（ビルドのたびにNotionから取得します）
- 費用：Notion無料プラン・GitHub無料プラン（パブリックリポジトリ）・Cloudflare Pages無料プランの範囲で完結する構成です

---

## 0. まず知っておくこと

- 記事の反映は **最大30分ほど遅れます**（GitHub Actionsが30分おきに自動チェック→ビルド→公開するため）。すぐ確認したい場合は、GitHubの「Actions」タブから手動実行できます（手順は5章）。
- Notionに直接アップロードした画像は、Notion側のURLが約1時間で失効する仕様です。30分おきの自動更新の範囲内であれば通常問題になりませんが、長期間ビルドが止まると画像が表示されなくなることがあります。

---

## 1. 全体で必要になるアカウント

- Notion（既にお使いのはず）
- GitHub（無料アカウントでOK）
- Cloudflare（無料アカウントでOK）
- Google アカウント（Google Analytics・Search Console用）

---

## 2. Notion側の準備

### 2-1. データベースのプロパティを確認

以下のプロパティ名・型で用意してください（名前が違うとサイトに反映されません）。名前を変えたい場合は `src/lib/notion.ts` の `PROP` を書き換えれば対応できます。

| プロパティ名 | 型 |
|---|---|
| タイトル | タイトル |
| タグ | マルチセレクト |
| 公開日 | 日付 |
| 更新日 | 日付 |
| サムネイル画像 | ファイル&メディア |
| 公開 | チェックボックス |

本文はNotionページ本体（ブロック）がそのまま記事本文として使われます。

### 2-2. インテグレーション（API連携）を作成する

1. Notionの左サイドバーから **設定（Settings）→ Connections（接続）** を開く
2. 「Develop your own connections（独自の接続を開発）」を開く
3. 「+ New connection（新規接続）」を押す
4. 名前を入力（例：「資産サイト連携」）、対象ワークスペースを選択して作成
5. 作成した接続の「…」メニューから **APIシークレット（トークン）** を表示・コピーする（`ntn_` または `secret_` から始まる文字列）→ これが `NOTION_TOKEN` です

### 2-3. データベースと接続を共有する

1. 記事データベースを開く
2. 右上の「…」メニュー → 「connections（接続）」→ 先ほど作成した接続を選んで追加
   （これをしないと、トークンがあってもAPIから読み取れません）

### 2-4. データベースIDを控える

データベースをブラウザで開いたときのURLの中にある32桁の英数字が `NOTION_DATABASE_ID` です。
`https://www.notion.so/xxxxxxxx/【ここの32桁】?v=...`

---

## 3. GitHubにコードを置く

1. GitHubで新規リポジトリを作成（**Public（公開）推奨** — Actionsの実行時間が無料・無制限になるため。ソースコードに機密情報は含めていません）
2. このフォルダ一式をリポジトリにpushする
   ```bash
   cd retirement-blog
   git init
   git add .
   git commit -m "初回コミット"
   git branch -M main
   git remote add origin https://github.com/【あなたのアカウント】/【リポジトリ名】.git
   git push -u origin main
   ```
   ※ Gitに不慣れな場合は、GitHub Desktop（GUIアプリ）を使うと簡単です。

---

## 4. Cloudflare Pagesプロジェクトを作成する

GitHub Actionsからのデプロイ用に、**最初の1回だけ**ダッシュボードで空のプロジェクトを作っておく必要があります（自動作成はCI環境では失敗するため）。

1. Cloudflareダッシュボード → 左メニュー「Workers & Pages」
2. 「Create」→「Pages」タブ→「Upload assets（直接アップロード）」を選択
3. プロジェクト名を入力（例：`retirement-blog`）
4. 適当な仮ファイル（何でも良い、例えばテキストファイル1つ）をアップロードして、いったんプロジェクトだけ作成する
5. 作成できたら、このプロジェクト名を控えておく → 後で `CLOUDFLARE_PAGES_PROJECT_NAME` として使います

### 4-1. Cloudflareの認証情報を取得する

- **Account ID**：Workers & Pagesの画面右側に表示されています → `CLOUDFLARE_ACCOUNT_ID`
- **API Token**：右上のアカウントメニュー → 「My Profile」→「API Tokens」→「Create Token」→ カスタムトークンで
  **Account / Cloudflare Pages / Edit** 権限を付与して発行 → `CLOUDFLARE_API_TOKEN`

---

## 5. GitHubにSecrets（環境変数）を登録する

リポジトリの **Settings → Secrets and variables → Actions → New repository secret** から、以下をすべて登録します。

| Secret名 | 値 |
|---|---|
| `NOTION_TOKEN` | 2-2で取得したトークン |
| `NOTION_DATABASE_ID` | 2-4で控えたデータベースID |
| `CLOUDFLARE_API_TOKEN` | 4-1で発行したトークン |
| `CLOUDFLARE_ACCOUNT_ID` | 4-1のAccount ID |
| `CLOUDFLARE_PAGES_PROJECT_NAME` | 4で作成したプロジェクト名 |
| `PUBLIC_GA_MEASUREMENT_ID` | （任意）GA4の測定ID |
| `PUBLIC_CLARITY_PROJECT_ID` | （任意）ClarityのプロジェクトID |
| `PUBLIC_GOOGLE_SITE_VERIFICATION` | （任意）Search Console所有権確認用の値 |

登録が終わったら、リポジトリの「Actions」タブ → 「Build and Deploy to Cloudflare Pages」→「Run workflow」で手動実行し、緑のチェックがつけば成功です。以降は30分おきに自動実行されます。

---

## 6. 独自ドメインの設定

Cloudflare Pagesのプロジェクト画面 →「Custom domains」→ ドメインを追加。ドメインのDNSをCloudflareで管理していれば数クリックで反映されます。

反映後、以下の2箇所を実際のドメインに書き換えてください。
- `astro.config.mjs` の `site`
- `public/robots.txt` の `Sitemap:` の行
- `src/lib/site.config.ts` の `SITE.url`

---

## 7. Google Analytics / Search Console / Clarity

- **GA4**：測定ID（`G-` から始まる文字列）を `PUBLIC_GA_MEASUREMENT_ID` に設定
- **Search Console**：ドメインを登録後、所有権確認方法で「HTMLタグ」を選び、`content="..."` の値を `PUBLIC_GOOGLE_SITE_VERIFICATION` に設定（サイトマップは `/sitemap-index.xml` を送信）
- **Clarity**：プロジェクト作成後に発行されるプロジェクトIDを `PUBLIC_CLARITY_PROJECT_ID` に設定

いずれもGitHub Secretsに値を追加するだけで、次回ビルドから自動で埋め込まれます。

---

## 8. 日常の運用

1. Notionで記事を作成・編集
2. 「公開」チェックボックスをON
3. 最大30分ほど待つ（急ぐ場合はGitHub Actionsを手動実行）
4. サイトに反映される

「公開」をOFFにすれば、その記事はサイトから消えます（削除ではなく非表示扱い）。

---

## 9. デザイン・文言をカスタマイズしたいとき

- サイト名・説明文・ナビゲーション：`src/lib/site.config.ts`
- 配色（ブランドカラーが決まったら）：`src/styles/global.css` の `--color-brand` 系
- トップページの文言：`src/pages/index.astro`
- ABOUT・プライバシーポリシーの文言：`src/pages/about.astro` / `src/pages/privacy.astro`（現在は仮文言です。必ず内容を確認・修正してください）
- OGP画像のデザイン：`src/pages/og/[slug].png.ts`（記事ごと）／`scripts/generate-default-ogp.mjs`（トップ等の共通画像。変更後に `node scripts/generate-default-ogp.mjs` を再実行）

---

## 10. ローカルで確認したいとき

```bash
npm install
cp .env.example .env   # NOTION_TOKEN / NOTION_DATABASE_ID を記入
npm run dev             # http://localhost:4321 で確認
npm run build            # 本番ビルド（distフォルダに出力）
```

---

## 11. トラブルシューティング

- **記事が0件のまま反映されない**：GitHub Secretsの `NOTION_TOKEN` / `NOTION_DATABASE_ID` を確認。データベースに接続（2-3）を共有し忘れていないか確認。
- **GitHub Actionsが赤くなる（失敗する）**：Actionsタブのログを開き、エラーメッセージを確認。多くの場合Secretsの入力ミスです。
- **画像が表示されない**：Notionに直接アップロードした画像はURLが約1時間で失効します。次の自動ビルド（最大30分後）で復旧します。

---

## 12. このリポジトリに含まれる開発用ファイルについて

`scripts/mock-notion-server.mjs` はNotionと接続せずにビルドの動作確認をするためのテスト用スクリプトです。運用上は不要なので、削除しても問題ありません。
