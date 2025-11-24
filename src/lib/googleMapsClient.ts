import { GeocodingResponse } from '@/types/google.maps';
import { googleMapsClient } from './apiClient';

/**
 * 住所文字列を使用してジオコーディングを実行し、緯度経度などの情報を取得します。
 * この関数は、汎用のAPIクライアントインスタンスを利用してリクエストを送信します。
 * @param address 検索する住所または地名
 * @returns ジオコーディング結果を含むPromise
 * @throws APIがエラーを返した場合にエラーをスローします
 */
export const geocode = async (address: string): Promise<GeocodingResponse> => {
  try {
    const data = await googleMapsClient.get<GeocodingResponse>('/geocode/json', {
      params: {
        address,
        language: 'ja',
      },
    });

    if (data.status !== 'OK') {
      throw new Error(`Geocoding API error: ${data.status} - ${data.error_message || ''}`);
    }

    return data;
  } catch (error) {
    console.error('An error occurred in the geocode function:', error);
    throw error; // エラーを再スローして、呼び出し元で処理できるようにする
  }
};
