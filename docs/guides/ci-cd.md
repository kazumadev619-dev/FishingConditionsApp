# CI/CD Documentation

## 📋 概要

このプロジェクトでは、GitHub Actionsを使用したCI/CDパイプラインを構築しています。コード品質の自動チェック、ビルド検証を実施し、高品質なコードベースを維持します。

## 🔄 CI/CDフロー

```
PR作成/push → GitHub Actions CI起動
  ├─ Code Quality Check (並列実行)
  │   ├─ ESLint
  │   ├─ Prettier Format Check
  │   └─ TypeScript Type Check
  │
  ├─ Build Verification
  │   ├─ Prisma Client生成
  │   └─ Next.js Production Build
  │
  └─ CI Summary
      └─ 結果サマリー表示
```

## 🚀 実装済みCI

### 1. メインCI ([.github/workflows/ci.yml](../../.github/workflows/ci.yml))

**トリガー条件:**
- `main`, `develop` ブランチへの `push`
- `main`, `develop` ブランチへの `pull_request`

**実行環境:**
- OS: `ubuntu-latest`
- Node.js: `24.x` (最新LTS)
- タイムアウト: Quality Check 10分 / Build 15分

#### ジョブ1: Code Quality Check

コード品質を担保するための3つのチェックを並列実行します。

| チェック項目 | コマンド | 目的 |
|------------|---------|------|
| **ESLint** | `npm run lint` | コーディング規約違反、潜在的バグの検出 |
| **Prettier** | `npm run format:check` | コードフォーマットの統一性確認 |
| **TypeScript** | `npm run type-check` | 型安全性の検証 |

**注意点:**
- フォーマットチェックは **チェックのみ** で自動修正はしません
- ローカルでの修正を推奨: `npm run lint-and-format`
- Huskyによりコミット時に自動整形されます

#### ジョブ2: Build Verification

本番環境向けビルドが成功することを確認します。

```yaml
steps:
  1. Prisma Client生成
     - DATABASE_URLはダミー値を使用（スキーマ検証のみ）
  2. Next.js Production Build
     - SKIP_ENV_VALIDATION=true で環境変数チェックをスキップ
```

**このジョブの意義:**
- デプロイ前にビルドエラーを検出
- Prisma Clientの生成が正しく動作することを確認
- 依存関係の問題を早期発見

#### ジョブ3: CI Summary

全ジョブの結果をGitHub Actions Summaryに表示します。

```
✅ 成功時: "🟢 All checks passed!"
❌ 失敗時: 各ジョブの結果を個別表示
```

### 2. Concurrency制御

同じPRで複数のpushがあった場合、古いワークフローを自動キャンセルします。

```yaml
concurrency:
  group: ${{ github.workflow }}-${{ github.event.pull_request.number || github.ref }}
  cancel-in-progress: true
```

**メリット:**
- CI実行時間の短縮
- GitHub Actions使用時間の節約
- 最新のコミットのみをチェック

## 🔧 ESLint設定の最適化

### 問題点と解決策

**以前の問題:**
TypeScriptルール(`@typescript-eslint/*`)が全ファイル(`.js`含む)に適用され、CIで意図しないエラーが発生していました。

**解決方法:**
[eslint.config.mts](../../eslint.config.mts) を修正し、**ファイルタイプごとにルールを分離**しました。

```typescript
// TypeScriptルールはTSファイルのみに適用
{
  files: ['**/*.{ts,mts,cts,tsx}'],
  ...tseslint.configs.recommended
}

// JavaScriptファイルには基本ルールのみ
{
  files: ['**/*.{js,mjs,cjs}'],
  rules: js.configs.recommended.rules
}
```

### 設定ファイルの扱い

| ファイル | 形式 | sourceType |
|---------|------|-----------|
| `commitlint.config.js` | CommonJS | `commonjs` |
| `postcss.config.js` | ESM | `module` |
| `next.config.mjs` | ESM | `module` |

