import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { NextConfig } from 'next'

const configDir = path.dirname(fileURLToPath(import.meta.url))

const nextConfig: NextConfig = {
  output: 'standalone',
  outputFileTracingRoot: configDir,
  outputFileTracingExcludes: {
    '/*': ['./data/**/*'],
    '/api/**/*': ['./data/**/*'],
  },
  serverExternalPackages: ['better-sqlite3'],
  allowedDevOrigins: ['192.168.50.196'],
  turbopack: {
    root: configDir,
  },
}

export default nextConfig
