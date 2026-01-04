'use server';

import { signIn } from '@/auth';
import { AuthError } from 'next-auth';
import { z } from 'zod';
import prisma from '@/lib/prisma';
import { Prisma } from '@/generated/prisma/client';
import bcrypt from 'bcrypt';
import { redirect } from 'next/navigation';
import { randomUUID } from 'crypto';
import { createVerificationToken } from '@/lib/token';
import { sendVerificationEmail } from '@/lib/email';
import { logger, maskEmail } from '@/lib/logger';

const SignupFormSchema = z.object({
  name: z.string().min(2, { message: '名前は2文字以上で入力してください。' }),
  email: z.string().email({ message: '有効なメールアドレスを入力してください。' }),
  password: z
    .string()
    .min(8, { message: 'パスワードは8文字以上である必要があります。' })
    .max(128, { message: 'パスワードは128文字以下である必要があります。' })
    .refine((password) => /[A-Z]/.test(password), {
      message: 'パスワードは大文字を1文字以上含む必要があります。',
    })
    .refine((password) => /[a-z]/.test(password), {
      message: 'パスワードは小文字を1文字以上含む必要があります。',
    })
    .refine((password) => /[0-9]/.test(password), {
      message: 'パスワードは数字を1文字以上含む必要があります。',
    })
    .refine((password) => /[!@#$%^&*.\-_]/.test(password), {
      message: 'パスワードは特殊文字(!@#$%^&*._-)を1文字以上含む必要があります。',
    }),
});

export async function signup(_prevState: string | undefined, formData: FormData) {
  const validatedFields = SignupFormSchema.safeParse(Object.fromEntries(formData.entries()));

  if (!validatedFields.success) {
    const fieldErrors = validatedFields.error.flatten().fieldErrors;
    return fieldErrors.password?.[0] || fieldErrors.email?.[0] || fieldErrors.name?.[0];
  }

  const { name, email, password } = validatedFields.data;

  // メールアドレスを小文字に正規化
  const normalizedEmail = email.toLowerCase().trim();

  try {
    const password_hash = await bcrypt.hash(password, 10);
    const userId = randomUUID();

    // usersテーブルに認証+プロフィール情報を統合して保存
    await prisma.users.create({
      data: {
        id: userId,
        email: normalizedEmail,
        password_hash,
        name,
        // 通常登録時はメール未検証（email_verified_atはnull）
      },
    });

    // メール検証トークンを生成して送信
    try {
      const token = await createVerificationToken(normalizedEmail);
      const verificationUrl = `${process.env.NEXTAUTH_URL}/api/auth/verify-email?token=${token}`;
      const emailSent = await sendVerificationEmail(normalizedEmail, verificationUrl);

      if (!emailSent) {
        logger.error({ email: maskEmail(normalizedEmail) }, 'Failed to send verification email');
      }
    } catch (emailError) {
      // メール送信失敗してもユーザー登録は成功させる
      logger.error(
        { email: maskEmail(normalizedEmail), error: emailError },
        'Email sending error during signup',
      );
    }
  } catch (error) {
    logger.error({ error }, 'Signup error');

    // Prisma Known Request Error (P2002, P2003, P2025 等)
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      switch (error.code) {
        case 'P1001': {
          // Database server connection error
          logger.error({ message: error.message }, 'Database connection error');
          return 'ユーザーの作成に失敗しました。時間をおいて再度お試しください。';
        }

        case 'P2002': {
          // Unique constraint violation
          const target = error.meta?.target;
          if (Array.isArray(target) && target.includes('email')) {
            return 'このメールアドレスは既に使用されています。';
          }
          return 'このデータは既に登録されています。';
        }

        case 'P2003': {
          // Foreign key constraint violation
          logger.error({ code: error.code }, 'Foreign key constraint violation');
          return 'ユーザーの作成に失敗しました。時間をおいて再度お試しください。';
        }

        case 'P2025': {
          // Record not found
          logger.error({ code: error.code }, 'Required data not found');
          return 'ユーザーの作成に失敗しました。時間をおいて再度お試しください。';
        }

        default:
          logger.error({ code: error.code }, 'Unhandled Prisma error code');
          return 'ユーザーの作成に失敗しました。時間をおいて再度お試しください。';
      }
    }

    // Prisma Validation Error
    if (error instanceof Prisma.PrismaClientValidationError) {
      logger.error({ message: error.message }, 'Prisma validation error');
      return 'データの検証に失敗しました。入力内容を確認してください。';
    }

    // Generic error fallback
    if (error instanceof Error) {
      logger.error({ message: error.message }, 'Unexpected error');
    }

    return 'ユーザーの作成に失敗しました。時間をおいて再度お試しください。';
  }

  redirect('/login');
}

export async function authenticate(_prevState: string | undefined, formData: FormData) {
  try {
    await signIn('credentials', formData);
  } catch (error) {
    // Type guard: ensure error is an Error object
    if (!(error instanceof Error)) {
      return '予期しないエラーが発生しました。';
    }

    if (error instanceof AuthError) {
      switch (error.type) {
        case 'CredentialsSignin':
          return 'メールアドレスまたはパスワードが正しくありません。';
        case 'CallbackRouteError':
          // Fallback for any callback-related errors
          return 'ログイン処理中にエラーが発生しました。';
        default:
          return '予期しないエラーが発生しました。';
      }
    }
    throw error;
  }
  redirect('/dashboard');
}
