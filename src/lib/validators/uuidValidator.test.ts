import { describe, expect, it } from 'vitest';
import { isValidUUID, UUID_REGEX } from './uuidValidator';

// 守る状態（#475, testing-policy.md 7節④）:
// UUID 検証で先頭・末尾アンカーが外れたり非文字列を通したりすると、
// 無効なセッション ID やリクエスト ID が DB クエリや認証境界をすり抜ける。
describe('uuidValidator', () => {
  describe('有効な UUID', () => {
    it.each([
      ['小文字の UUID', '11111111-1111-4111-8111-111111111111'],
      ['大文字の UUID', 'ABCDEF01-2345-4789-ABCD-EF0123456789'],
      ['大文字・小文字混在の UUID', 'a1B2c3D4-e5F6-4890-AbCd-Ef1234567890'],
      ['すべて 0 の UUID', '00000000-0000-0000-0000-000000000000'],
    ])('%s を有効と判定する', (_label, input) => {
      expect(isValidUUID(input)).toBe(true);
      expect(UUID_REGEX.test(input)).toBe(true);
    });
  });

  describe('前後余分文字列・境界違反を拒否する（^ / $ アンカーの検証）', () => {
    it.each([
      ['末尾に余分な文字列がある', '11111111-1111-4111-8111-111111111111-extra'],
      ['先頭に余分な文字列がある', 'prefix-11111111-1111-4111-8111-111111111111'],
      ['前後に余分な空白がある', ' 11111111-1111-4111-8111-111111111111 '],
      ['末尾に改行がある', '11111111-1111-4111-8111-111111111111\n'],
      ['先頭に改行がある', '\n11111111-1111-4111-8111-111111111111'],
    ])('%s 場合は false を返す', (_label, input) => {
      expect(isValidUUID(input)).toBe(false);
      expect(UUID_REGEX.test(input)).toBe(false);
    });
  });

  describe('形式不正な文字列を拒否する', () => {
    it.each([
      ['空文字', ''],
      ['一般的な非 UUID 文字列', 'not-a-uuid'],
      ['先頭セグメントが 7 桁', '1111111-1111-4111-8111-111111111111'],
      ['末尾セグメントが 13 桁', '11111111-1111-4111-8111-1111111111111'],
      ['16 進数以外の文字を含む', 'gggggggg-1111-4111-8111-111111111111'],
      ['ハイフン区切りが無い', '11111111111141118111111111111111'],
    ])('%s は false を返す', (_label, input) => {
      expect(isValidUUID(input)).toBe(false);
    });
  });

  describe('非文字列・未定義値を拒否する', () => {
    it.each([
      ['undefined', undefined],
      ['null', null],
      ['数値', 123],
      ['真偽値', true],
      ['オブジェクト', {}],
      ['配列', []],
      ['UUID 文字列を要素に持つ配列', ['11111111-1111-4111-8111-111111111111']],
      [
        'toString が UUID を返すオブジェクト',
        { toString: () => '11111111-1111-4111-8111-111111111111' },
      ],
    ])('%s は false を返す', (_label, input) => {
      expect(isValidUUID(input as unknown as string | undefined)).toBe(false);
    });
  });
});
