# 🎣 Fishing Conditions App

釣り初心者から経験者までが、**「いつ・どこで・どんな条件なら釣れるか」**をリアルタイムで確認できるWebアプリケーション。

潮汐・風・天気・海水温などの環境データを統合し、独自の**釣りやすさスコア**を算出・可視化することで、ユーザーの釣果向上を支援します。PWA対応により、スマートフォンでネイティブアプリライクな体験を提供します。

---

## 🎯 プロダクトビジョン

### 開発目的
- 釣行前・釣行中に「今の釣り条件」を簡単に確認できる環境を提供
- 気象・潮汐データをもとに「釣り日和」を定量的に評価
- 将来的にユーザーごとの釣果記録・共有機能を追加

### ターゲットユーザー
| 区分 | 想定ユーザー | 利用目的 |
|------|---------------|-----------|
| 初心者 | 釣り経験が浅く、潮や風の見方が分からない | 釣りに行く日や時間帯を決めたい |
| 経験者 | 定期的に釣りに行くユーザー | データを参考に釣果を安定させたい |

---

## 🏗️ 開発戦略

### 段階的開発アプローチ

**Phase 1: MVP (Next.js フルスタック)** - 8-10週間
- 迅速な開発・検証を重視
- Next.js API Routes でバックエンド機能を実装
- パフォーマンスベースラインの測定

**Phase 2: バックエンド分離 (Go移行)** - 4-6週間
- フロントエンド: Next.js (PWA)
- バックエンド: Go + Gin フレームワーク
- パフォーマンス比較・最適化

**Phase 3: モバイルアプリ展開** - 6-8週間
- React Native または Flutter
- Go APIを共通バックエンドとして活用

---

## ⚙️ 技術スタック

### 環境要件
| 項目 | バージョン |
|------|-----------|
| Node.js | v24.11.0 |
| TypeScript | v5.9.3 |

### Phase 1: MVP技術スタック
| レイヤー | 技術 | バージョン | 理由 |
|----------|------|-----------|------|
| フロントエンド | Next.js + React + TypeScript | 16.0.1 + 19.2.0 + 5.9.3 | SSR/SSG対応、PWA化、型安全性 |
| バックエンド | Next.js API Routes | 16.0.1 | 迅速な開発、フルスタック統合 |
| スタイリング | Tailwind CSS + shadcn/ui | 4.1.16 + latest | モバイルファースト、コンポーネント再利用 |
| 状態管理 | Zustand + React Query | 5.0.8 + 5.90.7 | 軽量、外部API連携に最適 |
| 認証 | Auth.js | 5.0.0-beta.30 | 多様な認証プロバイダー対応 |
| データベース | PostgreSQL (Supabase) | 15.0 + latest | リレーショナルDB、リアルタイム機能 |
| キャッシュ | Redis (Upstash) | 7.2.0 | 外部API結果のキャッシュ |
| デプロイ | Vercel | latest | Next.js最適化、Edge Functions |

---

## 🔐 主要機能

### MVP機能一覧 (Phase 1)
| カテゴリ | 機能 | 詳細 |
|-----------|-------|------|
| 認証 | ユーザー登録・ログイン・ログアウト | Auth.js によるメール認証 |
| 環境データ | 潮汐・風・天気・海水温データ取得 | 外部API統合 + キャッシュ機能 |
| 釣りやすさ分析 | スコア算出（独自ロジック） | 潮汐・天気・時間帯を重み付けして0-100でスコア化 |
| データ表示 | 日付別・時間帯別の釣りやすさ表示 | レスポンシブチャート・グラフ表示 |
| 場所検索 | 地名検索・現在位置取得・履歴保存 | Google Maps API連携 |
| PWA機能 | オフライン対応・アプリインストール | Service Worker + キャッシュ戦略 |

### 釣りやすさスコア算出ロジック
```
総合スコア (0-100) = 潮汐スコア (40) + 天気スコア (35) + 時間帯スコア (25)

- 潮汐スコア: 満潮・干潮前後2時間が高スコア、大潮・中潮期間はボーナス
- 天気スコア: 風速・天候・気圧の安定性で評価
- 時間帯スコア: 早朝・夕方が高スコア、日中は中程度
```

---

## 📚 外部API統合

### 使用予定API
- **[OpenWeatherMap API](https://openweathermap.org/api)**: 気象データ（風・天気・気温・湿度）
- **[WorldTides API](https://www.worldtides.info/apidocs)**: 潮汐データ（満潮・干潮時刻・潮位）
- **[Google Maps API](https://developers.google.com/maps)**: 地名検索・ジオコーディング・現在位置

### API統合戦略
- **キャッシュ戦略**: Redis による結果キャッシュ（天気30分、潮汐6時間）
- **エラーハンドリング**: タイムアウト・リトライ・フォールバック機能
- **レート制限対応**: API使用量監視・アラート設定

---

## 🧾 開発・運用ルール

### 開発規約
- **コーディング規約**: ESLint + Prettier + TypeScript strict mode
- **ブランチ戦略**: `main` / `develop` / `feature/*` / `hotfix/*`
- **コミット規約**: Conventional Commits
- **Issue管理**: GitHub Projects（スプリント単位）

### 品質保証
- **テスト戦略**: Jest (単体) + Playwright (E2E)
- **CI/CD**: GitHub Actions + Vercel自動デプロイ
- **監視**: Vercel Analytics + エラー追跡

---

### 外部リンク
- [Next.js Documentation](https://nextjs.org/docs)
- [OpenWeatherMap API](https://openweathermap.org/api)
- [WorldTides API](https://www.worldtides.info/apidocs)
- [Google Maps API](https://developers.google.com/maps)