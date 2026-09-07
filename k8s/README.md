# Kubernetes マニフェスト

`FishingConditionsApp`（Next.js）を Raspberry Pi 5 上の k3s にデプロイするための
マニフェスト。本番一系統のみで、環境ごとの overlay は持たない。

## 前提

namespace・Redis・cloudflared・RBAC は
[`fishing-infra`](https://github.com/kazumadev619-dev/fishing-infra) が所有する。
このリポジトリが依存するのは以下の 3 点のみ。

- namespace `fishing`
- `redis.fishing.svc.cluster.local:6379`（論理 DB 0 / prefix `fc:`）
- `ingressClassName: traefik`

クラスタは Raspberry Pi 5 上の **k3s v1.34.6+k3s1**（単一ノード / arm64）。
CI のマニフェスト検証もこのバージョンのスキーマで行う。

DB は Neon（マネージド PostgreSQL）。クラスタ内に PostgreSQL は置かない。

### イメージの公開設定（初回デプロイ前に決めること）

マニフェストには `imagePullSecrets` を置いていない。GHCR は新規パッケージの
既定が private なので、**パッケージを public にしない限り初回デプロイは
ImagePullBackOff になる**。`fishing-infra` の RBAC は CI に
`fishing-app-secret` しか触らせないため、CI 側で pull secret を作って回避する
こともできない。

どちらかを選ぶ。

1. GHCR のパッケージを public にする（イメージに秘密は含まれない。
   `.next` 配下と `server.js` を全文検索して確認済み）
2. `fishing-infra` 側で `ghcr-pull` Secret を作り、`deployment.yaml` と
   両 Job に `imagePullSecrets` を足す

## ファイル

| ファイル | 内容 |
|---------|------|
| `kustomization.yaml` | 全リソースを束ねる。CI が `kustomize edit set image` でタグを差し替える |
| `deployment.yaml` | アプリ本体。liveness は `/healthz`、readiness は `/readyz` |
| `service.yaml` | ClusterIP |
| `ingress.yaml` | Traefik Ingress（`fishing.kazuma-lab.com`）。TLS は Cloudflare で終端するため `spec.tls` は持たない |
| `configmap.yaml` | 非機密の環境変数 |
| `secret.enc.yaml` | SOPS/age 暗号化済みの機密。**kustomization には含めない** |
| `job-db-migrate.yaml` | `prisma migrate deploy`。**毎回 delete してから apply する**（下記） |
| `job-db-seed.yaml` | 初期データ投入。初回のみ手動。**kustomization には含めない** |

### probe を役割で分けている理由

- **liveness = `/healthz`**: 依存ゼロで「プロセスが生きているか」だけを見る。
  `/` は潮汐・天気の外部 API に依存するため、外部要因の障害で健全な Pod が
  再起動ループに入る。
- **readiness = `/readyz`**: DB 到達性を見る。`/healthz` だと DB 未接続の Pod も
  Ready になり、Service が流したトラフィックが全て 500 になる。
  Redis は判定に含めない（落ちてもキャッシュ素通しで動くため。含めると
  クラスタ全体の Redis 障害で全 Pod が NotReady になる）。

## ローカル検証

k8s のローカル環境（Minikube など）は用意していない。ローカル開発は
`docker compose` を使う（`npm run docker:dev`）。マニフェストの構文検証は
クラスタ無しで行える。

```bash
kustomize build k8s/ | kubeconform -strict -summary
```

これは PR ごとに CI（`.github/workflows/ci.yml` の `manifests` ジョブ）でも実行される。

## デプロイ

**順序が重要。** この順でないと初回・2 回目のどちらかが必ず失敗する。

```bash
# 1. Secret を先に入れる。あとにすると Pod が CreateContainerConfigError で
#    起動待ちになり、db-migrate は activeDeadlineSeconds で落ちる
sops -d k8s/secret.enc.yaml | kubectl apply -f -

# 2. 既存の db-migrate Job を消す。Job の spec.template は immutable なので、
#    イメージタグが変わった状態で apply すると
#    「field is immutable」で失敗する。しかも kustomize の出力順は
#    ConfigMap → Service → Deployment → Job なので、
#    Deployment だけ新イメージに変わってから Job が落ちる
#    （＝マイグレーション未実行のまま新コードが出る）
kubectl -n fishing delete job db-migrate --ignore-not-found --wait=true

# 3. まとめて適用
kustomize build k8s/ | kubectl apply -f -

# 4. マイグレーションの完了を待つ
kubectl -n fishing wait --for=condition=complete job/db-migrate --timeout=600s
```

**`kubectl apply -k` は使わないこと。** kubectl 内蔵の kustomize では SOPS 暗号化された
Secret を扱えず、暗号文のまま Secret を上書きして全 Pod を起動不能にする。
常に `kustomize build k8s/ | kubectl apply -f -` を使う。

> `ttlSecondsAfterFinished: 3600` があるため、前回から 1 時間以上空けば
> delete 無しでも偶然通る。だが CI 駆動のデプロイでは常に手順 2 が要る。

### db-seed（初回のみ手動）

`db-seed` は `kustomization.yaml` に含まれないため、**`images` によるタグ差し替えを
受けない**。ファイルの `image:` はタグを持たないので、そのまま apply すると
`:latest` に解決されて必ず ImagePullBackOff になる（`:latest` は GHCR に push しない）。
**タグを明示して流すこと。**

```bash
TAG=sha-$(git rev-parse --short HEAD)   # デプロイしたイメージのタグに合わせる
sed "s|\(fishing-app-migrator\)$|\1:${TAG}|" k8s/job-db-seed.yaml | kubectl apply -f -
kubectl -n fishing logs -f job/db-seed

# 再実行する場合は先に削除
kubectl -n fishing delete job db-seed
```

## Secret の編集

```bash
sops k8s/secret.enc.yaml     # in-place 編集。平文ファイルは作らない
```

recipients は 開発者鍵 / CI 鍵 / recovery 鍵 の 3 つ。増減したら
`sops updatekeys k8s/secret.enc.yaml` を実行する。

### 注意点

- **設定は `.sops.yaml`（リポジトリルート）にある。** sops は `.sops.yaml` を
  *カレントディレクトリ* から上に辿って探すため、`k8s/` に置くと
  リポジトリルートからの `sops -e k8s/secret.yaml` が `config file not found` で落ちる。
- **macOS では `SOPS_AGE_KEY_FILE` の指定が要る。** sops は既定で
  `~/Library/Application Support/sops/age/keys.txt` を探すが、鍵は
  `~/.config/sops/age/keys.txt` にある。`~/.zshrc` で
  `export SOPS_AGE_KEY_FILE="$HOME/.config/sops/age/keys.txt"` しておく。
  設定しないと「鍵が壊れた」ように見える `no master key was able to decrypt` が出る。
- **recipients は 1 つの `creation_rules` 内のカンマ区切り 1 文字列で書く。**
  鍵ごとにルールを分けると最初にマッチした 1 つしか適用されず、
  エラーも出ないまま CI 鍵が抜けた暗号文ができる。
- 平文の `secret.yaml` は `.gitignore` の `k8s/**/secret.yaml` で保護されている。
  作業後は `rm -P` で消すこと。

## Cloudflare を迂回して直接アクセスできる（対策せず許容している）

Traefik は Pi の LAN IP で 80/443 を受けている。正しい Host ヘッダを付けて
そこへ直接届けば、Cloudflare の WAF / レート制限を通らずにアプリへ到達する。

```bash
curl -H 'Host: fishing.kazuma-lab.com' http://<PiのLAN IP>/healthz   # → 200
```

2026-09-07 時点で実測した範囲:

- **到達できるのは同一 LAN 内のみ。** ルータは 80/443 をポートフォワード
  していない（モバイル回線からグローバル IP へは到達不可を確認）
- cloudflared は namespace `fishing` の Pod（当時 `10.42.0.9`）
- 迂回経路で触れるのは公開ページ（`/login` `/register`）と
  `/api/auth/*` のみ。`/api/*` は #116 の deny-by-default で 401 を返す

実害が「LAN 内からレート制限なしで認証エンドポイントを叩ける」に留まるため、
#134 では対策しないと判断した。

> **ルータで 80/443 を開けるときは、先にこれを塞ぐこと。**

塞ぐなら Traefik v3（`3.6.10`）の IPAllowList ミドルウェアを
`ingress.yaml` に付けるのが第一候補。

```yaml
apiVersion: traefik.io/v1alpha1   # v2 系の traefik.containo.us ではない
kind: Middleware
metadata:
  name: cloudflared-only
  namespace: fishing
spec:
  ipAllowList:                    # v2 系の ipWhiteList ではない
    sourceRange:
      - 10.42.0.0/16              # k3s の Pod CIDR
```

適用前に必ず確認すること。外すと本番が落ちる。

1. cloudflared がアプリへ **Traefik 経由** で届いているか。
   Service 直結ならこのミドルウェアは本番経路に効かない
2. CI の kubeconfig に `Middleware` CRD を作る権限があるか。
   RBAC は `fishing-infra` が所有しており、CI の権限は絞られている
