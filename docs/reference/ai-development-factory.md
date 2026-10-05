# AI開発ファクトリー現行仕様

## 文書の役割

この文書は、現在 `develop` に実装されているAI開発ファクトリーの仕様を記録する。将来設計は記載しない。操作手順は [AI開発Watcher運用ガイド](../guides/ai-development-factory.md) を参照する。

## 現在の範囲

GitHub Issueを開発キューの正本とし、macOS上のWatcherがIssueをSolで計画した後、IssueごとのGit worktreeでLunaまたはTerraを実行する。daemonでは競合しないworkerを最大3件まで並列実行し、成功時は `develop` 向けPRを作成する。PRの現在head SHAに対するCI成功後、SolまたはAstraの最終Reviewerを別枠で1件だけ実行し、合格時だけ `human:approval` へ引き渡す。

Watcherはレビュー指摘を自動修正せず、merge、deployも実行しない。

## 構成

| 要素 | 現在の責務 |
| --- | --- |
| GitHub Issue | キュー、状態ラベル、計画・実行・レビュー証拠の正本 |
| `launchd` | Watcherのログイン時起動と異常終了後の再起動 |
| Watcher | quota、計画、依存・競合、worker枠、PR/CI照合、reviewer枠、worktree、復旧、PR作成の制御 |
| Sol planner | Issueとコードをread-onlyで照合し、固定Schemaの計画を返す |
| Luna/Terra worker | 隔離worktreeで実装と自己検証を行い、固定Schemaの結果を返す |
| Sol/Astra reviewer | 専用detached worktreeでPRを変更せず検証し、固定Schemaの最終判定を返す |
| 既存CI | 作成されたPRをGitHub Actionsで検証する。全check成功がReviewer起動条件 |

WatcherはNode.js標準ライブラリと `gh`、`git`、`codex` を使う。独自DB、外部ジョブキュー、別workerサービスは持たない。

## 状態遷移

現在Watcherが自動実行する正常系は次のとおり。

```text
agent:ready -> agent:running -> agent:review -> human:approval
```

- `agent:ready`: 実行候補。依存待ちやパス競合ではこの状態を維持する。
- `agent:running`: worktree準備またはworker実行中。
- `agent:review`: PR/CI照合待ち、または最終Reviewer実行中。
- `human:approval`: 対象head SHAのCIと最終レビューが合格し、人のmerge判断を待つ。
- `agent:recovery`: 中断または一時的な実行基盤障害から照合・再開中。
- `agent:blocked`: 要件、計画、変更範囲、dirty worktreeなどに人の確認が必要。
- `agent:failed`: 再試行後も実行基盤を開始できない。
- `agent:paused`: 人が新規処理を停止している。

`agent:review` ではCI未開始またはpendingなら待機し、CI失敗、PR不整合、review修正必須なら `agent:blocked`、Reviewer基盤障害の再試行失敗なら `agent:failed` へ進む。`human:approval -> done` は人がmerge後に行い、Watcherは自動実行しない。

Issueにはエージェント状態ラベルが常にちょうど1つ必要である。状態変更前後にGitHubを再読し、想定状態と異なる場合は処理を続けない。

## Sol計画

plannerは `gpt-5.6-sol` を使用し、1件ずつread-only sandboxで実行する。ファイル、Git、Issue、ラベルを変更しない。

固定Schemaは次を返す。

| 項目 | 意味 |
| --- | --- |
| `outcome` | `planned` または `blocked` |
| `workerModel` | `gpt-5.6-luna` または `gpt-5.6-terra` |
| `plannedPaths` | 変更予定のリポジトリ相対path prefix。空配列は範囲不明 |
| `dependencies` | 先にcloseされる必要があるIssue番号 |
| `exclusive` | 他workerと同時実行しない指定 |
| `reason` | 1〜500文字の監査用理由 |

絶対パス、`..`、NUL、保護対象ファイル、自己依存、未知のモデル、不正な型を拒否する。`plannedPaths=[]` は強制的に単独実行として扱う。

