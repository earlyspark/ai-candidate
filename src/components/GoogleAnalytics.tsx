import Script from 'next/script'

declare global {
  interface Window {
    gtag: (command: string, ...args: unknown[]) => void
    dataLayer: unknown[]
  }
}

export default function GoogleAnalytics() {
  const measurementId = process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID

  // Only run analytics in production
  const isProduction = process.env.NODE_ENV === 'production'

  // Don't render anything if not in production or no measurement ID
  if (!isProduction || !measurementId) {
    return null
  }

  return (
    <>
      {/* Load Google Analytics script - this gets injected into HTML head */}
      <Script
        src={`https://www.googletagmanager.com/gtag/js?id=${measurementId}`}
        strategy="afterInteractive"
        id="google-analytics"
      />

      {/* Initialize gtag - this runs after the script loads */}
      <Script
        id="google-analytics-init"
        strategy="afterInteractive"
        dangerouslySetInnerHTML={{
          __html: `
            window.dataLayer = window.dataLayer || [];
            function gtag(){dataLayer.push(arguments);}
            gtag('js', new Date());

            // Only initialize if on chat.earlyspark.com
            if (typeof window !== 'undefined' && window.location.hostname === 'chat.earlyspark.com') {
              gtag('config', '${measurementId}', {
                page_title: document.title,
                page_location: window.location.href,
              });
            }
          `,
        }}
      />
    </>
  )
}