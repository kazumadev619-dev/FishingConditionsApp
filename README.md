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
- 本番自動デプロイ（Raspberry Pi 5 + k3s）・API パフォーマンスベースライン計測・テスト基盤（Vitest）・型チェックの TypeScript 7 化を導入済み

**Phase 2: バックエンド分離 (Go移行)** — 🚧 進行中

- フロントエンド: Next.js
- バックエンド: [`Fishing-api`](https://github.com/kazumadev619-dev/Fishing-api)（Go 1.26 + Gin、クリーンアーキテクチャ）— 主要 API 実装・テストカバレッジ 80% 達成済み
- フロントの取得経路を Go API へ切替え、Next API Routes と性能比較

**Phase 3: モバイルアプリ展開** — 📋 計画

- React Native または Flutter
- Go APIを共通バックエンドとして活用

### 直近の対応方針

本番デプロイ・ベースライン計測・テスト基盤導入（Vitest）・TypeScript 7 対応（`type-check`）は完了済みです。現在は E2E テスト（Playwright）の導入を進めつつ、バックエンド分離（Go API への切替）と比較計測へ進みます。

---

## ⚙️ 技術スタック

### 環境要件

| 項目       | バージョン                                              |
| ---------- | ------------------------------------------------------- |
| Node.js    | 26.13.1（`docker/Dockerfile`、CI は `26.x`）             |
| TypeScript | 6.0.3（`type-check` は `typescript-7` `7.0.2` を使用） |

### Phase 1: MVP技術スタック

| レイヤー       | 技術                         | バージョン              | 理由                                                               |
| -------------- | ---------------------------- | ----------------------- | ------------------------------------------------------------------ |
| フロントエンド | Next.js + React + TypeScript | 16.4.6 + 19.3.1 + 6.0.3 | SSR/SSG対応、型安全性（`type-check` は `typescript-7` `7.0.2`）    |
| バックエンド   | Next.js API Routes           | 16.4.6                  | 迅速な開発、フルスタック統合（Phase 2 で Go へ分離）               |
| スタイリング   | Tailwind CSS + shadcn/ui     | 4.3.5 + -               | モバイルファースト、コンポーネント再利用                           |
| 認証           | Auth.js                      | 5.0.0-beta.32           | 多様な認証プロバイダー対応                                         |
| ORM            | Prisma                       | 7.10.1                  | 型安全な DB アクセス                                               |
| データベース   | PostgreSQL (Neon)            | 17                      | マネージドクラウド、Go バックエンドと共用                          |
| キャッシュ     | Redis (k3s Pod)              | 7.x                     | 外部API結果のキャッシュ、レート制限                                |
| テスト         | Vitest                       | 5.1.1                   | 単体・Route Handler・コンポーネントテスト（`npm run test`）        |
| デプロイ       | Raspberry Pi 5 + k3s         | -                       | Cloudflare Tunnel + Traefik、arm64 本番                            |
| CI/CD          | GitHub Actions → GHCR / k3s  | -                       | PR で品質・ビルド・k8s・Docker を検証、`main` push で自動デプロイ |

> バージョンは `package-lock.json` の解決済みの版、`docker/Dockerfile`（Node.js など）、`docker/docker-compose.yml`（PostgreSQL・Redis）に基づく（`package.json` の範囲指定は `^`）。
>
> **PWA:** `next-pwa` が Turbopack 未対応のため現在無効（パッケージは削除済み）。対応後に再有効化予定（`next.config.mjs` 参照）。

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
# docker compose でローカル環境起動（.env.local を読み込み）
npm run docker:dev

# ログ確認
npm run docker:logs

# 停止
npm run docker:down
```

---

## 💻 開発

### よく使うコマンド

| コマンド                  | 説明                                              |
| ------------------------- | ------------------------------------------------- |
| `npm run dev`             | 開発サーバー起動 (http://localhost:3000)          |
| `npm run build`           | プロダクションビルド                              |
| `npm run start`           | プロダクションサーバー起動（要ビルド）            |
| `npm run lint`            | ESLintでコードチェック                            |
| `npm run lint:fix`        | ESLintで自動修正                                  |
| `npm run lint:fast`       | Oxlintでの高速チェック（`src/`）                  |
| `npm run format`          | Biomeでコード整形                                 |
| `npm run format:check`    | Biomeでフォーマットチェック                       |
| `npm run lint-and-format` | ESLint自動修正 + Biomeコード整形                  |
| `npm run type-check`      | TypeScript型チェック（`typescript-7` を使用）     |
| `npm run test`            | Vitestでテスト実行（CI と同じワンショット実行）   |
| `npm run test:watch`      | Vitestをウォッチモードで実行                      |
| `npm run check-code`      | Lint + フォーマット確認 + 型チェック + テスト一括 |

### データベース操作

| コマンド                  | 説明                                  |
| ------------------------- | ------------------------------------- |
| `npm run prisma:generate` | Prisma Clientの生成（スキーマ変更後） |
| `npm run prisma:migrate`  | マイグレーション作成・実行            |
| `npm run prisma:seed`     | シードデータ投入                      |
| `npm run prisma:studio`   | Prisma Studio起動（DBビジュアル）     |
| `npm run prisma:reset`    | DB を削除してマイグレーションを最初から適用し直す（データはすべて消える。`.env.local` の接続先に注意） |

### E2E開発環境

DB・Redis・外部 API スタブを含むローカル E2E 環境の起動・検証（詳細は [docs/guides/e2e-env.md](docs/guides/e2e-env.md)）：

```bash
npm run e2e:up      # 起動（migrate / seed / E2E ユーザー作成 / ビルド / 起動）
npm run e2e:smoke   # スモークチェック実行
npm run e2e:down    # 停止・クリーンアップ
```

### コード品質チェック

```bash
# Lint + フォーマットチェック + 型チェック + テストを一括実行
npm run check-code
```

---

## 🔧 開発ワークフロー

### ブランチ戦略

- `main`: 本番環境（プロダクション）
- `develop`: 開発統合ブランチ
- `<type>/<short-desc>`: 作業ブランチ。`develop` から切る（例: `docs/repo-tidy`、`refactor/#13`、`feat/#123_fishing-spot-pagination`）

`<type>` はコミットの type と同じ語を使う。

### コミットメッセージ規約

[gitmoji](https://gitmoji.dev) を使用する。`commitlint.config.cts`（`extends: ['gitmoji']`）が commit-msg フックで検証する。

```
<絵文字> <type>: <説明> [#<数字>]
```

**必ず守ること:**

- 絵文字と type の間は**半角スペース**。`✨:feat:` のようにコロンで繋ぐと `start-with-gitmoji` で落ちる
- チケット番号は `#123` のように**数字のみ**。文字列（`#TaskNo` 等）を書くと `subject-empty` で落ちる。無い場合は省略する
- ヘッダー（1 行目）は 100 文字以内

**type:**

`feat` `improve` `update` `fix` `hotfix` `refactor` `delete` `style` `docs` `move` `test` `chore` `package` `WIP`

**例:**

```bash
✨ feat: Add tide score calculation #21
🐛 fix: Fix authentication redirect issue #34
📝 docs: Update setup instructions in README
```

コミット前に、メッセージをファイルに書き、`npx --no-install commitlint < msg.txt` で検証する（`echo "<1行>"` ではヘッダーしか検証されない。詳しくは `github-push-pr` スキル）。

### 開発フロー

手順は [docs/guides/development.md](docs/guides/development.md) の「開発フロー」を見る。

---

## 🔐 主要機能

### MVP機能一覧 (Phase 1)

| カテゴリ       | 機能                               | 詳細                                                  |
| -------------- | ---------------------------------- | ----------------------------------------------------- |
| 認証           | ユーザー登録・ログイン・ログアウト | Auth.js によるメール認証                              |
| 環境データ     | 潮汐・風・天気・海水温データ取得   | 外部API統合 + キャッシュ機能                          |
| 釣りやすさ分析 | スコア算出（独自ロジック）         | 潮汐・天気・時間帯を重み付けして0-100でスコア化       |
| データ表示     | 日付別・時間帯別の釣りやすさ表示   | レスポンシブチャート・グラフ表示                      |
| 場所検索       | 地名検索・現在位置取得・履歴保存   | Google Maps API連携                                   |
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
- **[Google Maps API](https://developers.google.com/maps)**: 地名検索・ジオコーディング・現在位置 ([プロジェクト内ドキュメント](./docs/reference/google-maps-api.md))

### API統合戦略

- **キャッシュ戦略**: Redis による結果キャッシュ（天気30分、潮汐6時間、場所検索1時間、スコア30分）
- **エラーハンドリング**: タイムアウト・リトライ・フォールバック機能
- **レート制限対応**: API使用量監視・アラート設定

---

## 🧾 開発・運用ルール

### 開発規約

- **コーディング規約**: ESLint + Biome + Oxlint + TypeScript strict mode
- **ブランチ戦略**: `main` / `develop` / `<type>/<short-desc>`
- **コミット**: `<絵文字> <type>: <説明> [#<数字>]`（絵文字の後は半角スペース、チケットは数字のみ）
- **Issue管理**: GitHub Projects（スプリント単位）

### 品質保証

- **テスト戦略**: Vitest を導入済み（単体・Route Handler・コンポーネントテスト、CI で毎回実行）。E2E 用の開発環境（Postgres・Redis・上流スタブ）も整備済みで、Playwright による E2E テスト本体は導入予定（#439 進行中）。方針の詳細は [docs/guides/testing-policy.md](docs/guides/testing-policy.md)
- **CI/CD**: GitHub Actions で構築済み（詳細は [docs/guides/ci-cd.md](docs/guides/ci-cd.md)）
  - CI（`.github/workflows/ci.yml`）: PR および `main` / `develop` push で ESLint / Biome / TypeScript 型チェック / Vitest / actionlint / Next.js ビルド / k8s マニフェスト検証 / Docker イメージビルド / E2E 環境スモークを実行
  - CD（`.github/workflows/deploy.yml`）: `main` push（および手動実行）で arm64 イメージをビルド・GHCR へ push し、Raspberry Pi 5 上の k3s へ自動デプロイ
- **監視**: 導入予定（Grafana Cloud + Alloy の構成を選定済み。[ADR-005](docs/adr/005-monitoring-platform.md)）

---

### 外部リンク

- [Next.js Documentation](https://nextjs.org/docs)
- [OpenWeatherMap API](https://openweathermap.org/api)
- **[tide736.net API](https://tide736.net/api/)**
- [Google Maps API](https://developers.google.com/maps)