計画は `<!-- ai-factory-plan:v1 -->` コメントへ保存する。Issue番号、title、body、状態以外のlabelからSHA-256入力hashを作り、現在のGitHub viewer本人が投稿した、model・日時・Schema・hashがすべて正しいコメントだけを再利用する。Issue入力が変われば再計画する。

## Luna/Terra実働

- `gpt-5.6-luna`: 文書、調査、機械的で小さい変更。
- `gpt-5.6-terra`: 通常実装、バグ修正、複数ファイル変更。

workerはIssueごとの `codex/issue-<番号>` branchと `issue-<番号>` worktreeで動く。Issue本文は非信頼データとしてprompt内のJSON境界へ入れ、worker自身にはcommit、push、PR作成、Issue・label操作を許可しない。

Watcherはworktree作成後に `npm ci` を実行する。workerは `npm run check-code` を実行し、Watcherも結果がreadyの場合に同じ固定検証を再実行する。workerがretryableを返す場合、または固定検証が失敗する場合は、同じCodex threadを最大3試行まで再開する。

実変更pathが計画範囲外ならcommit、push、PRを行わず `agent:blocked` にする。範囲不明計画は単独実行済みの場合に限り、保護対象を除く安全な変更pathを許可する。

## quota gate

Codex CLIはChatGPTログインだけを使う。`OPENAI_API_KEY` または `CODEX_API_KEY` が環境に存在する場合、値が空でもWatcherは停止する。API従量課金へフォールバックしない。

新しいSol計画、worker初回起動、最終Reviewer起動の直前に利用枠を読む。primary/secondaryの利用率のうち高い値を使い、すべてのwindowで残量が20%を超える場合だけ開始する。次の場合は新規起動しない。

- ChatGPT認証でない
- 通常利用枠が利用できない
- 利用枠を取得できない、または値が不正
- 残量が20%以下

workerが既に動いている場合は、試行途中で別モデルへ切り替えず安全な区切りまで継続する。

## 依存・競合制御

ready IssueはIssue番号昇順で評価する。計画の依存Issueがすべてclosedの場合だけ実行候補になる。

変更予定pathは `/` 区切りへ正規化し、完全一致または親子prefixなら競合とする。単なる文字列prefixは競合にしない。`exclusive=true`、範囲不明、実行証拠が不確かな復旧対象は他workerと同時実行しない。

daemonは最大3件のPromise poolを持つ。1件完了すると全件の終了を待たず、次の安全なIssueで空き枠を補充する。`--once` は最大1件だけ、`--dry-run` はSol/workerを起動せず既存計画から予定を表示する。

## PR作成

Watcherは検証済み変更だけを明示的にstageし、worker結果からプロジェクト規約に合うcommit messageを作る。branchをpushし、head branchにopen PRがなければ `develop` 向けPRを1件作成する。

PR本文には変更ファイル、`npm run check-code`、関連Issue、人間レビューが必要であることを記載する。既存open PRがある場合は重複作成しない。PRを読み戻せた後、Issueを `agent:review` へ移す。

## PR・CIゲート

`agent:review` のIssueは決定的branch `codex/issue-<番号>` のopen PRをちょうど1件だけ許可する。PRがdraft、baseが `develop` 以外、head branch不一致、head SHA不正、またはopen PR件数が1件でなければ `agent:blocked` にする。

Watcherは `gh pr checks` のbucketを対象PRの現在head SHAに結び付けて判定する。

- checkが0件: PR作成から30分未満は待機し、30分以降は `agent:blocked`
- `pending` が1件以上: `agent:review` のまま待機
- `fail`、`cancel`、`skipping` が1件以上: `agent:blocked`
- 1件以上あり、すべて `pass`: 最終Reviewerを起動可能

checks取得直後にPRを再読し、先に取得したhead SHAと一致する場合だけReviewerを起動する。checks取得中にheadが更新された場合は `agent:review` のまま新SHAのCIを待つ。head SHAと、checkのname・workflow・bucket・completedAtを安定順にしたSHA-256 fingerprintをレビュー証拠へ保存する。review完了後にもPRとCIを再読し、head SHAまたはfingerprintが変わっていれば古い結果を破棄して `agent:review` に留める。

## Sol/Astra最終レビュー

