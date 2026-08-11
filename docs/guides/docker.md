# Docker & Kubernetes 運用ガイド

Fishing Conditions App のコンテナ化とデプロイに関する包括的なガイドです。

---

## 📑 目次

1. [Docker 基本操作](#1-docker-基本操作)
2. [docker-compose による開発環境](#2-docker-compose-による開発環境)
3. [Kubernetes (kind) ローカル開発](#3-kubernetes-kind-ローカル開発)
4. [GKE 本番デプロイ](#4-gke-本番デプロイ)
5. [トラブルシューティング](#5-トラブルシューティング)
6. [よく使うコマンド集](#6-よく使うコマンド集)

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

# イメージのタグ付け
docker tag fishing-app:latest gcr.io/your-project/fishing-app:v1.0.0

# イメージのプッシュ（GCR）
docker push gcr.io/your-project/fishing-app:v1.0.0
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

- **app**: Next.js アプリケーション
- **postgres**: PostgreSQL 17（データベース）
- **redis**: Redis 7（キャッシュ）
- **serverless-redis**: Upstash 互換 HTTP ラッパー

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
docker-compose logs

# 特定のサービスのログ
docker-compose logs app
docker-compose logs postgres

# リアルタイムでフォロー
docker-compose logs -f app

# 最新100行のみ表示
docker-compose logs --tail=100 app

# タイムスタンプ付き
docker-compose logs -t app
```

### 2.4 サービス管理

```bash
# サービスの状態確認
docker-compose ps

# サービス内でコマンド実行
docker-compose exec app sh
docker-compose exec postgres psql -U postgres -d fishing_app

# 新しいコンテナでコマンド実行
docker-compose run app npm run prisma:migrate

# スケーリング（特定サービスの複数インスタンス起動）
docker-compose up -d --scale app=3
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
- `DATABASE_URL`、`UPSTASH_REDIS_REST_URL` などはDocker環境では `docker-compose.yml` で自動設定されます（`.env.local` の値は無視されます）

### 2.6 データベース操作

```bash
# PostgreSQL に接続
docker-compose exec postgres psql -U postgres -d fishing_app

# SQL ファイルを実行
docker-compose exec -T postgres psql -U postgres -d fishing_app < schema.sql

# データベースのバックアップ
docker-compose exec postgres pg_dump -U postgres fishing_app > backup.sql

# データベースのリストア
docker-compose exec -T postgres psql -U postgres -d fishing_app < backup.sql

# Prisma マイグレーション実行
docker-compose exec app npm run prisma:migrate

# Prisma Studio 起動
docker-compose exec app npm run prisma:studio
```

### 2.7 Redis 操作

```bash
# Redis CLI に接続
docker-compose exec redis redis-cli

# キーの一覧表示
docker-compose exec redis redis-cli KEYS '*'

# 特定のキーの値を取得
docker-compose exec redis redis-cli GET your_key

# すべてのデータを削除
docker-compose exec redis redis-cli FLUSHALL
```

---

## 3. Kubernetes (kind) ローカル開発

### 3.1 kind クラスタのセットアップ

```bash
# kind をインストール（macOS）
brew install kind

# kind クラスタ作成
kind create cluster --name fishing-app

# クラスタ一覧
kind get clusters

# クラスタ削除
kind delete cluster --name fishing-app

# kubectl コンテキスト確認
kubectl config current-context

# kind コンテキストに切り替え
kubectl config use-context kind-fishing-app
```

### 3.2 イメージのロード

```bash
# Docker イメージをビルド
docker build -t fishing-app:latest -f docker/Dockerfile .

# kind クラスタにイメージをロード
kind load docker-image fishing-app:latest --name fishing-app

# ロード済みイメージの確認
docker exec -it fishing-app-control-plane crictl images | grep fishing-app
```

### 3.3 Kustomize によるデプロイ

```bash
# ローカル環境用のマニフェストをプレビュー
kubectl kustomize k8s/overlays/local

# ローカル環境にデプロイ
kubectl apply -k k8s/overlays/local

# デプロイ状況の確認
kubectl get all -n fishing-app

# Pod のステータス確認
kubectl get pods -n fishing-app

# Pod のログ確認
kubectl logs -n fishing-app -l app=fishing-app -f

# サービスの確認
kubectl get svc -n fishing-app

# Ingress の確認
kubectl get ingress -n fishing-app
```

### 3.4 ポートフォワーディング

```bash
# アプリケーションにアクセス
kubectl port-forward -n fishing-app svc/fishing-app 3000:3000

# PostgreSQL にアクセス
kubectl port-forward -n fishing-app svc/postgres 5432:5432

# Redis にアクセス
kubectl port-forward -n fishing-app svc/redis 6379:6379
```

### 3.5 Secret と ConfigMap の管理

```bash
# Secret の作成（.env.local から）
kubectl create secret generic fishing-app-secret \
  --from-env-file=.env.local \
  -n fishing-app

# Secret の確認
kubectl get secrets -n fishing-app
kubectl describe secret fishing-app-secret -n fishing-app

# Secret の削除
kubectl delete secret fishing-app-secret -n fishing-app

# ConfigMap の確認
kubectl get configmap -n fishing-app
kubectl describe configmap fishing-app-config -n fishing-app
```

### 3.6 リソースの更新とロールバック

```bash
# デプロイメントの更新
kubectl apply -k k8s/overlays/local

# ロールアウト履歴の確認
kubectl rollout history deployment/fishing-app -n fishing-app

# ロールアウトの状態確認
kubectl rollout status deployment/fishing-app -n fishing-app

# 前のバージョンにロールバック
kubectl rollout undo deployment/fishing-app -n fishing-app

# 特定のリビジョンにロールバック
kubectl rollout undo deployment/fishing-app --to-revision=2 -n fishing-app

# デプロイメントの再起動
kubectl rollout restart deployment/fishing-app -n fishing-app
```

### 3.7 トラブルシューティング

```bash
# Pod の詳細情報
kubectl describe pod <pod-name> -n fishing-app

# Pod のイベント確認
kubectl get events -n fishing-app --sort-by='.lastTimestamp'

# Pod 内でコマンド実行
kubectl exec -it <pod-name> -n fishing-app -- sh

# リソースの削除
kubectl delete -k k8s/overlays/local

# namespace ごと削除
kubectl delete namespace fishing-app
```

---

## 4. GKE 本番デプロイ

### 4.1 GCP のセットアップ

```bash
# gcloud CLI をインストール（macOS）
brew install --cask google-cloud-sdk

# gcloud 認証
gcloud auth login

# プロジェクト設定
gcloud config set project your-gcp-project-id

# Docker 認証設定（GCR）
gcloud auth configure-docker

# GKE クラスタ作成
gcloud container clusters create fishing-app-cluster \
  --zone=asia-northeast1-a \
  --num-nodes=3 \
  --machine-type=e2-medium \
  --enable-autoscaling \
  --min-nodes=1 \
  --max-nodes=5

# kubectl コンテキスト取得
gcloud container clusters get-credentials fishing-app-cluster \
  --zone=asia-northeast1-a
```

### 4.2 イメージのプッシュ

```bash
# イメージをビルド
docker build -t fishing-app:latest -f docker/Dockerfile .

# GCR 用にタグ付け
docker tag fishing-app:latest gcr.io/your-project-id/fishing-app:latest
docker tag fishing-app:latest gcr.io/your-project-id/fishing-app:v1.0.0

# GCR にプッシュ
docker push gcr.io/your-project-id/fishing-app:latest
docker push gcr.io/your-project-id/fishing-app:v1.0.0

# プッシュ済みイメージの確認
gcloud container images list --repository=gcr.io/your-project-id
```

### 4.3 本番環境へのデプロイ

```bash
# Secret の作成（本番環境用）
kubectl create secret generic fishing-app-secret \
  --from-env-file=.env.production \
  -n fishing-app

# 本番環境用のマニフェストをプレビュー
kubectl kustomize k8s/overlays/production

# 本番環境にデプロイ
kubectl apply -k k8s/overlays/production

# デプロイ状況の監視
kubectl rollout status deployment/fishing-app -n fishing-app

# Pod の確認
kubectl get pods -n fishing-app -o wide

# サービスの外部 IP 確認
kubectl get svc -n fishing-app
```

### 4.4 Cloud SQL の接続（オプション）

```bash
# Cloud SQL Proxy のインストール
gcloud components install cloud_sql_proxy

# Cloud SQL Proxy 起動
cloud_sql_proxy -instances=your-project:region:instance-name=tcp:5432

# または、Kubernetes で Cloud SQL Proxy を使用
# k8s/base/deployment.yaml に cloud-sql-proxy サイドカーを追加
```

### 4.5 モニタリングとログ

```bash
# GKE ダッシュボードで確認
# https://console.cloud.google.com/kubernetes/

# Cloud Logging でログ確認
gcloud logging read "resource.type=k8s_container AND resource.labels.namespace_name=fishing-app" \
  --limit 50 \
  --format json

# kubectl でログ確認
kubectl logs -n fishing-app -l app=fishing-app --tail=100 -f
```

---

## 5. トラブルシューティング

### 5.1 Docker 関連

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

### 5.2 docker-compose 関連

#### サービスが起動しない

```bash
# サービスの状態確認
docker-compose ps

# ログで原因を確認
docker-compose logs app

# サービスを再作成
docker-compose up -d --force-recreate app
```

#### データベース接続エラー

```bash
# PostgreSQL の状態確認
docker-compose exec postgres pg_isready -U postgres

# データベースが存在するか確認
docker-compose exec postgres psql -U postgres -l

# 接続文字列を確認
docker-compose exec app env | grep DATABASE_URL
```

### 5.3 Kubernetes 関連

#### Pod が起動しない

```bash
# Pod の状態確認
kubectl describe pod <pod-name> -n fishing-app

# イベントを確認
kubectl get events -n fishing-app --sort-by='.lastTimestamp'

# Pod のログ確認
kubectl logs <pod-name> -n fishing-app

# 前回のコンテナのログ確認（クラッシュループの場合）
kubectl logs <pod-name> -n fishing-app --previous
```

#### ImagePullBackOff エラー

```bash
# イメージが存在するか確認（GCR）
gcloud container images list --repository=gcr.io/your-project-id

# kind の場合、イメージをロード
kind load docker-image fishing-app:latest --name fishing-app

# Secret が正しく設定されているか確認
kubectl get secrets -n fishing-app
```

#### CrashLoopBackOff エラー

```bash
# ログで原因を確認
kubectl logs <pod-name> -n fishing-app

# 環境変数が正しく設定されているか確認
kubectl exec <pod-name> -n fishing-app -- env

# リソース不足の可能性を確認
kubectl describe node
```

---

## 6. よく使うコマンド集

### 6.1 Docker

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

### 6.2 docker-compose

```bash
# 基本操作
cd docker
docker-compose up -d --build
docker-compose logs -f app
docker-compose ps
docker-compose restart app
docker-compose down
docker-compose down -v         # ボリュームも削除

# データベース操作
docker-compose exec postgres psql -U postgres -d fishing_app
docker-compose exec app npm run prisma:migrate
docker-compose exec app npm run prisma:studio
```

### 6.3 Kubernetes (kind)

```bash
# クラスタ管理
kind create cluster --name fishing-app
kind load docker-image fishing-app:latest --name fishing-app
kind delete cluster --name fishing-app

# デプロイ
kubectl apply -k k8s/overlays/local
kubectl get all -n fishing-app
kubectl logs -n fishing-app -l app=fishing-app -f
kubectl port-forward -n fishing-app svc/fishing-app 3000:3000

# クリーンアップ
kubectl delete -k k8s/overlays/local
```

### 6.4 GKE

```bash
# クラスタ接続
gcloud container clusters get-credentials fishing-app-cluster --zone=asia-northeast1-a

# イメージプッシュ
docker tag fishing-app:latest gcr.io/your-project-id/fishing-app:latest
docker push gcr.io/your-project-id/fishing-app:latest

# デプロイ
kubectl apply -k k8s/overlays/production
kubectl rollout status deployment/fishing-app -n fishing-app
kubectl get svc -n fishing-app

# ログ確認
kubectl logs -n fishing-app -l app=fishing-app --tail=100 -f
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

### ローカル Kubernetes セットアップ

- [ ] kind インストール済み
- [ ] kind クラスタ作成済み
- [ ] イメージビルド・ロード済み
- [ ] `kubectl apply -k k8s/overlays/local` 成功
- [ ] ポートフォワーディングでアクセス確認済み

### 本番環境デプロイ

- [ ] GCP プロジェクト作成済み
- [ ] GKE クラスタ作成済み
- [ ] `.env.production` 作成済み
- [ ] イメージを GCR にプッシュ済み
- [ ] Secret 作成済み
- [ ] `kubectl apply -k k8s/overlays/production` 成功
- [ ] 外部 IP でアクセス確認済み
- [ ] モニタリング設定済み

---

## 参考リンク

- [Docker Documentation](https://docs.docker.com/)
- [docker-compose Documentation](https://docs.docker.com/compose/)
- [Kubernetes Documentation](https://kubernetes.io/docs/)
- [kind Documentation](https://kind.sigs.k8s.io/)
- [Kustomize Documentation](https://kustomize.io/)
- [Google Kubernetes Engine](https://cloud.google.com/kubernetes-engine/docs)
- [Google Container Registry](https://cloud.google.com/container-registry/docs)

---

**最終更新日**: 2025-12-13
