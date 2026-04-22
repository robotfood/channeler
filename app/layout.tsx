import type { Metadata } from 'next'
import './globals.css'
import Link from 'next/link'
import ThemeToggle from '@/components/theme-toggle'

export const metadata: Metadata = {
  title: 'IPTV Manager',
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
        `}} />
      </head>
      <body className="bg-gray-50 dark:bg-gray-950 text-gray-900 dark:text-gray-100 min-h-screen">
        <nav className="bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-800 px-6 py-3 flex items-center gap-6">
          <Link href="/" className="text-gray-900 dark:text-white font-semibold text-lg tracking-tight">IPTV Manager</Link>
          <Link href="/" className="text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white text-sm transition-colors">Playlists</Link>
          <Link href="/settings" className="text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white text-sm transition-colors">Settings</Link>
          <div className="ml-auto">
            <ThemeToggle />
          </div>
        </nav>
        <main className="p-6">{children}</main>
      </body>
    </html>
  )
}
