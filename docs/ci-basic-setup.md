---
name: 基本CI環境構築
about: GitHub Actionsによるコード品質チェックCI実装
title: '[CI] メインCIパイプライン構築 (lint/format/type/build)'
labels: enhancement, infrastructure, ci
assignees: ''
---

## 📋 概要

GitHub Actionsを使用した基本的なCIパイプラインを構築し、PR時のコード品質を自動チェックする。

## 🎯 目的

- **コード品質の担保**: PR時に自動でlint/format/type/buildをチェック
- **統一されたコードスタイル**: Prettierによるフォーマットチェック
- **ビルドエラーの早期発見**: main統合前にビルド検証

## 🔧 実装内容

### メインCI (`ci.yml`)

**トリガー**:
- `push` to `main`, `develop`
- `pull_request` to `main`, `develop`

**実行ステップ**:

1. **環境セットアップ**
   - [ ] Node.js 20.x環境構築
   - [ ] 依存関係のキャッシュ設定（`npm cache`）
   - [ ] `npm ci` で依存関係インストール

2. **コード品質チェック**（並列実行）
   - [ ] `npm run lint` - ESLintチェック
   - [ ] `npm run format:check` - Prettierフォーマットチェック
   - [ ] `npm run type-check` - TypeScript型チェック

3. **ビルド検証**
   - [ ] `npm run build` - Next.jsプロダクションビルド

4. **結果サマリー**
   - [ ] 全チェック結果をPRコメントに表示（GitHub Actions Summary）

## 📝 フォーマットについての補足

### 🚨 重要: CIでは自動整形しない

このCIでは **チェックのみ** を行い、自動整形はしません。理由:

1. **意図しない変更の防止**: 自動整形すると差分が増え、レビューが困難
2. **ローカルでの対応を促す**: 開発者がフォーマット問題に気づく機会を提供
3. **Git履歴の汚染防止**: Bot commitが増えると履歴が追いにくくなる

### ✅ 推奨フロー

```bash
# ローカルで修正
npm run format        # 自動整形
npm run lint:fix      # lint自動修正

# または一括実行
npm run lint-and-format
```

### 🤖 自動整形の選択肢（将来的に検討可能）

もし自動整形が必要なら、以下の方法があります:

- **Husky + lint-staged**: コミット前に自動整形（既に設定済み！）
- **GitHub Actions Bot**: PRに自動修正commitを追加（検討中）
- **Prettier Check with Fix**: CIで修正してpush（非推奨）

**現在のプロジェクトでは、Huskyが既に設定されているため、コミット時に自動整形されます。**

## 📂 作成ファイル

```
.github/
└── workflows/
    └── ci.yml          # メインCIワークフロー
```

## ✅ 完了条件

- [ ] `.github/workflows/ci.yml` を作成
- [ ] PRを作成してCIが動作することを確認
  - [ ] lint成功
  - [ ] format:check成功
  - [ ] type-check成功
  - [ ] build成功
- [ ] mainブランチへのマージ前にCIが必須チェックとなることを確認
- [ ] CI動作を `docs/ci-cd.md` にドキュメント化

## 🔄 CI実行イメージ

```
PR作成時 → CI起動
  ├─ Setup (Node.js 20.x + npm ci)
  ├─ Lint Check ✓
  ├─ Format Check ✓
  ├─ Type Check ✓
  └─ Build ✓
       ↓
   全て成功 → マージ可能 ✅
   1つでも失敗 → マージブロック ❌
```

## 📊 期待される効果

- ✅ コードスタイルの統一
- ✅ 型安全性の保証
- ✅ ビルドエラーの早期発見
- ✅ レビュー時の品質チェック負荷軽減

## 🎯 優先度

**High** - コード品質担保の基盤となるため最優先で実装

## ⏱️ 見積もり

- 実装: 30分
- テスト・検証: 30分
- ドキュメント化: 15分

合計: **約1時間**

---

**Next Steps（このチケット完了後）**:
1. Prismaマイグレーション検証CI追加
2. テスト自動化（Vitest）
3. デプロイ自動化（Vercel/AWS）
