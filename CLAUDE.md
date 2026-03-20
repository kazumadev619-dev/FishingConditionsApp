# CLAUDE.md

基本的な会話は日本語で。

## プロジェクト概要

**Fishing Conditions App** - 釣り条件をスコア化するPWA
- **Phase 1 (現在):** Next.js 16 + React 19 フルスタックMVP
- **技術スタック:** TypeScript, Prisma, PostgreSQL, Tailwind CSS, Auth.js

## コマンド

```bash
npm run dev
npm run type-check && npm run lint && npm run build
npm run lint:fast   # Oxlint高速チェック
npm run format      # Biomeフォーマット
```

## 禁止事項

- `@ts-ignore`、空catch禁止（根本原因を修正）
- リンター設定ファイル（biome.json, .oxlintrc.json, eslint.config.*）の直接編集禁止

## Git運用

```bash
git commit -m "✨:feat: 機能追加の説明 #TaskNo"
```
Prefixes: `feat`, `fix`, `docs`, `test`, `refactor`, `chore`

## 詳細ドキュメント（必要時のみ参照）

| ドキュメント | 内容 |
|-------------|------|
| `docs/architecture.md` | システム設計、DB、キャッシュ戦略 |
| `docs/authentication.md` | Auth.js設定、認証フロー |
| `docs/api-integration.md` | 外部API連携詳細 |
| `docs/adr/` | 技術的決定記録（ADR） |
| `.spec-workflow/steering/` | プロダクト・技術・構造の詳細仕様 |
