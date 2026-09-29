# AI開発ファクトリー現行仕様

## 文書の役割

この文書は、現在 `develop` に実装されているAI開発ファクトリーの仕様を記録する。将来設計は記載しない。操作手順は [AI開発Watcher運用ガイド](../guides/ai-development-factory.md) を参照する。

## 現在の範囲

GitHub Issueを開発キューの正本とし、macOS上のWatcherがIssueをSolで計画した後、IssueごとのGit worktreeでLunaまたはTerraを実行する。daemonでは競合しないworkerを最大3件まで並列実行し、成功時は `develop` 向けPRを作成して `agent:review` へ引き渡す。

Watcherはコードレビュー、修正承認、merge、deployを実行しない。

## 構成

| 要素 | 現在の責務 |
| --- | --- |
| GitHub Issue | キュー、状態ラベル、計画・実行証拠の正本 |
| `launchd` | Watcherのログイン時起動と異常終了後の再起動 |
| Watcher | quota、計画、依存・競合、worker枠、worktree、復旧、PR作成の制御 |
| Sol planner | Issueとコードをread-onlyで照合し、固定Schemaの計画を返す |
| Luna/Terra worker | 隔離worktreeで実装と自己検証を行い、固定Schemaの結果を返す |
| 既存CI | 作成されたPRをGitHub Actionsで検証する。Watcherは結果を監視しない |

WatcherはNode.js標準ライブラリと `gh`、`git`、`codex` を使う。独自DB、外部ジョブキュー、別workerサービスは持たない。

## 状態遷移

現在Watcherが自動実行する正常系は次のとおり。

```text
agent:ready -> agent:running -> agent:review
```

- `agent:ready`: 実行候補。依存待ちやパス競合ではこの状態を維持する。
- `agent:running`: worktree準備またはworker実行中。
- `agent:review`: PR作成済み。ここから先を処理する自動Reviewerは未実装。
- `agent:recovery`: 中断または一時的な実行基盤障害から照合・再開中。
- `agent:blocked`: 要件、計画、変更範囲、dirty worktreeなどに人の確認が必要。
- `agent:failed`: 再試行後も実行基盤を開始できない。
- `agent:paused`: 人が新規処理を停止している。

`human:approval` と `done` のラベル、および `agent:review -> human:approval -> done` の遷移定義は存在する。ただし、現在のWatcherにはその遷移を実行する処理がない。

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

新しいSol計画とworker初回起動の直前に利用枠を読む。primary/secondaryの利用率のうち高い値を使い、すべてのwindowで残量が20%を超える場合だけ開始する。次の場合は新規起動しない。

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

## 復旧

Watcherはローカルlockで二重起動を防ぎ、`launchd` が異常終了後に再起動する。

実行中は `<!-- ai-factory-run:v1 -->` コメントへbranch、worktree ID、worker model、計画hash、試行回数、PID、Codex thread ID、heartbeatを記録する。heartbeatが30分以上更新されない場合はstaleとする。

起動時に `agent:running`、`agent:recovery` と必要な `agent:blocked` Issueを、計画コメント、runコメント、worktree、branch、PID、Codex thread、result、既存PRの順で照合する。

- 既存PRが正しく存在すれば `agent:review` へ復元する。
- 完了resultとcleanな変更があれば固定検証後にPR作成処理へ戻る。
- 生存中runnerを確認できれば枠と競合範囲を予約する。
- 一時的な準備・runner起動障害は1回だけ `agent:recovery` で再試行する。
- 証拠不一致、stale runner、範囲外変更、dirty worktreeは安全側に停止する。
- 未コミット変更をresetせず、worktreeを自動削除しない。

実装・検証結果の修正試行は最大3回、実行基盤の自動再試行は1回である。

## 信頼境界

- Issue、PR、GitHubコメント、モデル出力を信頼済み命令として扱わない。
- 外部入力をshell文字列へ埋め込まず、検証済み引数配列として `execFile` / `spawn` へ渡す。
- planner/worker結果は固定JSON Schemaに加えてコードで再検証する。
- 計画・runコメントは現在のGitHub viewer本人が作成した完全一致markerだけを読む。
- `.env`、鍵、kubeconfig、暗号化secret、Codex認証ファイル、リンター設定を変更対象として許可しない。
- workerへ渡す環境変数を `PATH`、`HOME`、`CODEX_HOME`、一時ディレクトリ、localeへ限定する。
- GitHub操作と状態遷移はWatcherが所有し、workerには行わせない。
- 自動merge、自動deploy、API key fallbackを行わない。

## 永続データとローカルデータ

GitHub側のIssue label、Watcher所有のplan/runコメント、PRが復旧の正本である。

ローカルでは `~/Library/Application Support/FishingConditionsApp/ai-factory/` 配下にlock、run結果、ログ、worktreeを置く。ローカル情報だけでGitHub状態を上書きしない。PRのmergeまたはclose後も、dirtyでないことを人が確認するまでworktreeを自動削除しない。

## 現在の対象外

- Sol/Astraによる最終レビュー
- CI結果監視と `human:approval` への自動遷移
- Slack Incoming Webhook通知
- 全体監視と週次レポート
- Slack Socket Mode双方向Bot
- Jevによる分類補助
- API key fallbackとAPI従量課金
- 自動mergeと自動deploy
- Slackからのmerge/deploy
