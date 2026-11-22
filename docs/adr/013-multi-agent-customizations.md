# ADR-013: `.agents/` を正本とした複数エージェント間のカスタマイズ統合

**日付:** 2026-11-22
**ステータス:** 採用済み

## 決定

Claude Code と Antigravity（および `.agents/` 標準を読む将来のエージェント）でルール・スキル・フック・サブエージェントを二重管理せずに共有するため、`.agents/` と `AGENTS.md` を正本とし、`.claude/` と `CLAUDE.md` はリンクまたは最小限のメタデータのみを持つ構成にする。

- **ルール**: `AGENTS.md` を正本とし、`CLAUDE.md` は `AGENTS.md` への相対シンボリックリンクにする。
- **スキル**: `.agents/skills/` を実体（正本）とし、`.claude/skills` は `../.agents/skills` への相対シンボリックリンクにする（[ADR-011](./011-remove-codex-factory.md) の代替案を採用）。
- **フック**: `.agents/hooks/` を実体とし、`.claude/hooks` は `../.agents/hooks` への相対シンボリックリンクにする。各スクリプト（`secret_guard.py`・`linter_config_guard.py`・`post_edit_check.py`）が Claude Code 形式と Antigravity 形式の入力・出力を両方処理し、`.claude/settings.json` と `.agents/hooks.json` の双方から同じスクリプトを呼ぶ。
- **サブエージェント（`pr-verifier`）**: 検証手順の本体を `.agents/agents/pr-verifier.md` に置き、`.claude/agents/pr-verifier.md` は Claude Code 固有の frontmatter と `.agents/agents/pr-verifier.md` への参照のみを持つ。

## 理由

- [ADR-011](./011-remove-codex-factory.md) で削除した写しの `.agents/skills/` は、同期漏れ（#404）が問題だった。正本を1か所に寄せれば同期の手間とずれを無くせる。
- `.agents/skills.json` で `.claude/skills` を参照する案は Antigravity のみに閉じた仕組みになるため、`.agents/skills/` を標準パスとして実体にする方が他エージェントにも対応しやすい。
- フック判定ロジック（秘密情報ガード、リンター設定ファイル保護、編集後 `oxlint` / `biome`）を共通 Python スクリプトに集約することで、エージェントごとに別実装を持つ必要がなくなる。

## 代替案

### `.agents/skills.json` で `.claude/skills` を参照する（不採用）

`.claude/` の移動は不要だが、Antigravity 以外の `.agents/skills/` を読むエージェントでそのまま使えない。フックや `AGENTS.md` の二重管理解消と合わせて `.agents/` を正本に揃えた。

## 結果

- Claude Code と Antigravity が同じルール・スキル・フックスクリプト・`pr-verifier` 手順を参照する。
- 新しいスキルやフックルールの追加・更新は `.agents/` 側のみで行える。
