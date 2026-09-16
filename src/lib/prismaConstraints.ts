import type { Prisma } from '@/generated/prisma/client';

/**
 * 制約違反エラーが、どの制約で起きたかを判定する（#161）。
 *
 * Prisma は制約の情報を `error.meta` に載せるが、**その形が一定ではない。**
 * `@prisma/adapter-pg`（driver adapter）を通すと、素の Prisma が載せる
 * `meta.target` / `meta.constraint` が存在しなくなり、
 * `meta.driverAdapterError.cause.constraint` の下にネストする。しかもその中身も
 * 7.9.1 では `{ fields: ['email'] }`、7.10.0 では `{ index: 'users_email_key' }` と
 * 変わっている。
 *
 * このため `meta.target` だけを見るコードは driver adapter 経由では常に
 * undefined を読み、分岐が到達しなくなる。実際 signup のメールアドレス重複
 * メッセージは一度も表示されておらず、お気に入り追加の FK 違反は user_id 起因でも
 * 常に「地点が無い」と応答していた。
 *
 * 既知の置き場所をすべて探し、加えて `error.message` からも拾う。メッセージは
 * `Unique constraint failed on the constraint: ` + 制約名 の形で、driver adapter の
 * 有無に関わらず制約名を含む。どれか一つの形が変わっても判定が死なないようにする。
 */

/** meta の中で制約情報が入りうる形 */
interface ConstraintShape {
  index?: unknown;
  fields?: unknown;
}

interface PrismaErrorMeta {
  target?: unknown;
  constraint?: unknown;
  driverAdapterError?: {
    cause?: {
      constraint?: ConstraintShape;
    };
  };
}

/** 文字列なら1要素、文字列配列ならそのまま、それ以外は空 */
function toStrings(value: unknown): string[] {
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) return value.filter((v): v is string => typeof v === 'string');
  return [];
}

/**
 * エラーメッセージから制約名を取り出す。
 * 例: "Unique constraint failed on the constraint: `users_email_key`"
 */
function constraintFromMessage(message: string): string[] {
  const match = message.match(/constraint: `([^`]+)`/);
  return match ? [match[1]] : [];
}

/**
 * 制約違反がどこで起きたかを表す文字列をすべて集める。
 * 制約名（`users_email_key`）とカラム名（`email`）が混在しうる。
 */
function violationHints(error: Prisma.PrismaClientKnownRequestError): string[] {
  const meta = error.meta as PrismaErrorMeta | undefined;
  const nested = meta?.driverAdapterError?.cause?.constraint;

  return [
    ...toStrings(meta?.target),
    ...toStrings(meta?.constraint),
    ...toStrings(nested?.index),
    ...toStrings(nested?.fields),
    ...constraintFromMessage(error.message),
  ];
}

/** 判定したい制約の指定 */
export interface ConstraintDescriptor {
  /** この制約違反が現れる Prisma のエラーコード */
  code: string;
  /** DB 上の制約名（`users_email_key` など） */
  constraint: string;
  /** カラム名。Prisma が制約名ではなくカラム名を載せる形のときのフォールバック */
  field: string;
}

/**
 * 制約違反が指定の制約で起きたかを判定する。
 *
 * 一致は**完全一致**で見る。部分一致にすると
 * `user_favorites_user_id_location_id_key`（複合ユニーク）を `user_id` で拾って
 * しまい、お気に入りの重複登録を「ユーザーが存在しない」と誤判定する。
 *
 * `code` も照合するのは同じ理由。カラム名しか載らない形では複合ユニークが
 * `['user_id', 'location_id']` として現れうるため、外部キー違反の判定と
 * 取り違える余地が残る。呼び出し側が switch で分岐していても、ここで閉じておく。
 */
export function isViolationOf(
  error: Prisma.PrismaClientKnownRequestError,
  { code, constraint, field }: ConstraintDescriptor,
): boolean {
  if (error.code !== code) return false;

  const hints = violationHints(error);
  return hints.includes(constraint) || hints.includes(field);
}

/** このリポジトリで分岐に使っている制約 */
export const CONSTRAINTS = {
  /** users.email のユニーク制約 */
  usersEmail: {
    code: 'P2002',
    constraint: 'users_email_key',
    field: 'email',
  },
  /** user_favorites.user_id の外部キー */
  favoritesUserId: {
    code: 'P2003',
    constraint: 'user_favorites_user_id_fkey',
    field: 'user_id',
  },
} as const satisfies Record<string, ConstraintDescriptor>;
