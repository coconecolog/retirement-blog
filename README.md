# ブログサイト運用ガイド（mktg.axから「ブログ機能のみ」を再構築したもの）

このリポジトリは、本番サイト mktg.ax（coconecolog/mktg-ax）の実コードをベースに、**ブログ機能（記事・カテゴリ・タグ）だけ**を抜き出して作り直したものです。

Notion に書いた記事を Astro + Tailwind CSS でサイト化し、GitHub Actions 経由で Cloudflare Pages に自動デプロイする仕組みは元のサイトと同じです。

---

## 元のmktg.axとの違い（何を外したか）

元のサイトが持っていた以下の機能は、今回の依頼（ブログ機能のみでよい）に合わせて含めていません。必要になったら本家のコード（coconecolog/mktg-ax）を参照して個別に移植してください。

- 資料DB・資料ダウンロードページ（`/resources`）・PDFプレビュー自動生成（poppler-utils）
- 執筆者リストDB・執筆者カード・執筆者ページ（`/authors`）
- 記事＋資料の統合「ライブラリ」ページ（`/library`）
- お問い合わせフォーム・資料DLフォームのバックエンド（Cloudflare Pages Functions・Supabase・Resend）→ `/contact` はメールアドレスへのmailtoリンクのみの簡易版にしています
- 便利ツール群（`/tools/*`）、サービスページ（`/service`）、利用規約（`/terms`）

含まれているもの：トップ／ブログ一覧・詳細／カテゴリ別一覧／タグ別一覧／プライバシーポリシー／お問い合わせ（簡易版）／サイト内検索（Pagefind）／RSS／サイトマップ／robots.txt／OGP画像自動生成／JSON-LD構造化データ（Article・BreadcrumbList・WebSite・FAQPage）。

---

## 1. 全体の仕組み

```
Notion（記事DB・マスターカテゴリDB・マスタータグDB）
   ↓ 30分おき or push直後 or 手動実行
GitHub Actions（Notionから記事データを取得してビルド）
   ↓ wrangler pages deploy（Cloudflare Pagesの無料ビルド回数を消費しない方式）
Cloudflare Pages（本番サイト）
```

- **記事の中身（Notion）を直しただけなら、GitHubは何も触らなくてOK。** 30分以内に自動で反映されます。今すぐ反映したいときはGitHubの「Actions」タブ →「Deploy to Cloudflare Pages」→「Run workflow」で即時デプロイできます。
- **コード（見た目や機能）を直したいときだけ**コミットが必要です。pushすると自動でデプロイが走ります。

---

## 2. Notion側の準備（3つのデータベース）

プロパティ名は**完全一致**させてください（ずれると取得できません）。

### 2-1. 記事DB（必須）

| プロパティ名 | 種類 | 用途 |
| --- | --- | --- |
| タイトル | タイトル | 記事タイトル |
| タグ | リレーション（マスタータグDB、複数可） | タグ絞込 |
| カテゴリ | リレーション（マスターカテゴリDB、複数可） | カテゴリ絞込・自動サムネイル背景（先頭1件を使用） |
| 公開日 | 日付 | 並び順・構造化データ |
| 更新日 | 日付 | 構造化データ（dateModified） |
| サムネイル画像 | ファイル&メディア | 任意。未設定なら自動生成 |
| サムネ用タイトル / サムネ用サブタイトル | テキスト | 任意。自動生成サムネイルの文言 |
| 記事の要点 | テキスト（複数行） | 任意。「この記事でわかること」ボックス（1行1項目） |
| 公開 | セレクト（または ステータス） | 「未公開」「公開」「公開後の編集中」の3値。文言はこの通り完全一致させること |
| Slug | テキスト | 任意。空欄ならページIDがURLになる |
| ディスクリプション | テキスト | 任意。SEO用の説明文 |

「公開後の編集中」にすると、Notionの最新下書きではなく前回公開時点の内容がそのまま使われます（編集中の中途半端な内容が公開されるのを防ぐ仕組み）。

### 2-2. マスターカテゴリDB（任意。無いとカテゴリ関連の表示が空になるだけ）

