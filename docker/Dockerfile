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
# prisma.config.ts は DATABASE_URL_DIRECT を読むため、そちらも必要
RUN printf 'DATABASE_URL=postgresql://localhost:5432/dummy\nDATABASE_URL_DIRECT=postgresql://localhost:5432/dummy\n' > .env

# 依存関係インストール & Prisma Client 生成
RUN npm ci && npx prisma generate

# ============================================
# Stage 1b: Production Dependencies
# ============================================
# runner に devDependencies（Prisma CLI・tsx）を持ち込まないための stage。
# 常時公開される Web Pod に CLI が同梱されていると、RCE 時の足場になる。
FROM node:24-alpine AS prod-deps

WORKDIR /app

RUN apk add --no-cache python3 make g++

COPY package.json package-lock.json ./

RUN npm ci --omit=dev

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

# 生成済みの依存関係をコピー（dev 依存を含まない prod-deps から取る）
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=deps /app/prisma.config.ts ./
COPY --from=deps /app/prisma ./prisma

# Prisma Client の生成物（generator.output = ../src/generated/prisma）。
# scripts / tsconfig.json / code.csv は migrator stage に移した。
COPY --from=builder --chown=nextjs:nodejs /app/src/generated ./src/generated

# standalone出力をコピー
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

# Prisma 7 では @prisma/client が prisma（CLI）を依存に持つため、--omit=dev では消えない。
# 常時公開される Web Pod に DDL を打てる CLI を残さないよう明示的に取り除く。
# 実行時は生成済み Prisma Client（src/generated）だけで足りることを検証済み。
# standalone の COPY が node_modules を上書きするため、必ずその後に実行する。
RUN rm -rf node_modules/prisma node_modules/.bin/prisma

# 非rootユーザーで実行
USER nextjs

EXPOSE 3000

# ヘルスチェック
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD node -e "fetch('http://localhost:3000/healthz').then(r => r.ok ? process.exit(0) : process.exit(1)).catch(() => process.exit(1))"

CMD ["node", "server.js"]

# ============================================
# Stage 4: Migrator (db-migrate / db-seed Job 用)
# ============================================
# Prisma CLI と tsx を必要とするのはマイグレーションと seed だけなので、
# Web 用イメージから切り離す。
FROM node:24-alpine AS migrator

WORKDIR /app

RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 --ingroup nodejs nextjs

# npx を使わず node_modules/.bin を直接叩くが、
# 念のため HOME を書き込み可能な場所に向けておく
ENV HOME=/tmp
ENV NODE_ENV=production

COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/prisma.config.ts ./
COPY --from=deps /app/prisma ./prisma
COPY --from=builder --chown=nextjs:nodejs /app/package.json ./package.json
COPY --from=builder --chown=nextjs:nodejs /app/tsconfig.json ./
COPY --from=builder --chown=nextjs:nodejs /app/scripts ./scripts
COPY --from=builder --chown=nextjs:nodejs /app/src/generated ./src/generated
COPY --from=builder --chown=nextjs:nodejs /app/code.csv ./code.csv

USER nextjs

CMD ["node_modules/.bin/prisma", "migrate", "deploy"]
