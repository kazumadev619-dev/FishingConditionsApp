/**
 * 制約違反の判定（#161）
 *
 * ここで使う `meta` と `message` は、**ローカルの PostgreSQL に対して実際に
 * 制約違反を起こして採取したもの。** 手で書いた「理想的な」形でテストすると、
 * まさにこの issue の原因（実際の形が想定と違う）を再現できない。
 *
 * 採取は次の形で行える（`fishing-postgres` 稼働が前提）:
 *
 *   prisma.users.create() を同じ email で2回 → P2002
 *   prisma.user_favorites.create() に存在しない user_id / location_id → P2003
 *
 * CI には PostgreSQL が無いため、採取結果を固定値として持つ。Prisma を上げて
 * 形が変わったらここが落ちるので、気づける。
 */
import { describe, expect, it } from 'vitest';
import { Prisma } from '@/generated/prisma/client';
import { CONSTRAINTS, isViolationOf } from './prismaConstraints';

/** 採取した実物から PrismaClientKnownRequestError を組み立てる */
function knownError(code: string, message: string, meta: unknown) {
  return new Prisma.PrismaClientKnownRequestError(message, {
    code,
    clientVersion: '7.10.0',
    meta: meta as Record<string, unknown>,
  });
}

// ---- @prisma/adapter-pg 7.10.0 で実際に採取した形 ----

const usersEmailDuplicate = knownError(
  'P2002',
  'Unique constraint failed on the constraint: `users_email_key`',
  {
    driverAdapterError: {
      name: 'DriverAdapterError',
      cause: {
        originalCode: '23505',
        originalMessage: 'duplicate key value violates unique constraint "users_email_key"',
        kind: 'UniqueConstraintViolation',
        constraint: { index: 'users_email_key' },
        table: 'users',
      },
    },
    modelName: 'users',
  },
);

const favoritesUserIdMissing = knownError(
  'P2003',
  'Foreign key constraint violated on the constraint: `user_favorites_user_id_fkey`',
  {
    modelName: 'user_favorites',
    driverAdapterError: {
      name: 'DriverAdapterError',
      cause: {
        originalCode: '23503',
        kind: 'ForeignKeyConstraintViolation',
        constraint: { index: 'user_favorites_user_id_fkey' },
      },
    },
  },
);

const favoritesLocationIdMissing = knownError(
  'P2003',
  'Foreign key constraint violated on the constraint: `user_favorites_location_id_fkey`',
  {
    modelName: 'user_favorites',
    driverAdapterError: {
      name: 'DriverAdapterError',
      cause: {
        originalCode: '23503',
        kind: 'ForeignKeyConstraintViolation',
        constraint: { index: 'user_favorites_location_id_fkey' },
      },
    },
  },
);

const favoritesAlreadyAdded = knownError(
  'P2002',
  'Unique constraint failed on the constraint: `user_favorites_user_id_location_id_key`',
  {
    driverAdapterError: {
      name: 'DriverAdapterError',
      cause: {
        originalCode: '23505',
        kind: 'UniqueConstraintViolation',
        constraint: { index: 'user_favorites_user_id_location_id_key' },
        table: 'user_favorites',
      },
    },
    modelName: 'user_favorites',
  },
);

