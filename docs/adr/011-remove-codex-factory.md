# ADR-011: Codex 版 AI factory（Watcher）と Codex 向けの写しを削除する

**日付:** 2026-11-20
**ステータス:** 一部を [ADR-013](./013-multi-agent-customizations.md) で置き換え（`.claude/skills/` を実体のまま残す点。[ADR-013](./013-multi-agent-customizations.md) が `.agents/skills/` を実体にした）

## 決定

Codex 版の AI factory（`scripts/ai-factory/` の Watcher）と、Codex 向けの写し（`.agents/skills/`、`.codex/`）を削除する。削除は 2 本の PR に分ける。

- **写しの削除**: `.agents/skills/` と `.codex/` を消す。`.claude/skills/` は実体のまま残す。`AGENTS.md` はプロジェクト内に残し、Codex の記述だけ削る（`CLAUDE.md` も同じ）。
- **Watcher 本体の削除**: `scripts/ai-factory/`、運用ガイドと現行仕様の文書、`package.json` の `factory:*`、`vitest.config.ts` の対象指定を消す。写しの削除とは別の PR で行い、互いに依存しない。
- **ADR-007 の削除順序を変える**: ADR-007（Claude 版 factory）は「Claude 版が実 Issue で動いた後に Codex 資産を削除する」と定めている。これを改め、Claude 版の実運用を待たず、先に削除する。
- **`agent:*` ラベルは残す**: Claude 版（ADR-007）が同じラベルを使う。削除の対象にしない。
- **復元方法**: 削除前の develop の先頭にタグ `codex-factory-last` を打った。戻すときは `git checkout codex-factory-last -- <path>` を使う。ただし、`package.json` の `factory:*` 5 件、`vitest.config.ts` の include の 1 行、`docs/README.md` の 2 行は、ほかの変更と混ざるので、丸ごとは戻さず、Watcher 削除 PR の差分を参照して手で戻す。`watcher.test.ts` には `.codex/agents/pr-verifier.toml` を読むテストが 1 件あるので、写しの削除 PR で消した `.codex` も一緒に戻す。
- **他のエージェント向けの対応は、必要になったときに別途行う**: Codex 以外のエージェントが `.claude/skills/` と同じ内容を必要とした場合の対応（リンク化など）は、今回は決めない。

## 理由

- Codex は未契約で、Watcher も写しも動かして確かめられない。
- Watcher は約 12,000 行（テストを含む）で、テスト 240 件（`npx vitest run` の件数）とともに format、lint、vitest、doc-links の対象に残り続ける。Watcher と写しを合わせると、削除するのは約 17,000 行である。
- 写しは、skill・hook・`pr-verifier` を直すたびに二重に更新する必要がある。同期を確かめる仕組みがなく、内容がすでにずれていた（#404）。
- Watcher は 2026-10-17 以降、変更されていない。

## 代替案

### Claude 版の実運用を待ってから Watcher を消す（不採用）

ADR-007 の順序どおりだが、動かせない約 12,000 行が、Claude 版の完了まで残る。Claude 版は `scripts/factory/` に別実装を持ち、Watcher とコードを共有していない。共有するのは `agent:*` ラベルだけなので、先に消しても Claude 版は壊れない。

### `.agents/skills/` を実体にして `.claude/skills` をリンクにする（今回は見送り）

Claude Code はディレクトリのリンクを辿れると確かめた。ただし、`.agents/skills/` を読むエージェントが他にいるかを確かめていない。必要になってから別の PR で行う。

## 結果

- ADR-009 と ADR-010 の「`.claude/skills/` と `.agents/skills/` の両方に置く」は、この ADR で取りやめた。両 ADR の本文には、取りやめたことを追記した（決定は覆さず、補足とした）。
- #404（写しのずれ）は、写しの削除 PR のマージ後に、写しをやめたことを理由に閉じる。
- #382（Codex 資産の削除）は、Watcher 本体の削除 PR のマージ後に閉じる。
- 次の作業は、リポジトリ外で、オーナーが手で行う。
  - Mac の LaunchAgent（`com.kazuma-lab.fishing-conditions-ai-factory.plist`）の削除
  - Watcher の状態ディレクトリ（`~/Library/Application Support/FishingConditionsApp/ai-factory/`）の削除
  - `~/.codex` の扱いの判断
  - GitHub のラベル `agent:recovery` と `agent:test` の削除（Claude 版は使わない。任意）
- Claude 版 factory（ローカルの `feat/claude-ai-factory`）は、この ADR の対象外で、変更していない。ADR-007 にある「旧 Watcher を止める」の記述は、Claude 版の昇格時に直す。

## 補足: 番号と、この決定を見直すべきタイミング

- ADR の番号は、007 を AI factory（Claude 版）、008 を signup のレート制限に予約している。009・010 は使用済みなので、この ADR は 011 とした。

- Codex を契約し、factory として使いたくなったとき。`codex-factory-last` から復元できる。
- Codex 以外のエージェントが、`.agents/skills/` などの置き場所を必要としたとき。（追記: Antigravity の併用に合わせ、[ADR-013](./013-multi-agent-customizations.md) で `.agents/` を正本・`.claude/` をリンク等にする構成へ切り替えた）
