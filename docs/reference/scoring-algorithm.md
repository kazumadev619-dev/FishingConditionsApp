# 🎣 釣りやすさスコア算出アルゴリズム

> - **状態**: 仕様（正）
> - **対応する実装**: `src/lib/scoring/`、`src/lib/scoringService.ts`、`src/app/api/scores/route.ts`
> - **最終確認**: 2026-11-20（天気スコアと潮の大きさ・潮汐データなしの節は 2026-11-08 に実装に合わせて書き直し、ユーザーが承認した。風速はユーザーの指示で 2/4/6m/s の段階に変え、実装も合わせた。時間帯スコアと表示・解釈は、#388 で実装と突き合わせて直した。表示・解釈の「説明文の風の注意」の節は #401 で足した）

## スコア算出概要

釣りやすさスコアは、環境データを基に0-100の範囲で算出される数値指標です。複数の要素を重み付けして総合的に評価します。

```
総合スコア (0-100) = 潮汐スコア (40) + 天気スコア (35) + 時間帯スコア (25)
```

### 基準時刻

潮汐タイミングと時間帯のスコアは、どの時刻で計算するかで変わる（#301）。

| 呼び出し元 | 基準時刻 |
|---|---|
| 画面（`/`、`/dashboard`） | 現在時刻 |
| `/api/scores`（`date` 省略、または今日の日付） | 現在時刻。キャッシュキーは JST の30分単位の枠（`slot:HH:mm`）で切る |
| `/api/scores`（今日以外の日付） | その日の代表値として JST 9:00。キーは日付だけ |

---

## 🌊 潮汐スコア (0-40点)

### 基本ロジック

潮汐による魚の活性度を評価します。満潮・干潮の前後2時間が最も釣りやすいとされています。

### 計算方法

```typescript
calculateTideScore(tide: TideData, currentTime: Date): number {
  let score = 0;

  // 1. 潮汐タイミングスコア (0-25点)
  const tideTimingScore = this.calculateTideTimingScore(tide, currentTime);

  // 2. 潮の大きさスコア (0-15点)
  const tideSizeScore = this.calculateTideSizeScore(tide);

  return Math.min(40, tideTimingScore + tideSizeScore);
}
```

### 潮汐タイミング評価

時刻と日付はすべて日本時間（`Asia/Tokyo`）で扱う。潮汐データ（tide736）の日付と `HH:mm` は JST なので、実行環境のタイムゾーン（本番のコンテナは UTC）で `getHours()` や `toISOString()` を使うと、時刻がずれたり JST の 0〜9 時に前日の潮汐を引いたりする（#296）。`src/lib/utils/dateUtils.ts` の `getJapanDateTimeParts` / `formatDateInJapan` を使う。

```typescript
private calculateTideTimingScore(tide: TideData, currentTime: Date): number {
  const { hours: currentHour, minutes: currentMinutes } = getJapanDateTimeParts(currentTime);
  const currentTotalMinutes = currentHour * 60 + currentMinutes;
  let maxScore = 0;

  // 満潮・干潮時刻の前後2時間を高評価
  for (const extreme of [...tide.highTides, ...tide.lowTides]) {
    const extremeTotalMinutes = /* 極値の時刻を分単位に変換 */;
    const minDiff = Math.abs(extremeTotalMinutes - currentTotalMinutes);
    const hoursFromExtreme = minDiff / 60;

    if (hoursFromExtreme <= 2) {
      // 前後2時間以内: 高スコア
      const score = 25 - hoursFromExtreme * 6.25; // 2時間で25点から12.5点に減少
      maxScore = Math.max(maxScore, score);
    } else if (hoursFromExtreme <= 4) {
      // 前後4時間以内: 中スコア
      const score = 12.5 - (hoursFromExtreme - 2) * 6.25; // 4時間で12.5点から0点に減少
      maxScore = Math.max(maxScore, score);
    }
  }

  return maxScore;
}
```

### 潮の大きさ評価

潮位差は、**現在時刻に最も近い満潮の高さ − 現在時刻に最も近い干潮の高さ**（m。潮汐データの cm を 100 で割る）。その日の最高満潮と最低干潮ではない。スコアは時間帯ごとに出すので、その時間帯の潮の動きを見る。どちらも、当日の潮汐データの中から選ぶ。

| 潮位差 | スコア | 目安 |
|---|---|---|
| 1.5m 以上 | 15点 | 大潮 |
| 1.0m 以上 1.5m 未満 | 12点 | 中潮 |
| 0.5m 以上 1.0m 未満 | 8点 | 小潮 |
| 0.5m 未満 | 5点 | 長潮・若潮 |

### 潮汐データがないとき

当日の潮汐データがない場合と、満潮か干潮のどちらかが当日にない場合は、潮汐スコアを 20点（満点 40点の中間）にする。

---

## 🌤️ 天気スコア (0-35点)

### 基本ロジック

天気条件による釣りやすさを評価します。風速、天候、気圧の安定性を総合的に判断します。

### 計算方法

```typescript
calculateWeatherScore(weather: WeatherData): number {
  // 1. 風速スコア (0-15点)
  const windScore = this.calculateWindScore(weather.windSpeed);

  // 2. 天候スコア (0-12点)
  const conditionScore = this.calculateConditionScore(weather.condition);

  // 3. 気圧スコア (0-8点)
  const pressureScore = this.calculatePressureScore(weather.pressure);

  return Math.min(35, windScore + conditionScore + pressureScore);
}
```

### 風速評価

| 風速 | スコア | 説明 |
|---|---|---|
| 2m/s 以下 | 15点 | 最適 |
| 2m/s を超え 4m/s 以下 | 10点 | 良好 |
| 4m/s を超え 6m/s 以下 | 5点 | やや不利 |
| 6m/s を超える | 0点 | 不適 |

