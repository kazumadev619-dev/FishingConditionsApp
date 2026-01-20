# syntax=docker/dockerfile:1
# check=error=true

# ============================================
# Stage 1: Dependencies
# ============================================
FROM node:24-alpine AS deps

WORKDIR /app

# bcrypt などネイティブモジュールのビルドに必要
RUN apk add --no-cache python3 make g++

# パッケージファイルをコピー
COPY package.json package-lock.json ./
COPY prisma.config.ts ./
COPY prisma ./prisma/

# Prisma生成用のダミー環境変数（実際の値は実行時に注入）
# .env.localをCOPYしないことで、秘密情報がイメージに含まれるリスクを回避
RUN echo "DATABASE_URL=postgresql://localhost:5432/dummy" > .env

# 依存関係インストール & Prisma Client 生成
RUN npm ci && npx prisma generate

# ============================================
# Stage 2: Build
# ============================================
FROM node:24-alpine AS builder

WORKDIR /app

# 依存関係をコピー
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/prisma.config.ts ./
COPY --from=deps /app/prisma ./prisma
COPY . .

# 環境変数（NEXT_PUBLIC_*はクライアントサイドで使用するため、ビルド時に埋め込み必須）
ARG NEXT_PUBLIC_GOOGLE_MAPS_API_KEY
ARG NEXT_PUBLIC_GOOGLE_MAPS_MAP_ID
ENV NEXT_PUBLIC_GOOGLE_MAPS_API_KEY=$NEXT_PUBLIC_GOOGLE_MAPS_API_KEY
ENV NEXT_PUBLIC_GOOGLE_MAPS_MAP_ID=$NEXT_PUBLIC_GOOGLE_MAPS_MAP_ID
ENV NEXT_TELEMETRY_DISABLED=1

# ビルド
RUN npm run build

# ============================================
# Stage 3: Runner (Production)
# ============================================
FROM node:24-alpine AS runner

WORKDIR /app

# 非rootユーザー作成
RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 --ingroup nodejs nextjs

# 本番環境設定
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

# 生成済みの依存関係をコピー
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/prisma.config.ts ./
COPY --from=deps /app/prisma ./prisma

# DB初期化スクリプトをコピー（db-init-job用）
COPY --from=builder --chown=nextjs:nodejs /app/scripts ./scripts
COPY --from=builder --chown=nextjs:nodejs /app/tsconfig.json ./
COPY --from=builder --chown=nextjs:nodejs /app/src/generated ./src/generated
COPY --from=builder --chown=nextjs:nodejs /app/code.csv ./code.csv

# standalone出力をコピー
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

# 非rootユーザーで実行
USER nextjs

EXPOSE 3000

# ヘルスチェック
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD node -e "fetch('http://localhost:3000/').then(r => r.ok ? process.exit(0) : process.exit(1)).catch(() => process.exit(1))"

CMD ["node", "server.js"]
