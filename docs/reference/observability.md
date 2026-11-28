# 計測（OpenTelemetry）

> - **状態**: 仕様（正）
> - **対応する実装**: `src/instrumentation.ts`、`src/lib/telemetry/`、`src/lib/api/client.ts`（`ApiClient.request`）、`src/lib/cache/helpers.ts`（`withCache`）、`src/lib/logger.ts`（`mixin`）、`k8s/config.env`
> - **最終確認**: 2026-11-28（PR #494 の実装と突き合わせて書いた。本番では未確認。下の「本番で確かめていないこと」）

アプリが何を、どこで、どんな名前で計測しているかを書く。監視の構成（Grafana Cloud と Alloy）を選んだ理由は [ADR-005](../adr/005-monitoring-platform.md) にある。ダッシュボードとアラートはここに書いた名前を使うので、名前やラベルを変える PR は、この文書と fishing-infra のダッシュボードも直す。

範囲は #283 の「着手前の決定（2026-11-27）」で絞った。DB クエリの時間、接続プールの使用数、利用状況のカウンターは、Next では計測しない。バックエンドを Go に移す段7（Fishing-api #31）で入れる。

## SDK の起動と送り先

Next がサーバーの起動時に `register()`（`src/instrumentation.ts`）を1回呼ぶ。次の2つを満たすときだけ、`startTelemetry()`（`src/lib/telemetry/sdk.ts`）が `@opentelemetry/sdk-node` の `NodeSDK` を起動する。

- `NEXT_RUNTIME` が `nodejs`（Edge では起動しない）
- `OTEL_EXPORTER_OTLP_ENDPOINT` が空でない

ローカル、テスト、CI では送り先を設定しないので、SDK は起動しない。

| 環境変数 | 本番の値（`k8s/config.env`） | 意味 |
|---|---|---|
| `OTEL_EXPORTER_OTLP_ENDPOINT` | `http://k8s-monitoring-alloy.monitoring.svc.cluster.local:4318` | 送り先（`monitoring` の Alloy、OTLP/HTTP）。消すと SDK を起動しない |
| `OTEL_LOGS_EXPORTER` | `none` | OTLP でのログの送信を止める。ログは stdout から Loki に入る |

- サービス名は `fishing-conditions-app`
- トレースは OTLP/HTTP（protobuf）で送る。メトリクスは SDK の既定（OTLP、60秒ごと）で送る。最初に記録するまでは、メトリクスを送らない
- 送り先に届かなくても、アプリは動く。送信の失敗はログに出ないので、届いていないことには Grafana Cloud にデータが来ないことで気づく（`k8s/README.md` の環境変数の表）

## トレース

自前のスパンは作らず、Next に組み込みのスパンを使う。standalone のイメージを手元で起動し、OTLP の受信サーバーの代わりに置いたサーバーに届いたのを確かめた主なスパンは次のとおり。

| 何か | スパンの例 |
|---|---|
| 画面の描画 | `GET /dashboard`、`render route (app) /dashboard`、`build component tree` |
| API ルート | `GET /api/weather`、`GET /api/scores`、`GET /api/conditions/tide`、`GET /api/locations/search` |
| 上流への fetch | `fetch GET https://api.openweathermap.org/data/2.5/weather`（クエリは消す） |
| proxy | `middleware GET` |

### 送るものと送らないもの

- トレースは 100% 送る（ADR-005）。外から来た `traceparent` の sampled=0 には従わない
- `/healthz` と `/readyz` のスパンは送らない。sampler が、開始時の `http.target` のパス（クエリを除く）で判定する。完全一致で比べるので、`/healthzz` は送る。子のスパンも親に従って落ちる

### URL のクエリを消す範囲

上流の URL には API キー（`appid`・`key`）が、受けた要求の `http.target` にはメール確認のトークンなどが入る。そのため、span processor（`stripUrlQuery`）が、スパンの開始時に次のものから `?` 以降を消す。

- スパンの名前（`fetch GET <url>` など）
- 開始時に付いている文字列の属性すべて（`http.url`、`http.target`、`next.span_name` など）。属性の名前で決め打ちしないのは、`next.span_name` のように URL を持つ属性があとから増えうるため

