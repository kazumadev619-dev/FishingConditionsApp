import type { GeocodingResponse } from '@/types/google.maps';
import { googleMapsClient } from './apiClient';
import { logger } from './logger';

/**
 * 住所文字列を使用してジオコーディングを実行し、緯度経度などの情報を取得します。
 * この関数は、汎用のAPIクライアントインスタンスを利用してリクエストを送信します。
 * @param address 検索する住所または地名
 * @returns ジオコーディング結果を含むPromise
 * @throws APIがエラーを返した場合にエラーをスローします
 */
export const geocode = async (address: string): Promise<GeocodingResponse> => {
  // Google Maps APIが正しく設定されているかチェック
  if (!googleMapsClient.isAvailable()) {
    throw new Error(
      'Google Maps API is not configured. Please set GOOGLE_MAPS_API_KEY in your environment variables.',
    );
  }

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
    logger.error({ err: error, address }, 'Geocode function error');
    throw error; // エラーを再スローして、呼び出し元で処理できるようにする
  }
};
