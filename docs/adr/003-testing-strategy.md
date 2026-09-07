# ADR-003: テスト基盤の選定

**日付:** 2026-09-07
**ステータス:** 採用済み

## 決定

Vitest を Unit / Integration / Client Component テストの標準ランナーとして採用する。

段階的に拡張し、ランナーの載せ替えは発生させない。

| 段階 | 対象 | 環境 | 追加するもの |
|------|------|------|-------------|
| Stage 1 | 純粋関数のユニットテスト | Node | Vitest のみ |
| Stage 2 | API Route Handler の統合テスト | Node | （追加なし） |
| Stage 3 | Client Component のテスト | jsdom | jsdom + React Testing Library |

E2E テストが必要になった場合は、Vitest とは**別のランナー**として Playwright Test を採用する。E2E はブラウザを起動して本番相当の経路を通す性質上、アプリ内部のテストとは要求が異なるため、無理に同一ランナーに載せない。

## 理由

### 1. ESM module mocking を第一級に扱えること（決め手）

本プロジェクトは `"type": "module"`（ESM）+ TypeScript + Next.js App Router の構成である。

直近で必要になるテストのうち、認証 allowlist の回帰テスト（#129）は NextAuth v5 の `auth()` をモックする必要がある。NextAuth v5 は ESM モジュールであり、**ESM モジュールのモックがどれだけ素直に書けるかがランナー選定の実質的な分岐点**になる。

Vitest の `vi.mock()` は ESM を前提に設計されており、追加のフラグや API を要しない。

### 2. Unit / Integration / Component を単一ランナーで段階拡張できること

上表のとおり、テストの対象は純粋関数 → Route Handler → Client Component と広がっていく見込みである。ここでランナーを分けたり載せ替えたりすると、設定・モック・アサーションの書き方が二重管理になる。

Vitest は Node 環境から jsdom 環境への切り替えを設定1行で行えるため、**最初から Vitest に固定しておけば「Jest → Vitest」のような移行を発生させずに済む**。新規導入で既存のテスト資産が無い今が、この固定を行う最良のタイミングである。

### 3. Next.js 公式のテストガイドが Vitest を採用していること

Next.js App Router のテストは、Server Component / Client Component の境界など固有の踏み抜きポイントがある。公式ガイドが Vitest で書かれているため、詰まったときに一次情報を参照できる。

## 代替案

### Jest（不採用）

Next.js との統合は良好で、エコシステム（jest-dom, jest-axe 等）も最大である。`docs/guides/development.md` にも当初 Jest と記載されていた。

しかし本プロジェクトは**新規導入であり既存の Jest 資産が無い**。そのうえで ESM + TypeScript 構成に載せるには `ts-jest` または `babel-jest`、`extensionsToTreatAsEsm`、`moduleNameMapper` によるパスエイリアス解決といった設定を積む必要があり、ESM モジュールのモックには `jest.unstable_mockModule` を使うことになる。移行元が無い以上、この複雑性を引き受ける理由が無い。

### Node.js 標準テストランナー `node:test`（不採用）

Node 24 との親和性が高く、依存パッケージを1つも増やさずに済む。純粋関数のテスト（Stage 1）に限れば最も軽量である。

しかし Stage 2 のモジュールモックと Stage 3 の React / jsdom を含む**長期的な統一基盤としては追加構成が増える**。Stage 1 だけを見て採用すると、Stage 2 で乗り換えることになる。

### bun:test（不採用）

テストランナー単体としては最速で、Jest 互換 API を持つ。

しかし本プロジェクトの**本番および CI のランタイムは Node 24 + npm** であり（`docker/Dockerfile`、`.github/workflows/ci.yml`）、テストのためだけに Bun ランタイムを追加導入する合理性が無い。ビルドとテストでランタイムが分かれることは、それ自体が再現性のリスクになる。

## 結果

- `npm run test`（`vitest run`）と `npm run test:watch`（`vitest`）が追加される
- `npm run check-code` にテストが含まれ、`full-check` からも実行される
- CI の quality-check ジョブに「7. ユニットテスト（Vitest）」ステップが追加される。テストが落ちた PR はマージできない
- テストファイルは実装の隣にコロケートする（`src/lib/foo.ts` に対して `src/lib/foo.test.ts`）。対応関係が一目で分かり、実装を移動したときにテストが取り残されにくい
- `docs/guides/development.md` の「Jest + React Testing Library / Playwright」という記述は実体が存在しなかったため、本 ADR の内容に合わせて書き換える

## 補足: この決定を見直すべきタイミング

- Next.js 公式ガイドが Vitest 以外を推奨するようになったとき
- E2E を導入し、Playwright のコンポーネントテスト機能で Stage 3 を代替できると判断したとき
- ESM モジュールのモックが言語・ランタイム標準の機能で解決され、ランナー固有の実装に依存しなくなったとき
