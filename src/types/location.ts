/**
 * 場所検索関連の型定義
 */

/**
 * 場所検索結果
 */
export interface LocationSearchResult {
  /** Google Maps Place ID */
  place_id: string;
  /** フォーマット済みの住所 */
  formatted_address: string;
  /** 緯度 */
  latitude: number;
  /** 経度 */
  longitude: number;
  /** 住所の構成要素 */
  address_components: LocationAddressComponents;
  /** 座標の精度 */
  location_type: 'ROOFTOP' | 'RANGE_INTERPOLATED' | 'GEOMETRIC_CENTER' | 'APPROXIMATE';
}

/**
 * 住所の構成要素
 */
export interface LocationAddressComponents {
  /** 国名 */
  country?: string;
  /** 都道府県名 */
  prefecture?: string;
  /** 市区町村名 */
  city?: string;
  /** 街区住居表示 */
  street?: string;
}

/**
 * 場所検索のオプション
 */
export interface LocationSearchOptions {
  /** キャッシュをスキップするか */
  skipCache?: boolean;
  /** 取得する結果の上限数（デフォルト: 10） */
  limit?: number;
}

/**
 * 場所検索のレスポンス型
 */
export interface LocationSearchResponse<T> {
  /** 検索結果の配列 */
  data: T[];
  /** キャッシュから取得したか */
  fromCache: boolean;
  /** データ取得時刻 */
  fetchedAt: string;
  /** 検索クエリ */
  query: string;
}
