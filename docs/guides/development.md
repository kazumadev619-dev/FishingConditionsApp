# 🛠️ 開発ガイド

## 開発環境セットアップ

### 必要な環境

- **Node.js**: v24.11.0
- **TypeScript**: v5.9.3

### 技術スタック詳細バージョン

| 技術          | バージョン    | 用途               |
| ------------- | ------------- | ------------------ |
| Next.js       | 16.0.10       | フレームワーク     |
| React         | 19.2.3        | UIライブラリ       |
| TypeScript    | 5.9.3         | 型安全性           |
| Tailwind CSS  | 4.1.16        | スタイリング       |
| Zustand       | 5.0.8         | 状態管理           |
| React Query   | 5.90.7        | サーバー状態管理   |
| Auth.js       | 5.0.0-beta.30 | 認証               |
| shadcn/ui     | latest        | UIコンポーネント   |
| PostgreSQL    | 17.0          | データベース       |
| Prisma        | latest        | ORM                |
| ioredis       | latest        | キャッシュ         |

---

## プロジェクト構成

```
fishing-conditions-app/
├── docs/                          # ドキュメント（docs/README.md が索引）
│   ├── README.md
│   ├── roadmap.md
│   ├── guides/                    # 作業手順・運用
│   ├── reference/                 # 設計・仕様
│   ├── adr/                       # 技術的決定記録
│   └── perf/                      # パフォーマンス計測結果
├── k8s/                           # Kubernetesマニフェスト
├── docker/                        # Dockerfile / docker-compose.yml
├── src/                           # ソースコード
│   ├── app/                       # Next.js App Router
│   │   ├── api/                   # API Routes
│   │   ├── (auth)/                # 認証関連ページ
│   │   └── dashboard/             # ダッシュボード
│   ├── components/                # Reactコンポーネント
│   │   ├── atoms/
│   │   ├── molecules/
│   │   ├── organisms/
│   │   └── templates/
│   ├── lib/                       # ユーティリティ・設定
│   │   ├── services/              # ビジネスロジック
│   │   ├── repositories/          # データアクセス層
│   │   └── utils/                 # ヘルパー関数
│   └── types/                     # TypeScript型定義
├── public/                        # 静的ファイル
│   ├── icons/
│   └── manifest.json
├── tests/                         # テストファイル
│   ├── unit/
│   ├── integration/
│   └── e2e/
├── package.json
├── next.config.mjs
├── tailwind.config.js
├── tsconfig.json
└── README.md
```

---

## 開発ルール・規約

### コーディング規約

- **言語**: TypeScript strict mode
- **フォーマッター**: Biome（`npm run format`）
- **リンター**: ESLint + TypeScript ESLint
- **スタイル**: Tailwind CSS
- **コンポーネント**: shadcn/ui ベース

### ブランチ戦略

```
main                       # 本番環境
├── develop               # 開発統合ブランチ
└── <type>/<short-desc>   # 作業ブランチ
```

`<type>` はコミットの type と同じ語を使う。Issue 番号がある場合は `<type>/#<issue-no>_<desc>` としてよい。
実例: `refactor/#13` / `docs/repo-tidy` / `feat/#123_fishing-spot-pagination`

### コミット規約（gitmoji + Conventional Commits）

`commitlint.config.cts`（`extends: ['gitmoji']`）が commit-msg フックで検証する。

```
<絵文字> <type>: <説明> [#<数字>]
```

```bash
git commit -m "✨ feat: Auth.js認証機能を実装 #123"
git commit -m "📝 docs: 開発ガイドを更新"
```

- 絵文字と type の間は**半角スペース**。`✨:feat:` のようにコロンで繋ぐと落ちる
- チケット番号は `#123` のように**数字のみ**。文字列（`#TaskNo` 等）を書くと落ちる。無ければ省略する
- ヘッダー（1 行目）は 100 文字以内
- type は `commitlint.config.cts` の `type-enum` にあるもの:
  `feat` `improve` `update` `fix` `hotfix` `refactor` `delete` `style` `docs` `move` `test` `chore` `package` `WIP`

---

## 開発フロー

### 1. 機能開発の流れ

1. **Issue作成**: GitHub Issuesでタスクを作成
2. **ブランチ作成**: `develop` から `<type>/<short-desc>` 形式で切る（例: `docs/repo-tidy`、`refactor/#13`）
3. **開発**: ローカル環境で実装
4. **テスト**: 単体テスト・統合テスト実行
5. **PR作成**: `develop` 向けに Pull Request を作成・レビュー依頼
6. **レビュー**: コードレビュー・修正
7. **マージ**: developブランチにマージ

### 2. 品質保証

- **自動テスト**: Jest + React Testing Library
- **E2Eテスト**: Playwright
- **型チェック**: TypeScript strict mode
- **リント**: Oxlint（高速チェック）+ Biome（整形）+ ESLint（CIでの深い静的解析）
- **CI/CD**: GitHub Actions

---

## 環境変数管理

### 必要な環境変数

```bash
# データベース
DATABASE_URL=postgresql://...
SUPABASE_URL=https://...
SUPABASE_ANON_KEY=...

# 外部API
OPENWEATHERMAP_API_KEY=...
WORLDTIDES_API_KEY=...
GOOGLE_MAPS_API_KEY=...

# キャッシュ
REDIS_URL=redis://localhost:6379

# 認証
AUTH_URL=http://localhost:3000
AUTH_SECRET=...                      # npx auth secret で生成

# Google OAuth (オプション)
AUTH_GOOGLE_ID=...                   # Google Cloud ConsoleのClient ID
AUTH_GOOGLE_SECRET=...               # Google Cloud ConsoleのClient Secret
```

