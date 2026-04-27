import path from 'node:path'
import fs from 'node:fs'
import os from 'node:os'

const isNextBuild = process.env.NEXT_PHASE === 'phase-production-build' || process.env.npm_lifecycle_event === 'build'

export const dataPath = isNextBuild
  ? path.join(os.tmpdir(), `channeler-build-${process.pid}`)
  : process.env.DATA_PATH ?? path.join(/*turbopackIgnore: true*/ process.cwd(), 'data')

export function ensureDataDirectories() {
  fs.mkdirSync(dataPath, { recursive: true })
  fs.mkdirSync(path.join(dataPath, 'raw'), { recursive: true })
}
