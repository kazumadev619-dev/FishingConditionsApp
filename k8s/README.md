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
| `deployment.yaml` | アプリ本体。probe はすべて `/healthz`（下記） |
| `service.yaml` | ClusterIP |
| `ingress.yaml` | Traefik Ingress（`fishing.kazuma-lab.com`）。TLS は Cloudflare で終端するため `spec.tls` は持たない |
| `config.env` | 非機密の環境変数。`kustomization.yaml` の `configMapGenerator` が ConfigMap を生成する（下記） |
| `secret.enc.yaml` | SOPS/age 暗号化済みの機密。**kustomization には含めない** |
| `job-db-migrate.yaml` | `prisma migrate deploy`。**毎回 delete してから apply する**（下記） |
| `job-db-check.yaml` | pooled 側の `DATABASE_URL` に `SELECT 1` を1回投げる（#191）。db-migrate と同じく**毎回 delete してから apply する** |
| `job-db-seed.yaml` | 初期データ投入。初回のみ手動。**kustomization には含めない** |

### probe がすべて `/healthz` を向く理由

startup / liveness / readiness の3つとも、依存ゼロの `/healthz` を叩く。

- **`/` を使わない**: 潮汐・天気の外部 API に依存するため、外部要因の障害で健全な
  Pod が再起動ループに入る。
- **readiness で DB を見ない**: 以前は DB に `SELECT 1` を投げる `/readyz` を向けて
  いたが、#187 でやめた。理由は2つ。
  1. **可用性が上がらない。** `replicas: 1` で DB は全 Pod 共通の外部サービスなので、
     DB が落ちれば全 Pod が同時に NotReady になる。逃がす先が無く、endpoints が空に
     なって Traefik が全パスに `503 no available server` を返す。`/healthz` にも
     届かず、エラーページすら出せない。
  2. **Neon の無料枠を使い切る。** 10秒ごとの `SELECT 1` が autosuspend（無料枠は
     5分固定で変更不可）を永久にリセットし、compute が24時間起きたままになる。
     0.25 CU なら月 180 CU-hrs で、無料枠 100 CU-hrs を約16.7日で使い切る。
     2026-09-18 に実際に枯渇して、本番が3日以上落ちた。

  **probe の間隔を延ばしても解決しない。** 5分以下の間隔では稼働率が100%のまま
  変わらない。意味のある削減には10〜30分が要り、それは probe として機能しない。

**DB が落ちたときの挙動**: Pod は Ready のまま動き続ける。`/dashboard` は
`resolveLocation.ts` が DB エラーを catch して既定の地点に逃がすので描画され、
天気・潮汐・スコアは外部 API から取れる。お気に入りと港マスタの API は 500 を返す。

**`/readyz` は人が叩く診断用として残している。** DB と Redis の到達性を返す。
監視や probe など、定期ポーリングは向けないこと。CI の
`Ensure probes only hit /healthz` が、probe が `/healthz` 以外を向いたら落とす。

**代わりに失ったもの: ロールアウトで壊れた DB 設定を止める網。** 以前は新しい Pod が
DB に繋がらないと Ready にならず、`rollout status` が落ちて止まっていた。いまは
`/healthz` が通るので、Secret の `DATABASE_URL`（アプリが使う pooled 側）を壊しても
ロールアウトは完了する。migrate は `DATABASE_URL_DIRECT` しか読まないので、pooled 側
だけ壊れた場合は migrate も通る。

そこで `deploy.yml` は **Apply manifests の前に** `db-check` Job（アプリと同じイメージ・
同じ `pg` ドライバで `DATABASE_URL` に `SELECT 1`）を流し、繋がらなければロールアウト
せずに止める（#191）。旧 Pod はそのまま動き続ける。`rollout undo` では Secret 起因の
障害は直らない（作り直された Pod も壊れた Secret を読む）ので、旧 Pod を消す前に
止めるしかない。ログにはエラーコードだけを出し、接続文字列は出さない。

加えてブロッキングスモークで `/readyz` を**デプロイごとに1回だけ**叩く（直前の migrate で
compute は起きており、1回きりなので autosuspend も妨げない）。

