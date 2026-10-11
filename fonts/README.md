# fonts/

ここに置いたファイルを `css/style.css` の `@font-face` が読みに行く。無ければフォールバックされる。

| ファイル名 | 用途 |
|---|---|
| `Degular-Bold.woff2` / `.woff` / `.otf`（または `DegularDemo-Bold.otf` / `DegularDemo-Black.otf`） | 英語（`--font-en`） |
| `Degular-Regular.woff2` / `.otf`（または `DegularDemo-Regular.otf`） | 英語 Regular |
| `LINESeedJP-Bold.woff2` / `LINESeedJP_OTF_Bd.otf` | 日本語。普段は Google Fonts から読むので、オフライン用 |

Degular Demo は Web 埋め込みのライセンスが無いので、ローカルで試すだけにしてリポジトリには入れないこと（`.gitignore` 済み）。

## GitHub Pages で Degular を使う

フォントファイルはリポジトリに入れていないので、Pages には配信されない。代わりに **Mac に Degular をインストール** しておけば、CSS の `local()` がそれを拾う（自分の Mac で見たときだけ Degular になる）。

1. `DegularDemo-Black.otf` をダブルクリック → Font Book で「インストール」
2. ブラウザを再起動して Pages を開き直す
