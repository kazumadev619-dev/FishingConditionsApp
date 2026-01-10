/**
 * 港の基本情報を表すインターフェース
 */
export interface PortInfo {
  prefecture_code: string; // 都道府県コード
  harbor_code: string; // 港コード
  harbor_namej: string; // 日本語の港名
  latitude: string; // 緯度
  longitude: string; // 経度
}

/**
 * 日の出・日の入り情報を表すインターフェース
 */
export interface SunInfo {
  rise: string; // 日の出時刻 (HH:mm)
  set: string; // 日の入り時刻 (HH:mm)
}

/**
 * 月の情報を表すインターフェース
 */
export interface MoonInfo {
  brightness: string; // 輝度 (例: "64.7")
  age: string; // 月齢 (例: "9.1")
  title: string; // 潮の種類 (例: "長潮", "大潮")
}

/**
 * 潮汐イベント（満潮・干潮）の詳細を表すインターフェース
 */
export interface TideEvent {
  time: string; // 時刻 (HH:mm)
  cm: string; // 潮位 (cm)
}

/**
 * 特定の日の潮汐、太陽、月の情報をまとめたインターフェース
 */
export interface DailyTide {
  sun: SunInfo; // 太陽情報
  moon: MoonInfo; // 月情報
  flood: TideEvent[]; // 満潮情報
  edd: TideEvent[]; // 干潮情報 (edd: Ebb-tide Data - 干潮データ)
}

/**
 * 日付をキーとする潮汐チャート情報を表すインターフェース
 */
export interface TideChart {
  [date: string]: DailyTide; // YYYY-MM-DD形式の日付をキーとする日ごとの潮汐情報
}

/**
 * 潮汐データ全体を表すインターフェース
 */
export interface Tide {
  port: PortInfo; // 港情報
  chart: TideChart; // 潮汐チャート
}

/**
 * tide736.net APIのレスポンスのルートオブジェクト
 */
export interface TideApiResponse {
  status: number; // 応答ステータス (0:異常終了／1:正常終了)
  message: string; // 応答メッセージ
  tide: Tide; // 潮汐データ本体
}
