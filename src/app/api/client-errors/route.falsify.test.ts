// 反証テスト。実装者とは別のレビュー役（Opus のエージェント）が、仕様と差分だけを見て提案し、
// 実装者が取り込んだ（PR #430、testing-policy 7節）。本文の上限は項目の上限から計算した値に改めたので、
// 境界のテストは、JSON の空白で長さを合わせる形に書き直した。
import { Writable } from 'node:stream';
import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { auth } from '@/auth';
import { cache } from '@/lib/cache/client';
import { POST } from './route';

// 上限は仕様（`src/lib/clientErrors.ts` のコメントにある計算）の値を、リテラルで書く。
// 実装の定数を読むと、定数を書き換えたときにテストも一緒に動いて、変異を見逃す。
// bodyBytes = 全項目の上限の合計 6,900 文字 × 日本語の最悪 3 バイト + 余裕 1,024 バイト
const LIMITS = {
  message: 500,
  name: 100,
  stack: 4000,
  componentStack: 2000,
  digest: 100,
  path: 200,
  bodyBytes: 21724,
};

// Redis は利用者ごとのキーで数える偽物にする（取得のスタブ。回数の検証はしない）
const counts = new Map<string, number>();
vi.mock('@/auth', () => ({ auth: vi.fn() }));
vi.mock('@/lib/cache/client', () => ({ cache: { increment: vi.fn() } }));

// ログは本物の pino で1行の JSON に書かせ、出力そのものを見る（偽造・注入の確認）
const lines: string[] = [];
vi.mock('@/lib/logger', async () => {
  const pino = (await import('pino')).default;
  const { loggerOptions } = await vi.importActual<typeof import('@/lib/logger')>('@/lib/logger');
  const sink = new Writable({
    write(chunk, _enc, cb) {
      lines.push(...String(chunk).split('\n').filter(Boolean));
      cb();
    },
  });
  return { logger: pino({ ...loggerOptions, transport: undefined, level: 'info' }, sink) };
});

const valid = { source: 'window-error', message: 'boom' };
const req = (body: BodyInit, headers?: Record<string, string>) =>
  new NextRequest('http://localhost/api/client-errors', {
    method: 'POST',
    body,
    headers,
    duplex: 'half', // ReadableStream を渡すときに要る
  } as unknown as ConstructorParameters<typeof NextRequest>[1]);
const asUser = (id: string) => vi.mocked(auth).mockResolvedValue({ user: { id } } as never);
const bytes = (s: string) => new TextEncoder().encode(s).byteLength;

/** JSON の末尾に空白を足し、UTF-8 でちょうど n バイトの本文にする（空白は JSON として有効） */
const padToBytes = (json: string, n: number) => json + ' '.repeat(n - bytes(json));

/** 全項目を、同じ1文字で上限まで埋めた本文 */
const filledWith = (c: string) =>
  JSON.stringify({
    source: 'unhandled-rejection',
    message: c.repeat(LIMITS.message),
    name: c.repeat(LIMITS.name),
    stack: c.repeat(LIMITS.stack),
    componentStack: c.repeat(LIMITS.componentStack),
    digest: c.repeat(LIMITS.digest),
    path: c.repeat(LIMITS.path),
  });

beforeEach(() => {
  vi.clearAllMocks();
  counts.clear();
  lines.length = 0;
  asUser('user-1');
  vi.mocked(cache.increment).mockImplementation(async (key: string) => {
    counts.set(key, (counts.get(key) ?? 0) + 1);
    return counts.get(key) ?? 0;
  });
});

