import GoogleProvider from 'next-auth/providers/google'
import type { NextAuthOptions } from 'next-auth'

// NextAuth configuration lives here (not in the route file) because Next.js
// route modules may only export HTTP handlers; other API routes import
// authOptions from this module for getServerSession checks.

// Fail closed: with ADMIN_EMAIL unset, a plain `email === process.env.ADMIN_EMAIL`
// comparison is true for a profile that has no email (undefined === undefined),
// so both sides must be present before they are compared.
function isAdminEmail(email: string | null | undefined): boolean {
  const adminEmail = process.env.ADMIN_EMAIL
  return Boolean(adminEmail) && Boolean(email) && email === adminEmail
}

export const authOptions: NextAuthOptions = {
  providers: [
    GoogleProvider({
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
    }),
  ],
  callbacks: {
    async signIn({ user }) {
      // Only allow sign-in if the email matches the admin email
      return isAdminEmail(user.email)
    },
    async session({ session }) {
      // Add admin flag to session
      session.user.isAdmin = isAdminEmail(session.user?.email)
      return session
    },
    async jwt({ token, user }) {
      // Add admin flag to JWT token
      if (user) {
        token.isAdmin = isAdminEmail(user.email)
      }
      return token
    },
  },
  pages: {
    signIn: '/auth/signin',
    error: '/auth/error',
  },
  session: {
    strategy: 'jwt',
  },
}
