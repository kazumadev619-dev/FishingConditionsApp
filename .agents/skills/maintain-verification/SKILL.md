---
name: maintain-verification
description: アプリや仕様の変更後に、仕様の正（docs/reference/）、検証スキル（run-app-locally 等）、E2E/スモーク手順（scripts/e2e/）が現状のコードとズレていないか定期点検するときに使う。週次・夜間メンテナンス、仕様と実装の突合、検証手順の鮮度確認、ドキュメントドリフト検知、maintain-verification、といった場面。
---

# maintain-verification

> **参考元:** [pstack `maintain-verification-skill`](https://github.com/cursor/plugins/tree/main/pstack/skills/maintain-verification-skill)

コードが変わった瞬間に、仕様書や検証手順は古くなり始める。このスキルは、**本リポジトリの検証資産と「仕様（正）」を現状のコードと定期的に突き合わせ、ズレを放置しない**ためのメンテナンスループである。

## 守ること（厳格な編集境界）

1. **点検中にプロダクトコード（`src/`、`prisma/`、`k8s/` 等）を編集しない。**
2. **「文書・検証ハーネスのドリフト」と「プロダクトの退行・仕様違反」を絶対に混ぜない。**
   - [ADR-010](../../../docs/adr/010-spec-source-of-truth.md) の通り、`docs/reference/` のうち状態が「仕様（正）」の文書と実装が食い違う場合は、**原則として実装の誤り（プロダクト退行）**として扱う。文書を勝手に書き換えて退行を揉み消さない
   - 検証スクリプトや説明文書の明らかなドリフト（例: `run-app-locally/session-cookie.mjs` が読む JWT フィールド名のズレ、死んだファイルリンク、削除済みコマンドの記載）だけを修正対象にする
3. **シークレットを読まない・出さない。**
4. **無人・夜間実行では直接マージしない。** 修正が必要な場合は Draft PR（1 本）または Issue に留める

## 点検対象（このリポジトリの正本資産）

- **仕様（正）4 文書（[ADR-010](../../../docs/adr/010-spec-source-of-truth.md)）**:
  - `docs/reference/scoring-algorithm.md`
  - `docs/reference/authentication.md`
  - `docs/reference/api-error-handling.md`
  - `docs/reference/api-integration.md`
- **索引と説明文書**: `docs/README.md`、`docs/guides/e2e-env.md`
- **検証スキルとハーネス**:
  - `.agents/skills/run-app-locally/SKILL.md`・`session-cookie.mjs`
  - `scripts/e2e/`（`up.sh` / `smoke.sh` / `down.sh` / `session-cookie.mjs`）

## 手順（3 フェーズ）

### フェーズ 1: 索引・リンク衛生（Index Hygiene）

1. `docs/README.md` に列挙された全リンク先が存在するか、逆に `docs/guides/`・`docs/reference/`・`docs/adr/`・`docs/perf/` に索引漏れのファイルが無いかを確認する
2. `docs/reference/` 各文書の冒頭メタデータ（`状態`、`対応する実装`、`最終確認`）を確認し、「対応する実装」に書かれたファイルパスが実在するか確かめる
3. `.agents/skills/run-app-locally/SKILL.md` と `session-cookie.mjs` が前提としている認証項目（`src/auth/callbacks/jwtCallback.ts`・`sessionCallback.ts` 等）やコマンド名（`package.json`）が現行と一致するか確認する

### フェーズ 2: ソース突合（Source Wave）

対象を機能・仕様書単位に分けて（サブエージェントが使えるなら読み取り専用で並列分担し）、**文書と対応する実装ファイルを 1 項目ずつ照合**する。

- 仕様（正）4 文書について、しきい値・ステータスコード・許可リスト・リトライ条件・エラーコードが実装と一致しているか
- 食い違いを見つけたら、**git log / 関連 PR で「意図的な仕様変更の文書更新漏れ」か「実装の誤り・退行」か**を裏取りする。判断がつかないものは勝手に決めず「要確認」に分類する

### フェーズ 3: ライブ検証（Live Drive）

Docker やローカル環境が使える場合は、検証ハーネス自体が今も壊れていないことを実行して確かめる。

- worktree 隔離の E2E 環境（[ADR-012](../../../docs/adr/012-e2e-dev-env-per-worktree.md)）:
  ```bash
  npm run e2e:up && npm run e2e:smoke
  # 必要なら: npm run test:e2e
  npm run e2e:down
  ```
- ライブ検証ができない環境（Docker 停止中・サンドボックス制限など）では、推測で「OK」と書かず、未実行の理由とともに `blocked` または未確認範囲として明記する

## 終了ステータス（3 択）

点検の結論は必ず次のいずれか 1 つで返す。

| ステータス | 条件 | 次のアクション |
|---|---|---|
| **`clean`** | ドリフトなし・退行なし・ライブ検証通過 | PR 不要。報告のみ |
| **`changed`** | 検証ハーネス・リンク・説明文書のドリフトのみを検知（退行なし） | 検証資産の修正を 1 本の Draft PR / 変更案にまとめる（仕様（正）の更新はオーナー確認を添える） |
| **`blocked`** | プロダクト退行（仕様違反）を検知、または検証を安全に完走できなかった | 退行は再現手順・該当箇所を添えて Issue 化または即報告。未完走ならブロッカーを明記 |

## 出力の形（固定）

```markdown
## maintain-verification 結果: <clean / changed / blocked>

### 1. 索引・リンク衛生
- <確認結果・不備があれば一覧>

### 2. 仕様（正）と実装の突合
| 文書 | 状態 | 食い違い・所見 | 分類（ドリフト / 退行 / 要確認） |
|---|---|---|---|

### 3. ライブ検証
- 実行したコマンドと結果（未実行なら理由）

### 4. 次のアクション
- <clean なら「なし」。changed なら修正対象。blocked なら退行 Issue 案 / 解消条件>
```
