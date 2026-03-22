# Documentation Update Policy

## 重要な約束事項

すべての開発作業で、以下の3つのドキュメントを常に一緒に更新する：

### 1. CLAUDE.md
- Claude Code用のプロジェクトガイド
- 重要な実装パターン、API詳細、開発フロー
- 新しいデベロッパーが最初に読むべき内容

### 2. /docs フォルダ
詳細な技術ドキュメント：
- `architecture.md` - システム構成、データベース設計
- `development-guide.md` - セットアップ、規約、トラブルシューティング
- `api-integration.md` - 外部API統合の詳細
- `authentication.md` - 認証実装の詳細
- `scoring-algorithm.md` - スコア計算ロジック
- `google-maps-api.md` - Google Maps API使用方法
- `roadmap.md` - 開発ロードマップ、スプリント進捗

### 3. README.md
- プロジェクト概要
- セットアップ手順
- 技術スタック一覧
- リンク・参考資料

## 更新ルール

- **新機能追加** → CLAUDE.md + 関連docs + README
- **API仕様変更** → docs/api-integration.md + CLAUDE.md
- **アルゴリズム改善** → docs/scoring-algorithm.md + CLAUDE.md
- **認証周辺** → docs/authentication.md + CLAUDE.md
- **開発フロー変更** → docs/development-guide.md + CLAUDE.md
- **依存関係変更** → README.md の技術スタック + CLAUDE.md

## 目的

ドキュメントと実装を常に同期させ、将来のClaudeインスタンスが正確で最新の情報で作業できるようにする。
