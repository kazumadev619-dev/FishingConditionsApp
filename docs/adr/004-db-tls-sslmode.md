# ADR-004: Neon への接続は `sslmode=require` とする

**日付:** 2026-09-23
**ステータス:** 採用済み（2026-10-28 に #209 で migrate の経路を改訂）

## 決定

Secret（`k8s/secret.enc.yaml`）に入れる Neon の接続文字列は、すべて `sslmode=require` とする。

Prisma CLI で使う `DATABASE_URL_DIRECT` には、`db-migrate` Job のマニフェスト（`k8s/job-db-migrate.yaml`）が `sslaccept=strict` を足してから渡す（#209）。Secret の値には足さない。

| キー | ロール | 使うもの | ドライバ |
|------|--------|---------|---------|
| `DATABASE_URL` | `fishing_app_rw`（pooled） | アプリ本体 | `pg`（`@prisma/adapter-pg`） |
| `DATABASE_URL_RW_DIRECT` | `fishing_app_rw`（direct） | `db-seed` Job | `pg` |
| `DATABASE_URL_DIRECT` | `neondb_owner`（direct） | `db-migrate` Job（`sslaccept=strict` を足して渡す） | Prisma CLI（schema engine） |

## 理由

### 1. `verify-full` は Stage 1 の構築時に証明書エラーで通らなかった

当初の計画は `verify-full` で、通らなければ `require` に落として ADR に残す、としていた。構築時に `verify-full` は証明書エラーになり、`require` を採った。どのクライアントで出たエラーかは記録が残っていない。

### 2. 同じ `sslmode` でも、ドライバによって意味が違う

自己署名証明書のサーバに、同じ接続文字列でつないだ結果（pg 8.23.0 / pg-connection-string 2.14.0 / Prisma 7.10.0、#135 でローカル実測）:

| 接続文字列のパラメータ | `pg`（アプリ・seed） | Prisma CLI（migrate） |
|------|------|------|
| `sslmode=require` | 拒否（`self-signed certificate`） | **接続できる** |
| `sslmode=verify-full` | 拒否 | **接続できる** |
| `sslmode=require&sslaccept=strict` | 拒否 | 拒否（`P1011: ... The certificate was not trusted.`） |
| `sslmode=no-verify` | 接続できる | 接続できる |

- **`pg` 8 系は `require` を `verify-full` の別名として扱う。** 証明書とホスト名を検証する。したがってアプリと seed は `require` のままで検証されている
- **Prisma CLI では `sslmode` は検証のスイッチではない。** `verify-full` と書いても検証しない。検証させるのは `sslaccept=strict`

`verify-full` と書けば安全になるわけではなく、`require` と書いても危険になるわけではない。どちらが効くかはドライバ次第である。

## 結果

- アプリと `db-seed` の経路（`pg`）は証明書を検証している
- `db-migrate` の経路（Prisma CLI + `DATABASE_URL_DIRECT`）は、当初は証明書を検証していなかった。#209 で `sslaccept=strict` を足し、証明書とホスト名を検証するようにした（下の「#209 での改訂」）
- `db-seed` は `neondb_owner` ではなく `fishing_app_rw` の direct 接続（`DATABASE_URL_RW_DIRECT`）を使う（#135）。seed に DDL は無く、`ports` への `INSERT ... ON CONFLICT DO UPDATE` と `UPDATE` だけなので、オーナーは要らない

## 補足: この決定を見直すべきタイミング

- **`pg` を 9 系（pg-connection-string 3 系）に上げるとき。** `require` が libpq と同じ「暗号化するが検証しない」意味に変わる。pg-connection-string 2.14.0 はこの変更を `SECURITY WARNING` として予告している。上げる前に、`pg` が読む接続文字列を `sslmode=verify-full` に変えること
- Prisma CLI が `sslmode=verify-full` を検証として扱うようになったとき

## #209 での改訂: migrate の経路に `sslaccept=strict` を足す（2026-10-28）

`k8s/job-db-migrate.yaml` の `command` を `sh -c` にし、Secret から受けた `DATABASE_URL_DIRECT` に `sslaccept=strict` を足してから `prisma migrate deploy` を `exec` する。区切り文字は値に `?` があれば `&`、無ければ `?` を選ぶ。

Secret ではなくマニフェストで足す理由:

- 変更がレビューで見える。Secret は暗号化されていて差分を読めない
- Secret を差し替えても外れない。ローテーションで値を貼り直したときに付け忘れる余地が無い

区切り文字を固定で `&` にしてはいけない。`?` の無い値に `&sslaccept=strict` を足すと DB 名が `neondb&sslaccept=strict` になり、`migrate deploy` はその名前の DB を**作って**検証なしで成功する（実測）。Kubernetes の `$(VAR)` 展開だけで足す案はこれで捨てた。

### 実測（Prisma 7.10.1、migrator イメージ = `node:26.12.1-alpine`、arm64）

使い捨ての postgres（`sslmode=require&sslaccept=strict`）:

| サーバ証明書 | 結果 |
|------|------|
| 自己署名 | 拒否（`P1011 ... certificate verify failed`） |
| 信頼済み CA の署名だがホスト名が違う | 拒否（`P1011 ... (hostname mismatch)`） |
| 信頼していない CA の署名 | 拒否（`P1011 ... certificate verify failed`） |
| 信頼済み CA の署名でホスト名も一致 | 接続できる |

Prisma CLI はイメージのシステム CA（`/etc/ssl/certs/ca-certificates.crt`、Alpine の `ca-certificates-bundle`）で検証する。`SSL_CERT_FILE` を差し替えると信頼する CA が変わることで確かめた。

Neon の証明書（`*.<region>.aws.neon.tech`、Let's Encrypt。ISRG Root X1 に繋がる）は、このシステム CA で strict の検証を通る。存在しない endpoint とダミーの資格情報で Neon の公開プロキシに繋ぎ、TLS を通ってから認証で落ちること（`P1000`）を確かめた。CA を差し替えると同じ接続が `P1011` になる。本番の DB にはこの検証では繋いでいない。

使い捨ての k3s（v1.34.1）で develop と #209 の `db-migrate` Job を流した。自己署名のサーバに対して、develop の Job はマイグレーションを適用して完了し、#209 の Job は `P1011` で失敗した。Secret の値が `?` を含まない場合も、自己署名なら `P1011` で失敗し、正しい証明書なら元の DB に対して完了する（余計な DB は作られない）。

### 見直すタイミング

- Neon の証明書の発行元が、イメージのシステム CA に無い CA に変わったとき。migrate が `P1011` で落ち、ロールアウトの前でデプロイが止まる（旧 Pod は残る）
