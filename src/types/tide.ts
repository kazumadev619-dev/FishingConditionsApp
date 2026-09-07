/**
 * 港の基本情報を表すインターフェース
 *
 * 注意: tide736.net API は数値フィールドを JSON number で返す。
 * 以前は latitude / longitude を string と宣言していたが実際は number で、
 * しかも値は度分形式（DD.MM）である。十進度として扱うと最大約44km ずれるため、
 * 取り込み時に必ず `dmToDegrees()` で変換すること（#71）。
 */
export interface PortInfo {
  prefecture_code: number; // 都道府県コード (例: 13)
  harbor_code: number; // 港コード (例: 1)
  harbor_namej: string; // 日本語の港名
  harbor_name: string; // ローマ字の港名
  latitude: number; // 緯度（度分形式 DD.MM。例: 35.4 = 35度40分）
  longitude: number; // 経度（度分形式 DD.MM。例: 139.46 = 139度46分）
  level: number; // 基準面からの高さ (cm)
  tide_type: number; // 潮汐型
  calc_time: string; // 推算期間
  sa_ssa: string; // 潮位改正の基準
  calc_way: string; // 推算方法 (例: "ダーウィン法（１か年）")
  observe_public: string; // 観測機関
  calc_public: string; // 推算機関
}

/**
 * 日の出・日の入り情報を表すインターフェース
 */
export interface SunInfo {
  astro_twilight: string[]; // 天文薄明の開始・終了時刻 (HH:mm)
  regular_twilight: string[]; // 常用薄明の開始・終了時刻 (HH:mm)
  rise: string; // 日の出時刻 (HH:mm)
  midline: string; // 南中時刻 (HH:mm)
  set: string; // 日の入り時刻 (HH:mm)
}

/**
 * 月の情報を表すインターフェース
 */
export interface MoonInfo {
  brightness: string; // 輝度 (例: "64.7")
  age: string; // 月齢 (例: "9.1")
  title: string; // 潮の種類 (例: "長潮", "大潮")
  rise: string; // 月の出 (例: " 4日 22:11")
  midline: string; // 南中 (例: " 5日 05:58")
  set: string; // 月の入り (例: " 5日 13:46")
  name: string | null; // 月の名称 (満月など。無い日は null)
}

/**
 * 潮汐イベント（満潮・干潮・時刻ごとの潮位）の詳細を表すインターフェース
 */
export interface TideEvent {
  time: string; // 時刻 (HH:mm)
  unix: number; // Unix時刻 (ミリ秒)
  cm: number; // 潮位 (cm。例: 140.2)
}

/**
 * 特定の日の潮汐、太陽、月の情報をまとめたインターフェース
 */
export interface DailyTide {
  sun: SunInfo; // 太陽情報
  moon: MoonInfo; // 月情報
  tide: TideEvent[]; // 時刻ごとの潮位（潮汐曲線）
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
