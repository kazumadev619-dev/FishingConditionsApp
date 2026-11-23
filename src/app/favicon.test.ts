/**
 * favicon.ico 配置とバイナリ形式の回帰テスト（#443）
 *
 * `public/` は docker/Dockerfile の runner ステージへコピーされないため、
 * Next.js App Router の規約に従い `src/app/favicon.ico` に配置する。
 * 消えたり壊れたバイナリに差し替わると、本番環境で /favicon.ico が 404 になる。
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const FAVICON_PATH = fileURLToPath(new URL('./favicon.ico', import.meta.url));

/** ICO ファイルの ICONDIR / ICONDIRENTRY 最小仕様（Microsoft ICO 形式） */
const ICONDIR_SIZE = 6;
const ICONDIRENTRY_SIZE = 16;
const ICO_TYPE = 1;
const BITMAPINFOHEADER_SIZE = 40;
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

describe('src/app/favicon.ico（#443）', () => {
  it('有効な ICO ヘッダと画像エントリを持つ', () => {
    const buf = readFileSync(FAVICON_PATH);

    expect(buf.length).toBeGreaterThan(ICONDIR_SIZE + ICONDIRENTRY_SIZE);
    // ICONDIR: idReserved (0x0000), idType (0x0001 = ICO), idCount (>= 1)
    expect(buf.readUInt16LE(0)).toBe(0);
    expect(buf.readUInt16LE(2)).toBe(ICO_TYPE);
    const count = buf.readUInt16LE(4);
    expect(count).toBeGreaterThanOrEqual(1);

    const headerEnd = ICONDIR_SIZE + ICONDIRENTRY_SIZE * count;
    expect(buf.length).toBeGreaterThan(headerEnd);

    for (let i = 0; i < count; i++) {
      const entryOffset = ICONDIR_SIZE + ICONDIRENTRY_SIZE * i;
      const bytesInRes = buf.readUInt32LE(entryOffset + 8);
      const imageOffset = buf.readUInt32LE(entryOffset + 12);

      expect(bytesInRes).toBeGreaterThan(0);
      expect(imageOffset).toBeGreaterThanOrEqual(headerEnd);
      expect(imageOffset + bytesInRes).toBeLessThanOrEqual(buf.length);

      // ICO の各エントリは PNG か BITMAPINFOHEADER (biSize === 40) のいずれか
      const payload = buf.subarray(imageOffset, imageOffset + bytesInRes);
      const isPng = payload.subarray(0, PNG_MAGIC.length).equals(PNG_MAGIC);
      const isBmpDib = payload.length >= 4 && payload.readUInt32LE(0) === BITMAPINFOHEADER_SIZE;
      expect(isPng || isBmpDib).toBe(true);
    }
  });
});
