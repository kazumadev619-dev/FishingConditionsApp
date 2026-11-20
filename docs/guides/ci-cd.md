# CI/CD Documentation

## 📋 概要

このプロジェクトでは、GitHub Actionsを使用したCI/CDパイプラインを構築しています。コード品質の自動チェック、ビルド検証を実施し、高品質なコードベースを維持します。

> **照合の範囲**: 2026-11-20 に現状と照合したのは、CI のジョブ構成、トリガー、ブランチ保護、Phase 2 と Phase 4 の状態、ローカルでの実行の節。**「ESLint設定の最適化」「Huskyによる自動整形」「CI失敗時の対処法」「Phase 3」「Phase 5」の各節は未照合**（Phase 5 の依存更新だけは Renovate に合わせた）。

## 🔄 CI/CDフロー

```
PR作成/push → GitHub Actions CI起動
  ├─ Code Quality Check
  │   ├─ ESLint
  │   ├─ Biome Format Check
  │   ├─ TypeScript Type Check
  │   ├─ Vitest（ユニットテスト）
  │   └─ actionlint（ワークフローの検査）
  │
  ├─ Build Verification（Quality Check 通過後）
  │   ├─ Prisma Client生成
  │   └─ Next.js Production Build
  │
  ├─ Kubernetes Manifests（Quality Check とは独立に並列実行）
  │   ├─ kustomize build
  │   ├─ kubeconform -strict（k8s 1.34 スキーマ）
  │   ├─ Secret が描画されていないことの確認
  │   └─ secret.enc.yaml が暗号化されていることの確認
  │
  ├─ Docker Images（migrator と runner のイメージをビルド。Quality Check とは独立に並列実行）
  │
  └─ CI Summary（上の4ジョブすべての結果を集約。ブランチ保護の必須チェック）
```

## 🚀 実装済みCI

### 1. メインCI ([.github/workflows/ci.yml](../../.github/workflows/ci.yml))

**トリガー条件:**
- `main`, `develop` ブランチへの `push`
- すべての `pull_request`（PR を積み重ねても走らせるため、base ブランチを限定しない）

**実行環境:**
- OS: `ubuntu-26.04`（`ubuntu-latest` にはしない。Docker Images ジョブは `ubuntu-26.04-arm`）
- Node.js: `26.x`
- タイムアウト: Quality Check 10分 / Build 15分 / Manifests 5分 / Docker Images 30分

#### ジョブ1: Code Quality Check

コード品質を担保するためのチェックを、1つのジョブ内で順に実行します。

| チェック項目 | コマンド | 目的 |
|------------|---------|------|
| **ESLint** | `npm run lint` | コーディング規約違反、潜在的バグの検出 |
| **Biome** | `npm run format:check` | コードフォーマットの統一性確認 |
| **TypeScript** | `npm run type-check` | 型安全性の検証 |
| **Vitest** | `npm run test` | ユニットテストの実行 |
| **actionlint** | （ワークフローの検査） | `.github/workflows/` の構文・式の誤りの検出 |

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

#### ジョブ3: Kubernetes Manifests

`k8s/` のマニフェストをクラスタ無しで静的検証します。`k8s/overlays/local` を廃止して
PR 時点の検証手段が減ったため追加しました。npm 依存を使わないので Quality Check には
従属させず、並列で走らせています。

```yaml
steps:
  1. kustomize / kubeconform をバージョン固定で取得
     - master / latest 参照だと上流の更新だけでCIが赤にも緑にも変わる
  2. kustomize build k8s/ → kubeconform -strict -kubernetes-version 1.34.0
     - 本番の k3s v1.34.6+k3s1 に合わせる
  3. 描画結果に kind: Secret が無いことを確認
     - kustomize は SOPS を復号できない。混入すると暗号文のまま
       Secret を上書きして全Podが起動不能になる
  4. secret.enc.yaml が実際に暗号化されていることを確認
     - .gitignore が守るのは secret.yaml という名前だけなので、
       secret.enc.yaml に平文が入る事故はここでしか止められない
```

