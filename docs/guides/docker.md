# Docker 運用ガイド

Fishing Conditions App のコンテナ化に関するガイドです。Kubernetes へのデプロイは [k8s/README.md](../../k8s/README.md) を参照してください。

---

## 📑 目次

1. [Docker 基本操作](#1-docker-基本操作)
2. [docker-compose による開発環境](#2-docker-compose-による開発環境)
3. [Kubernetes](#3-kubernetes)
4. [トラブルシューティング](#4-トラブルシューティング)
5. [よく使うコマンド集](#5-よく使うコマンド集)

---

## 1. Docker 基本操作

### 1.1 Dockerfile のビルド

```bash
# 基本的なビルド
docker build -t fishing-app:latest -f docker/Dockerfile .

# ビルド引数を指定（Google Maps API Key）
docker build \
  -t fishing-app:latest \
  -f docker/Dockerfile \
  --build-arg NEXT_PUBLIC_GOOGLE_MAPS_API_KEY=your_api_key_here \
  .

# タグを複数付与
docker build \
  -t fishing-app:latest \
  -t fishing-app:v1.0.0 \
  -f docker/Dockerfile \
  .

# キャッシュを使わずビルド（完全に再ビルド）
docker build --no-cache -t fishing-app:latest -f docker/Dockerfile .
```

### 1.2 イメージの管理

```bash
# イメージ一覧表示
docker images

# 特定のイメージを検索
docker images | grep fishing-app

# イメージの詳細情報
docker inspect fishing-app:latest

# イメージの削除
docker rmi fishing-app:latest

# 未使用イメージの一括削除
docker image prune -a
```

### 1.3 コンテナの操作

```bash
# コンテナ起動（フォアグラウンド）
docker run -p 3000:3000 fishing-app:latest

# コンテナ起動（バックグラウンド）
docker run -d -p 3000:3000 --name fishing-app fishing-app:latest

# 環境変数を指定して起動
docker run -d \
  -p 3000:3000 \
  -e DATABASE_URL=postgresql://user:pass@host:5432/db \
  -e AUTH_SECRET=your_secret \
  --name fishing-app \
  fishing-app:latest

# コンテナ一覧
docker ps                # 実行中のコンテナ
docker ps -a             # すべてのコンテナ

# コンテナの停止・削除
docker stop fishing-app
docker rm fishing-app

# コンテナのログ確認
docker logs fishing-app                    # すべてのログ
docker logs -f fishing-app                 # リアルタイムでフォロー
docker logs --tail 100 fishing-app         # 最新100行
docker logs --since 10m fishing-app        # 直近10分

# コンテナ内でシェル実行
docker exec -it fishing-app sh

# コンテナの再起動
docker restart fishing-app

# コンテナのリソース使用状況
docker stats fishing-app

# コンテナの詳細情報
docker inspect fishing-app
```

---

## 2. docker-compose による開発環境

### 2.1 構成

`docker-compose.yml` には以下のサービスが含まれます：

- **app**: Next.js アプリケーション（`fishing-app`）
- **postgres**: PostgreSQL 17 Alpine（`fishing-postgres`）
- **redis**: Redis 7 Alpine（`fishing-redis`）
- **redisinsight**: Redis の GUI 管理ツール（`fishing-redisinsight`）

### 2.2 基本コマンド

#### npm スクリプト（推奨）

```bash
# すべてのサービスを起動（バックグラウンド）
npm run docker:dev

# ビルドしてから起動
npm run docker:dev:build

# ログをリアルタイム表示
npm run docker:logs

# アプリケーションを再起動
npm run docker:restart

# サービスの停止と削除
npm run docker:down

# ボリュームも含めて削除（データベースデータも削除される）
npm run docker:down:volumes
```

#### docker compose コマンド（直接実行）

```bash
# すべてのサービスを起動（バックグラウンド）
cd docker
docker compose up -d

# すべてのサービスを起動（フォアグラウンド・ログ表示）
docker compose up

# 特定のサービスのみ起動
docker compose up -d postgres redis

# ビルドしてから起動
docker compose up -d --build

# キャッシュを使わずビルド
docker compose build --no-cache

# サービスの停止
docker compose stop

# サービスの停止と削除
docker compose down

# ボリュームも含めて削除（データベースデータも削除される）
docker compose down -v

# サービスの再起動
docker compose restart

# 特定のサービスのみ再起動
docker compose restart app
```

### 2.3 ログの確認

```bash
# すべてのサービスのログ
docker compose logs

# 特定のサービスのログ
docker compose logs app
docker compose logs postgres

# リアルタイムでフォロー
docker compose logs -f app

# 最新100行のみ表示
docker compose logs --tail=100 app

# タイムスタンプ付き
docker compose logs -t app
```

### 2.4 サービス管理

```bash
# サービスの状態確認
docker compose ps

# サービス内でコマンド実行
docker compose exec app sh
docker compose exec postgres psql -U postgres -d fishing_app

# 新しいコンテナでコマンド実行（マイグレーションは migrator サービスを使う）
docker compose --profile tools run --rm migrator

# スケーリング（特定サービスの複数インスタンス起動）
docker compose up -d --scale app=3
```

### 2.5 環境変数の設定

Docker 環境では `.env.local` ファイルを使用します（ローカル開発と同じファイル）。

#### セットアップ手順

1. **`.env.local` がない場合は作成**

```bash
# .env.example を .env.local にコピー
cp .env.example .env.local
```

2. **環境変数を設定**

`.env.local` を開いて、以下の必須項目を設定してください：

```bash
# [必須] Google Maps API Key
NEXT_PUBLIC_GOOGLE_MAPS_API_KEY=your_actual_api_key_here

# [必須] OpenWeatherMap API Key
OPENWEATHERMAP_API_KEY=your_actual_api_key_here

# [必須] Auth Secret（生成方法: openssl rand -base64 32）
AUTH_SECRET=your_generated_secret_here

# Auth URL
AUTH_URL=http://localhost:3000
```

3. **オプション設定**

Google OAuth を使う場合は、以下も設定してください：

```bash
AUTH_GOOGLE_ID=your_google_client_id
AUTH_GOOGLE_SECRET=your_google_client_secret
```

#### 注意事項

- `.env.local` は `.gitignore` に含まれており、Git管理されません
- ローカル開発（`npm run dev`）とDocker開発（`npm run docker:dev`）の両方で同じファイルを使用します
- `DATABASE_URL`、`REDIS_URL` などはDocker環境では `docker-compose.yml` で自動設定されます（`.env.local` の値は無視されます）

### 2.6 データベース操作

```bash
# PostgreSQL に接続
docker compose exec postgres psql -U postgres -d fishing_app

# SQL ファイルを実行
docker compose exec -T postgres psql -U postgres -d fishing_app < schema.sql

# データベースのバックアップ
docker compose exec postgres pg_dump -U postgres fishing_app > backup.sql

# データベースのリストア
docker compose exec -T postgres psql -U postgres -d fishing_app < backup.sql

# Prisma マイグレーション実行
# app（runner イメージ）には Prisma CLI が入っていないため migrator を使う
docker compose --profile tools run --rm migrator

# seed 実行
docker compose --profile tools run --rm migrator node --import tsx/esm prisma/seed.ts

# Prisma Studio は migrator イメージのCLIで起動する（ポート公開が必要）
docker compose --profile tools run --rm --service-ports migrator \
  node_modules/.bin/prisma studio
```

### 2.7 Redis 操作

```bash
# Redis CLI に接続
docker compose exec redis redis-cli

# キーの一覧表示
docker compose exec redis redis-cli KEYS '*'

# 特定のキーの値を取得
docker compose exec redis redis-cli GET your_key

# すべてのデータを削除
docker compose exec redis redis-cli FLUSHALL
```

---

## 3. Kubernetes

Kubernetes へのデプロイ手順（k3s 本番環境、SOPS による Secret 管理）は
マニフェストと同じ場所にある [k8s/README.md](../../k8s/README.md) にまとめている。
ローカル開発に Kubernetes は使わず、この docker compose 環境に一本化している。

本番環境のデプロイ先として Raspberry Pi 5 上の k3s（Cloudflare Tunnel + Traefik）を用意しているが、初回デプロイはまだ行っていない。

---

## 4. トラブルシューティング

### 4.1 Docker 関連

#### イメージビルドが失敗する

```bash
# キャッシュをクリアして再ビルド
docker builder prune
docker build --no-cache -t fishing-app:latest -f docker/Dockerfile .

# ビルドログを詳細表示
docker build --progress=plain -t fishing-app:latest -f docker/Dockerfile .
```

#### コンテナが起動しない

```bash
# ログで原因を確認
docker logs fishing-app

# コンテナの状態を確認
docker inspect fishing-app

# ヘルスチェックの状態確認
docker inspect fishing-app | jq '.[0].State.Health'
```

#### ポートが既に使用されている

```bash
# ポートを使用しているプロセスを確認
lsof -i :3000

# プロセスを終了
kill -9 <PID>

# または、異なるポートで起動
docker run -p 3001:3000 fishing-app:latest
```

### 4.2 docker-compose 関連

#### サービスが起動しない

```bash
# サービスの状態確認
docker compose ps

# ログで原因を確認
docker compose logs app

# サービスを再作成
docker compose up -d --force-recreate app
```

#### データベース接続エラー

```bash
# PostgreSQL の状態確認
docker compose exec postgres pg_isready -U postgres

# データベースが存在するか確認
docker compose exec postgres psql -U postgres -l

# 接続文字列を確認
docker compose exec app env | grep DATABASE_URL
```

---

## 5. よく使うコマンド集

### 5.1 Docker

```bash
# 基本操作
docker build -t fishing-app:latest -f docker/Dockerfile .
docker run -d -p 3000:3000 --name fishing-app fishing-app:latest
docker ps
docker logs -f fishing-app
docker exec -it fishing-app sh
docker stop fishing-app
docker rm fishing-app

# クリーンアップ
docker system prune -a         # 未使用リソースをすべて削除
docker volume prune            # 未使用ボリュームを削除
docker network prune           # 未使用ネットワークを削除
```

### 5.2 docker-compose

```bash
# 基本操作
cd docker
docker compose up -d --build
docker compose logs -f app
docker compose ps
docker compose restart app
docker compose down
docker compose down -v         # ボリュームも削除

# データベース操作
docker compose exec postgres psql -U postgres -d fishing_app
docker compose --profile tools run --rm migrator          # マイグレーション
```

---

## 📋 チェックリスト

### 開発環境セットアップ

- [ ] Docker Desktop インストール済み
- [ ] `.env.local` 作成済み（`cp .env.example .env.local`）
- [ ] `.env.local` に必要なAPIキーを設定済み
- [ ] `npm run docker:dev:build` 成功
- [ ] http://localhost:3000 でアプリにアクセス可能
- [ ] データベース接続確認済み

---

## 参考リンク

- [Docker Documentation](https://docs.docker.com/)
- [docker-compose Documentation](https://docs.docker.com/compose/)
- [Kubernetes Documentation](https://kubernetes.io/docs/)
- [Kustomize Documentation](https://kustomize.io/)

---

**最終更新日**: 2026-08-10
