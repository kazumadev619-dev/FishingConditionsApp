# 🎣 釣りやすさスコア算出アルゴリズム

## スコア算出概要

釣りやすさスコアは、環境データを基に0-100の範囲で算出される数値指標です。複数の要素を重み付けして総合的に評価します。

```
総合スコア (0-100) = 潮汐スコア (40) + 天気スコア (35) + 時間帯スコア (25)
```

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

```typescript
private calculateTideTimingScore(tide: TideData, currentTime: Date): number {
  const currentHour = currentTime.getHours();
  const currentMinutes = currentTime.getMinutes();
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

```typescript
private calculateTideSizeScore(tide: TideData): number {
  // 潮位差を計算
  const highestTide = Math.max(...tide.highTides.map(t => t.height));
  const lowestTide = Math.min(...tide.lowTides.map(t => t.height));
  const tideRange = highestTide - lowestTide;

  // 潮位差による評価
  if (tideRange >= 1.5) return 15;      // 大潮
  if (tideRange >= 1.0) return 12;      // 中潮
  if (tideRange >= 0.5) return 8;       // 小潮
  return 5;                             // 長潮・若潮
}
```

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

```typescript
private calculateWindScore(windSpeed: number): number {
  if (windSpeed <= 3) return 15;        // 微風: 最適
  if (windSpeed <= 5) return 12;        // 軽風: 良好
  if (windSpeed <= 8) return 8;         // 軟風: 普通
  if (windSpeed <= 10) return 5;        // 和風: やや不利
  return 0;                             // 疾風以上: 不適
}
```

### 天候評価

```typescript
private calculateConditionScore(condition: string): number {
  const conditionScores = {
    'Clear': 12,           // 晴れ: 最適
    'Partly Cloudy': 10,   // 薄曇り: 良好
    'Cloudy': 8,           // 曇り: 普通
    'Light Rain': 5,       // 小雨: やや不利
    'Rain': 2,             // 雨: 不利
    'Heavy Rain': 0,       // 大雨: 不適
    'Thunderstorm': 0,     // 雷雨: 不適
    'Snow': 0              // 雪: 不適
  };

  return conditionScores[condition] || 5;
}
```

### 気圧評価

```typescript
private calculatePressureScore(pressure: number): number {
  // 標準気圧 1013hPa を基準とした安定性評価
  const deviation = Math.abs(pressure - 1013);

  if (deviation <= 5) return 8;         // 非常に安定
  if (deviation <= 10) return 6;        // 安定
  if (deviation <= 20) return 4;        // やや不安定
  if (deviation <= 30) return 2;        // 不安定
  return 0;                             // 非常に不安定
}
```

---

## 🕐 時間帯スコア (0-25点)

### 基本ロジック

日の出・日の入り前後の時間帯で魚の活性度を評価します。魚は光の変化に敏感で、日の出・日の入り前後が最も活発に活動します。

### 計算方法

```typescript
calculateTimeScore(weatherData: FormattedWeatherData, currentTime: Date): number {
  const currentHour = currentTime.getHours();
  const currentMinutes = currentTime.getMinutes();
  const currentTotalMinutes = currentHour * 60 + currentMinutes;

  // 日の出・日の入り時刻を分単位で取得
  const sunriseTotalMinutes = weatherData.sunrise.getHours() * 60 + weatherData.sunrise.getMinutes();
  const sunsetTotalMinutes = weatherData.sunset.getHours() * 60 + weatherData.sunset.getMinutes();

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

```typescript
export const ScoreInterpretation = {
  excellent: { min: 80, max: 100, label: '絶好調', color: '#22c55e' },
  good: { min: 60, max: 79, label: '良好', color: '#3b82f6' },
  fair: { min: 40, max: 59, label: '普通', color: '#f59e0b' },
  poor: { min: 20, max: 39, label: 'やや不利', color: '#f97316' },
  bad: { min: 0, max: 19, label: '不適', color: '#ef4444' },
};
```

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
  calculatedAt: Date;
}
```
