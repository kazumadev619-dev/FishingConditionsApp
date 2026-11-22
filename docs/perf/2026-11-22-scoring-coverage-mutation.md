# スコア計算のカバレッジと変異テストの結果（2026-11-22）

> - **測った日**: 2026-11-22
> - **commit**: カバレッジは develop の `7d1970d` から作った #426 の作業（PR #431）の時点。変異テストの2回目は PR #431 のレビューの反映後（PR の最後の commit は `d8a4c58`）
> - **対象**: `src/lib/scoring/`、`src/lib/utils/scoreRank.ts`。ケースの一覧は [scoring-test-cases.md](../reference/scoring-test-cases.md)
> - **出どころ**: 旧版の `scoring-test-cases.md` の 6・7節（この記録に移した。数値は変えていない）

[ADR-009](../adr/009-testing-quality-policy.md) の決定（カバレッジの閾値もツールも置かない）は変えない。網羅率は、コードが実行されたかどうかを示すだけで、結果を確かめたかどうかは示さない（[testing-policy.md](../guides/testing-policy.md) 8節）。

## カバレッジ

測定環境: Node 24.11.0、vitest 5.1.1。CI と本番は Node 26 系なので、測った環境とは違う。網羅率は Node のバージョンでほとんど変わらないと考えているが、26 系では測っていない。

```bash
npm i --no-save @vitest/coverage-v8@5.1.1   # package.json と package-lock.json は変わらない
npx vitest run --coverage --coverage.provider=v8 --coverage.reporter=text
```

| 範囲 | line | branch |
|---|---|---|
| スコア計算（`src/lib/scoring/` の5ファイルと `src/lib/utils/scoreRank.ts`。テストファイルを除く）合計 | 100%（128/128） | 100%（85/85） |
| 　`tideScore.ts` | 100% | 100%（20/20） |
| 　`weatherScore.ts` | 100% | 100%（34/34） |
| 　`timeScore.ts` | 100% | 100%（6/6） |
| 　`index.ts` | 100% | 100%（5/5） |
| 　`explanationGenerator.ts` | 100% | 100%（12/12） |
| 　`scoreRank.ts` | 100% | 100%（8/8） |
| 全体（テストが読み込んだ81ファイル） | 86.28%（1107/1283） | 82.33%（606/736） |

- 全体の数値は、テストの実行中に1度でも読み込まれたファイルだけが分母である（vitest 5 の既定。テストが1つも読み込まないファイルは数えない）
- スコア計算は line・branch とも 100% だが、`explanationGenerator.ts` のランクごとの文面は、実行されても内容を確かめていない。網羅率が高いことは、確かめたことの証明ではない
- PR #431 で足したテストの前は、`tideScore.ts` の branch が 90%（18/20）だった。最も近い極値を選ぶ処理（`reduce`）の、「後ろの極値のほうが遠い」側を通るテストがなかった。足したテストで埋まった

## 変異テスト

[`mutation-test`](../../.agents/skills/mutation-test/SKILL.md) で、スコア計算の実装を60通りに壊し、`npx vitest run src/lib/scoring src/lib/utils/scoreRank.test.ts` で確かめた（対象: `tideScore.ts`、`weatherScore.ts`、`timeScore.ts`、`index.ts`、`scoreRank.ts`）。

- 57件が落ちた（KILLED）
- 3件が通った（SURVIVED）。いずれも、仕様の上で値が変わらない変異である
  - 潮汐の2時間の境目 `<= 2` → `< 2`（ちょうど 2 時間で、どちらの式も 12.5）
  - 潮汐の4時間の境目 `<= 4` → `< 4`（ちょうど 4 時間で、どちらの式も 0）
  - 最も良い要素の比較 `>` → `>=`（同点のときだけ変わり、同点の扱いは仕様にない）

PR #431 のレビューを受けて、5通りを足して確かめた（計65通り）。

- 4件が落ちた。0〜2時間・2〜4時間のタイミングを段階式にする変異、最も近い極値を現在より後ろ・前から優先して選ぶ変異。PR #431 で足したテストの前は、0〜2時間を段階式にする変異と、後ろを優先する変異が通っていた
- 1件が通った。最も悪い要素の比較 `<` → `<=` は、最も良い要素と同じく、同点のときだけ変わる（同値）。したがって、生き残りは計4件で、すべて同値である