### 環境別設定

- **開発環境**: `.env.local`
- **Kubernetes**: `k8s/overlays/<env>/secret.yaml`（SOPS で暗号化して `secret.enc.yaml` として管理）

---

## テスト戦略

### 単体テスト（Jest + React Testing Library）

```typescript
// components/ScoreIndicator.test.tsx
import { render, screen } from '@testing-library/react';
import { ScoreIndicator } from './ScoreIndicator';

describe('ScoreIndicator', () => {
  it('should display score correctly', () => {
    render(<ScoreIndicator score={85} />);
    expect(screen.getByText('85')).toBeInTheDocument();
    expect(screen.getByText('絶好調')).toBeInTheDocument();
  });
});
```

### 統合テスト（API Routes）

```typescript
// tests/api/conditions.test.ts
import { GET } from '@/app/api/conditions/[locationId]/route';
import { NextRequest } from 'next/server';

describe('/api/conditions/[locationId]', () => {
  it('should return fishing conditions', async () => {
    const request = new NextRequest('http://localhost:3000/api/conditions/test-location');
    const response = await GET(request, { params: { locationId: 'test-location' } });

    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data).toHaveProperty('score');
  });
});
```

### E2Eテスト（Playwright）

```typescript
// tests/e2e/dashboard.spec.ts
import { test, expect } from '@playwright/test';

test('dashboard displays fishing score', async ({ page }) => {
  await page.goto('/dashboard');
  await expect(page.locator('[data-testid=fishing-score]')).toBeVisible();
});
```

---

## デバッグ・トラブルシューティング

### よくある問題と解決方法

#### 1. 外部API接続エラー

```bash
# APIキーの確認
echo $OPENWEATHERMAP_API_KEY

# ネットワーク接続テスト
curl "https://api.openweathermap.org/data/2.5/weather?q=Tokyo&appid=YOUR_API_KEY"
```

#### 2. データベース接続エラー

```bash
# PostgreSQL接続確認 (docker-compose)
docker compose -f docker/docker-compose.yml exec postgres pg_isready

# ローカルDB起動
cd docker && docker compose up -d postgres

# Prisma Studio でDB確認
npm run prisma:studio
```

#### 3. キャッシュ関連の問題

```bash
# Redis接続確認
redis-cli ping

# キャッシュクリア
redis-cli flushall
```

### ログ確認

```typescript
// 開発環境でのデバッグログ
console.log('Weather API Response:', weatherData);

// 本番環境での構造化ログ
logger.info('User login successful', { userId, timestamp });
```

---

## パフォーマンス最適化

### フロントエンド最適化

- **画像最適化**: Next.js Image コンポーネント使用
- **コード分割**: 動的インポートでバンドルサイズ削減
- **キャッシュ活用**: SWR/React Query でデータキャッシュ
- **Core Web Vitals**: LCP、FID、CLS の監視・改善

### バックエンド最適化

- **データベースクエリ**: インデックス最適化
- **API レスポンス**: gzip圧縮、並列処理
- **キャッシュ戦略**: Redis による多層キャッシュ
- **外部API**: レート制限・リトライ機能

---

## セキュリティ対策

### 開発時の注意点

- **APIキー**: 環境変数で管理、コードにハードコーディング禁止
- **入力検証**: Zod による型安全な検証
- **認証**: NextAuth.js による適切な認証実装
- **CORS**: 適切なオリジン設定

### セキュリティチェックリスト

- [ ] 環境変数の適切な管理
- [ ] 入力値の検証・サニタイズ
- [ ] 認証・認可の実装
- [ ] HTTPS の強制
- [ ] セキュリティヘッダーの設定

---

## デプロイメント

### 現状

**本番環境はまだ公開していない。** デプロイ先として Raspberry Pi 5 上の k3s（Cloudflare Tunnel + Traefik）を用意しており、初回デプロイはこれから行う。

- **ローカル Kubernetes**: Minikube（手順は [k8s/README.md](../../k8s/README.md)）
- **本番相当**: Raspberry Pi 5 + k3s（arm64）
- **ステージング環境**: 未構築。今後整備する

### CI/CD の現状

GitHub Actions で lint / format / type-check / build を実行している（詳細は [ci-cd.md](./ci-cd.md)）。
**k3s への自動デプロイは未導入**で、現時点のデプロイは手動で行う。

---

## 参考リンク

### 技術ドキュメント

- [Next.js Documentation](https://nextjs.org/docs)
- [React Documentation](https://react.dev/)
- [TypeScript Handbook](https://www.typescriptlang.org/docs/)
- [Tailwind CSS](https://tailwindcss.com/docs)
- [shadcn/ui](https://ui.shadcn.com/)

### 外部API

- [OpenWeatherMap API](https://openweathermap.org/api)
- [WorldTides API](https://www.worldtides.info/apidocs)
- [Google Maps API](https://developers.google.com/maps)

### インフラ・ツール

- [PostgreSQL Documentation](https://www.postgresql.org/docs/)
- [Prisma Documentation](https://www.prisma.io/docs/)

