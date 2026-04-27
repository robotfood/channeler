import type { Metadata } from 'next'
import './globals.css'
import Link from 'next/link'
import ThemeToggle from '@/components/theme-toggle'
import Script from 'next/script'

export const metadata: Metadata = {
  title: 'Channeler',
  description: 'M3U playlist filter and proxy',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        {/* Apply saved theme before first paint to avoid flash */}
        <script dangerouslySetInnerHTML={{ __html: `
          (function() {
            var t = localStorage.getItem('theme');
            if (t === 'dark') document.documentElement.classList.add('dark');
            else document.documentElement.classList.remove('dark');
          })();
          
          window.__onGCastApiAvailable = function(isAvailable) {
            if (isAvailable) {
              cast.framework.CastContext.getInstance().setOptions({
                receiverApplicationId: chrome.cast.media.DEFAULT_MEDIA_RECEIVER_APP_ID,
                autoJoinPolicy: chrome.cast.AutoJoinPolicy.ORIGIN_SCOPED
              });
            }
          };
        `}} />
      </head>
      <body className="bg-gray-50 dark:bg-gray-950 text-gray-900 dark:text-gray-100 min-h-screen">
        <Script src="https://www.gstatic.com/cv/js/sender/v1/cast_sender.js?loadCastFramework=1" strategy="lazyOnload" />
        <nav className="bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-800 px-6 py-3 flex items-center gap-6">
          <Link href="/" className="text-gray-900 dark:text-white font-semibold text-lg tracking-tight">Channeler</Link>
          <div className="ml-auto">
            <ThemeToggle />
          </div>
        </nav>
        <main className="p-6">{children}</main>
      </body>
    </html>
  )
}
