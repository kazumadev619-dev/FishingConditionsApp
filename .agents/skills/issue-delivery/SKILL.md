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

AGENTS.md の禁止事項を守る。

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

### まず OCR（delegate モード）で diff を一通り読む

PR を出す前に、自分で open-code-review の delegate レビューをかける（手順は CLAUDE.md / AGENTS.md の「コードレビュー」）。API キーは要らない。

```bash
ocr delegate preview --format json --from origin/develop --to HEAD
ocr delegate rule --format json <reviewable_files のパス...>
```

- `reviewable_files` を全部 reviewed か skipped（理由つき）にする。狙いは**見落としたファイルを作らない**こと
- Critical/High は PR 前に直す。確信が持てない指摘は直さずに、次の pr-verifier に「確かめてほしい点」として渡す
- OCR は diff を読むだけで何も実行しない。**これで pr-verifier を省略しない**

### レビューは `pr-verifier` agent に worktree 隔離で投げる

守るべきルール（コミットしない、推測で指摘しない、秘密を出さない、報告の形）は `.codex/agents/pr-verifier.toml` に書いてある。Codex の subagent は親の cwd を共有するため、呼び出し側が先に `mcp__codex_app__create_worktree` でレビュー専用の worktree を作る。返された workspace の**絶対パス**、PR 番号、本文の主張、重点観点の4つを `collaboration.spawn_agent` の `agent_type: "pr-verifier"` に渡す。

依頼には「各コマンドの実行ディレクトリを専用検証 worktree の絶対パスに明示する。開始時に `pwd -P` がそのパスと一致し、`git rev-parse --path-format=absolute --git-dir --git-common-dir` の2行が異なることを確認する。どちらかを確認できなければ `git checkout`・`npm ci`・変異の注入をせず読み取りレビューへ切り替える」と明記する。worktree の作成だけでは subagent の cwd は変わらない。

- **主張は番号付きで列挙する。** agent は報告の「PR 本文の主張の検証」で1つずつ判定を返す。自分の PR 本文の誤りや過少な記述はここで見つかる
- レビュアーは変異の注入や依存の入れ替えでファイルを書き換えるため、親が作業中の worktree を検証先に渡さない
- 角度を変えて2本投げると噛み合う（例: セキュリティ + 型/テスト品質、インフラ + アーキテクチャ）。並行レビューでは reviewer ごとに専用 worktree を作る

`pr-verifier` が選べないとき（agent 定義を足したばかりのセッション、定義がまだ develop に無いブランチにいるときなど）は、`default` に「最初に `.codex/agents/pr-verifier.toml` を Read し、`developer_instructions` に従う」と指示して投げる。**Bash を持たない agent には投げない。** `git fetch` もできず、推論だけのレポートが返ってくる。

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

**以下は commitlint 21.2.3 での実測。** 20 系とは一部違う（PR #183 で 21 に上げたとき、実コミット 229 件を両版に通して差分を取った）。

**本文の段落の途中の行に裸の `#123` を書くと、その行から footer 扱いされて `footer-leading-blank` で落ちる。**

```
NG: ...レートリミットで落ちる。
    PR #156 の CI で実際に踏んだ。      ← この行が footer 扱い

OK: PR（#156）の CI で実際に踏んだ。   ← 全角括弧で囲む
OK: 段落の1行目に置く
```

回避策は 20 / 21 のどちらでも変わらないが、**判定そのものは 21 で変わった**。とくに 21 では `#123` の直後が句読点や日本語でも footer 扱いになる（20 では通っていた）。

| 本文の段落途中に書いたもの | 20.5.3 | 21.2.3 |
|---|---|---|
| `PR（#156）の CI で踏んだ。`（全角括弧） | 通る | 通る |
| `#156 の CI で踏んだ。`（段落の1行目） | 通る | 通る |
| `PR #156 の CI で踏んだ。` | 落ちる | 落ちる |
| `PR (#156) の CI で踏んだ。`（半角括弧） | 落ちる | **通る** |
| `PR #156。` / `PR #156.` / `PR #156、` / `PR #156の CI。` | 通る | **落ちる** |

**21 から、本文の行頭に `word: `（ASCII の語 + コロン + 半角スペース）を書くと、その行が footer 扱いになる。** 推移的依存の `conventional-commits-parser` が 6 → 7 で行頭のこの形を footer トークンとして拾うようになったため。**上流の 21.0.0 の破壊的変更一覧には載っていない。**

```
NG: target: migrator を使う migrator サービスを追加し、   ← 行頭が `target: `

OK: `target: migrator` を使う migrator サービスを追加し、 ← バッククォートで囲む
OK: 設定の target: migrator を使う                       ← 行頭に語を足す
OK: - postgres: 既定パスワードのまま                     ← 箇条書きの `- ` が付けば対象外
OK: 日本語: 値                                           ← 行頭が非 ASCII なら対象外
```

過去のコミット `3e527dc0dc02` が実際に該当し、20 では通るが 21 では落ちる。**この非互換は CI では検知できない**（ワークフローに commitlint を回すステップは無く、実行経路は `.husky/commit-msg` だけ）。

**本文に `:word:` の形のトークンを書くと gitmoji コードとして検証され、実在しないコードだと `start-with-gitmoji` に落ちる。** 実測（この表は 20 / 21 で変化なし）:

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

`.env` などを git add しない話は `github-push-pr` と AGENTS.md にあるので、ここでは重複させない。加えて:

- `sops` を Claude Code の `!` から実行しない（TTY が無くエディタが異常終了し、復号内容が会話ログへ出る。2026-09-12 に実際に事故った）
- 秘密の値をコマンドラインに渡さない。`npx dotenv -e .env.local -- <cmd>` の形を使う
- サブエージェントにも同じ制約を明示する（レビュアーが `.env.local` の中身を出力してしまったことがある）
- 上のうち機械的に見分けられるものは、PreToolUse hook（`.codex/hooks/secret_guard.py`）が Bash / Read / Grep の前に止める。止められたら書き方を変えて通そうとせず、値を出さない方法に切り替える。hook はうっかりを防ぐ網で、すべては見分けられない
