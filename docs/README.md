# ドキュメント索引

Fishing Conditions App のドキュメント一覧。目的から探せるように分類している。

## 目的から探す

| 知りたいこと | 読むもの |
|-------------|---------|
| 開発環境を立ち上げたい | [guides/development.md](./guides/development.md) |
| Docker で動かしたい | [guides/docker.md](./guides/docker.md) |
| Kubernetes にデプロイしたい | [../k8s/README.md](../k8s/README.md) |
| CI が落ちた原因を知りたい | [guides/ci-cd.md](./guides/ci-cd.md) |
| システム全体の構成を知りたい | [reference/architecture.md](./reference/architecture.md) |
| 認証の仕組みを知りたい | [reference/authentication.md](./reference/authentication.md) ／ [図解](./reference/authentication-diagrams.md) |
| スコアの計算方法を知りたい | [reference/scoring-algorithm.md](./reference/scoring-algorithm.md) |
| 外部 API の仕様を知りたい | [reference/api-integration.md](./reference/api-integration.md) ／ [Google Maps](./reference/google-maps-api.md) |
| API エラーの扱い方を知りたい | [reference/api-error-handling.md](./reference/api-error-handling.md) |
| なぜこの技術を選んだか知りたい | [adr/](./adr/) |
| 開発の進捗と今後の予定を知りたい | [roadmap.md](./roadmap.md) |

## ディレクトリの使い分け

新しいドキュメントを追加するときは、次の判定質問で置き場所を決める。

| ディレクトリ | 判定質問 | 例 |
|-------------|---------|-----|
| `guides/` | コマンドを打ちながら読むか？ | 開発環境構築、Docker 操作、CI の対処法 |
| `reference/` | 実装が何をしているか調べるために読むか？ | アーキテクチャ、認証仕様、スコア算出式 |
| `adr/` | なぜ A ではなく B を選んだかを説明しているか？ | ツールチェーン選定、ディレクトリ構成の決定 |
| `perf/` | 数値の記録か？ | パフォーマンス計測結果 |
| 直下 | 上のどれでもなく、プロジェクト全体を俯瞰するものか？ | この索引、ロードマップ |

## git 管理外のディレクトリ

`docs/superpowers/` は superpowers skill が生成する設計書・実装計画の置き場で、**git 管理外**（ローカルのみ）である。
恒久的に残すべき決定は `docs/adr/` に ADR として記録すること。理由は [ADR-002](./adr/002-docs-structure.md) を参照。