## 📊 ローカルでの実行

### コミット前の推奨チェック

```bash
# 全チェックを一括実行（CIと同等）
npm run lint && npm run format:check && npm run type-check && npm run build

# またはCLAUDE.mdに記載の簡潔版
npm run type-check && npm run lint && npm run build
```

### 自動修正

```bash
# lint + format を自動修正
npm run lint-and-format

# 個別実行
npm run lint:fix
npm run format
```

### Huskyによる自動整形

このプロジェクトでは**Husky + lint-staged**が設定されており、`git commit`時に自動で以下が実行されます:

1. Prettier自動整形
2. ESLint自動修正

そのため、**手動でformatコマンドを実行する必要はほとんどありません**。

## 🚫 CI失敗時の対処法

### 1. ESLintエラー

```bash
# エラー詳細を確認
npm run lint

# 自動修正可能なものを修正
npm run lint:fix

# 手動修正が必要な場合はエラーメッセージに従う
```

### 2. フォーマットエラー

```bash
# フォーマット適用
npm run format

# または再コミット（Huskyが自動整形）
git add .
git commit --amend --no-edit
```

### 3. 型エラー

```bash
# 型エラー詳細を確認
npm run type-check

# tsconfig.jsonまたはコードを修正
```

### 4. ビルドエラー

```bash
# ローカルでビルドを実行
npm run build

# Prisma Clientを再生成（必要に応じて）
npm run prisma:generate
```

## 🔮 今後の拡張予定

### Phase 2: テスト自動化
- [ ] Vitestセットアップ
- [ ] ユニットテスト実行CI追加
- [ ] コードカバレッジ計測
- [ ] E2Eテスト（Playwright）

### Phase 3: Prismaマイグレーション検証
- [ ] `prisma-check.yml` ワークフロー作成
- [ ] PostgreSQLサービスコンテナ起動
- [ ] `prisma migrate deploy` 検証
- [ ] PRで `prisma/schema.prisma` 変更時に自動実行

### Phase 4: 自動デプロイ
- [ ] Vercel/AWS自動デプロイ設定
- [ ] ステージング環境へのプレビューデプロイ
- [ ] main統合時の本番デプロイ
- [ ] Slack通知連携

### Phase 5: PR自動化
- [ ] PRラベル自動付与（変更ファイルパスベース）
- [ ] コミットメッセージ検証（commitlint）
- [ ] 依存関係自動更新（Dependabot）

## 🔐 Secrets/Variables管理

### 現在必要なSecrets: なし

Phase 1では外部APIキーや認証情報は不要です。

### 将来的に必要になるSecrets

| Secret名 | 用途 | 必要時期 |
|---------|------|---------|
| `DATABASE_URL` | 本番DB接続 | CD実装時 |
| `VERCEL_TOKEN` | Vercelデプロイ | CD実装時 |
| `SLACK_WEBHOOK_URL` | 通知連携 | Phase 4 |

## 📚 参考リソース

- [GitHub Actions公式ドキュメント](https://docs.github.com/ja/actions)
- [Next.js CI/CD ベストプラクティス](https://nextjs.org/docs/pages/building-your-application/deploying/ci-build-caching)
- [ESLint Flat Config](https://eslint.org/docs/latest/use/configure/configuration-files)
- [Prettier CI統合](https://prettier.io/docs/en/install#git-hooks)

## 🎯 チェックリスト

CI構築完了の確認:

- [x] `.github/workflows/ci.yml` 作成
- [x] ESLint設定最適化（ファイルタイプ別）
- [x] ローカルで全チェック成功
- [x] CI/CDドキュメント作成
- [ ] PRでCIが正常動作することを確認
- [ ] mainマージ前にCIが必須チェックとなることを設定

---

**Last Updated**: 2026-01-06
**Maintained by**: @kazumadev619-dev
