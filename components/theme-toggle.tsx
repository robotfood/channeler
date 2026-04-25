'use client'

import { useEffect, useSyncExternalStore } from 'react'

function subscribe(onStoreChange: () => void) {
  const onChange = () => onStoreChange()
  window.addEventListener('storage', onChange)
  window.addEventListener('themechange', onChange)
  return () => {
    window.removeEventListener('storage', onChange)
    window.removeEventListener('themechange', onChange)
  }
}

function getServerSnapshot() {
  return true
}

function getClientSnapshot() {
  const saved = localStorage.getItem('theme')
  return saved ? saved === 'dark' : true
}

export default function ThemeToggle() {
  const dark = useSyncExternalStore(subscribe, getClientSnapshot, getServerSnapshot)

  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark)
  }, [dark])

  function toggle() {
    const next = !dark
    document.documentElement.classList.toggle('dark', next)
    localStorage.setItem('theme', next ? 'dark' : 'light')
    window.dispatchEvent(new Event('themechange'))
  }

  return (
    <button onClick={toggle} aria-label="Toggle theme"
      className="text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white transition-colors text-lg leading-none">
      {dark ? '☀' : '☾'}
    </button>
  )
}
