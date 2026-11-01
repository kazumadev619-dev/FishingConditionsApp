import { afterEach, describe, expect, it, vi } from 'vitest';
import { issueVerificationEmail } from './email';
import { createVerificationToken, deleteVerificationToken } from './token';

const send = vi.hoisted(() => vi.fn());

vi.mock('resend', () => ({
  Resend: vi.fn(
    class {
      emails = { send };
    },
  ),
}));
vi.mock('./logger', () => ({ logger: { info: vi.fn(), error: vi.fn() } }));
vi.mock('./token', () => ({
  createVerificationToken: vi.fn(async () => 'token-1'),
  deleteVerificationToken: vi.fn(),
}));

vi.stubEnv('RESEND_API_KEY', 'test-key');
vi.stubEnv('NEXTAUTH_URL', 'https://app.test');

afterEach(() => vi.clearAllMocks());

describe('issueVerificationEmail', () => {
  it('リンクは確認ページを指し、送れたらトークンを残す', async () => {
    send.mockResolvedValue({ data: { id: 'mail-1' }, error: null });

    await expect(issueVerificationEmail('owner@example.com')).resolves.toBe(true);

    expect(send.mock.calls[0][0].html).toContain(
      'https://app.test/auth/verify-email?token=token-1',
    );
    expect(deleteVerificationToken).not.toHaveBeenCalled();
    expect(createVerificationToken).toHaveBeenCalledWith('owner@example.com');
  });

  it('送れなかったらトークンを消して、再送できるようにする', async () => {
    send.mockResolvedValue({ data: null, error: { message: 'rejected' } });

    await expect(issueVerificationEmail('owner@example.com')).resolves.toBe(false);

    expect(deleteVerificationToken).toHaveBeenCalledWith('token-1');
  });
});