| プロパティ名 | 種類 | 用途 |
| --- | --- | --- |
| カテゴリ | タイトル | カテゴリ名 |
| 説明文 | テキスト | カテゴリページの説明文 |
| 代表記事 | テキスト | カテゴリページで代表記事として扱う記事のSlug |
| 背景画像ファイル名 | テキスト | `public/images/category-backgrounds/`にアップロードした画像のファイル名 |
| テーマカラー | セレクト | 背景画像が無い場合のフォールバック用グラデーション色 |
| 並び順 | 数値 | 表示順（小さい順） |

### 2-3. マスタータグDB（任意。無いとタグの解説文が空になるだけ）

| プロパティ名 | 種類 | 用途 |
| --- | --- | --- |
| タグ | タイトル | タグ名 |
| 説明文 | テキスト | タグページの説明文 |
| 代表記事 | テキスト | タグページで代表記事として扱う記事のSlug |

いずれのDBも、Notion Integration（Settings → Connections → Develop your own connections）を作成し、各データベースの「…」→「接続」で共有してください。

---

## 3. 環境変数・GitHub Secrets

### ビルド時（GitHubリポジトリ → Settings → Secrets and variables → Actions）

`.github/workflows/deploy.yml` は `MKTG_AX_` 接頭辞付きの名前で登録する前提になっています（他リポジトリとの名前衝突を避けるため）。不要なら接頭辞は削って構いません。

| Secret名 | 必須/任意 | 用途 |
| --- | --- | --- |
| MKTG_AX_NOTION_TOKEN | 必須 | Notion Integrationのシークレット |
| MKTG_AX_NOTION_DATABASE_ID | 必須 | 記事DBのデータベースID |
| MKTG_AX_NOTION_CATEGORIES_DATABASE_ID | 任意 | マスターカテゴリDBのID |
| MKTG_AX_NOTION_TAGS_DATABASE_ID | 任意 | マスタータグDBのID |
| MKTG_AX_PUBLIC_SITE_URL | 必須 | 本番URL（例: `https://your-site.pages.dev`）。**プレースホルダーのまま放置すると内部リンク判定が誤動作するので、独自ドメイン未確定でも実際に表示されているURLを入れておくこと** |
| MKTG_AX_PUBLIC_GA4_ID / MKTG_AX_PUBLIC_CLARITY_ID / MKTG_AX_PUBLIC_GSC_VERIFICATION / MKTG_AX_PUBLIC_GTM_ID | 任意 | アクセス解析 |
| MKTG_AX_CLOUDFLARE_API_TOKEN / MKTG_AX_CLOUDFLARE_ACCOUNT_ID | 必須 | Cloudflare Pagesへのデプロイ用 |

### Cloudflare Pages側

Workers & Pages → Create → Pages → Upload assets で空のプロジェクトを1回だけ手動作成してください（CI環境からの自動作成はできません）。`.github/workflows/deploy.yml` の `--project-name=mktg-ax` は作成したプロジェクト名に合わせて書き換えてください。

---

## 4. ローカルでの確認

```bash
npm install
npm run build:sample   # Notion未接続でもサンプル記事でデザイン確認
npm run dev             # 開発サーバー
```

Notionに接続してビルドする場合は `.env` に上記の環境変数（`MKTG_AX_`接頭辞は付けない）を設定し `npm run build` を実行してください。

---

## 5. 運用上の注意点（元のサイトから引き継いでいるもの）

- GitHubのWeb編集画面でファイル全体を貼り付ける場合、`<a ...>`タグは`<a`と最初の属性（`href="..."`など）を必ず同じ行に書いてください（改行して貼り付けるとタグが消える不具合が過去に発生しています）。
- GitHub Actionsは、リポジトリに60日間動きが無いと自動でスケジュール実行（cron）が止まります。「記事を直したのに反映されない」と思ったらActionsタブで停止していないか確認し、「Run workflow」で再開してください。
- カテゴリ名・タグ名に「/」が含まれる場合、URL上は自動的に全角スラッシュ「／」に変換されます（`src/lib/routeSlug.ts`）。表示は半角のままです。