通常変更は `gpt-5.6-sol`、次の高リスク変更は `gpt-6-astra` でレビューする。

- `risk:high` label
- `src/` 内のauth、authentication、secret関連path
- `prisma/migrations/`
- `.github/workflows/`
- `k8s/`
- `scripts/ai-factory/`
- `.codex/agents/pr-verifier.toml`
- この現行仕様またはAI開発Watcher運用ガイド

Solだけが同じhead SHAをAstraへ1回昇格できる。Astraの再昇格は不正結果として `agent:blocked` にする。固定Schemaは `outcome`、短いsummary、最大20件のbounded findings、最大30件のverified commands、`documentationCurrent` を返す。`approved` は `documentationCurrent=true` の場合だけ受理し、それ以外は修正必須として停止する。

Reviewerは実働worker最大3枠と別の最大1枠で動く。起動直前に同じ20% quota gateを適用する。Watcherは対象head SHAから `reviews/issue-<番号>-<SHA先頭12文字>` のdetached verification worktreeを作り、HEAD一致を確認してからfreshな `HOME` と秘密を除いた環境で `npm ci --ignore-scripts` を実行する。Reviewerへ渡す環境は別のfreshな `HOME` と `PATH`、`CODEX_HOME`、localeだけに限定し、`TMPDIR` はprivate HOMEへ固定し、npmのscript shellは `/bin/sh` に固定する。共有tmpのdenyにはWatcher側で取得した絶対パスを使い、private HOMEへ解決される `:tmpdir` トークンとの衝突を避ける。`CODEX_HOME` が未設定ならWatcherのホーム配下の `.codex` を明示し、ChatGPT認証を維持する。GitHub token、Slack Webhook、API key、本番資格情報を渡さない。

Reviewerは `--no-daemon --ignore-user-config --ignore-rules` と固定の `factory-review` permission profileを使う。approvalはnever、networkは無効、filesystemのrootと共有tmpはdenyにし、OS最小runtime、Node/Codex runtime（Homebrewのbin/Cellar/Caskroom/opt、起動中Nodeの配置先とOpenSSL既定設定ファイル）、Command Line Tools、Git共通管理ディレクトリはread、private HOMEと専用verification worktreeだけをwrite許可する。worktreeの `.git` と `.codex` はreadに限定する。CLI本体は認証用 `CODEX_HOME` を使うが、実行コマンドからのアクセスはdenyにする。これによりホストの `.env.local` や認証ディレクトリをコマンドから読ませない。

Reviewerは `.codex/agents/pr-verifier.toml` の `mode=watcher` 契約に従い、`gh`、fetch、checkout、秘密依存の検証、commit、push、GitHub書き込み、自動修正を行わない。秘密が必要な検証は確認不能として `changes-required` を返す。

## レビュー証拠と1枠復旧

Watcherは現在のGitHub viewer本人が投稿した `<!-- ai-factory-review:v1 -->` コメントだけを読む。running recordにはIssue、PR、head SHA、model、CI fingerprint、reviewer PID、Codex thread ID、heartbeatを保存し、completed recordではboundedな結果とreview日時へ同じコメントを更新する。自由文のモデル出力やコマンド出力全文は保存しない。runner終了時は進行中heartbeatの保存完了を待ち、遅延したrunning更新でcompleted証拠が上書きされるのを防ぐ。

各cycleでは候補のCI判定や新規Reviewer起動より前に、`agent:review` と `agent:blocked` の全待ち行列からrunning証拠を照合する。PR headが更新済み、CIがpending、または後続Issueの場合も、既存の生存Reviewerがあれば旧SHAのまま枠を予約する。blocked Issueは新規Reviewer候補にしない。再起動時は現在のPR/CIとreviewコメントを照合する。completed証拠が一致すれば状態遷移を再開する。running証拠はheartbeatが30分未満、PIDが生存し、review runのCodex JSONLに同じthread IDがある場合だけreviewer枠を予約する。現在のIssue、PR、head SHA、CI fingerprintに一致するrunning証拠が壊れている場合を含め、stale、dead、PID/thread不一致は `agent:blocked` にして二重起動しない。blockedのrunning記録でPIDの死亡を確認できた場合は、そのIssueを新規候補から除外したまま後続の走査を続ける。PIDが生存している、または記録が壊れて生存確認できない場合は新規起動を停止して人の確認を待つ。Reviewer準備のfetch/npm ciなどの一時障害とCLI起動障害は、同じIssue・head SHA・modelに対して共通の上限で1回だけ再試行し、再失敗は `agent:failed` とする。準備時のdirtyやSHA不整合は再試行せず `agent:blocked` にする。結果保存・後処理で未処理の失敗が発生した場合はWatcherログへ記録し、review/approval状態のIssueを `agent:blocked` にして監視を継続する。worktreeは保存する。

