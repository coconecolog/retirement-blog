/**
 * カテゴリ名・タグ名をURLの1セグメント（例: /blog/category/[category]/ の[category]部分）として
 * 安全に使うための変換ヘルパー。
 *
 * 背景（2026-09-08）: マスターカテゴリDBに「目標管理・KPI/KGI設計」のように「/」を含む名前が
 * 登録されると、Astroの静的ビルドがその「/」を追加のパス区切りとして解釈してしまい、
 * ビルド全体が失敗する（`TypeError: Missing parameter: category` 等）。
 *
 * 対策として単純に `encodeURIComponent()` した文字列（「/」は%2Fになる）をparamsに使う方法も
 * 試したが、Astroの内部レンダリング処理がファイルパスから元のリクエストパスを復元する際に
 * `decodeURI()` 相当の処理（%2Fなどの予約文字だけは意図的にデコードしない）を使っているため、
 * 日本語部分だけがデコードされ%2Fだけ残った中途半端な文字列になり、getStaticPaths()に登録した
 * パラメータ値と一致せず `NoMatchingStaticPathFound` でビルドが失敗した。
 *
 * そのため、「/」という1文字だけを、URL的に何の意味も持たない全角スラッシュ「／」に
 * 置き換える方式にしている。それ以外の文字（日本語含む）は、置き換え前から`encodeURIComponent()`
 * だけで問題なく往復できているため変更しない。
 *
 * 使い方: getStaticPaths()のparams生成と、リンク生成側（<a href>）の両方で、必ず
 * `encodeURIComponent(toRouteSlug(name))` の形で通すことで、常に同じURLになるようにする。
 * タグページのようにURLから元の名前を復元する必要がある場合は `fromRouteSlug()` を使う
 * （`decodeURIComponent()` の後にこちらを呼ぶ）。
 */
export function toRouteSlug(name: string): string {
  return name.replaceAll("/", "／");
}

export function fromRouteSlug(slug: string): string {
  return slug.replaceAll("／", "/");
}
