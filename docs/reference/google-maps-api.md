# Google Maps API 連携

このドキュメントは、このプロジェクトで Google Maps API を統合し、利用する方法について概説します。

## 概要

Google Maps API は、主に住所から座標への変換（ジオコーディング）など、さまざまな地理空間機能に利用します。API へのアクセスは、専用のクライアントモジュールを介して行われます。

## 設定

**API キーは用途ごとに2本に分ける（#143）。1本で兼ねることはできない。**

ブラウザからのリクエストには `Referer` が付き、サーバーからのリクエストには付かない。
1本のキーにリファラ制限を掛けると、その瞬間にサーバー側の Geocoding が
`REQUEST_DENIED` で落ちる。逆に制限を外すと、バンドルに焼き込まれたキーを
第三者がそのまま使えてしまう。

| 変数 | 実行場所 | 使う API | 制限 |
| --- | --- | --- | --- |
| `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` | ブラウザ | Maps JavaScript API | HTTP リファラ |
| `GOOGLE_MAPS_API_KEY` | サーバーのみ | Geocoding API | API 制限のみ |

1.  [Google Cloud Console](https://console.cloud.google.com/) で2本の API キーを作成します。
2.  プロジェクトのルートに `.env.local` ファイルが存在しない場合は作成します。
3.  以下の環境変数名で、それぞれのキーを `.env.local` ファイルに追加します。

    ```env
    # ブラウザ用（Maps JavaScript API）。バンドルへ埋め込まれる前提
    NEXT_PUBLIC_GOOGLE_MAPS_API_KEY=your_browser_google_maps_api_key
    NEXT_PUBLIC_GOOGLE_MAPS_MAP_ID=your_google_maps_map_id

    # サーバー用（Geocoding API）。NEXT_PUBLIC_ を付けてはいけない
    GOOGLE_MAPS_API_KEY=your_server_google_maps_api_key
    ```

    **注意:** `NEXT_PUBLIC_` を付けた変数はビルド時にクライアントバンドルへ
    インライン化される。サーバー用キーに付けると分割した意味が無くなる。
    本番では `k8s/secret.enc.yaml` から `envFrom` でランタイムに渡る
    （ビルド時には不要なので `deploy.yml` の `build-args` には渡さない）。

## API クライアント

Google Maps 用の API クライアントは `src/lib/googleMapsClient.ts` にあります。このモジュールは、Google Maps API エンドポイントへの `fetch` 呼び出しを抽象化します。サーバー専用のキー（`GOOGLE_MAPS_API_KEY`）を使うため、`'use client'` なファイルから import してはいけません。

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
