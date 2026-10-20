#!/bin/sh
# デスクトップアプリ（Tauri）に入れる Web のファイルを dist/ に集める。
# リポジトリの直下には src-tauri/ や .git もあるので、必要なものだけを選んでコピーする
set -eu
cd "$(dirname "$0")/.."
rm -rf dist
mkdir -p dist
cp -R index.html manifest.webmanifest css js icons dist/
