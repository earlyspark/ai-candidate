import GoogleProvider from 'next-auth/providers/google'
import type { NextAuthOptions } from 'next-auth'

// NextAuth configuration lives here (not in the route file) because Next.js
// route modules may only export HTTP handlers; other API routes import
// authOptions from this module for getServerSession checks.
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
      const adminEmail = process.env.ADMIN_EMAIL

      if (user.email === adminEmail) {
        return true
      }

      return false // Deny access for all other emails
    },
    async session({ session }) {
      // Add admin flag to session
      session.user.isAdmin = session.user?.email === process.env.ADMIN_EMAIL
      return session
    },
    async jwt({ token, user }) {
      // Add admin flag to JWT token
      if (user) {
        token.isAdmin = user.email === process.env.ADMIN_EMAIL
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
