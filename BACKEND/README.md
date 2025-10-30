# 🎣 Fishing Conditions App - Backend

このリポジトリは、釣りコンディションアプリのバックエンドサーバーです。
Go言語で実装されており、フロントエンドにAPIを提供します。

---

## ⚙️ 技術スタック 予定

| レイヤー | 技術 | 備考 |
| :--- | :--- | :--- |
| **言語** | Go | |
| **Webフレームワーク** | [Gin](https://github.com/gin-gonic/gin) | 高パフォーマンスなHTTP Webフレームワーク |
| **データベース** | PostgreSQL | |
| **DBアクセス** | [sqlc](https://sqlc.dev/) | SQLファイルから型安全なGoコードを生成 |
| **マイグレーション** | [golang-migrate](https://github.com/golang-migrate/migrate) | SQLベースのスキーママイグレーションツール |
| **設定管理** | [Viper](https://github.com/spf13/viper) | 環境変数、設定ファイルの管理 |
| **認証** | [golang-jwt/jwt](https://github.com/golang-jwt/jwt) | JWTによるトークンベース認証 |

---

## 🔄 開発ロードマップ

| フェーズ | 内容 | 目標 |
| :--- | :--- | :--- |
| **1. 環境構築** | Go, Gin, sqlcのセットアップ。DB接続設定。 | 開発開始準備 |
| **2. DB設計と認証API** | スキーマ定義、マイグレーション実行。<br>sqlcでクエリ作成・コード生成。<br>ユーザー登録/ログインAPI実装。 | 基礎機能の完成 |
| **3. コア機能API** | 外部API連携、釣りやすさスコア算出API実装。 | MVPのコア機能完成 |
| **4. フロントエンドとの結合** | フロントエンドからAPIを呼び出し、画面表示。 | α版リリース |
| **5. 拡張機能開発** | 釣果記録・共有機能など。 | 本番リリースへ |