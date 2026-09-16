---
name: mutation-test
description: 回帰テストや CI のガード（ワークフローの run:）を書いた・直したとき、またはレビューで「このテストは退行を本当に検知できるか」を確かめるときに使う。変異テスト、mutation testing、実装を壊して落ちることを確かめる、テストが素通りしていないか、といった場面。
---

# mutation-test

**テストやガードは、実装を壊して落ちることを確かめるまで検証になっていない。** 手でファイルを書き換えて戻すと、ハーネスの方が壊れる（置換が効いていない、抜き出しが途中で切れている、戻し忘れる）。同梱の `mutate.py` に任せる。

```bash
python3 .claude/skills/mutation-test/mutate.py run <spec.json>
```

spec は `mktemp -d` の下に置く。リポジトリには置かない。複数行の `old` を JSON で手書きするとエスケープを誤るので、**spec は Python の `json.dump` で書き出す**。

## spec

```json
{
  "command": "npx vitest run src/lib/prismaConstraints.test.ts",
  "summary_pattern": "^ +Tests +.*",
  "mutations": [
    {"label": "error.code の照合をやめる",
     "edits": [{"file": "src/lib/prismaConstraints.ts",
                "old": "  if (error.code !== code) return false;\n\n", "new": ""}]},
    {"label": "_private はルートではない（落ちないのが正解）", "expect": "pass",
     "create": [{"file": "src/app/_private/page.tsx",
                 "content": "export default function P() { return null; }\n"}]}
  ]
}
```

| キー | 意味 |
|---|---|
| `command` | `bash -c` で実行。終了コード 0 が「通過」 |
| `edits[]` | `old` を `new` に置換。`old` は**ちょうど1箇所**一致しないと適用しない。複数箇所なら `count` |
| `create[]` | 新しいファイルを作る。既にあれば適用しない。作ったディレクトリごと消して戻す。1つの変異で `edits` と併用できる（例: 固定名の設定ファイルを作り、それを参照するよう別ファイルを書き換える） |
| `expect` | `fail`（既定）/ `pass` |
| `message_pattern` | 落ちたときに出るべきメッセージの正規表現。グループ1を結果に出す |
| `summary_pattern` | 結果に並べる要約行の正規表現 |
| `unset_env` / `cwd` / `timeout` | 環境変数を外す（例: 壊れた `NODE_OPTIONS`）/ 実行ディレクトリ / 秒 |

### CI のガードを試す

```bash
T=$(mktemp -d)
python3 .claude/skills/mutation-test/mutate.py extract-step .github/workflows/ci.yml "<step の name>" \
  | sed "s|/tmp/rendered.yaml|$T/rendered.yaml|g" > "$T/guard.sh"
```

- `command` は `kustomize build k8s/ > $T/rendered.yaml && bash -e $T/guard.sh` のように組む。**`bash -e` にする**（Actions の `run:` は `shell` 未指定だと `bash -e` で動く）
- **`message_pattern` に `::error::(.*)` を指定する。** 指定しないと、ガードが落としたのか前段（`kustomize build` など）が落ちたのか区別できない
- パスの差し替えは上のようにパイプで `sed` を通す。`sed -i` は macOS と GNU で引数が違う

## 結果の読み方

| 判定 | 意味 | 次にやること |
|---|---|---|
| `KILLED` | 壊したら落ちた | なし |
| `SURVIVED` | 壊したのに通った | テストの穴。ケースを足してやり直す |
| `PASSED` | 落ちないのが正解で、通った | なし |
| `FALSE_ALARM` | 落ちないはずが落ちた | テストが広すぎるか、`expect` が誤り |
| `HARNESS_ERROR` | 変異を適用できなかった。**コマンドは走っていない** | `old` を具体的にする |
| `TIMEOUT` | 時間切れ | `timeout` を見直す |

**警告**はテストの結果ではなくハーネスへの疑いとして読む。

- **全件が同じ結果** → テスト側に本当に穴があるか、ハーネスが変異を届けていない（別のファイルを見ている、パスの差し替え漏れ）かのどちらか。下の「確実に落ちる変異」を入れておけば区別できる
- **検知したがメッセージが出ていない** → エラーを出す前に死んでいる。`set -e` のもとで `x=$(grep ...)` が一致なしで終了する、など

終了コードは 0（全件期待どおり、警告なし）/ 1（それ以外）/ 2（変異なしで落ちた、復元に失敗、中断）。

## 変異の選び方

- **確実に落ちる変異を1件入れる。** テストが直接読む値を壊す（必須のキーを消す、など）。これが `KILLED` にならなければハーネスが壊れている
- **過去に直したバグを戻す。** 実際に起きた退行なので最も価値が高い
- **判定の分岐を1つずつ潰す。** 条件を `False` にする、照合を外す、フォールバックを消す
- **検査対象の「相手側」も壊す。** 生成物だけでなく、それを参照する側（例: ConfigMap の生成だけでなく Deployment の `configMapRef`）。片側だけ壊していると、自分自身に一致するような検査の穴を見逃す
- **「落ちないのが正解」を1つ入れる。** 何を変えても落ちるテストになっていないかを見る

## よくある間違い

| 症状 | 原因と対処 |
|---|---|
| 置換対象が2箇所で `HARNESS_ERROR` | `AUTH_URL=https://` は `NEXTAUTH_URL=https://` の中にもある。前の改行を含めて `"\nAUTH_URL=https://"` にする |
| `SURVIVED` が出たのでテストを足そうとしている | 先に「その変異は本当に挙動を変えるか」を考える。例: Python の `SIGINT` ハンドラを消しても、既定の `KeyboardInterrupt` で `finally` が走るので結果は変わらない |
| 1件ずつ手で置換して戻している | spec にまとめて1回で流す。戻し忘れと置換の空振りをスクリプトが止める |

スクリプト自体のテスト: `python3 .claude/skills/mutation-test/test_mutate.py`
