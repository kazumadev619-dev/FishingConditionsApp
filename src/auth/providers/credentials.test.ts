import bcrypt from 'bcrypt';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { issueVerificationEmail } from '@/lib/email';
import { hasActiveVerificationToken } from '@/lib/token';
import { getUser } from '../utils/userRepository';
import { credentialsProvider, EmailNotVerifiedError } from './credentials';

vi.mock('bcrypt', () => ({ default: { compare: vi.fn() } }));
vi.mock('@/lib/email', () => ({ issueVerificationEmail: vi.fn() }));
vi.mock('@/lib/logger', () => ({
  logger: { warn: vi.fn(), error: vi.fn() },
  maskEmail: (email: string) => email,
}));
vi.mock('@/lib/token', () => ({
  hasActiveVerificationToken: vi.fn(),
}));
vi.mock('../utils/userRepository', () => ({ getUser: vi.fn() }));

const credentials = { email: 'owner@example.com', password: 'Passw0rd!' };
// Credentials() は渡した authorize を options に入れて返すが、型には出ていない
const { authorize } = (
  credentialsProvider as unknown as {
    options: { authorize: (credentials: unknown) => Promise<unknown> };
  }
).options;

const givenUser = (emailVerifiedAt: Date | null, passwordMatches: boolean) => {
  vi.mocked(getUser).mockResolvedValue({
    email: credentials.email,
    password_hash: 'hash',
    email_verified_at: emailVerifiedAt,
  } as never);
  vi.mocked(bcrypt.compare).mockImplementation(async () => passwordMatches);
};

afterEach(() => vi.clearAllMocks());

describe('credentials の authorize', () => {
  it('確認済みでパスワードが合えばログインできる', async () => {
    givenUser(new Date(), true);

    await expect(authorize(credentials)).resolves.toMatchObject({ email: credentials.email });
    expect(issueVerificationEmail).not.toHaveBeenCalled();
  });

  it('未確認なら正しいパスワードでも拒否し、確認メールを送り直す', async () => {
    givenUser(null, true);
    vi.mocked(hasActiveVerificationToken).mockResolvedValue(false);

    await expect(authorize(credentials)).rejects.toBeInstanceOf(EmailNotVerifiedError);
    expect(issueVerificationEmail).toHaveBeenCalledWith(credentials.email);
  });

  it('有効なトークンが残っている間は確認メールを送らない', async () => {
    givenUser(null, true);
    vi.mocked(hasActiveVerificationToken).mockResolvedValue(true);

    await expect(authorize(credentials)).rejects.toBeInstanceOf(EmailNotVerifiedError);
    expect(issueVerificationEmail).not.toHaveBeenCalled();
  });

  it('確認メールを送れなくても、未確認として拒否する', async () => {
    givenUser(null, true);
    vi.mocked(hasActiveVerificationToken).mockResolvedValue(false);
    vi.mocked(issueVerificationEmail).mockRejectedValueOnce(new Error('resend down'));

    await expect(authorize(credentials)).rejects.toBeInstanceOf(EmailNotVerifiedError);
  });

  it('未確認でもパスワードが違えば、確認状態を明かさずメールも送らない', async () => {
    givenUser(null, false);

    await expect(authorize(credentials)).resolves.toBeNull();
    expect(hasActiveVerificationToken).not.toHaveBeenCalled();
  });
});
