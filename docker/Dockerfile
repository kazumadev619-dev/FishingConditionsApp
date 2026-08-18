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

# ビルド用のダミー値。
# next build はページデータ収集で auth() を評価するため AUTH_SECRET が要る。
# 以前は .dockerignore に .env* が無かったせいで開発者の .env.local が
# `COPY . .` で紛れ込み、それに依存してビルドが通っていた（.env.local が無い
# 環境ではビルドが落ちる、再現性の無い状態だった）。
#
# ファイル（.env）ではなく RUN のインライン環境変数で渡すのは、next build が
# .env を standalone 出力へコピーしてしまい、プレースホルダ値が本番イメージに
# 同梱されるため。@next/env は既存の process.env を上書きしないが、
# k8s 側で設定し忘れた変数を "your_auth_secret_here" が静かに埋めてしまう
# （＝セッションが偽造可能になる）状態は作らない。
# ENV で書くと BuildKit の SecretsUsedInArgOrEnv に引っかかる点でも RUN が適切。
RUN AUTH_SECRET=build-time-placeholder-not-used-at-runtime \
    AUTH_GOOGLE_ID=build-time-placeholder \
    AUTH_GOOGLE_SECRET=build-time-placeholder \
    npm run build

# ============================================
# Stage 3: Migrator (db-migrate / db-seed Job 用)
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

# ============================================
# Stage 4: Runner (Production)
# ============================================
# **このステージは必ずファイル末尾に置くこと。** docker は --target 省略時に
# 最後のステージをビルドするため、順序を変えると `docker build` や
# compose の build（target 未指定）が Web イメージを作らなくなる。
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
# k8s では readOnlyRootFilesystem: true で動かすため、既定の HOME
# (/home/nextjs) は書き込めない。ライブラリが $HOME に書いた時点で EROFS に
# なるので、emptyDir を当てている /tmp を向けておく（migrator と同じ扱い）。
ENV HOME=/tmp

# node_modules は standalone 出力に同梱されるトレース済みのものだけを使う。
#
# 以前は `npm ci --omit=dev` した node_modules を丸ごとコピーしていたが、
# prisma / @prisma/engines / @prisma/studio-core などは package-lock.json 上で
# devOptional 扱い（devDependency かつ @prisma/client の optional peer）のため
# --omit=dev では除外されず、87 パッケージが残っていた。
# 後段の `rm -rf` で消してもレイヤは加算のため実体はイメージに残り、
# DDL を実行できる schema-engine バイナリも @prisma/engines 側に残っていた。
#
# standalone の node_modules（44 パッケージ / 77MB）には bcrypt・sharp の
# ネイティブバイナリを含む実行時依存が揃っており、Prisma CLI は最初から入らない。
# これによりイメージは 1.52GB -> 344MB になる。
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

# Prisma Client の生成物（generator.output = ../src/generated/prisma）。
# 実測では Next がサーバチャンクへバンドルするため無くても動くが、
# トレース漏れに対する保険として残す（578KB）。
# scripts / tsconfig.json / code.csv は migrator stage に移した。
COPY --from=builder --chown=nextjs:nodejs /app/src/generated ./src/generated

# prisma.config.ts と prisma/ は CLI 専用。CLI がいない runner では読まれず、
# スキーマと全マイグレーション SQL を公開 Pod に置くだけなのでコピーしない。

# 非rootユーザーで実行
USER nextjs

EXPOSE 3000

# ヘルスチェック
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD node -e "fetch('http://localhost:3000/healthz').then(r => r.ok ? process.exit(0) : process.exit(1)).catch(() => process.exit(1))"

CMD ["node", "server.js"]
