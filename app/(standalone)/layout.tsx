import type { Metadata } from 'next'
import '../globals.css'
import Script from 'next/script'

export const metadata: Metadata = {
  title: 'Channeler',
}

export default function StandaloneLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="bg-black text-white h-screen overflow-hidden">
        <Script
          id="theme-init"
          strategy="beforeInteractive"
          dangerouslySetInnerHTML={{ __html: `
          (function() {
            var t = localStorage.getItem('theme');
            if (t === 'dark') document.documentElement.classList.add('dark');
            else document.documentElement.classList.remove('dark');
          })();
        `}}
        />
        {children}
      </body>
    </html>
  )
}
