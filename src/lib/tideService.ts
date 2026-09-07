/**
 * 潮汐データサービス
 * tide736.net API を使用して潮汐情報を取得
 */

import type { DailyTide, TideApiResponse, TideEvent } from '@/types/tide';
import { tide736Client } from './apiClient';
import { CACHE_PREFIX, CACHE_TTL, generateCacheKey, reviveDate, withCache } from './cache';

// Re-export types for external use
export type { DailyTide, TideEvent };

/**
 * 潮汐取得時のオプション
 */
export interface TideOptions {
  /** キャッシュをスキップするか */
  skipCache?: boolean;
  /** 取得範囲（day, week, month） */
  range?: 'day' | 'week' | 'month';
}

/**
 * 潮汐サービスのレスポンス型
 */
export interface TideResponse<T> {
  data: T;
  fromCache: boolean;
  fetchedAt: string;
}

/**
 * アプリケーション用に整形された潮汐データ
 */
export interface FormattedTideData {
  /** ポート情報 */
  port: {
    prefecture_code: string;
    port_code: string;
    port_name: string;
  };
  /** 日ごとの潮汐情報（複数日分） */
  tides: Array<{
    date: string;
    daily: DailyTide;
  }>;
  /** データ取得時刻 */
  dataTime: Date;
}

/**
 * tide736.net APIからのレスポンスをアプリ用に整形
 */
function formatTideData(raw: TideApiResponse): FormattedTideData {
  const tides = Object.entries(raw.tide.chart).map(([date, daily]) => ({
    date,
    daily,
  }));

  return {
    port: {
      // API は数値で返すが、DB の ports テーブル側が VarChar なので文字列で揃える
      prefecture_code: String(raw.tide.port.prefecture_code),
      port_code: String(raw.tide.port.harbor_code),
      port_name: raw.tide.port.harbor_namej,
    },
    tides,
    dataTime: new Date(),
  };
}

/**
 * キャッシュヒット時に Date フィールドを Date インスタンスへ復元する（withCache の revive）。
 * FormattedTideData.dataTime は Date 宣言だが、キャッシュは JSON で往復するため
 * 復元しないと文字列のまま返り、型が実態と食い違う。
 */
function reviveTideDates(data: FormattedTideData): FormattedTideData {
  return {
    ...data,
    dataTime: reviveDate(data.dataTime, 'dataTime'),
  };
}

/**
 * 都道府県コードと港コードから潮汐データを取得
 * @param prefectureCode 都道府県コード
 * @param portCode 港コード
 * @param date 取得日付（YYYY-MM-DD形式）
 * @param options オプション
 */
export async function getTideData(
  prefectureCode: string,
  portCode: string,
  date: string,
  options: TideOptions = {},
): Promise<TideResponse<FormattedTideData>> {
  const { skipCache = false, range = 'week' } = options;

  // 日付をパース（YYYY-MM-DDの形式を想定）
  const [year, month, day] = date.split('-');

  const cacheKey = generateCacheKey(CACHE_PREFIX.TIDE, {
    prefecture: prefectureCode,
    port: portCode,
    year,
    month,
    day,
    range,
  });

  const fetchTide = async (): Promise<FormattedTideData> => {
    const rawData = await tide736Client.get<TideApiResponse>('/get_tide.php', {
      params: {
        pc: prefectureCode, // prefecture code
        hc: portCode, // harbor code
        yr: year, // year
        mn: month, // month
        dy: day, // day
        rg: range, // range（day, week, month）
      },
    });

    if (rawData.status !== 1) {
      throw new Error(`tide736 API Error: ${rawData.message}`);
    }

    return formatTideData(rawData);
  };

  if (skipCache) {
    const data = await fetchTide();
    return {
      data,
      fromCache: false,
      fetchedAt: new Date().toISOString(),
    };
  }

  const { data, fromCache } = await withCache(cacheKey, CACHE_TTL.TIDE, fetchTide, reviveTideDates);

  return {
    data,
    fromCache,
    fetchedAt: new Date().toISOString(),
  };
}

/**
 * API キーが不要（tide736.net はキー不要）なので常に true
 */
export function isTideApiConfigured(): boolean {
  return true;
}
