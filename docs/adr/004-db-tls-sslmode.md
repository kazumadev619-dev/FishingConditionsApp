# ADR-004: Neon への接続は `sslmode=require` とする

**日付:** 2026-09-23
**ステータス:** 採用済み

## 決定

Secret（`k8s/secret.enc.yaml`）に入れる Neon の接続文字列は、すべて `sslmode=require` とする。

| キー | ロール | 使うもの | ドライバ |
|------|--------|---------|---------|
| `DATABASE_URL` | `fishing_app_rw`（pooled） | アプリ本体 | `pg`（`@prisma/adapter-pg`） |
| `DATABASE_URL_RW_DIRECT` | `fishing_app_rw`（direct） | `db-seed` Job | `pg` |
| `DATABASE_URL_DIRECT` | `neondb_owner`（direct） | `db-migrate` Job | Prisma CLI（schema engine） |

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
- **`db-migrate` の経路（Prisma CLI + `DATABASE_URL_DIRECT`）は証明書を検証していない。** 検証させるには `DATABASE_URL_DIRECT` に `&sslaccept=strict` を足す。Neon の証明書で通るかは未確認なので、この ADR では変えない
- `db-seed` は `neondb_owner` ではなく `fishing_app_rw` の direct 接続（`DATABASE_URL_RW_DIRECT`）を使う（#135）。seed に DDL は無く、`ports` への `INSERT ... ON CONFLICT DO UPDATE` と `UPDATE` だけなので、オーナーは要らない

## 補足: この決定を見直すべきタイミング

- **`pg` を 9 系（pg-connection-string 3 系）に上げるとき。** `require` が libpq と同じ「暗号化するが検証しない」意味に変わる。pg-connection-string 2.14.0 はこの変更を `SECURITY WARNING` として予告している。上げる前に、`pg` が読む接続文字列を `sslmode=verify-full` に変えること
- Prisma CLI が `sslmode=verify-full` を検証として扱うようになったとき
