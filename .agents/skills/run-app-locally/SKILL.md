---
name: run-app-locally
description: アプリをローカルで起動して動きを確かめるとき、ログインが必要な画面や API を確かめるとき、実際の PostgreSQL で挙動を確かめるとき、Docker イメージを起動してスモークするときに使う。起動、localhost、next dev、ログインした状態、セッション Cookie、curl、実 DB、といった場面。
---

# run-app-locally

## 1. 前提をそろえる

```bash
cd docker && docker compose --env-file ../.env.local up -d postgres redis && cd ..   # 動いていれば何もしない
for v in DATABASE_URL REDIS_URL AUTH_SECRET AUTH_URL; do printf '%s %s\n' "$v" "$(grep -c "^$v=" .env.local)"; done   # 値は出さない
npx dotenv -e .env.local -- prisma migrate status    # "Database schema is up to date!"
```

- **`npm run prisma:seed` を既存のデータに流し直さない。** 港の ID が振り直され、地点との紐づけが切れる（#146）。DB が空のときだけ
- `docker compose down -v` をしない。ボリュームごとローカル DB が消える

## 2. 起動する

`run_in_background` で `npm run dev` を起動し、`/healthz` が返るまで待つ。

```bash
for i in $(seq 1 60); do curl -fsS -o /dev/null http://localhost:3000/healthz && break; sleep 1; done
curl -s http://localhost:3000/readyz    # {"status":"ready","checks":{"database":"ok","cache":"ok"}}
```

**Claude が `next dev` を起動すると、Next.js がリポジトリの `CLAUDE.md` にブロックを書き足す**（`<!-- BEGIN:nextjs-agent-rules -->`）。`CLAUDECODE`・`AI_AGENT`・`CURSOR_TRACE_ID` などの環境変数で AI エージェントを検出したときだけ動き、それらが無い端末で人が起動したときは起きない。止めるには `next.config` の `agentRules: false`。入れるか止めるかはプロジェクトの判断なので、勝手に決めない。**終わったら `git diff CLAUDE.md` を見て、自分の起動で増えた追記なら戻し、ユーザーに伝える。**

ポート 3000 が使われていたら、`lsof -nP -iTCP:3000 -sTCP:LISTEN` で誰のプロセスか確かめる。**自分が起動していないプロセスは止めない。** 別のポート（`npm run dev -- -p 3100`）で起動してよいが、下の表の違いがある。

| 確かめたいこと | `AUTH_URL`（:3000）と違うポートで |
|---|---|
| Cookie を付けた curl（API、ページ） | 動く |
| 未ログイン時のリダイレクト先 | `:3000` の `/login` に向く |
| Google ログイン | コールバックが `:3000` に向くので通らない |

## 3. ログインした状態で確かめる

セッションは JWT 戦略なので、`AUTH_SECRET` でトークンを作ればパスワードも OAuth も要らない。同梱のスクリプトが、既存ユーザーのセッション Cookie を curl の cookie jar に書き出す（**トークンの値は画面に出さない**）。

```bash
J=$(mktemp -d)/cookies.txt
npx dotenv -e .env.local -- node .agents/skills/run-app-locally/session-cookie.mjs "$J" [email]
curl -s -b "$J" -o /dev/null -w '%{http_code}\n' http://localhost:3000/api/ports     # 200
curl -s -b "$J" -o /dev/null -w '%{http_code}\n' http://localhost:3000/dashboard     # 200
```

- email を省くと最初に作られたユーザーを使う。有効期限は1時間
- jar は作った時点から権限 600。既にあるファイルには書かないので、同じパスに作り直すときは先に消す
- **curl に `-i` `-v` `-D` を付けない。** Auth.js はリクエストのたびにトークンを作り直し、`Set-Cookie` で返す（有効期限は `session.maxAge` の7日）。付けるとその値が出力に出る。`-c` で jar に書き戻すこともしない
- トークンには `id` と `email` を載せる（`src/auth/callbacks/jwtCallback.ts` と `sessionCallback.ts` が読む項目）。これらが変わったらスクリプトも直す
- 終わったら jar を消す

## 4. 実際の DB で挙動を確かめる

ORM のエラーの形などは、モックでは再現できない（#161）。リポジトリ直下に一時スクリプトを置くと `@/` の import が使える。

```bash
npx dotenv -e .env.local -- node --import tsx/esm check.ts
```

- 作るレコードのメールアドレスは `...@example.invalid` にし、**最後に必ず消す**
- スクリプトも消し、`git status` で何も残っていないことを確かめる

## 5. Docker イメージで確かめる

```bash
cd docker
APP_PORT=3100 docker compose --env-file ../.env.local up -d --build app    # runner イメージ
docker compose --env-file ../.env.local --profile tools run --rm --build migrator    # "No pending migrations to apply."
docker compose rm -sf app
```

**migrator には `--build` を付ける。** `run` は付けないとイメージを作り直さず、前に作った `docker-migrator` のまま通る。PR で足したマイグレーションが入っていなくても同じ出力になる。

イメージは `NODE_ENV=production` で、`AUTH_URL` は `.env.local` の値のまま。ヘルスと 401 は確かめられるが、ブラウザでのログインは上の表のとおり通らない。

## 6. 片付け

- 起動したサーバーのタスクを止め、`lsof -nP -iTCP:<使ったポート> -sTCP:LISTEN` が何も返さないことを確かめる。`pgrep -f "next dev"` は親の node しか当たらず、実際に listen している `next-server` が残っていても見逃す
- `git status`。`CLAUDE.md` の追記（2.を参照）以外に変わったファイルが無いこと
- DB と Redis のコンテナは、自分が起動したのでなければ止めない
