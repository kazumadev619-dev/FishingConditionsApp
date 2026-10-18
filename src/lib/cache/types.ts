/**
 * JSON に保存して読み戻した値の型。
 *
 * - Date は ISO 文字列になる
 * - Map / Set は `{}` になる
 * - 関数はキーごと消えるので `undefined` として読める
 * - 配列・タプル・optional・union はそのまま保つ（マップ型が配列とタプルを保ち、条件型が union に分配される）
 */
export type Jsonified<T> = T extends Date
  ? string
  : T extends ReadonlyMap<unknown, unknown> | ReadonlySet<unknown>
    ? Record<string, never>
    : T extends (...args: never[]) => unknown
      ? undefined
      : T extends object
        ? { [Key in keyof T]: Jsonified<T[Key]> }
        : T;
