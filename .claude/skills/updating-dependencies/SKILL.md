---
name: updating-dependencies
description: 依存パッケージを更新するとき、npm outdated や npm audit の結果を読むとき、脆弱性の修正のために版を上げるとき、Dependabot や Renovate の PR を確かめるときに使う。依存更新、バージョンアップ、npm update、メジャーアップデート、package-lock.json の差分、Latest 列、といった場面。
---

# updating-dependencies

依存更新で踏んだ罠のうち機械的に見つけられるものは、同梱の `deps.py` が見つける。文書は判断が要る部分だけを扱う。

```bash
D=.claude/skills/updating-dependencies/deps.py
python3 $D check-install              # 入っている版が lock どおりか
python3 $D outdated                   # npm outdated を Latest 列の罠を踏まずに読む
python3 $D lockdiff "$(git merge-base origin/develop HEAD)"   # この PR で変えた lock の差分を検査する
```

`lockdiff origin/develop` と書かないこと。develop が先に進んでいると、develop 側の変更を逆向きにこの PR のものとして出す（メジャー更新が入っていれば逆向きのメジャーとして要確認になる）。

## 手順

1. **`check-install` を通す。** 落ちたら `npm ci`。lock ファイル同士を比べても分からない（別ブランチで `npm ci` したまま切り替えると、lock は prisma 7.10.0 なのに 7.9.1 が入っている）。ずれたまま `npm outdated` を読むと件数も版も狂う。版の違いのほか、**この環境向け（`os` / `cpu` が一致する）の optional が欠けていないか**と、**lock に無いパッケージが `node_modules` に残っていないか**も見る
2. **`outdated` で調べる。** 「Latest 列を信じてはいけない」に出たものは、Latest に合わせない
3. **PR を分ける。**
   - レンジ内の更新 → `npm update` をまとめて1本
   - メジャー → **1パッケージ1本**（#110 の完了条件）。CHANGELOG と移行ガイドを WebFetch で読み、`src/` の該当箇所を grep し、破壊的変更と対応をコミットか ADR に書く
   - 脆弱性の修正 → `package.json` の下限も上げる（`^16.3.1` → `^16.3.5`）。lock で入る版が安全でも、脆弱な版を許す範囲を宣言し続けないため
4. **Prisma が変わったら `npm run prisma:generate`。** `src/generated/prisma/` は git で追跡している。差分が版の文字列などに留まることを見てからコミットする
5. **`lockdiff "$(git merge-base origin/develop HEAD)"` が要確認なしになること。** メジャーを上げる PR は `--allow-major <パッケージ名>` を付ける
6. `npm run check-code`、`npm run build`
7. **イメージを2つともビルドして動かす。** runner は **run-app-locally スキル**の手順（`up -d --build app`）で起動し、`/healthz` `/readyz` と保護された API の 401 を見る。migrator は `cd docker && docker compose --env-file ../.env.local --profile tools run --rm --build migrator` で `No pending migrations to apply.` を見る。**`--build` を付けないと、前に作ったイメージのまま通ってしまう。** 単独の `docker build --target ...` は compose が使うイメージ（`docker-migrator` など）を更新しないので使わない
8. **`npm audit` を更新の前後で比べ、件数を PR に書く。** 解消したものを過少に書かない（#158 は critical しか書かず、high 3件の解消を書き漏らした）
9. PR 本文の主張を番号付きで `pr-verifier` に渡す

## 判断が要るところ

| 状況 | どうするか |
|---|---|
| `npm audit fix --force` を勧められる | **`--dry-run` で何が変わるかを見る。** 2026-09 時点では CLI 側（`prisma` `@prisma/config` `@prisma/engines` など）を 6.19.3 に下げ、`@prisma/client` と `@prisma/adapter-pg` は 7 のまま残す内容だった。メジャーを戻すうえに CLI とクライアントの版が食い違う。当てない場合は、残した理由を PR と issue に書く |
| advisory の深刻度が critical | 実際の露出を調べてから急ぐか決める（該当 OS か、該当機能を使っているか、経路が開いているか）。#158 の next の RCE は、Windows 限定のものと、使っていない画像最適化経由のものだった |
| Latest 列が今より古い／prerelease | dist-tag の `latest` が別の系統に付いている（`next-auth` は 4.x、`@types/node` は 22.x）か、rc に付いている（`prisma`）。`npm view <pkg> dist-tags --json` で確かめる |
| 推移的な 0.x の minor 更新が出る | `lockdiff` は一覧に出すだけ（親の指定範囲に従っている）。直接の依存の 0.x の minor 更新は要確認になる |
| issue に書かれた目標の版 | **issue は古くなる。** #110 の目標 `next 16.3.0` は、脆弱性の対象範囲（`<16.3.3`）に入っていた。advisory の範囲と突き合わせる |

## deps.py の終了コード

0 問題なし / 1 要確認がある / 2 前提が満たされていない（`check-install` が落ちている、比べる ref が無い、lock が古い形式、npm がエラーを返した、package.json にあって lock に無い依存がある）。`outdated` は調べるためのコマンドなので、前提が満たされていれば常に 0。

`outdated` は `npm outdated` に出ない新しい版を出さない。`@types/ioredis` は dist-tag の latest が 5.0.0 だが、ioredis 本体が型を持つので中身の無い型定義になっている。上げるのではなく外す候補。

スクリプト自体のテスト: `python3 .claude/skills/updating-dependencies/test_deps.py`