風速が有限の数値でないとき（欠損・`null`・`NaN`・文字列・無限大）は、点を付けない。OpenWeather の応答を受け取る時点（`src/lib/openWeatherService.ts`）で、不正な応答として弾く（#414）。0 点として扱うと、説明文の風の注意と食い違うため。弾いたときの応答は [api-error-handling.md](./api-error-handling.md#上流の応答が不正なとき) に書く。0m/s は欠損ではなく、有効な値（15点）。

### 天候評価

天候の分類（`weather.main`）で決める。日本語の表記（括弧内）も同じ点数にする。

| 天候 | スコア | 説明 |
|---|---|---|
| Clear、Sunny（晴れ） | 12点 | 最適 |
| Clouds（曇り） | 8点 | 普通 |
| Drizzle、Mist（小雨） | 4点 | やや不利 |
| Rain（雨） | 2点 | 不利 |
| Thunderstorm、Snow（嵐、雪） | 0点 | 不適 |
| 上記以外 | 5点 | 判定できない分類の中間値 |

### 気圧評価

| 気圧 | スコア | 説明 |
|---|---|---|
| 990hPa 以上 1030hPa 以下 | 8点 | 安定 |
| 990hPa 未満、または 1030hPa を超える | 4点 | 不安定 |

---

## 🕐 時間帯スコア (0-25点)

### 基本ロジック

日の出・日の入り前後の時間帯で魚の活性度を評価します。魚は光の変化に敏感で、日の出・日の入り前後が最も活発に活動します。

### 計算方法

```typescript
calculateTimeScore(weatherData: FormattedWeatherData, currentTime: Date): number {
  // 時・分は潮汐と同じく日本時間で取る（getHours() は実行環境のタイムゾーンになる）
  const { hours: currentHour, minutes: currentMinutes } = getJapanDateTimeParts(currentTime);
  const currentTotalMinutes = currentHour * 60 + currentMinutes;

  // 日の出・日の入り時刻を分単位で取得
  const sunrise = getJapanDateTimeParts(weatherData.sunrise);
  const sunset = getJapanDateTimeParts(weatherData.sunset);
  const sunriseTotalMinutes = sunrise.hours * 60 + sunrise.minutes;
  const sunsetTotalMinutes = sunset.hours * 60 + sunset.minutes;

  // 日の出・日の入りからの最短時間を計算（分単位）
  const diffFromSunrise = Math.abs(currentTotalMinutes - sunriseTotalMinutes);
  const diffFromSunset = Math.abs(currentTotalMinutes - sunsetTotalMinutes);
  const minDiff = Math.min(diffFromSunrise, diffFromSunset);

  // 時間を時間単位に変換
  const hoursFromSunEvent = minDiff / 60;

  // 日の出・日の入り前後でスコアを段階的に評価
  if (hoursFromSunEvent <= 1) {
    // ±1時間以内: 最高スコア
    return 25;
  } else if (hoursFromSunEvent <= 2) {
    // ±2時間以内: 中スコア
    return 15;
  } else if (hoursFromSunEvent <= 3) {
    // ±3時間以内: 低スコア
    return 5;
  }

  // それ以外: スコアなし
  return 0;
}
```

### 評価基準

| 時間帯 | スコア | 説明 |
|--------|--------|------|
| 日の出・日の入り ±1時間 | 25点 | 最適な釣り時間帯 |
| 日の出・日の入り ±2時間 | 15点 | 良好な釣り時間帯 |
| 日の出・日の入り ±3時間 | 5点 | やや期待できる時間帯 |
| その他の時間帯 | 0点 | 通常の時間帯 |

---

## 📊 スコア表示・解釈

### スコア範囲と評価

閾値は `src/lib/utils/scoreRank.ts` の `getScoreRank`、ラベルは `src/lib/utils/dashboardUtils.ts` の `getRankLabel` にある。`ScoreInterpretation` という定数は無い。色は `src/app/globals.css` の CSS 変数 `--score-<rank>`（oklch。ライト・ダークで別の値）で、`getRankColor` が `var(--score-<rank>)` を返す。

| ランク | 範囲 | ラベル | CSS 変数 |
|---|---|---|---|
| `excellent` | 80〜100 | 絶好調 | `--score-excellent` |
| `good` | 60〜79 | 良好 | `--score-good` |
| `fair` | 40〜59 | 普通 | `--score-fair` |
| `poor` | 20〜39 | やや不利 | `--score-poor` |
| `bad` | 0〜19 | 不適 | `--score-bad` |

### 合計の丸め

3つの要素を足した合計は、四捨五入して 0〜100 に収める（`src/lib/scoring/index.ts`）。`components` の各値は丸めない。

### 説明文の風の注意

風速が 6m/s を超えるとき（風の点が 0 点になる境目と同じ）、説明文に「風が強いため注意が必要です。」を足す。6m/s ちょうどでは足さない。実装は `src/lib/scoring/explanationGenerator.ts`。

### スコア内訳表示

```typescript
interface ScoreComponents {
  tide: number; // 潮汐スコア (最大40点)
  weather: number; // 天気スコア (最大35点)
  time: number; // 時間帯スコア (最大25点)
}

interface FishingScore {
  score: number; // 総合スコア (0-100)
  rank: ScoreRank;
  components: ScoreComponents;
  explanation: string;
  bestComponent: 'tide' | 'weather' | 'time';
  worstComponent: 'tide' | 'weather' | 'time';
  tideName?: string; // 潮の種類（大潮・中潮など。当日の tide736 の moon.title）
  moonAge?: string; // 月齢（当日の tide736 の moon.age）
  calculatedAt: Date;
}
```
