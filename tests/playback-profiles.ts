import { spawn, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { chromium, type Browser, type Page } from 'playwright'
import { normalizeAudioProfile } from '../lib/audio-profile'
import { normalizePlaybackProfile } from '../lib/playback-profile'

const FFMPEG = process.env.FFMPEG_PATH || 'ffmpeg'
const TEST_TIMEOUT_MS = parseInt(process.env.PLAYBACK_TEST_TIMEOUT_MS || '45000', 10)
const STARTUP_TIMEOUT_MS = parseInt(process.env.PLAYBACK_TEST_STARTUP_TIMEOUT_MS || '30000', 10)
const PLAYBACK_OBSERVATION_MS = 10_000
const HEAVY_PROFILES = new Set(['transcode_4k', 'smooth_1080p60'])
const SOURCE_URL = 'https://skynewsau-live.akamaized.net/hls/live/2002689/skynewsau-extra1/master.m3u8'

type Result = {
  profile: string
  status: 'pass' | 'fail' | 'skip'
  detail: string
  elapsedMs: number
  artifactDir?: string
  screenshotPath?: string
}

function hasArg(name: string) {
  return process.argv.includes(name)
}

function optionValue(name: string) {
  const prefix = `${name}=`
  const match = process.argv.find(arg => arg.startsWith(prefix))
  return match?.slice(prefix.length)
}

function timestampForPath() {
  return new Date().toISOString().replace(/[:.]/g, '-')
}

function escapeHtml(value: string) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

function relativeHtmlPath(fromFile: string, toFile: string) {
  return path.relative(path.dirname(fromFile), toFile).split(path.sep).join('/')
}

async function freePort() {
  return await new Promise<number>((resolve, reject) => {
    const server = net.createServer()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      server.close(() => {
        if (typeof address === 'object' && address) resolve(address.port)
        else reject(new Error('Unable to allocate port'))
      })
    })
  })
}

function selectedProfiles() {
  const raw = optionValue('--profiles') || process.env.PLAYBACK_TEST_PROFILES
  const profiles = raw
    ? raw.split(',').map(value => value.trim()).filter(Boolean)
    : [
        'stable_hls',
        'transcode_720p',
        'transcode_1080p',
        'enhanced_1080p',
        'clean_1080p',
        'smooth_720p60',
        'sports_720p60',
      ]

  const normalized = profiles.map(profile => {
    const value = normalizePlaybackProfile(profile)
    if (value === 'direct' || value === 'proxy') throw new Error(`Unknown transcode profile: ${profile}`)
    return value
  })

  return hasArg('--all')
    ? [...new Set([...normalized, 'transcode_4k', 'smooth_1080p60'])]
    : normalized.filter(profile => !HEAVY_PROFILES.has(profile))
}

function waitForHttp(url: string, timeoutMs: number) {
  const deadline = Date.now() + timeoutMs
  return new Promise<void>((resolve, reject) => {
    const check = async () => {
      try {
        const response = await fetch(url)
        if (response.ok) {
          resolve()
          return
        }
      } catch {}

      if (Date.now() >= deadline) {
        reject(new Error(`Timed out waiting for ${url}`))
        return
      }
      setTimeout(check, 250)
    }
    check()
  })
}

