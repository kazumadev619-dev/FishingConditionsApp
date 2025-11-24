# Google Maps API 連携

このドキュメントは、このプロジェクトで Google Maps API を統合し、利用する方法について概説します。

## 概要

Google Maps API は、主に住所から座標への変換（ジオコーディング）など、さまざまな地理空間機能に利用します。API へのアクセスは、専用のクライアントモジュールを介して行われます。

## 設定

Google Maps API を利用するには、API キーを設定する必要があります。

1.  [Google Cloud Console](https://console.cloud.google.com/) から API キーを取得します。
2.  プロジェクトのルートに `.env.local` ファイルが存在しない場合は作成します。
3.  以下の環境変数名で、API キーを `.env.local` ファイルに追加します。

    ```env
    NEXT_PUBLIC_GOOGLE_MAPS_API_KEY=your_google_maps_api_key_here
    ```

    **注意:** `NEXT_PUBLIC_` というプレフィックスは、環境変数をブラウザ側に公開するために必要です。

## API クライアント

Google Maps 用の API クライアントは `src/lib/googleMapsClient.ts` にあります。このモジュールは、Google Maps API エンドポイントへの `fetch` 呼び出しを抽象化します。

### `geocode` 関数

この関数は、住所文字列を地理座標に変換します。

**使用例:**

```typescript
import { geocode } from '@/lib/googleMapsClient';
import { GeocodingResult } from '@/types/google.maps';

const getCoordinates = async (address: string) => {
  try {
    const response = await geocode(address);
    if (response.results.length > 0) {
      const location = response.results[0].geometry.location;
      console.log(`緯度: ${location.lat}, 経度: ${location.lng}`);
      return response.results[0];
    }
  } catch (error) {
    console.error('ジオコーディングに失敗しました:', error);
  }
};
```

## 型定義

Google Maps API のレスポンスに関する型定義は `src/types/google.maps.ts` にあります。これらの型は、Google Maps API の公式ドキュメントに基づいており、API データを扱う際の型安全性を確保するのに役立ちます。

**主要な型:**

-   `GeocodingResponse`: ジオコーディング API レスポンスのトップレベルオブジェクト。
-   `GeocodingResult`: 一致した単一の住所に関する詳細情報。
-   `LatLngLiteral`: 緯度と経度を表すシンプルなオブジェクト。

## 参考資料

-   [Google Maps Platform ドキュメント](https://developers.google.com/maps/documentation?hl=ja)
-   [ジオコーディング API ドキュメント](https://developers.google.com/maps/documentation/geocoding/overview?hl=ja)
