# 依存の自動更新（Renovate）

設定は [`renovate.json`](../../renovate.json)。導入の経緯は #165。

## 何を見ているか

| 対象 | 拾い方 |
|------|-------|
| `package.json` | npm manager |
| `.github/workflows/` の `uses:` と `runs-on:` | github-actions manager |
| ワークフローで固定しているツール（kustomize / sops / yq / kubeconform / actionlint） | `customManagers`。`*_VERSION:` の直前の `# renovate:` コメントで取得元を指定する |
| `docker/Dockerfile` のベースイメージ、`docker/docker-compose.yml` のイメージ | dockerfile / docker-compose manager |

`ci.yml` の `node-version: [24.x]`（matrix）は対象外。Node 26（#241）を承認すると上がるのは Dockerfile だけなので、CI の matrix は同じ PR で手で揃える。

`k8s/` のイメージは自前の GHCR イメージだけで、タグは CI が差し込む（`newTag: latest` はプレースホルダ）ので Renovate の対象外になる。

ツールを増やすときは、`*_VERSION:` の直前に同じ形のコメントを付ける。

```yaml
# renovate: datasource=github-releases depName=<owner>/<repo>
FOO_VERSION: v1.2.3
```

タグが `v` 付きでなかったり接頭辞が付いていたりするなら、`extractVersion=` を足す（例: kustomize はタグが `kustomize/v5.8.1`）。

## PR の出方

- 週1回（月曜の4時前、Asia/Tokyo）。公開から3日経っていない版は出さない
- パッチとマイナーは `all non-major dependencies` の1本にまとまる
- メジャーとパッケージの置き換えは、**Dependency Dashboard の issue でチェックを入れたものだけ** PR になる。Node 26（#241）や TypeScript 7 のように保留しているものは、チェックを入れなければ PR は作られない
- 脆弱性の修正は OSV のデータで検知し、スケジュールを待たずに PR になる（リポジトリの Dependabot alerts は無効のため）
- 同時に開く PR は5本まで。ベースは `develop`
- コミットと PR タイトルは `⬆️ package: Update ...` の形になる（commitlint の規則に合わせてある）

## ツールの PR は SHA256 も書き換える

Renovate が書き換えるのは `*_VERSION` だけで、隣の `*_SHA256` はそのまま残る。マージする前に、新しい版のリリースが公開しているチェックサムの linux amd64 の値に書き換えること（PR 本文にも注意書きが出る）。

- kustomize / kubeconform / actionlint は `ci.yml` の各インストールのステップで `sha256sum -c` される
- `deploy.yml` の値（kustomize / sops / yq）は main に上がるまで使われないので、`ci.yml` の `Verify deploy.yml tool checksums` が `deploy.yml` から版と SHA256 を読んで照合する。kustomize は `ci.yml` と `deploy.yml` の両方にあり、同じ PR で両方の版が書き換わる。`ci.yml` 側の SHA256 だけ直しても、このステップで落ちる
- yq は、deploy ではランナーに同梱の yq が無いときだけ `YQ_VERSION` を取得する。だから今は書き忘れても deploy は落ちない（同梱が消えた日に落ちる）。照合のステップは常に検知する

## 導入（初回のみ）

Renovate は設定を既定ブランチ（main）から読む。`renovate.json` が main に昇格する前に App を入れると、main 向けのオンボーディング PR が出てしまう。

1. `renovate.json` が main に入ったことを確かめる
2. [Mend Renovate の GitHub App](https://github.com/apps/renovate) をこのリポジトリにインストールする（main に設定があるのでオンボーディング PR は出ない）
3. Dependency Dashboard の issue ができたことを確かめる
4. Docker のイメージ（postgres / redis）が `minimumReleaseAge` で pending のまま止まっていないかを Dashboard で見る。2026-10-25 の初回は、Docker Hub の `releaseTimestamp` が取れず「Pending Status Checks」で止まった（手元の dry-run と同じ）。そのため Docker のイメージだけ `minimumReleaseAgeBehaviour: timestamp-optional` にした。main に入ったあとの次の実行で、postgres 18 と redis 8 が「Pending Approval」に移っていれば直っている