describe('driver adapter 経由の実際のエラー形状', () => {
  it('users.email の重複を検出する', () => {
    expect(isViolationOf(usersEmailDuplicate, CONSTRAINTS.usersEmail)).toBe(true);
  });

  it('user_favorites.user_id の外部キー違反を検出する', () => {
    expect(isViolationOf(favoritesUserIdMissing, CONSTRAINTS.favoritesUserId)).toBe(true);
  });

  it('location_id の外部キー違反を user_id と取り違えない', () => {
    // ここが false にならないと、地点が存在しないだけなのに 401 を返してしまう
    expect(isViolationOf(favoritesLocationIdMissing, CONSTRAINTS.favoritesUserId)).toBe(false);
  });

  it('複合ユニーク user_favorites_user_id_location_id_key を user_id の外部キーと取り違えない', () => {
    // 制約名が user_id を部分文字列として含むため、部分一致で判定すると
    // 「既に登録済み（409）」が「ユーザーが存在しない（401）」になる
    expect(isViolationOf(favoritesAlreadyAdded, CONSTRAINTS.favoritesUserId)).toBe(false);
  });

  it('エラーコードが違えば一致しない', () => {
    expect(isViolationOf(usersEmailDuplicate, CONSTRAINTS.favoritesUserId)).toBe(false);
    expect(isViolationOf(favoritesUserIdMissing, CONSTRAINTS.usersEmail)).toBe(false);
  });

  // 実在する制約。user_favorites 以外にも user_id の外部キーを持つテーブルがある
  // （identities_user_id_fkey / user_settings_user_id_fkey）。部分一致で判定すると
  // 別テーブルの違反まで拾ってしまう
  it('別テーブルの user_id 外部キーを user_favorites のものと取り違えない', () => {
    const e = knownError(
      'P2003',
      'Foreign key constraint violated on the constraint: `user_settings_user_id_fkey`',
      {
        modelName: 'user_settings',
        driverAdapterError: {
          cause: {
            kind: 'ForeignKeyConstraintViolation',
            constraint: { index: 'user_settings_user_id_fkey' },
          },
        },
      },
    );

    expect(isViolationOf(e, CONSTRAINTS.favoritesUserId)).toBe(false);
  });

  // カラム名しか載らない形では、複合ユニークが ['user_id', 'location_id'] として
  // 現れる。code を照合しないと、これを user_id の外部キー違反と取り違えて
  // 「既に登録済み（409）」が「ユーザーが存在しない（401）」になる
  it('複合ユニークのカラム名一覧を外部キー違反と取り違えない', () => {
    const e = knownError('P2002', 'Unique constraint failed', {
      target: ['user_id', 'location_id'],
    });

    expect(isViolationOf(e, CONSTRAINTS.favoritesUserId)).toBe(false);
  });
});

describe('meta の形が変わっても判定が死なないこと', () => {
  // #161 の原因そのもの。driver adapter を使わない Prisma はこの形で返す
  it('meta.target（素の Prisma の P2002）', () => {
    const e = knownError('P2002', 'Unique constraint failed', { target: ['email'] });
    expect(isViolationOf(e, CONSTRAINTS.usersEmail)).toBe(true);
  });

  it('meta.constraint が文字列（素の Prisma の P2003）', () => {
    const e = knownError('P2003', 'Foreign key constraint failed', {
      constraint: 'user_favorites_user_id_fkey',
    });
    expect(isViolationOf(e, CONSTRAINTS.favoritesUserId)).toBe(true);
  });

  it('driverAdapterError.cause.constraint.fields（カラム名しか載らない形）', () => {
    const e = knownError('P2002', 'Unique constraint failed', {
      driverAdapterError: { cause: { constraint: { fields: ['email'] } } },
    });
    expect(isViolationOf(e, CONSTRAINTS.usersEmail)).toBe(true);
  });

  it('メッセージが制約名を含まなくても meta から拾う', () => {
    // メッセージの文面は Prisma の版で変わりうる。meta 側だけで判定できることを固定する
    const e = knownError('P2002', 'Unique constraint failed', {
      driverAdapterError: { cause: { constraint: { index: 'users_email_key' } } },
    });

    expect(isViolationOf(e, CONSTRAINTS.usersEmail)).toBe(true);
  });

  it('meta が空でもメッセージから制約名を拾う', () => {
    const e = knownError(
      'P2002',
      'Unique constraint failed on the constraint: `users_email_key`',
      undefined,
    );
    expect(isViolationOf(e, CONSTRAINTS.usersEmail)).toBe(true);
  });

  it('meta もメッセージも手がかりが無ければ false', () => {
    const e = knownError('P2002', 'Unique constraint failed', {});
    expect(isViolationOf(e, CONSTRAINTS.usersEmail)).toBe(false);
  });
});
