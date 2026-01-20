# Kubernetes デプロイガイド

Fishing Conditions App の Kubernetes デプロイ手順。

## 構成

```
k8s/
├── base/                    # 共通リソース定義
│   ├── namespace.yaml
│   ├── configmap.yaml
│   ├── secret.yaml          # テンプレート（実際の値はoverlaysで上書き）
│   ├── postgres.yaml
│   ├── redis.yaml
│   ├── deployment.yaml
│   ├── service.yaml
│   ├── ingress.yaml
│   └── db-init-job.yaml     # DB初期化Job
├── overlays/
│   ├── local/               # ローカル開発用（Minikube）
│   └── production/          # 本番用（EKS）
└── .sops.yaml               # Secret暗号化設定
```

## ローカル環境（Minikube）セットアップ

### クイックスタート（セットアップ済みの場合）

```bash
# 1. Minikube起動 & Docker環境設定
minikube start --memory=4096 --cpus=2
eval $(minikube docker-env)

# 2. イメージビルド（NEXT_PUBLIC_*はビルド時に埋め込み必須）
# APIキーは .env.local または k8s/overlays/local/secret.yaml から取得
docker build -f docker/Dockerfile \
  --build-arg NEXT_PUBLIC_GOOGLE_MAPS_API_KEY="your-api-key" \
  --build-arg NEXT_PUBLIC_GOOGLE_MAPS_MAP_ID="your-map-id" \
  -t fishing-app:latest .

# 3. SOPS設定 & デプロイ
export SOPS_AGE_KEY_FILE="$HOME/.config/sops/age/keys.txt"
kustomize build k8s/overlays/local --enable-alpha-plugins --enable-exec | kubectl apply -f -

# 4. Pod起動待機
kubectl get pods -n fishing-app -w

# 5. DB初期化（Postgres起動後）
kubectl apply -f k8s/base/db-init-job.yaml
kubectl logs -f job/db-init -n fishing-app

# 6. アクセス
# 方法: minikube tunnel
# 1. /etc/hosts にホスト名を追加（初回のみ）
#    minikube tunnel を使う場合は 127.0.0.1 を使用
echo "127.0.0.1 fishing-app.local" | sudo tee -a /etc/hosts

# 2. 別ターミナルで minikube tunnel を起動
sudo minikube tunnel

# 3. ブラウザでアクセス
open http://fishing-app.local
```

---

### 前提条件

```bash
# 必要なツールをインストール
brew install minikube kubectl sops age
```

### Step 1: Minikube起動

```bash
# クラスター起動
minikube start --memory=4096 --cpus=2

# Ingressアドオン有効化
minikube addons enable ingress
```

### Step 2: Dockerイメージビルド

```bash
# Minikubeの内部Docker環境を使用（重要！）
eval $(minikube docker-env)

# イメージビルド
# NEXT_PUBLIC_* はクライアントサイド（ブラウザ）で使用するため、ビルド時に埋め込む必要がある
# APIキーは .env.local または k8s/overlays/local/secret.yaml を参照
docker build -f docker/Dockerfile \
  --build-arg NEXT_PUBLIC_GOOGLE_MAPS_API_KEY="your-api-key" \
  --build-arg NEXT_PUBLIC_GOOGLE_MAPS_MAP_ID="your-map-id" \
  -t fishing-app:latest .
```

### Step 3: Secret設定

#### SOPS + age で暗号化（推奨）

```bash
# 1. age鍵を生成（初回のみ）
mkdir -p ~/.config/sops/age
age-keygen -o ~/.config/sops/age/keys.txt

# 2. 公開鍵を.sops.yamlに設定
#    生成された公開鍵（age1...）を k8s/.sops.yaml に記入

# 3. secretを編集してAPI KEYを設定
vim k8s/overlays/local/secret.yaml

# 4. 暗号化
cd k8s/overlays/local
sops -e secret.yaml > secret.enc.yaml

# 5. kustomization.yamlを更新
#    patches の secret.yaml を削除し、
#    resources に secret.enc.yaml を追加
```

### Step 4: デプロイ

```bash
# SOPS復号化用の環境変数を設定
export SOPS_AGE_KEY_FILE="$HOME/.config/sops/age/keys.txt"

# Kustomize + SOPS でデプロイ（Secret自動復号化）
kustomize build k8s/overlays/local --enable-alpha-plugins --enable-exec | kubectl apply -f -

# Pod状態確認（全てRunningになるまで待機）
kubectl get pods -n fishing-app -w
```

> **Note:** `kubectl apply -k` ではSOPSプラグインが動作しないため、`kustomize build` を使用する。

### Step 5: DB初期化

PostgresがRunningになったことを確認してから実行。

```bash
# Postgres起動確認
kubectl get pods -n fishing-app -l app=postgres

# DB初期化Job実行（migrate + seed + 座標更新）
# ※ ConfigMap/Secretが先に作成されている必要がある
kubectl apply -f k8s/base/db-init-job.yaml

# ログ確認
kubectl logs -f job/db-init -n fishing-app
```

**Job実行時にエラーが出た場合:**

```bash
# Pod詳細でエラー原因を確認
kubectl describe pod -l job-name=db-init -n fishing-app

# Jobを削除して再実行
kubectl delete job db-init -n fishing-app
kubectl apply -f k8s/base/db-init-job.yaml
```

### Step 6: アクセス

#### 方法: Ingress経由

Ingress経由でアクセスする場合は、`minikube tunnel` と `/etc/hosts` の設定が必要。

```bash
# 1. /etc/hosts にホスト名を追加（初回のみ）
#    minikube tunnel を使う場合は 127.0.0.1 を使用
echo "127.0.0.1 fishing-app.local" | sudo tee -a /etc/hosts

# 2. 別ターミナルで minikube tunnel を起動
sudo minikube tunnel

# 3. ブラウザでアクセス
open http://fishing-app.local
```

## Pod状態確認

```bash
# 全Pod確認
kubectl get pods -n fishing-app

# Pod詳細
kubectl describe pod <pod-name> -n fishing-app

# ログ確認
kubectl logs <pod-name> -n fishing-app
```

### リソース削除

```bash
# 全リソース削除
export SOPS_AGE_KEY_FILE="$HOME/.config/sops/age/keys.txt"
kustomize build k8s/overlays/local --enable-alpha-plugins --enable-exec | kubectl delete -f -

# Job削除（再実行前に必要）
kubectl delete job db-init -n fishing-app

# Minikube停止
minikube stop
```

## 本番環境（EKS）への移行

1. `.sops.yaml` の production セクションに AWS KMS ARN を設定
2. `overlays/production/` に本番用設定を追加
3. AWS KMS で暗号化した secret を作成
4. EKS クラスターにデプロイ

```bash
kubectl apply -k k8s/overlays/production
```
