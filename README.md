# 🎣 Fishing Conditions App

釣り初心者から経験者までが、**「いつ・どこで・どんな条件なら釣れるか」**をリアルタイムで確認できるWebアプリケーション。

潮汐・風・天気・海水温などの環境データを統合し、独自の**釣りやすさスコア**を算出・可視化することで、ユーザーの釣果向上を支援します。将来的には PWA 対応により、スマートフォンでネイティブアプリライクな体験を提供する予定です（現在は Turbopack 非対応のため一時無効）。

> **関連リポジトリ:** Go バックエンドは [`Fishing-api`](https://github.com/kazumadev619-dev/Fishing-api) で開発中（Phase 2）。

---

## 🎯 プロダクトビジョン

### 開発目的

- 釣行前・釣行中に「今の釣り条件」を簡単に確認できる環境を提供
- 気象・潮汐データをもとに「釣り日和」を定量的に評価
- 将来的にユーザーごとの釣果記録・共有機能を追加

### ターゲットユーザー

| 区分   | 想定ユーザー                             | 利用目的                         |
| ------ | ---------------------------------------- | -------------------------------- |
| 初心者 | 釣り経験が浅く、潮や風の見方が分からない | 釣りに行く日や時間帯を決めたい   |
| 経験者 | 定期的に釣りに行くユーザー               | データを参考に釣果を安定させたい |

---

## 🏗️ 開発戦略

### 段階的開発アプローチ

**Phase 1: MVP (Next.js フルスタック)** — ✅ 実装ほぼ完了

- 迅速な開発・検証を重視
- Next.js API Routes でバックエンド機能を実装（認証・天気・潮汐・スコア・地点検索・お気に入り）
- リファクタリング候補 #1〜#10 消化済み（重複排除・大型ファイル分解）
- 次は本番デプロイとパフォーマンスベースライン測定へ

**Phase 2: バックエンド分離 (Go移行)** — 🚧 進行中

- フロントエンド: Next.js
- バックエンド: [`Fishing-api`](https://github.com/kazumadev619-dev/Fishing-api)（Go 1.26 + Gin、クリーンアーキテクチャ）— 主要 API 実装・テストカバレッジ 80% 達成済み
- フロントの取得経路を Go API へ切替え、Next API Routes と性能比較

**Phase 3: モバイルアプリ展開** — 📋 計画

- React Native または Flutter
- Go APIを共通バックエンドとして活用

### 直近の対応方針

現状デプロイ → ベースライン計測 → テスト基盤導入（Vitest）→ TypeScript 7 更新 → バックエンド分離 → 比較計測、という段階計画で進めます。詳細は [`docs/superpowers/specs/2026-08-10-deploy-perf-improvement-program.md`](./docs/superpowers/specs/2026-08-10-deploy-perf-improvement-program.md) を参照。

---

## ⚙️ 技術スタック

### 環境要件

| 項目       | バージョン |
| ---------- | ---------- |
| Node.js    | v24.11.0   |
| TypeScript | v5.9.3     |

### Phase 1: MVP技術スタック

| レイヤー       | 技術                         | バージョン               | 理由                                     |
| -------------- | ---------------------------- | ------------------------ | ---------------------------------------- |
| フロントエンド | Next.js + React + TypeScript | 16.0.10 + 19.2.3 + 5.9.3 | SSR/SSG対応、型安全性                     |
| バックエンド   | Next.js API Routes           | 16.0.10                  | 迅速な開発、フルスタック統合（Phase 2 で Go へ分離） |
| スタイリング   | Tailwind CSS + shadcn/ui     | 4.1.17 + latest          | モバイルファースト、コンポーネント再利用 |
| 状態管理       | Zustand + React Query        | 5.0.8 + 5.90.7           | 軽量、外部API連携に最適                  |
| 認証           | Auth.js                      | 5.0.0-beta.30            | 多様な認証プロバイダー対応               |
| ORM            | Prisma                       | 7.2.0                    | 型安全な DB アクセス                     |
| データベース   | PostgreSQL (Neon)            | 17                       | マネージドクラウド、Go バックエンドと共用 |
| キャッシュ     | Redis (k3s Pod)              | 7.x                      | 外部API結果のキャッシュ                  |
| デプロイ       | Raspberry Pi 5 + k3s         | -                        | Cloudflare Tunnel + Traefik、arm64 本番  |
| ローカルk8s    | Minikube                     | -                        | ローカルKubernetes開発環境               |

> **PWA:** `next-pwa` が Turbopack 未対応のため現在無効。対応後に再有効化予定（`next.config.mjs` 参照）。

---

## 🚀 セットアップ

### インストール手順

1. **リポジトリのクローン**

```bash
git clone https://github.com/kazumadev619-dev/FishingConditionsApp.git

cd FishingConditionsApp
```

2. **依存関係のインストール**

```bash
npm install
```

3. **環境変数の設定**

`.env.example` を参考に `.env.local` ファイルを作成： 詳細は連絡にて共有

```bash
cp .env.example .env.local
```

4. **開発サーバーの起動**

```bash
npm run dev
```

ブラウザで [http://localhost:3000](http://localhost:3000) を開いて確認してください。

### Docker開発環境

```bash
# docker-composeでローカル環境起動
cd docker && docker-compose up -d

# ログ確認
docker-compose logs -f app
```

---

## 💻 開発

### よく使うコマンド

| コマンド             | 説明                                     |
| -------------------- | ---------------------------------------- |
| `npm run dev`        | 開発サーバー起動 (http://localhost:3000) |
| `npm run build`      | プロダクションビルド                     |
| `npm run start`      | プロダクションサーバー起動（要ビルド）   |
| `npm run lint`       | ESLintでコードチェック                   |
| `npm run lint:fix`   | ESLintで自動修正                         |
| `npm run lint:fast`  | Oxlintでの高速チェック                   |
| `npm run format`     | Biomeでコード整形                        |
| `npm run type-check` | TypeScript型チェック                     |

### データベース操作

| コマンド                  | 説明                                  |
| ------------------------- | ------------------------------------- |
| `npm run prisma:generate` | Prisma Clientの生成（スキーマ変更後） |
| `npm run prisma:migrate`  | マイグレーション作成・実行            |
| `npm run prisma:studio`   | Prisma Studio起動（DBビジュアル）     |

### コード品質チェック

```bash
# 型チェック + リント + フォーマットチェックを一括実行
npm run type-check && npm run lint && npm run format:check
```

---

## 🔧 開発ワークフロー

### ブランチ戦略

- `main`: 本番環境（プロダクション）
- `develop`: 開発統合ブランチ
- `Task/*`: 機能開発・修正用ブランチ

### コミットメッセージ規約

[gitmoji](https://gitmoji.dev) を使用したコミットメッセージ:

```
[emoji]:[prefix]: [message] #[TaskNo]
```

**プレフィックス:**

- `feat`: 新機能
- `fix`: バグ修正
- `docs`: ドキュメント
- `test`: テスト追加・修正
- `refactor`: リファクタリング
- `chore`: ビルド・設定変更

**例:**

```bash
✨:feat: Add tide score calculation #21
🐛:fix: Fix authentication redirect issue #34
📝:docs: Update setup instructions in README #45
```

### 開発フロー

1. `develop` ブランチから新しい `Task/*` ブランチを作成
2. 機能実装・テスト
3. `npm run type-check` と `npm run lint` でコード品質確認
4. コミット（上記規約に従う）
5. `develop` ブランチへプルリクエスト
6. レビュー後マージ

---

## 🔐 主要機能

### MVP機能一覧 (Phase 1)

| カテゴリ       | 機能                               | 詳細                                            |
| -------------- | ---------------------------------- | ----------------------------------------------- |
| 認証           | ユーザー登録・ログイン・ログアウト | Auth.js によるメール認証                        |
| 環境データ     | 潮汐・風・天気・海水温データ取得   | 外部API統合 + キャッシュ機能                    |
| 釣りやすさ分析 | スコア算出（独自ロジック）         | 潮汐・天気・時間帯を重み付けして0-100でスコア化 |
| データ表示     | 日付別・時間帯別の釣りやすさ表示   | レスポンシブチャート・グラフ表示                |
| 場所検索       | 地名検索・現在位置取得・履歴保存   | Google Maps API連携                             |
| PWA機能        | オフライン対応・アプリインストール | Service Worker + キャッシュ戦略（現在無効、対応待ち） |

### 釣りやすさスコア算出ロジック

```
総合スコア (0-100) = 潮汐スコア (40) + 天気スコア (35) + 時間帯スコア (25)

- 潮汐スコア: 満潮・干潮前後2時間が高スコア、大潮・中潮期間はボーナス
- 天気スコア: 風速・天候・気圧の安定性で評価
- 時間帯スコア: 早朝・夕方が高スコア、日中は中程度
```

---

## 📚 外部API統合

### 使用API

- **[OpenWeatherMap API](https://openweathermap.org/api)**: 気象データ（風・天気・気温・湿度）
- **[tide736.net API](https://tide736.net/api/)**: 潮汐データ（満潮・干潮時刻・潮位）
- **[Google Maps API](https://developers.google.com/maps)**: 地名検索・ジオコーディング・現在位置 ([プロジェクト内ドキュメント](./docs/google-maps-api.md))

### API統合戦略

- **キャッシュ戦略**: Redis による結果キャッシュ（天気30分、潮汐6時間）
- **エラーハンドリング**: タイムアウト・リトライ・フォールバック機能
- **レート制限対応**: API使用量監視・アラート設定

---

## 🧾 開発・運用ルール

### 開発規約

- **コーディング規約**: ESLint + Biome + Oxlint + TypeScript strict mode
- **ブランチ戦略**: `main` / `develop` / `Task/*`
- **コミット**: `[gitmoji]:[prefix]: [message] #[TaskNoXXX]`
- **Issue管理**: GitHub Projects（スプリント単位）

### 品質保証

- **テスト戦略**: 現在テストランナー未整備。Vitest（単体）を導入予定、E2E は Playwright を検討
- **CI/CD**: GitHub Actions（lint / format / type-check / build）。k3s への自動デプロイは導入予定
- **監視**: 導入予定

---

### 外部リンク

- [Next.js Documentation](https://nextjs.org/docs)
- [OpenWeatherMap API](https://openweathermap.org/api)
- **[tide736.net API](https://tide736.net/api/)**
- [Google Maps API](https://developers.google.com/maps)
