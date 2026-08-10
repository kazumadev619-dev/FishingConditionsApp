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
- 関連が薄く見えるエラーの放置禁止（対処するか、理由を明示して記録する）
- テストを通すためだけのテスト改変禁止（実装の誤りを疑う）

## Git運用

```bash
git commit -m "✨ feat: 機能追加の説明"
git commit -m "🐛 fix: バグ修正の説明 #123"
```

- 絵文字と type の間は**半角スペース**。`✨:feat:` のようにコロンで繋ぐと commitlint が落ちる
- チケット番号は `#123` のように**数字のみ**。文字列を書くと commitlint が落ちる。無い場合は省略する
- type は `commitlint.config.cts` の `type-enum` にあるもの:
  `feat` `improve` `update` `fix` `hotfix` `refactor` `delete` `style` `docs` `move` `test` `chore` `package` `WIP`

## 詳細ドキュメント（必要時のみ参照）

まず `docs/README.md`（索引）を見ること。

| ドキュメント | 内容 |
|-------------|------|
| `docs/README.md` | 全ドキュメントの索引・置き場所の判断基準 |
| `docs/guides/development.md` | 開発環境セットアップ、コーディング規約 |
| `docs/guides/docker.md` | Docker / docker compose 操作 |
| `docs/guides/ci-cd.md` | CI パイプライン、CI 失敗時の対処 |
| `docs/reference/architecture.md` | システム設計、DB、キャッシュ戦略 |
| `docs/reference/authentication.md` | Auth.js設定、認証フロー |
| `docs/reference/api-integration.md` | 外部API連携詳細 |
| `docs/reference/scoring-algorithm.md` | 釣りやすさスコア算出式 |
| `docs/adr/` | 技術的決定記録（ADR） |
| `docs/roadmap.md` | Phase 進捗と今後の予定 |
| `k8s/README.md` | Kubernetes デプロイ手順 |
