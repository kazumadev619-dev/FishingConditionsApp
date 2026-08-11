import Google from 'next-auth/providers/google';

export const googleProvider = Google({
  clientId: process.env.AUTH_GOOGLE_ID as string,
  clientSecret: process.env.AUTH_GOOGLE_SECRET as string,
});
