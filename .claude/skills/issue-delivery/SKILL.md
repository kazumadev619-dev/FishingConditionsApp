---
name: issue-delivery
description: GitHub issue を1本ずつ仕上げて本番まで届けるスキル。ユーザーが「次のissueをやろう」「他に対応すべきissueはある？」「#123を進めて」「並行して動かせるissueはある？」「本番に出して」「リリースして」「main にマージして」などと言ったとき、または issue を選ぶ・実装する・レビューさせる・develop から main へ昇格させるときに使う。commit/push/PR の書式そのものは github-push-pr スキルに従う。
---

# Issue を仕上げて本番へ届ける

このスキルは「issue を選ぶ → 前提を検証する → 実装する → 実証する → レビューさせる → 昇格させる」の流れを扱う。
コミット書式・PR テンプレートの詳細は **`github-push-pr` スキル**に従うこと。ここでは重複を書かない。

## ステップ0: issue の前提を疑う（最重要）

**issue の本文は書かれた時点のスナップショットで、古くなっている。実装を始める前に必ず現状と突き合わせる。**

実例:

- #110「`npm outdated` が 50 パッケージ」→ 実際は 30 件。P1 として挙がっていた項目の多くが既に済んでいた
- #110「目標は `next 16.3.0`」→ 16.3.0 も脆弱性の対象範囲内で、そのまま上げても解消しなかった
- #129「リポジトリに既存のテスト基盤が無い。テストランナーの導入から必要」→ 別チケットで Vitest が既に入っており、CI でも走っていた

やること:

1. issue 本文の主張を1つずつコマンドで確認する（`npm outdated` / `grep` / 実際にファイルを読む）
2. ズレていたら**issue にコメントして現状を記録する**。黙って直さない。次に読む人が同じ調査をやり直すことになる
3. 完了条件が現状に合っているかも見る

## ステップ1: 着手順と並行可否を決める

複数を並行して進めるときは、**触るファイルが重ならないこと**を先に確認する。

```bash
# 進行中の PR が触っているファイル
gh pr view <N> --json files --jq '.files[].path'
```

重なっていなければ別ブランチで並行して進められる。重なっていたら順番に片付ける。

優先の考え方:

- 本番に実害が出ているもの（P0）が最優先
- セキュリティ負債（P1）は「実際の露出」を調べてから優先度を判断する。advisory の深刻度だけで慌てない
- 依存更新のような広く影響するものは、**回帰テストを整えてから**やる

## ステップ2: 実装

CLAUDE.md の禁止事項を守る。

- `@ts-ignore` / 空 catch 禁止（根本原因を修正する）
- リンター設定ファイル（`biome.json` / `.oxlintrc.json` / `eslint.config.*`）の直接編集禁止。直す必要があるならユーザーに方針を確認する
- 関連が薄く見えるエラーの放置禁止（対処するか、理由を明示して記録する）
- **テストを通すためだけのテスト改変禁止（実装の誤りを疑う）**。ステップ3の変異テストで落ちたときに一番効く

**スコープを勝手に広げない。** 作業中に見つけた無関係な問題は、このブランチに混ぜず別 issue にする（ステップ5参照）。

## ステップ3: 実証する

**「型チェックとビルドが通った」は検証ではない。壊れることを確かめて初めて検証になる。**

### 回帰テストや CI ガードを書いたとき: 変異テスト

テストが本当に退行を検知できるかは、**実装を壊して落ちることを確認する**まで分からない。

**REQUIRED SUB-SKILL:** `mutation-test` を使う。手でファイルを書き換えて戻さない（置換の空振り、抜き出しの途中切れ、戻し忘れをスクリプトが止める）。

レビュー指摘でテストを足したら、**変異テストをやり直す。**

### インフラを変えたとき: 実際に動かす

`deploy.yml` は PR では走らない（`push: branches: [main]` と `workflow_dispatch` のみ）。**本番が初回テストになる変更は、ローカルで実行して確かめる。**

```bash
# ワークフローの run: の中身を切り出して、ランナー相当の環境でそのまま流す。
# deploy ジョブは runs-on: ubuntu-latest（amd64）、build ジョブは
# ubuntu-24.04-arm なので、再現したい方に --platform を合わせる
SCRATCH=$(mktemp -d)
cat > "$SCRATCH/step.sh" <<'SH'
set -euo pipefail
# ここにワークフローの run: の中身を貼る
SH
docker run --rm --platform linux/amd64 \
  -v "$SCRATCH":/scratch:ro -v "$PWD":/repo:ro ubuntu:24.04 bash /scratch/step.sh
```

k8s マニフェストは `develop` との**レンダリング差分**を取る。意図した行だけが変わっていることを示す。

