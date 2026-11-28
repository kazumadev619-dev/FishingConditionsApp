---
name: blast-radius
description: コード変更が直接の diff の外で何を壊しうるかを見積もり、静的 grep や推測だけで終わらせず、実コード・実コマンドの実行で安全性を証明するときに使う。共通モジュール・認証・スコア・DB スキーマ・依存更新・3リポジトリ契約に関わる変更の影響調査、blast-radius、影響範囲を確かめたい、といった場面。
---

# blast-radius

> **参考元:** [pstack `blast-radius`](https://github.com/cursor/plugins/tree/main/pstack/skills/blast-radius)

変更の安全性を「grep で呼び出し元を一覧にした」だけで済ませず、**diff の外で壊れうる急所を特定し、実際に動かして証明する**スキル。

## このリポジトリで必ず確認すべき波及境界

直接触ったファイルの外に、次の境界が無いかを毎回チェックする。

1. **アプリ内部の共有境界**:
   - 型・スキーマ（`zod`、Prisma 型、`src/generated/prisma/`）
   - 認証・セッション（JWT 項目、Cookie 属性、許可リスト、`run-app-locally/session-cookie.mjs`）
   - キャッシュ・レート制限（Redis キー名、TTL、in-flight dedupe）
   - API エラー形式・HTTP ステータス・`Server-Timing` / OTel メトリクス
2. **仕様（正）とテスト**:
   - `docs/reference/` の「仕様（正）」4 文書（[ADR-010](../../../docs/adr/010-spec-source-of-truth.md)）
   - `docs/reference/scoring-test-cases.md` や既存テストの暗黙前提（モックのシグネチャや例外型が実ライブラリとズレていないか）
3. **3 リポジトリ間の契約（`fishing-infra/README.md`）**:
   - **DB スキーマ（Prisma DDL）**: `FishingConditionsApp` が唯一の所有者。テーブル・列・制約の変更は `Fishing-api`（Go・`schema.sql`）へ波及する
   - **Redis 論理 DB**: Next = DB 0、Go = DB 1
   - **URL パス境界**: `/api/auth/*`・`/healthz`・`/*` は Next、`/api/v1/*` は Go
   - **k8s / 環境変数**: `k8s/config.env`、`k8s/deployment.yaml`、`.env.example`、CI ガード（`ci.yml` の `manifests` ジョブ）

## 手順

### 1. 変更差分と直接の契約変化を抜き出す

```bash
git diff --stat origin/develop...HEAD
```

戻り値の形・例外の型・副作用・環境変数・DB/Redis キー・ビルド成果物のうち、「外から見える振る舞いが変わりうる点」を列挙する。

### 2. 「安全を分ける核心事実（Core Fact）」を絞る

呼び出し元を並べるだけで止めない。「もし本番で壊れるとしたら、どの前提が崩れたときか？」を 1〜3 点の仮説（急所）に絞る。

- 例: 「モックは生の `Error` を返しているが、実物の `next-auth` は `CallbackRouteError` で包む」
- 例: 「`k8s/config.env` の変数名を変えたが、`ci.yml` の許可リストや `docker/Dockerfile` の build-arg と整合するか」
- 例: 「Prisma のカラム変更で既存レコードや `prisma/seed.ts` の再実行（冪等性）が壊れないか」

### 3. 実行して証明する

絞った急所ごとに、**読むだけでなくコマンドや一時スクリプトを動かして裏を取る**。

- テスト・型・lint: `npm run check-code`、`npm run build`
- モックで隠れる実挙動: [`run-app-locally`](../run-app-locally/SKILL.md) の実 DB / 実アプリ確認、または `npm run e2e:up && npm run e2e:smoke`
- k8s / インフラ: `kustomize build k8s/` の `origin/develop` との差分、`deploy.yml` ステップのコンテナ再現
- 依存更新: [`updating-dependencies`](../updating-dependencies/SKILL.md) の `deps.py lockdiff` と実ライブラリの挙動確認

実行できなかった経路は「大丈夫そう」と書かず、必ず **未確認** として分ける。

## 出力の形（固定）

```markdown
## blast-radius 調査結果

### 1. 最も壊れやすい急所（Core Facts）と裏取り
1. <急所>: <安全 / リスクあり / 未確認>
   - 根拠: <実行したコマンドと出力の要点>

### 2. 影響マップ
| 波及先（アプリ内 / 仕様書 / 他リポジトリ / インフラ） | 起こりうる影響 | 検証方法 | 判定 |
|---|---|---|---|

### 3. 未確認の範囲
- <実行できなかった経路と理由。無ければ「なし」>
```