**Secret はロールアウトより前に適用済み**なので、db-check で止まっても壊れた Secret は
クラスタに残る。旧 Pod は起動時に読んだ値で動き続けるが、次に再起動した時点で壊れた
値を読む。デプロイが赤くなったら Secret を直して再デプロイする。

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
#    db-check も同じ（#191）
kubectl -n fishing delete job db-migrate db-check --ignore-not-found --wait=true

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

### ConfigMap は名前にハッシュが付く

`config.env` を変更すると、生成される ConfigMap の名前が
`fishing-app-config-t676559hhk` のように変わり、`deployment.yaml` の
`configMapRef` も kustomize が同時に書き換える。Pod テンプレートが変わるので、
`kustomize build k8s/ | kubectl apply -f -` するだけで確実にロールアウトされる。

固定名の ConfigMap を `resources` に置いていた頃は、環境変数が Pod 起動時にしか
読まれないため **`config.env` だけ直しても Deployment は無変更のままで反映されなかった**。
イメージタグが変わるデプロイでは Pod が入れ替わるので気づかず、ConfigMap だけ
直したときに静かに無反映になる（#133）。

`kustomization.yaml` の `configMapGenerator` に `disableNameSuffixHash` を
**付けないこと。** 付けると固定名に戻り、この仕組みが死ぬ。

#### `config.env` は dotenv ではない

`configMapGenerator` の `envs:` は、各行を最初の `=` で切って左右を**ほぼそのまま**
キーと値にする。dotenv や シェルの感覚で書くと、値が静かに変わる。
kustomize v5.8.1（CI の固定版）と v5.8.3 で実測した結果:

| `config.env` の行 | ConfigMap の値 | 備考 |
|---|---|---|
| `A=b` | `b` | これだけを使う |
| `A="b"` / `A='b'` | `"b"` / `'b'`（引用符込み） | クォートを剥がさない |
| `A=b # comment` | `b # comment` | インラインコメントにならない |
| `A=  b` / `A=b  ` | `  b` / `b  ` | 値の前後の空白を残す |
| `A =b` | キーが `A `（空白込み） | アプリからは `A` が見えない |
| `export A=b` | キーが `export A` | 同上 |
| `A=b=c` | `b=c` | 最初の `=` でだけ切る。URL のクエリは安全 |
| `A=a\nb` | `a\nb`（2文字の `\` と `n`） | エスケープを展開しない |
| `A` / `A=` | `""` | `=` の無い行がビルドホストの環境変数を引くことは無い |
| 同じキーを2回 | ビルドが落ちる（`illegally repeats the key`） | 安全側 |
| `# comment`（行頭。前に空白があってもよい） | 無視 | コメントはこの形だけ |

CRLF の `\r` とキーの前の空白は剥がされる。

**CI で拾えるのは `AUTH_URL` だけ。** `ci.yml` のガードは `AUTH_URL` が `https://` で
始まることを見ており、クォートや空白が混ざると YAML 側でクォートが付いて一致しなく
なるので落ちる。ほかのキーは、壊れた値でもガードを素通りする（`NODE_ENV="production"` と
`REDIS_URL="redis://..."` で実測）。壊れたときの挙動は次のとおり。

| キー | 壊れたときの挙動 | 気づけるか |
|---|---|---|
| `NODE_ENV` | `src/lib/logger.ts` が `=== 'production'` で判定するので、本番でも開発用の `pino-pretty`（devDependencies）を読みに行く | 起動時に落ちるはず（イメージでは未実測） |
| `LOG_LEVEL` | pino が未知のレベルで例外を投げる（`"info"` で実測） | 起動時に落ちる |
| `AUTH_URL` / `NEXTAUTH_URL` | Cookie の `__Host-` と `Secure` が外れ、メール検証リンクが壊れる（#134） | `AUTH_URL` は CI ガードと deploy の `callbackUrl` 照合が止める |
| `REDIS_URL` | 接続できず、キャッシュが永久に無効のまま動く | deploy の非ブロッキングスモークが `/readyz` の cache で warning を出すだけ |