```bash
kustomize build k8s/ > /tmp/new.yaml
git stash -u && git checkout develop
kustomize build k8s/ > /tmp/old.yaml
git checkout - && git stash pop
diff /tmp/old.yaml /tmp/new.yaml
```

### 依存を更新したとき

- `package-lock.json` の差分に説明できない変化が無いか（新規の install script、レジストリ外の `resolved`、推移的なメジャーバンプ）
- 実イメージを起動してスモーク（`/healthz` `/readyz` と、認証が要るなら 401 が返ること）
- CHANGELOG を実際に読む。「マイナーだから安全なはず」は根拠にならない

### 外部の主張は自分で確かめる

advisory の影響範囲もライブラリの挙動も、**自分でコマンドを流して裏を取ってから報告する。**「メジャーじゃないから安全なはず」は根拠にならない。

## ステップ4: PR とレビュー

PR の作り方は `github-push-pr` スキルに従う。加えて:

### develop へのマージでは issue は閉じない

GitHub が自動クローズするのは**デフォルトブランチ（main）にマージされたとき**だけ。`develop` 向け PR に `Closes #N` と書いても何も起きない。

- **develop 向け PR**: `github-push-pr` の PR テンプレートは `## 関連Issue` に `closes #N` を書かせるが、develop 向けでは効かないので `Refs #N` にして、本文に「次の main 昇格 PR で `Closes #N` を付ける」と明記する。issue の一部だけを扱う PR なら「この PR では閉じない」と書く（ステップ6で `Closes` と `Refs` を分けるときの手がかりになる）
- **main 昇格 PR**: ステップ6の手順で書く

### レビューは `pr-verifier` agent に worktree 隔離で投げる

守るべきルール（コミットしない、推測で指摘しない、秘密を出さない、報告の形）は `.claude/agents/pr-verifier.md` に書いてある。呼ぶ側が渡すのは次の3つだけ。

```
Agent(
  subagent_type: "pr-verifier",
  isolation: "worktree",
  prompt: "PR #<N>。本文で主張していること: 1) ... 2) ...。重点的に見てほしい観点: ...",
)
```

- **主張は番号付きで列挙する。** agent は報告の「PR 本文の主張の検証」で1つずつ判定を返す。自分の PR 本文の誤りや過少な記述はここで見つかる
- **`isolation: "worktree"` を付ける。** レビュアーは変異の注入や依存の入れ替えでファイルを書き換える
- 角度を変えて2本投げると噛み合う（例: セキュリティ + 型/テスト品質、インフラ + アーキテクチャ）

`pr-verifier` が選べないとき（agent 定義を足したばかりのセッション、定義がまだ develop に無いブランチにいるときなど）は、`general-purpose` に「最初に `.claude/agents/pr-verifier.md` を Read し、frontmatter より下の本文に従う。使うツールは frontmatter の `tools` だけ」と指示して投げる。**Bash を持たない agent type（例: `everything-claude-code:architect`）には投げない。** `git fetch` もできず、推論だけのレポートが返ってくる。

**レビューが走っている間、本体の作業ツリーのブランチを切り替えない。** agent 定義や skill は作業ツリーのファイルから読まれるので、定義が無いブランチに切り替えると agent type が選べなくなる（切り替えた直後にレビューが停止したことがある。因果は断定できていない）。別のブランチを触る必要があれば、別の worktree で作業する。

```bash
W=$(mktemp -d)/wt
git worktree add "$W" <branch>
(cd "$W" && npm ci)   # husky のフックに要る。--no-verify で飛ばさない
# ... "$W" で編集・コミット・プッシュ
git worktree remove --force "$W"
```

本体の `node_modules` をリンクして `npm ci` を省く手もあるが、**lock ファイルが同じでも本体の `node_modules` が古いことがある**（別ブランチで `npm ci` したまま切り替えていた。lock は prisma 7.10.0 なのに 7.9.1 が入っていた）。リンクするなら先に本体で `npm ci` を流す。

エージェントが走っている間、**同じファイルを触らない**。別 issue を進めるか、衝突しない調査をする。

## ステップ5: 指摘への対応

1. **自分でコマンドを流して裏を取る。** エージェントの報告をそのまま信じない。実際に間違っていることもある
2. 本 PR のスコープ内なら直して、**変異テストをやり直す**
3. スコープ外の発見は**別 issue にする**。本文には再現手順と実際の出力を載せる
4. 直さないと判断した指摘は、**PR にその理由を書く**。黙って無視しない
5. 自分の PR 本文が間違っていた／過少だったら訂正コメントを入れる

## ステップ6: main へ昇格

`develop` に溜まった分をまとめて `main` へ。ここで初めて `Deploy` ワークフローが走る。

### 1. 対象の issue を機械的に列挙する

