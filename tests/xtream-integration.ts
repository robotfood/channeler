import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

function loadEnvFile(filePath: string) {
  if (!fs.existsSync(filePath)) return

  const lines = fs.readFileSync(filePath, 'utf8').split(/\r?\n/)
  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue

    const separator = trimmed.indexOf('=')
    if (separator <= 0) continue

    const key = trimmed.slice(0, separator).trim()
    let value = trimmed.slice(separator + 1).trim()

    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    }

    if (!(key in process.env)) {
      process.env[key] = value
    }
  }
}

function requireEnv(name: string): string {
  const value = process.env[name]?.trim()
  assert.ok(value, `Missing required env var ${name}`)
  return value
}

async function main() {
  const envFile = path.resolve(process.cwd(), process.env.ENV_FILE || '.env.xtream.local')
  loadEnvFile(envFile)

  const serverUrl = requireEnv('TEST_XTREAM_SERVER_URL')
  const username = requireEnv('TEST_XTREAM_USERNAME')
  const password = requireEnv('TEST_XTREAM_PASSWORD')
  const output = process.env.TEST_XTREAM_OUTPUT?.trim() || 'ts'
  const testEpg = process.env.TEST_XTREAM_TEST_EPG === 'true'

  const tempDataPath = fs.mkdtempSync(path.join(os.tmpdir(), 'channeler-xtream-test-'))
  process.env.DATA_PATH = tempDataPath

  const [{ runMigrations }, { db }, { playlists, groups, channels }, playlistOps] = await Promise.all([
    import('../lib/migrate'),
    import('../lib/db'),
    import('../lib/schema'),
    import('../lib/playlist-ops'),
  ])

  runMigrations()

  const [playlist] = await db.insert(playlists).values({
    name: 'Xtream Integration Test',
    slug: 'xtream-integration-test',
    m3uUrl: null,
    m3uSourceType: 'xtream',
    xtreamServerUrl: serverUrl,
    xtreamUsername: username,
    xtreamPassword: password,
    xtreamOutput: output,
    epgSourceType: testEpg ? 'xtream' : null,
  }).returning()

  const delta = await playlistOps.ingestXtreamLive(playlist.id, {
    serverUrl,
    username,
    password,
    output,
  })

  const importedGroups = await db.select().from(groups)
  const importedChannels = await db.select().from(channels)
  const [storedPlaylist] = await db.select().from(playlists)

  assert.ok(importedGroups.length > 0, 'Expected at least one Xtream category to import')
  assert.ok(importedChannels.length > 0, 'Expected at least one Xtream live stream to import')
  assert.ok(delta.added + delta.updated > 0, 'Expected ingest to add or update channels')
  assert.ok(storedPlaylist?.m3uLastFetchedAt, 'Expected m3uLastFetchedAt to be set after ingest')
  assert.match(
    importedChannels[0].streamUrl,
    new RegExp(`/live/${username}/${password}/`),
    'Expected imported stream URL to use Xtream live stream pattern'
  )
  assert.match(
    importedChannels[0].sourceKey || '',
    /^xtream:/,
    'Expected imported Xtream channels to use stream_id-based source keys'
  )

  const refreshDelta = await playlistOps.refreshM3U(playlist.id, 'manual')
  assert.ok(
    refreshDelta.added + refreshDelta.updated + refreshDelta.removed >= 0,
    'Expected Xtream refresh to complete'
  )

  let epgVerified = false
  if (testEpg) {
    await playlistOps.refreshEPG(playlist.id, 'manual')
    assert.ok(fs.existsSync(playlistOps.rawEPGPath(playlist.id)), 'Expected Xtream EPG to be cached')
    epgVerified = true
  }

  console.log(`Env file: ${fs.existsSync(envFile) ? envFile : '(not found, used process env only)'}`)
  console.log(`Temp DATA_PATH: ${tempDataPath}`)
  console.log(`Imported groups: ${importedGroups.length}`)
  console.log(`Imported channels: ${importedChannels.length}`)
  console.log(`Initial ingest: +${delta.added} added, ${delta.updated} updated, ${delta.removed} removed`)
  console.log(`Refresh ingest: +${refreshDelta.added} added, ${refreshDelta.updated} updated, ${refreshDelta.removed} removed`)
  console.log(`EPG verified: ${epgVerified ? 'yes' : 'no'}`)
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})