async function seedDatabase(dataPath: string, streamUrl: string, profile: string, backend: string, audioProfile: string) {
  process.env.DATA_PATH = dataPath
  const [{ runMigrations }, { sqlite }] = await Promise.all([
    import('../lib/migrate'),
    import('../lib/db'),
  ])
  runMigrations()

  sqlite.exec('DELETE FROM channels; DELETE FROM groups; DELETE FROM playlists;')
  sqlite.prepare(`
    INSERT INTO playlists (
      id, name, m3u_source_type, slug, auto_refresh, buffer_size, playback_profile,
      transcode_backend, audio_profile, proxy_streams, proxy_epg
    ) VALUES (1, 'Playback E2E', 'url', 'playback-e2e', 0, 'small', ?, ?, ?, 1, 1)
  `).run(profile, backend, audioProfile)
  sqlite.prepare(`
    INSERT INTO groups (id, playlist_id, original_name, display_name, enabled, sort_order)
    VALUES (1, 1, 'E2E', 'E2E', 1, 0)
  `).run()
  sqlite.prepare(`
    INSERT INTO channels (
      id, playlist_id, group_id, tvg_id, tvg_name, channel_source_key, display_name,
      stream_url, enabled, is_deleted, is_favorite, sort_order
    ) VALUES (1, 1, 1, 'e2e', 'E2E Test Channel', 'url:e2e', 'E2E Test Channel', ?, 1, 0, 0, 0)
  `).run(streamUrl)
}

