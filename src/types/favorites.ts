/**
 * お気に入り機能関連の型定義
 */

/**
 * お気に入り追加リクエスト
 */
export interface FavoriteRequest {
  /** 既存のlocation_idを指定（パターン1） */
  locationId?: string;
  /** portIdから location を作成（パターン2） */
  portId?: string;
  /** 座標から location を作成（パターン3） */
  coordinates?: {
    lat: number;
    lng: number;
    name: string;
  };
}

/**
 * お気に入り釣り場の情報
 */
export interface FavoriteLocation {
  /** お気に入りID */
  id: string;
  /** 釣り場ID */
  locationId: string;
  /** 釣り場名 */
  name: string;
  /** 緯度 */
  latitude: number;
  /** 経度 */
  longitude: number;
  /** 地域 */
  region?: string | null;
  /** 都道府県 */
  prefecture?: string | null;
  /** お気に入り登録日時 */
  createdAt: string;
}

/**
 * お気に入り一覧のレスポンス
 */
export interface FavoritesResponse {
  /** お気に入り釣り場の配列 */
  favorites: FavoriteLocation[];
  /** 取得件数 */
  count: number;
}

/**
 * お気に入り追加のレスポンス
 */
export interface FavoriteAddResponse {
  /** 成功フラグ */
  success: boolean;
  /** 登録された釣り場ID（URL更新用） */
  locationId: string;
}

/**
 * お気に入り API のエラーレスポンス
 */
export interface FavoriteErrorResponse {
  /** エラーメッセージ */
  error: string;
  /**
   * 409（既に登録済み）のときだけ入る。
   * 「登録済みなのに UI が未登録と思っている」状態から復帰するために使う（#78）。
   */
  locationId?: string;
}