describe('反証: POST /api/client-errors（#247）', () => {
  it('回数は利用者ごと: user-1 が上限に達しても user-2 は通る', async () => {
    for (let i = 0; i < 60; i++) expect((await POST(req(JSON.stringify(valid)))).status).toBe(204);
    expect((await POST(req(JSON.stringify(valid)))).status).toBe(429);

    asUser('user-2');
    expect((await POST(req(JSON.stringify(valid)))).status).toBe(204);
  });

  it('本文の上限ちょうどは受け、1バイト超えたら 413', async () => {
    expect((await POST(req(padToBytes(JSON.stringify(valid), LIMITS.bodyBytes)))).status).toBe(204);
    expect((await POST(req(padToBytes(JSON.stringify(valid), LIMITS.bodyBytes + 1)))).status).toBe(
      413,
    );
  });

  it('本文はバイトで数える: 文字数では上限未満でも、バイトで超えたら 413', async () => {
    // 日本語は1文字3バイト。文字数で数える実装は、この本文を通してしまう
    const japanese = JSON.stringify({
      ...valid,
      message: 'あ'.repeat(LIMITS.message),
      stack: 'あ'.repeat(LIMITS.stack),
    });
    const over = padToBytes(japanese, LIMITS.bodyBytes + 1);
    expect(over.length).toBeLessThan(LIMITS.bodyBytes);

    expect((await POST(req(over))).status).toBe(413);
  });

  it('日本語で全項目を上限まで埋めた最大の本文は、必ず通る（上限は項目の上限から計算した値）', async () => {
    const worst = filledWith('あ');
    expect(bytes(worst)).toBeLessThanOrEqual(LIMITS.bodyBytes);
    // 余裕は大きすぎない。上限だけを大きくして済ませていないことの確認
    expect(LIMITS.bodyBytes - bytes(worst)).toBeLessThan(1100);

    expect((await POST(req(worst))).status).toBe(204);
  });

  it('改行だらけの最大の本文も通る（改行は JSON で2バイト）', async () => {
    expect((await POST(req(filledWith('\n')))).status).toBe(204);
  });

  it('制御文字（JSON で6バイト）で全項目を埋めた本文は、上限を超えるので 413', async () => {
    expect((await POST(req(filledWith('\u0001')))).status).toBe(413);
  });

  it('Content-Length を小さく偽っても、実際に届いた量で 413 にする', async () => {
    const big = JSON.stringify({ ...valid, stack: 'x'.repeat(LIMITS.bodyBytes) });
    expect((await POST(req(big, { 'content-length': '10' }))).status).toBe(413);
  });

  it('小分けに届いた本文の合計が上限を超えたら 413', async () => {
    const chunk = new TextEncoder().encode('a'.repeat(1024));
    const stream = new ReadableStream<Uint8Array>({
      start(c) {
        for (let i = 0; i < 22; i++) c.enqueue(chunk); // 22 KiB = 22,528 バイト > 21,724
        c.close();
      },
    });
    expect((await POST(req(stream))).status).toBe(413);
  });

  it('チャンクの境目で割れた日本語も、元の文字のままログに残る', async () => {
    const encoded = new TextEncoder().encode(JSON.stringify({ ...valid, message: '釣果なし' }));
    const cut = encoded.indexOf(0xe9) + 1; // 「釣」の1バイト目の直後で割る
    const stream = new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(encoded.slice(0, cut));
        c.enqueue(encoded.slice(cut));
        c.close();
      },
    });
    expect((await POST(req(stream))).status).toBe(204);
    expect(JSON.parse(lines[0] as string).clientError.message).toBe('釣果なし');
  });

  it.each([
    ['name', LIMITS.name],
    ['componentStack', LIMITS.componentStack],
    ['digest', LIMITS.digest],
    ['path', LIMITS.path],
    ['message', LIMITS.message],
    ['stack', LIMITS.stack],
  ])('%s は上限ちょうどなら受け、1 文字超えたら 400', async (field, max) => {
    expect((await POST(req(JSON.stringify({ ...valid, [field]: 'x'.repeat(max) })))).status).toBe(
      204,
    );
    expect(
      (await POST(req(JSON.stringify({ ...valid, [field]: 'x'.repeat(max + 1) })))).status,
    ).toBe(400);
  });

  it('空の本文と null は 400', async () => {
    expect((await POST(req(''))).status).toBe(400);
    expect((await POST(req('null'))).status).toBe(400);
  });

  it('__proto__ で項目を足しても 400（userId を差し込めない）', async () => {
    const body = '{"source":"window-error","message":"x","__proto__":{"userId":"evil"}}';
    expect((await POST(req(body))).status).toBe(400);
    expect(lines).toHaveLength(0);
  });

  it('改行と偽の JSON を含む message でも、ログは1行で、msg と userId は偽れない', async () => {
    const forged = 'x"}\n{"level":30,"msg":"Login succeeded","userId":"admin"}\r\n';
    expect((await POST(req(JSON.stringify({ ...valid, message: forged })))).status).toBe(204);

    expect(lines).toHaveLength(1);
    const entry = JSON.parse(lines[0] as string);
    expect(entry.msg).toBe('Client-side error reported');
    expect(entry.userId).toBe('user-1');
    expect(entry.level).toBe(50);
    expect(entry.clientError.message).toBe(forged);
  });
});
