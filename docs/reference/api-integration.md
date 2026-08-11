# 🔌 外部API統合ガイド

## 使用予定API一覧

### 🌤️ 気象データ - OpenWeatherMap API

- **URL**: https://openweathermap.org/api
- **用途**: 気象データ（風・天気・気温・湿度・気圧）
- **プラン**: 無料枠 1,000 calls/day
- **エンドポイント**: `https://api.openweathermap.org/data/2.5/weather`
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
- **エンドポイント**: `https://api.tide736.net/get_tide.php`
- **リクエスト方法**: GET or POST
- **主要パラメータ**:
  - `pc`: 都道府県コード (必須)
  - `hc`: 港コード (必須)
  - `yr`: 年 (必須)
  - `mn`: 月 (必須)
  - `dy`: 日 (必須)
  - `rg`: 取得範囲 (`day`, `week`, `month`) (必須)
- **注意点**:
  - APIは緯度・経度による検索をサポートしていません。都道府県コードと港コードが必要です。
  - コード体系は[公式サイト](https://tide736.net/)からダウンロード可能なため、アプリ内にデータを保持し、緯度・経度から最も近い港を検索するロジックを実装する必要があります。
- **レスポンス例**:

```json
{
  "status": 1,
  "message": "success",
  "tide": {
    "port": {
      "prefecture_code": "13",
      "harbor_code": "tk",
      "harbor_namej": "東京",
      "latitude": "35.38.25",
      "longitude": "139.46.52"
    },
    "chart": {
      "2025-11-22": {
        "sun": {
          "rise": "06:23",
          "set": "16:32"
        },
        "moon": {
          "age": 1.2,
          "title": "新月"
        },
        "flood": [
          { "time": "04:53", "cm": "178" },
          { "time": "16:18", "cm": "183" }
        ],
        "edd": [
          { "time": "10:33", "cm": "84" },
          { "time": "22:58", "cm": "96" }
        ]
      }
    }
  }
}
```

### 🗺️ 地図・位置情報 - Google Maps API

- **URL**: https://developers.google.com/maps
- **用途**: 地名検索・ジオコーディング・現在位置
- **使用サービス**:
  - Places API (地名検索)
  - Geocoding API (座標変換)
  - Geolocation API (現在位置)