目で追うと落とす。コミット件名の末尾の番号から拾う（マージコミットは PR 番号が混ざるので除く）。

```bash
git fetch origin
for n in $(git log --no-merges --format=%s origin/main..origin/develop | grep -oE '#[0-9]+$' | tr -d '#' | sort -n -u); do
  gh api "repos/{owner}/{repo}/issues/$n" \
    --jq '"#\(.number)  \(if .pull_request then "PR" else "issue" end)  \(.state)  \(.title)"'
done
```

### 2. 閉じるものと閉じないものを分ける

列挙した issue ごとに、その issue を扱った develop 向け PR の本文を読む。

- PR 本文に「この PR では閉じない」「残りのタスク」「第1弾」と書いてある issue → **`Refs #N`**
- それ以外 → **`Closes #N`**

### 3. PR 本文の先頭をこの形で書く

```
Closes #129
Closes #133

Refs #110（残り: メジャー8件。完了条件が「メジャーは個別 PR」のため開けておく）
```

**番号ごとにキーワードを付ける。** GitHub の公式ドキュメントは「Use full syntax for each issue」（例: `Resolves #10, resolves #123`）としている。`Closes #129 #133` のように1つのキーワードに番号を並べる書き方は規則から外れ、閉じる対象に入らない可能性がある。上のように1行1件で書くのが一番確実。どう認識されたかは次の手順4で確かめる。

```bash
gh pr create --base main --head develop --title "<まとめ> (#129 #133)" --body-file <本文>
```

### 4. マージ前に GitHub の認識を確かめる

```bash
gh pr view <N> --json closingIssuesReferences --jq '[.closingIssuesReferences[].number] | sort'
```

出力が手順2で `Closes` にしたものと一致すること。`Refs` にした番号が入っていたら本文を直す。

### 5. デプロイを見守り、本番で確かめる

```bash
gh run list --workflow=deploy.yml --limit 1
gh run watch <run-id>
```

**デプロイは途中で止めない。** マイグレーション中に中断すると `_prisma_migrations` に failed レコードが残り、以後の `migrate deploy` がすべて止まる。

本番で確かめるもの:

- `/healthz` が `{"status":"ok"}`、`/readyz` が `database` / `cache` ともに `ok`
- 未認証の `/api/ports` が 401
- この昇格に含まれる変更それぞれについて、変わったことが外から見える点（画面、ヘッダ、デプロイログの `configured` / `created` 行など）

最後に手順2で `Closes` にした issue が CLOSED、`Refs` にした issue が OPEN のままであることを確かめる。

## commitlint の落とし穴（github-push-pr に加えて）

**本文の段落の途中の行に裸の `#123` を書くと、その行から footer 扱いされて `footer-leading-blank` で落ちる。**

```
NG: ...レートリミットで落ちる。
    PR #156 の CI で実際に踏んだ。      ← この行が footer 扱い

OK: PR（#156）の CI で実際に踏んだ。   ← 全角括弧で囲む
OK: 段落の1行目に置く
```

半角括弧 `(#123)` では回避できない（実測）。

**本文に `:word:` の形のトークンを書くと gitmoji コードとして検証され、実在しないコードだと `start-with-gitmoji` に落ちる。** 実測:

| 本文に書いたもの | 結果 |
|---|---|
| `:fire:`（実在する gitmoji コード） | 通る |
| `:notacode:` | 落ちる |
| `::`（空のコード扱い） | 落ちる |
| `::error::` を単語として置く | 落ちる |
| `::error::foo`（前後がくっついている） | 通る |

GitHub Actions のアノテーション記法をコミット本文に貼ったときに踏んだ。コード片を本文に入れるときは言い換える。

コミット前に `npx --no-install commitlint < msg.txt` で検証する。**`echo "<msg>" | npx commitlint` ではこの手の落とし穴を検出できない**（1行に潰れるので `subject-empty` など無関係なエラーになる）。ファイルから流し込むこと。

## 秘密情報

`.env` などを git add しない話は `github-push-pr` と CLAUDE.md にあるので、ここでは重複させない。加えて:

- `sops` を Claude Code の `!` から実行しない（TTY が無くエディタが異常終了し、復号内容が会話ログへ出る。2026-09-12 に実際に事故った）
- 秘密の値をコマンドラインに渡さない。`npx dotenv -e .env.local -- <cmd>` の形を使う
- サブエージェントにも同じ制約を明示する（レビュアーが `.env.local` の中身を出力してしまったことがある）
- 上のうち機械的に見分けられるものは、PreToolUse hook（`.claude/hooks/secret_guard.py`）が Bash / Read / Grep の前に止める。止められたら書き方を変えて通そうとせず、値を出さない方法に切り替える。hook はうっかりを防ぐ網で、すべては見分けられない
