/**
 * 制約違反の判定（#161）
 *
 * ここで使う `meta` と `message` は、**ローカルの PostgreSQL に対して実際に
 * 制約違反を起こして採取したもの。** 手で書いた「理想的な」形でテストすると、
 * まさにこの issue の原因（実際の形が想定と違う）を再現できない。
 *
 * **`@prisma/adapter-pg` の 7.9.1 と 7.10.0 の両方で採取している。** この2版だけで
 * 形が変わっており（7.9.1 は `constraint.fields` とメッセージ `on the fields: (\`email\`)`、
 * 7.10.0 は `constraint.index` とメッセージ `on the constraint: \`users_email_key\``）、
 * 片方だけで書くと「たまたま今の版で通る」テストになる。
 *
 * 採取は次の形で行える（`fishing-postgres` 稼働が前提）:
 *
 *   prisma.users.create() を同じ email で2回 → P2002
 *   prisma.user_favorites.create() に存在しない user_id / location_id → P2003
 *   既存の user_favorites を同じ組み合わせで作成 → P2002（複合ユニーク）
 *
 * CI には PostgreSQL が無いため、採取結果を固定値として持つ。Prisma を上げて
 * 形が変わったらここが落ちるので、気づける。
 */
import { describe, expect, it } from 'vitest';
import { Prisma } from '@/generated/prisma/client';
import { CONSTRAINTS, isViolationOf } from './prismaConstraints';

/** 採取した実物から PrismaClientKnownRequestError を組み立てる */
function knownError(code: string, message: string, meta: unknown, clientVersion = '7.10.0') {
  return new Prisma.PrismaClientKnownRequestError(message, {
    code,
    clientVersion,
    meta: meta as Record<string, unknown>,
  });
}

// ---- @prisma/adapter-pg 7.10.0 で実際に採取した形（constraint.index + メッセージに制約名）----

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
});

// ---- @prisma/adapter-pg 7.9.1 で実際に採取した形 ----
// 同じ driver adapter でも constraint の中身が fields になり、メッセージも
// `on the fields: (`email`)` に変わる。メッセージからの制約名抽出はここでは効かず、
// fields 側で拾えている必要がある

const usersEmailDuplicate791 = knownError(
  'P2002',
  'Unique constraint failed on the fields: (`email`)',
  {
    modelName: 'users',
    driverAdapterError: {
      name: 'DriverAdapterError',
      cause: {
        originalCode: '23505',
        originalMessage: 'duplicate key value violates unique constraint "users_email_key"',
        kind: 'UniqueConstraintViolation',
        constraint: { fields: ['email'] },
      },
    },
  },
  '7.9.1',
);

const favoritesAlreadyAdded791 = knownError(
  'P2002',
  'Unique constraint failed on the fields: (`user_id`, `location_id`)',
  {
    modelName: 'user_favorites',
    driverAdapterError: {
      name: 'DriverAdapterError',
      cause: {
        originalCode: '23505',
        originalMessage:
          'duplicate key value violates unique constraint "user_favorites_user_id_location_id_key"',
        kind: 'UniqueConstraintViolation',
        constraint: { fields: ['user_id', 'location_id'] },
      },
    },
  },
  '7.9.1',
);

describe('7.9.1 の形（constraint.fields / メッセージに制約名が無い）', () => {
  it('users.email の重複を検出する', () => {
    // メッセージは `on the fields: (`email`)` で制約名を含まないため、
    // fields 側で拾えていないと判定できない
    expect(isViolationOf(usersEmailDuplicate791, CONSTRAINTS.usersEmail)).toBe(true);
  });

  // この版では複合ユニークが ['user_id', 'location_id'] として現れる。
  // code を照合しないと user_id の外部キー違反と取り違えて、
  // 「既に登録済み（409）」が「ユーザーが存在しない（401）」になる
  it('複合ユニークのカラム名一覧を外部キーの違反と取り違えない', () => {
    expect(isViolationOf(favoritesAlreadyAdded791, CONSTRAINTS.favoritesUserId)).toBe(false);
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

  // 今のところ P2003 は 7.9.1 / 7.10.0 のどちらも index に完全な制約名を載せるので、
  // favoritesUserId の field フォールバックが決め手になる形は観測されていない。
  // 将来 P2002 と同じくカラム名だけ載る形に変わったときに気づけるよう固定しておく
  it('外部キー違反でカラム名しか載らなくなっても判定できる', () => {
    const e = knownError('P2003', 'Foreign key constraint failed', {
      driverAdapterError: { cause: { constraint: { fields: ['user_id'] } } },
    });
    expect(isViolationOf(e, CONSTRAINTS.favoritesUserId)).toBe(true);
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
