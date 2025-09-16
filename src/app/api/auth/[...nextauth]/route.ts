import NextAuth from 'next-auth'
import GoogleProvider from 'next-auth/providers/google'
import type { NextAuthOptions } from 'next-auth'

export const authOptions: NextAuthOptions = {
  providers: [
    GoogleProvider({
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
    }),
  ],
  callbacks: {
    async signIn({ user, account }) {
      // Only allow sign-in if the email matches the admin email
      const adminEmail = process.env.ADMIN_EMAIL
      
      if (user.email === adminEmail) {
        return true
      }
      
      return false // Deny access for all other emails
    },
    async session({ session, token }) {
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

const handler = NextAuth(authOptions)

export { handler as GET, handler as POST }