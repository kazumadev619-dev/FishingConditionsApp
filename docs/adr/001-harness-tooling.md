# ADR-001: Harnessツールチェーン選定

**日付:** 2026-03-20
**ステータス:** 採用済み

## 決定

ローカル開発のlintツールを以下の役割分担で構成する:
- **Oxlint:** PostToolUse Hookでの高速lint（ms単位フィードバック）
- **Biome:** フォーマット + lint autofix（Prettier代替）
- **ESLint:** CIのみで使用する深い静的解析

## 理由

Claude Code等のAIエージェントがファイル編集後に即時フィードバックを受け取り自己修正ループを回すには、PostToolUse Hookのlintツールがmsオーダーで完了する必要がある。ESLintは高精度だが低速であり、Hookには不適切。

## 代替案

- **ESLint一本化:** 低速のためHookには不適切
- **Biomeのみ:** ESLintのルール網羅性（React Hooks等）が失われる

## 結果

`npm run lint:fast`（Oxlint）+ `npm run format`（Biome）がローカル品質ゲートになり、`npm run lint`（ESLint）はCI専用となる。
