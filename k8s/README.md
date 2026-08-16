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

DB は Neon（マネージド PostgreSQL）。クラスタ内に PostgreSQL は置かない。

## ファイル

| ファイル | 内容 |
|---------|------|
| `kustomization.yaml` | 全リソースを束ねる。CI が `kustomize edit set image` でタグを差し替える |
| `deployment.yaml` | アプリ本体。liveness は `/healthz`、readiness は `/readyz` |
| `service.yaml` | ClusterIP |
| `ingress.yaml` | Traefik Ingress（`fishing.kazuma-lab.com`）。TLS は Cloudflare で終端するため `spec.tls` は持たない |
| `configmap.yaml` | 非機密の環境変数 |
| `secret.enc.yaml` | SOPS/age 暗号化済みの機密。**kustomization には含めない** |
| `job-db-migrate.yaml` | `prisma migrate deploy`。deploy のたびに実行される |
| `job-db-seed.yaml` | 初期データ投入。初回のみ手動 |

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

```bash
kustomize build k8s/ | kubectl apply -f -
sops -d k8s/secret.enc.yaml | kubectl apply -f -
```

**`kubectl apply -k` は使わないこと。** kubectl 内蔵の kustomize では SOPS 暗号化された
Secret を扱えず、暗号文のまま Secret を上書きして全 Pod を起動不能にする。
常に `kustomize build k8s/ | kubectl apply -f -` を使う。

`db-seed` は `kustomization.yaml` に含まれていないので、初回のみ手動で流す。

```bash
kubectl apply -f k8s/job-db-seed.yaml
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