function startApp(dataPath: string, port: number, backend: string) {
  const child = spawn('npm', ['run', 'dev', '--', '--port', String(port)], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      DATA_PATH: dataPath,
      TRANSCODE_BACKEND: backend,
      TRANSCODE_REALTIME_INPUT: 'true',
      CHANNELER_SKIP_CONTAINER_CHECKS: 'true',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  let output = ''
  child.stdout.on('data', chunk => {
    output += chunk.toString()
    if (hasArg('--verbose')) process.stdout.write(chunk)
  })
  child.stderr.on('data', chunk => {
    output += chunk.toString()
    if (hasArg('--verbose')) process.stderr.write(chunk)
  })

  return {
    child,
    output: () => output.slice(-8000),
    stop: () => {
      if (child.exitCode === null) child.kill('SIGTERM')
    },
  }
}

async function saveDiagnostics(args: {
  root: string
  profile: string
  page: Page
  baseUrl: string
  dataPath: string
  consoleMessages: string[]
  requestFailures: string[]
  appLog: string
  error: unknown
}) {
  const artifactDir = path.join(args.root, 'artifacts', args.profile)
  fs.mkdirSync(artifactDir, { recursive: true })

  await args.page.screenshot({ path: path.join(artifactDir, 'screenshot.png'), fullPage: true }).catch(() => {})
  fs.writeFileSync(path.join(artifactDir, 'console.log'), args.consoleMessages.join('\n'))
  fs.writeFileSync(path.join(artifactDir, 'network.log'), args.requestFailures.join('\n'))
  fs.writeFileSync(path.join(artifactDir, 'app.log'), args.appLog)
  fs.writeFileSync(path.join(artifactDir, 'error.txt'), args.error instanceof Error ? args.error.stack ?? args.error.message : String(args.error))

  try {
    const status = await fetch(`${args.baseUrl}/api/transcode/status`).then(res => res.text())
    fs.writeFileSync(path.join(artifactDir, 'transcode-status.json'), status)
  } catch {}

  const cacheRoot = path.join(args.dataPath, 'transcode-cache', '1')
  const manifests = fs.existsSync(cacheRoot)
    ? fs.readdirSync(cacheRoot, { recursive: true }).filter(file => String(file).endsWith('index.m3u8')).map(file => String(file))
    : []
  for (const manifest of manifests) {
    const source = path.join(cacheRoot, manifest)
    const target = path.join(artifactDir, manifest.replaceAll(path.sep, '__'))
    fs.copyFileSync(source, target)
  }

  const segments = fs.existsSync(cacheRoot)
    ? fs.readdirSync(cacheRoot, { recursive: true }).filter(file => String(file).endsWith('.ts')).map(file => String(file)).sort()
    : []
  const lastSegment = segments.at(-1)
  if (lastSegment) {
    const segmentPath = path.join(cacheRoot, lastSegment)
    const probe = spawnSync(FFMPEG.replace(/ffmpeg$/, 'ffprobe'), [
      '-hide_banner',
      '-loglevel', 'error',
      '-show_streams',
      segmentPath,
    ], { encoding: 'utf8', timeout: 10000 })
    fs.writeFileSync(path.join(artifactDir, 'latest-segment-ffprobe.txt'), probe.stdout || probe.stderr || '')
  }

  return artifactDir
}

async function runProfile(args: {
  browser: Browser
  baseUrl: string
  profile: string
  root: string
  reportDir: string
  dataPath: string
  appLog: () => string
}) {
  const startedAt = Date.now()
  const page = await args.browser.newPage()
  const consoleMessages: string[] = []
  const requestFailures: string[] = []
  let screenshotPath: string | undefined

  page.on('console', message => consoleMessages.push(`${message.type()}: ${message.text()}`))
  page.on('pageerror', error => consoleMessages.push(`pageerror: ${error.stack ?? error.message}`))
  page.on('requestfailed', request => requestFailures.push(`${request.method()} ${request.url()} ${request.failure()?.errorText ?? ''}`))

  try {
    await page.goto(`${args.baseUrl}/playlists/1/watch`, { waitUntil: 'domcontentloaded', timeout: TEST_TIMEOUT_MS })
    const channelRow = page.getByTestId('channel-row').filter({ hasText: 'E2E Test Channel' })
    await channelRow.waitFor({ state: 'visible', timeout: TEST_TIMEOUT_MS })
    await page.waitForTimeout(1000)
    await channelRow.click({ timeout: TEST_TIMEOUT_MS })
    await page.waitForFunction(() => {
      return !!document.querySelector('[data-testid="channel-video"],[data-testid="player-error"]')
    }, { timeout: TEST_TIMEOUT_MS })
    const video = page.getByTestId('channel-video')
    await video.waitFor({ state: 'visible', timeout: TEST_TIMEOUT_MS })

    await page.evaluate(async () => {
      const video = document.querySelector('video')
      if (!video) throw new Error('No video element')
      video.muted = true
      await video.play().catch(() => {})
    })
    await page.waitForTimeout(2000)
    const screenshotDir = path.join(args.reportDir, 'screenshots')
    fs.mkdirSync(screenshotDir, { recursive: true })
    screenshotPath = path.join(screenshotDir, `${args.profile}.png`)
    await page.screenshot({ path: screenshotPath, fullPage: true })

    await page.waitForFunction(() => {
      const video = document.querySelector('video')
      return !!video && video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA && video.videoWidth > 0 && video.videoHeight > 0
    }, { timeout: TEST_TIMEOUT_MS })

    const firstTime = await page.evaluate(() => document.querySelector('video')?.currentTime ?? 0)
    await page.waitForTimeout(PLAYBACK_OBSERVATION_MS)
    const stats = await page.evaluate(() => {
      const video = document.querySelector('video')
      return {
        currentTime: video?.currentTime ?? 0,
        width: video?.videoWidth ?? 0,
        height: video?.videoHeight ?? 0,
        error: document.querySelector('[data-testid="player-error"]')?.textContent ?? '',
      }
    })

    if (stats.error) throw new Error(`Player error: ${stats.error}`)
    if (stats.currentTime <= firstTime + 0.5) throw new Error(`Video time did not advance enough: ${firstTime} -> ${stats.currentTime}`)
    if (stats.width === 0 || stats.height === 0) throw new Error(`Video dimensions missing: ${stats.width}x${stats.height}`)

    await page.close()
    return {
      profile: args.profile,
      status: 'pass' as const,
      detail: `${stats.width}x${stats.height}, advanced ${(stats.currentTime - firstTime).toFixed(2)}s`,
      elapsedMs: Date.now() - startedAt,
      screenshotPath,
    }
  } catch (error) {
    const artifactDir = await saveDiagnostics({
      root: args.root,
      profile: args.profile,
      page,
      baseUrl: args.baseUrl,
      dataPath: args.dataPath,
      consoleMessages,
      requestFailures,
      appLog: args.appLog(),
      error,
    })
    await page.close().catch(() => {})
    return {
      profile: args.profile,
      status: 'fail' as const,
      detail: error instanceof Error ? error.message : String(error),
      elapsedMs: Date.now() - startedAt,
      artifactDir,
      screenshotPath,
    }
  }
}

function writeReport(args: {
  reportDir: string
  results: Result[]
  profiles: string[]
  backend: string
  audioProfile: string
  sourceUrl: string
  baseUrl: string
  tempRoot: string
}) {
  fs.mkdirSync(args.reportDir, { recursive: true })
  const reportPath = path.join(args.reportDir, 'index.html')
  const passed = args.results.filter(result => result.status === 'pass').length
  const failed = args.results.filter(result => result.status === 'fail').length
  const rows = args.results.map(result => {
    const screenshot = result.screenshotPath
      ? `<a href="${escapeHtml(relativeHtmlPath(reportPath, result.screenshotPath))}"><img src="${escapeHtml(relativeHtmlPath(reportPath, result.screenshotPath))}" alt="${escapeHtml(result.profile)} screenshot"></a>`
      : '<span class="muted">No screenshot captured</span>'
    const artifacts = result.artifactDir
      ? `<div><code>${escapeHtml(result.artifactDir)}</code></div>`
      : ''
    return `
      <section class="profile ${result.status}">
        <div class="profile-header">
          <h2>${escapeHtml(result.profile)}</h2>
          <span class="status">${escapeHtml(result.status.toUpperCase())}</span>
        </div>
        <p><strong>Time:</strong> ${(result.elapsedMs / 1000).toFixed(1)}s</p>
        <p><strong>Detail:</strong> ${escapeHtml(result.detail)}</p>
        ${artifacts}
        ${screenshot}
      </section>
    `
  }).join('\n')

  fs.writeFileSync(reportPath, `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Channeler Playback E2E Report</title>
  <style>
    body { margin: 0; font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background: #f8fafc; color: #111827; }
    main { max-width: 1180px; margin: 0 auto; padding: 32px 20px 56px; }
    h1 { margin: 0 0 8px; font-size: 28px; }
    h2 { margin: 0; font-size: 18px; }
    .summary { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 12px; margin: 24px 0; }
    .metric, .profile { border: 1px solid #e5e7eb; background: white; border-radius: 8px; padding: 16px; box-shadow: 0 1px 2px rgb(15 23 42 / 6%); }
    .metric span { display: block; color: #6b7280; font-size: 12px; text-transform: uppercase; letter-spacing: .04em; }
    .metric strong { display: block; margin-top: 4px; font-size: 18px; overflow-wrap: anywhere; }
    .profiles { display: grid; gap: 18px; }
    .profile-header { display: flex; align-items: center; justify-content: space-between; gap: 16px; margin-bottom: 10px; }
    .status { border-radius: 999px; padding: 4px 10px; font-size: 12px; font-weight: 700; }
    .pass .status { background: #dcfce7; color: #166534; }
    .fail .status { background: #fee2e2; color: #991b1b; }
    p { margin: 8px 0; }
    img { display: block; width: 100%; margin-top: 14px; border: 1px solid #e5e7eb; border-radius: 6px; background: #000; }
    code { color: #374151; overflow-wrap: anywhere; }
    .muted { color: #6b7280; }
  </style>
</head>
<body>
  <main>
    <h1>Channeler Playback E2E Report</h1>
    <p class="muted">Generated ${escapeHtml(new Date().toLocaleString())}</p>
    <div class="summary">
      <div class="metric"><span>Passed</span><strong>${passed}</strong></div>
      <div class="metric"><span>Failed</span><strong>${failed}</strong></div>
      <div class="metric"><span>Backend</span><strong>${escapeHtml(args.backend)}</strong></div>
      <div class="metric"><span>Audio</span><strong>${escapeHtml(args.audioProfile)}</strong></div>
      <div class="metric"><span>Source</span><strong>${escapeHtml(args.sourceUrl)}</strong></div>
      <div class="metric"><span>App URL</span><strong>${escapeHtml(args.baseUrl)}</strong></div>
      <div class="metric"><span>Profiles</span><strong>${escapeHtml(args.profiles.join(', '))}</strong></div>
      <div class="metric"><span>Temp Root</span><strong>${escapeHtml(args.tempRoot)}</strong></div>
    </div>
    <div class="profiles">
      ${rows}
    </div>
  </main>
</body>
</html>`)

  return reportPath
}

async function main() {
  const profiles = selectedProfiles()
  const backend = optionValue('--backend') || process.env.PLAYBACK_TEST_BACKEND || 'cpu'
  const audioProfile = normalizeAudioProfile(optionValue('--audio-profile') || process.env.PLAYBACK_TEST_AUDIO_PROFILE)
  const headed = hasArg('--headed')
  const keepOutput = hasArg('--keep-output')
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'channeler-playback-e2e-'))
  const reportDir = path.resolve(optionValue('--report-dir') || path.join('test-results', `playback-e2e-${timestampForPath()}`))
  const dataPath = path.join(root, 'data')
  const appPort = parseInt(optionValue('--port') || process.env.PLAYBACK_TEST_PORT || String(await freePort()), 10)
  const baseUrl = `http://localhost:${appPort}`
  let app: ReturnType<typeof startApp> | null = null
  let browser: Browser | null = null
  const results: Result[] = []

  console.log(`Temp root: ${root}`)
  console.log(`Report dir: ${reportDir}`)
  console.log(`Profiles: ${profiles.join(', ')}`)
  console.log(`Backend: ${backend}`)
  console.log(`Audio profile: ${audioProfile}`)
  console.log(`Source: ${SOURCE_URL}`)

  try {
    await seedDatabase(dataPath, SOURCE_URL, profiles[0], backend, audioProfile)
    app = startApp(dataPath, appPort, backend)
    await waitForHttp(baseUrl, STARTUP_TIMEOUT_MS)
    browser = await chromium.launch({ headless: !headed })

    const { sqlite } = await import('../lib/db')
    for (const profile of profiles) {
      sqlite.prepare('UPDATE playlists SET playback_profile = ?, transcode_backend = ?, audio_profile = ? WHERE id = 1')
        .run(profile, backend, audioProfile)
      const result = await runProfile({ browser, baseUrl, profile, root, reportDir, dataPath, appLog: app.output })
      results.push(result)
      await fetch(`${baseUrl}/api/transcode/1/stop`, { method: 'POST' }).catch(() => {})
    }
  } finally {
    await browser?.close().catch(() => {})
    app?.stop()
  }

  console.table(results.map(result => ({
    Profile: result.profile,
    Status: result.status.toUpperCase(),
    Time: `${(result.elapsedMs / 1000).toFixed(1)}s`,
    Detail: result.detail,
    Artifacts: result.artifactDir ?? '',
  })))

  const failed = results.filter(result => result.status === 'fail')
  const reportPath = writeReport({
    reportDir,
    results,
    profiles,
    backend,
    audioProfile,
    sourceUrl: SOURCE_URL,
    baseUrl,
    tempRoot: root,
  })
  console.log(`Playback report: ${reportPath}`)

  if (!keepOutput && failed.length === 0) fs.rmSync(root, { recursive: true, force: true })
  else console.log(`Kept output at: ${root}`)

  if (failed.length > 0) {
    console.error(`Playback profile E2E: ${results.length - failed.length} passed, ${failed.length} failed`)
    process.exit(1)
  }

  console.log(`Playback profile E2E: ${results.length} passed, 0 failed`)
}

main().catch(error => {
  console.error(error)
  process.exit(1)
})