次のものからは消さない。

- 開始のあとに付く属性。いまの経路で開始のあとに付くのは、状態コード、route、`error.type` だけ
- 例外イベント（`exception.message`、stacktrace）。いまの経路では、例外の文言に URL は入らない（推測を含む。すべての経路は確かめていない）

## メトリクス

| OTel の名前 | 種類 | ラベル | 記録する場所 |
|---|---|---|---|
| `fishing.upstream.request.duration` | ヒストグラム（秒） | `server.address`（`api.openweathermap.org`・`tide736.net`・`maps.googleapis.com`）、`error.type`（失敗したときだけ。`ApiErrorType` の値） | `ApiClient.request`（`src/lib/api/client.ts`） |
| `fishing.cache.lookups` | カウンター | `cache.prefix`（`weather`・`tide`・`location`・`score`）、`cache.result`（`hit`・`miss`） | `withCache`（`src/lib/cache/helpers.ts`） |

Prometheus では、名前は `fishing_upstream_request_duration_seconds_{bucket,count,sum}` と `fishing_cache_lookups_total` に、ラベルの `.` は `_` になる見込み。本番では未確認（下の「本番で確かめていないこと」）。

### 上流の所要時間

- HTTP 1回ごとに記録する。リトライも1回ずつ数える（リトライも上流のクォータを使うため）。リトライの待ち時間は含めない
- 呼び出し数とエラー数は、`_count` を `error.type` で分けて数える
- バケットは 0.025、0.05、0.1、0.25、0.5、1、2.5、5、10 秒。上流の実測（35〜93ms、[perf/2026-11-22-api-baseline.md](../perf/2026-11-22-api-baseline.md)）とタイムアウト（10秒）から決めた
- 次のものは成功として数える。HTTP は成功していて、`ApiClient.request` のあとで失敗になるため
  - Google Geocoding が HTTP 200 の本文で返す異常の status（`OVER_QUERY_LIMIT` など）。`src/lib/googleMapsClient.ts` が `ApiError`（`RATE_LIMITED`・`CLIENT_ERROR` など）を投げるが、メトリクスには出ない
  - HTTP 200 で本文の JSON が壊れていたとき
- API キーが未設定で呼ばなかったときは記録しない

### キャッシュのヒット／ミス

- `withCache` がキャッシュを引くたびに1回数える。Redis が使えないときと、読み取りや JSON の解析に失敗したときも、`miss` として数える（`src/lib/cache/client.ts` の `get`）
- `skipCache` の経路と、同じキーへの相乗り（#433）は、キャッシュを引かないので数えない

### ラベルに入れないもの

系列数を増やさないため、スポット（港コード、座標）とエンドポイントはラベルにしない。キャッシュはキーの先頭（種類）だけをラベルにする。スポットごとの取得数は、メトリクスではなく Loki のログで数える（#496）。

## ログ

Pino の `mixin`（`src/lib/logger.ts`）が、スパンの中で出したログに `trace_id` と `span_id` を載せる。Loki のログから Tempo のトレースへ辿るためのもの。SDK が動いていない環境ではスパンが無いので、何も載らない。

## 既知の限界

- SIGTERM で SDK を shutdown しない。Pod が入れ替わるたびに、最後の数秒のスパンと、最大60秒分のメトリクスを落とす（`src/lib/telemetry/sdk.ts` の `ponytail:` コメント）
- クエリを消さない範囲がある（上の「URL のクエリを消す範囲」）

## 本番で確かめていないこと

次の点は、本番ではまだ確かめていない。#496 で確かめ、結果に合わせてこの文書を直す。

- Alloy の Service 名とポート。`k8s-monitoring-alloy.monitoring.svc.cluster.local:4318` は、fishing-infra の values（release 名 `k8s-monitoring`、collector 名 `alloy`）からの推定
- `fishing` の Pod から Alloy に届くか
- Grafana Cloud の Tempo・Prometheus・Loki にデータが入るか。Prometheus での名前とラベルが上の見込みどおりか
- Loki のログの `trace_id` から Tempo のトレースへ辿れるか
- Pi での所要時間とメモリ（SDK を入れる前と後）