Deployment 側で `envFrom` に `prefix:` を付けたり、`env:` で同じ名前を上書きしたり
しても、`config.env` が正しいままアプリから見える値が変わる（#168 のコメント）。

#### 古い ConfigMap は残る

`kubectl apply` は削除を行わないため、`config.env` を変えるたびに古い名前の
ConfigMap がクラスタに残る。CI の `ci-deployer` Role は ConfigMap の `delete` を
持たない（`fishing-infra` の RBAC）ので、消すのは人の手作業になる。

**消してよいのは、どの ReplicaSet からも参照されていないものだけ。** `kubectl rollout undo`
は残っている ReplicaSet の Pod テンプレートに戻すので、そのテンプレートが参照する
ConfigMap が消えていると、戻した Pod が `CreateContainerConfigError` で起動しない。

ReplicaSet はデプロイのたびに1つ増え（イメージタグが run ごとに変わる）、
`deployment.yaml` の `revisionHistoryLimit: 10` を超えた古いものから k8s が消す。
つまり「直近 11 デプロイ（現行 + 履歴 10）のどれかが使っている ConfigMap」は消さない。

```bash
# 1. 消してはいけないもの（ReplicaSet が参照している ConfigMap）
kubectl -n fishing get rs -l app.kubernetes.io/name=fishing-app,app.kubernetes.io/component=web \
  -o jsonpath='{range .items[*]}{.spec.template.spec.containers[*].envFrom[*].configMapRef.name}{"\n"}{end}' \
  | sort -u > /tmp/cm-keep.txt

# 2. 生成された ConfigMap 全部
kubectl -n fishing get configmap -l app.kubernetes.io/name=fishing-app \
  -o jsonpath='{range .items[*]}{.metadata.name}{"\n"}{end}' | sort -u > /tmp/cm-all.txt

# 3. 2 にあって 1 に無いものが削除候補。目で確かめてから1つずつ消す
comm -13 /tmp/cm-keep.txt /tmp/cm-all.txt
# kubectl -n fishing delete configmap <名前>
```

1 が空なら何かがおかしい（現行の Deployment の ReplicaSet は必ず参照している）ので、
その場合は何も消さない。消したあとは、次のデプロイの非ブロッキングスモーク
（Summary の「ConfigMap（#133）」）で、参照先がすべて「ある」になっていることを確かめる。

### db-seed（初回のみ手動）

`db-seed` は `kustomization.yaml` に含まれないため、**`images` によるタグ差し替えを
受けない**。ファイルの `image:` はタグを持たないので、そのまま apply すると
`:latest` に解決されて必ず ImagePullBackOff になる（`:latest` は GHCR に push しない）。
**タグを明示して流すこと。**

接続にはオーナー（`DATABASE_URL_DIRECT`）ではなく、Secret の `DATABASE_URL_RW_DIRECT`
（アプリロール `fishing_app_rw` の **direct** 接続。pooled の `DATABASE_URL` のホスト名から
`-pooler` を外したもの）を使う。seed に DDL は無く DML だけなので、オーナーは要らない（#135）。
このキーが Secret に無いと Pod は `CreateContainerConfigError` で止まる。

```bash
# いま動いているイメージのタグ（sha-<短縮SHA>-<run_number>-<run_attempt>。#275）
TAG=$(kubectl -n fishing get deploy fishing-app -o jsonpath='{.spec.template.spec.containers[0].image}' | sed 's/.*://')
sed "s|\(fishing-app-migrator\)$|\1:${TAG}|" k8s/job-db-seed.yaml | kubectl apply -f -
kubectl -n fishing logs -f job/db-seed

# 再実行する場合は先に削除
kubectl -n fishing delete job db-seed
```

再実行しても港の id と座標は保たれ、`locations.port_id` の紐づけも切れない（seed は
`(prefecture_code, port_code)` で upsert し、更新するのは港名と都道府県名だけ。#146）。
CSV から消えた港は削除されずに残る。2段目は全港の座標を tide736.net から取り直す。

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
