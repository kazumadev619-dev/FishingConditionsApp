# 🔌 外部API統合ガイド

> - **状態**: 仕様（正）
> - **対応する実装**: `src/lib/openWeatherService.ts`、`src/lib/tideService.ts`、`src/lib/portMappingService.ts`、`src/lib/googleMapsClient.ts`、`src/lib/api/client.ts`、`src/components/molecules/FishingLocationMap.tsx`
> - **最終確認**: 2026-11-23（仕様と実装の突き合わせで、対応する実装に `FishingLocationMap.tsx` を、tide736 の `status` が 1 でないときの扱いを足した）。2026-11-20（#388 で、読んで実装と突き合わせて直した。状態を「仕様（正）」のままにするかは #392 で決める）

## 使用しているAPI一覧

### 🌤️ 気象データ - OpenWeatherMap API

- **URL**: https://openweathermap.org/api
- **用途**: 気象データ（風・天気・気温・湿度・気圧）
- **プラン**: 無料枠 1,000 calls/day
- **エンドポイント**: `https://api.openweathermap.org/data/2.5` の `/weather`（現在の天気）と `/forecast`（予報）
- **主要パラメータ**:
  - `lat`, `lon`: 緯度・経度（必須）
  - `appid`: APIキー（必須）
  - `units`: 単位 (`metric`推奨)
  - `lang`: 言語
- **環境変数**: `.env.local` に `OPENWEATHERMAP_API_KEY` として設定してください。
- **レスポンス例**:

```json
{
  "weather": [{ "main": "Clear", "description": "clear sky" }],
  "main": { "temp": 20.5, "humidity": 65, "pressure": 1013 },
  "wind": { "speed": 3.2, "deg": 180 }
}
```

### 🌊 潮汐データ - tide736.net API

- **URL**: https://tide736.net/
- **用途**: 潮汐データ（満潮・干潮時刻・潮位）
- **エンドポイント**: `https://tide736.net/api` + `/get_tide.php`
- **リクエスト方法**: GET のみ
- **主要パラメータ**:
  - `pc`: 都道府県コード (必須)
  - `hc`: 港コード (必須)
  - `yr`: 年 (必須)
  - `mn`: 月 (必須)
  - `dy`: 日 (必須)
  - `rg`: 取得範囲 (`day`, `week`, `month`) (必須)
- **注意点**:
  - APIは緯度・経度による検索をサポートしていません。都道府県コードと港コードが必要です。
  - コード体系は[公式サイト](https://tide736.net/)からダウンロード可能なため、アプリ内（`prisma/data/port-coordinates.csv` を seed した `ports` テーブル）にデータを保持し、緯度・経度から最も近い港を探します。実装済みで、`src/lib/portMappingService.ts` の `findNearestPort` です。
- **レスポンス例**:

```json
{
  "status": 1,
  "message": "success",
  "tide": {
    "port": {
      "prefecture_code": 13,
      "harbor_code": 1,
      "harbor_namej": "東京",
      "latitude": 35.4,
      "longitude": 139.46
    },
    "chart": {
      "2025-11-22": {
        "sun": {
          "rise": "06:23",
          "set": "16:32"
        },
        "moon": {
          "age": "1.2",
          "title": "大潮"
        },
        "flood": [
          { "time": "04:53", "cm": 178 },
          { "time": "16:18", "cm": 183 }
        ],
        "edd": [
          { "time": "10:33", "cm": 84 },
          { "time": "22:58", "cm": 96 }
        ]
      }
    }
  }
}
```

`status` が 1 でないときの扱いは、[api-error-handling.md](./api-error-handling.md#上流の応答が不正なとき) にある。

### 🗺️ 地図・位置情報 - Google Maps API

- **URL**: https://developers.google.com/maps
- **用途**: 地名の座標変換（ジオコーディング）と地図の表示
- **使用サービス**:
  - Geocoding API (座標変換。サーバーから呼ぶ。`src/lib/googleMapsClient.ts`)
  - Maps JavaScript API (地図の表示。ブラウザから呼ぶ。`src/components/molecules/FishingLocationMap.tsx`)
- **使っていないもの**: Places API、Geolocation API