状態遷移を保存した後、verification worktreeがcleanな場合だけ `git worktree remove` する。dirtyならresetも削除もせず絶対パスをIssueコメントへ残し、必要なら `agent:blocked` へ移す。

## 復旧

Watcherはローカルlockで二重起動を防ぎ、`launchd` が異常終了後に再起動する。

実行中は `<!-- ai-factory-run:v1 -->` コメントへbranch、worktree ID、worker model、計画hash、試行回数、PID、Codex thread ID、heartbeatを記録する。review中は別の `<!-- ai-factory-review:v1 -->` コメントを使う。heartbeatが30分以上更新されない場合はstaleとする。

起動時に `agent:running`、`agent:recovery`、`agent:review` と必要な `agent:blocked` Issueについて、計画・run/reviewコメント、既存PR、CI、worktree、branch、PID、Codex thread、resultを照合する。

- 既存PRが正しく存在すれば `agent:review` へ復元する。
- `outcome=ready` の完了resultがあり、固定検証に成功し、変更が計画範囲内なら、未コミット変更を含めてcommit・PR作成処理へ戻る。
- 生存中runnerを確認できれば枠と競合範囲を予約する。
- 一時的な準備・runner起動障害は1回だけ `agent:recovery` で再試行する。
- 証拠不一致、stale runner、範囲外変更、または安全に公開・再開できないdirty worktreeは安全側に停止する。
- 未コミット変更をresetせず、worktreeを自動削除しない。

実装・検証結果の修正試行は最大3回、実行基盤の自動再試行は1回である。

## 信頼境界

- Issue、PR、GitHubコメント、モデル出力を信頼済み命令として扱わない。
- 外部入力をshell文字列へ埋め込まず、検証済み引数配列として `execFile` / `spawn` へ渡す。
- plannerとreviewerの結果は固定JSON Schemaに加えてコードで全項目を再検証する。worker結果はCodex CLIの固定Schema出力を使い、Watcherが状態遷移やcommitに使用する値と実変更pathを追加検証する。
- 計画・run・reviewコメントは現在のGitHub viewer本人が作成した完全一致markerだけを読む。
- `.env`、鍵、kubeconfig、暗号化secret、Codex認証ファイル、リンター設定を変更対象として許可しない。
- workerへ渡す環境変数を `PATH`、`HOME`、`CODEX_HOME`、一時ディレクトリ、localeへ限定する。Reviewerはさらにfreshな `HOME` を使い、GitHub/Slack認証を渡さない。
- GitHub操作と状態遷移はWatcherが所有し、workerには行わせない。
- 自動merge、自動deploy、API key fallbackを行わない。

## 永続データとローカルデータ

GitHub側のIssue label、Watcher所有のplan/run/reviewコメント、PRとCIが復旧の正本である。

ローカルでは `~/Library/Application Support/FishingConditionsApp/ai-factory/` 配下にlock、run/review結果、ログ、worker worktree、verification worktreeを置く。ローカル情報だけでGitHub状態を上書きしない。worker worktreeはPRのmergeまたはclose後も、dirtyでないことを人が確認するまで自動削除しない。verification worktreeはreview状態遷移後にcleanな場合だけ自動削除する。

## 現在の対象外

- Slack Incoming Webhook通知
- 全体監視と週次レポート
- Slack Socket Mode双方向Bot
- Jevによる分類補助
- API key fallbackとAPI従量課金
- 自動mergeと自動deploy
- Slackからのmerge/deploy