#### ジョブ4: Docker Images

`ubuntu-26.04-arm` で migrator と runner の2つのイメージをビルドし、Dockerfile の退行を PR の時点で検出します（push はしません）。Quality Check には従属させず、並列で走ります。

#### ジョブ5: CI Summary

Quality Check、Build、Manifests、Docker Images の結果を集約し、GitHub Actions Summaryに表示します。失敗したジョブがあれば、このジョブも失敗します。

```
✅ 成功時: "🟢 All checks passed!"
❌ 失敗時: 各ジョブの結果を個別表示
```

### 2. ブランチ保護

`develop` と `main` のどちらも、**`CI Summary` を必須のステータスチェック**にしています（`strict: false`）。CI が落ちた PR は通常マージできません（`enforce_admins` が無効なので、管理者は飛ばせます）。レビュー承認の必須化と、管理者への適用（`enforce_admins`）は有効にしていません。

### 3. Concurrency制御

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
# 全チェックを一括実行（CI の Quality Check と Build 相当）
npm run lint && npm run format:check && npm run type-check && npm run test && npm run build

# 最小限
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

1. `src/**/*.{js,jsx,ts,tsx}`: Oxlint によるチェック → Biome による自動修正（`biome check --write`）
2. `src/**/*.{json,md}`: Biome による自動整形（`biome format --write`）

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
- [x] Vitestセットアップ
- [x] ユニットテスト実行CI追加（Code Quality Check の中で実行）
- ~~コードカバレッジ計測~~（不採用。[testing-policy.md](./testing-policy.md) の8節）
- [ ] E2Eテスト（Playwright）
- [ ] 実 DB（PostgreSQL・Redis）を使うテスト（CI にサービスコンテナが無い。#354）

### Phase 3: Prismaマイグレーション検証
- [ ] `prisma-check.yml` ワークフロー作成
- [ ] PostgreSQLサービスコンテナ起動
- [ ] `prisma migrate deploy` 検証
- [ ] PRで `prisma/schema.prisma` 変更時に自動実行

### Phase 4: 自動デプロイ
- [x] k3s への自動デプロイ設定（Raspberry Pi 5 / arm64）
- [x] イメージのビルドとレジストリへの push
- [x] main統合時の本番デプロイ（[deploy.yml](../../.github/workflows/deploy.yml)）
- [ ] Slack通知連携

### Phase 5: PR自動化
- [ ] PRラベル自動付与（変更ファイルパスベース）
- [ ] コミットメッセージ検証（commitlint）
- [x] 依存関係自動更新（Dependabot ではなく Renovate。[renovate.md](./renovate.md)）

## 🔐 Secrets/Variables管理

CI（`ci.yml`）は Secrets を使いません。デプロイ（`deploy.yml`）が使う Secrets は、GitHub の Settings（Secrets and variables）で名前を確認してください。値はこの文書に書きません。

## 📚 参考リソース

- [GitHub Actions公式ドキュメント](https://docs.github.com/ja/actions)
- [Next.js CI/CD ベストプラクティス](https://nextjs.org/docs/pages/building-your-application/deploying/ci-build-caching)
- [ESLint Flat Config](https://eslint.org/docs/latest/use/configure/configuration-files)
- [Biome CI統合](https://biomejs.dev/recipes/continuous-integration/)

## 🎯 チェックリスト

CI構築完了の確認:

- [x] `.github/workflows/ci.yml` 作成
- [x] ESLint設定最適化（ファイルタイプ別）
- [x] ローカルで全チェック成功
- [x] CI/CDドキュメント作成
- [x] PRでCIが正常動作することを確認
- [x] mainマージ前にCIが必須チェックとなることを設定（`develop` と `main` に `CI Summary`）

---

**Last Updated**: 2026-11-20
**Maintained by**: @kazumadev619-dev
