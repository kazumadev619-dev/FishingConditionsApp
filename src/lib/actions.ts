'use server';

import { signIn } from '@/auth';
import { AuthError } from 'next-auth';
import { z } from 'zod';
import prisma from '@/lib/prisma';
import bcrypt from 'bcrypt';
import { redirect } from 'next/navigation';
import { randomUUID } from 'crypto';

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
    .refine((password) => /[!@#$%^&*._-]/.test(password), {
      message: 'パスワードは特殊文字(!@#$%^&*._-)を1文字以上含む必要があります。',
    }),
});

export async function signup(_prevState: string | undefined, formData: FormData) {
  const validatedFields = SignupFormSchema.safeParse(Object.fromEntries(formData.entries()));

  if (!validatedFields.success) {
    return (
      validatedFields.error.flatten().fieldErrors.password?.[0] ||
      validatedFields.error.flatten().fieldErrors.email?.[0] ||
      validatedFields.error.flatten().fieldErrors.name?.[0]
    );
  }

  const { name, email, password } = validatedFields.data;

  try {
    const existingUser = await prisma.auth_users.findFirst({
      where: { email },
    });

    if (existingUser) {
      return 'このメールアドレスは既に使用されています。';
    }

    const password_hash = await bcrypt.hash(password, 10);
    const userId = randomUUID();

    await prisma.$transaction(async (tx) => {
      await tx.auth_users.create({
        data: {
          id: userId,
          email,
          encrypted_password: password_hash,
          aud: 'authenticated',
          role: 'authenticated',
        },
      });

      await tx.public_users.create({
        data: {
          id: userId,
          name,
          email,
        },
      });
    });
  } catch (error) {
    console.error(error);
    return 'データベースエラー: ユーザーの作成に失敗しました。';
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
