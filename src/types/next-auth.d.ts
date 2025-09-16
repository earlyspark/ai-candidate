import { DefaultSession } from 'next-auth'

declare module 'next-auth' {
  interface Session {
    user: {
      isAdmin?: boolean
    } & DefaultSession['user']
  }

  interface User {
    isAdmin?: boolean
  }
}

declare module 'next-auth/jwt' {
  interface JWT {
    isAdmin?: boolean
  }
}