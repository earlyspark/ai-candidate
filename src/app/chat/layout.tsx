import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Chat with @earlyspark',
  description: 'An AI experiment in professional representation',
  alternates: {
    canonical: 'https://chat.earlyspark.com',
  },
  openGraph: {
    title: 'Chat with @earlyspark',
    description: 'An AI experiment in professional representation',
    url: '/chat',
    images: [],
  },
  twitter: {
    card: 'summary',
    title: 'Chat with @earlyspark',
    description: 'An AI experiment in professional representation',
    images: [],
  },
}

export default function ChatLayout({ children }: { children: React.ReactNode }) {
  return children
}

