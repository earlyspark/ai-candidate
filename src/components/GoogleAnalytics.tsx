'use client'

import { useEffect } from 'react'
import { usePathname } from 'next/navigation'

declare global {
  interface Window {
    gtag: (command: string, ...args: any[]) => void
  }
}

export default function GoogleAnalytics() {
  const pathname = usePathname()
  const measurementId = process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID

  // Only run analytics in production on earlyspark.com
  const isProduction = process.env.NODE_ENV === 'production' &&
                      typeof window !== 'undefined' &&
                      window.location.hostname === 'earlyspark.com'

  useEffect(() => {
    if (!isProduction || !measurementId) {
      return
    }

    // Load Google Analytics script
    const script = document.createElement('script')
    script.src = `https://www.googletagmanager.com/gtag/js?id=${measurementId}`
    script.async = true
    document.head.appendChild(script)

    // Initialize gtag
    window.gtag = function(...args: any[]) {
      (window as any).dataLayer = (window as any).dataLayer || []
      ;(window as any).dataLayer.push(arguments)
    }

    // Configure Google Analytics
    window.gtag('js', new Date())
    window.gtag('config', measurementId, {
      page_title: document.title,
      page_location: window.location.href,
    })

    // Cleanup function
    return () => {
      const existingScript = document.querySelector(`script[src*="${measurementId}"]`)
      if (existingScript) {
        existingScript.remove()
      }
    }
  }, [isProduction, measurementId])

  // Track page views on route changes
  useEffect(() => {
    if (!isProduction || !measurementId || typeof window.gtag !== 'function') {
      return
    }

    window.gtag('config', measurementId, {
      page_path: pathname,
      page_title: document.title,
      page_location: window.location.href,
    })
  }, [pathname, isProduction, measurementId])

  // Component renders nothing
  return null
}