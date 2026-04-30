export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    if (process.env.NEXT_PHASE === 'phase-production-build' || process.env.npm_lifecycle_event === 'build') return

    const { runMigrations } = await import('./lib/migrate')
    const { reloadScheduler } = await import('./lib/scheduler')
    const { assertFfmpegAvailable, runTranscodeHardwareProbe } = await import('./lib/server-transcode')
    assertFfmpegAvailable()
    runMigrations()
    runTranscodeHardwareProbe()
    await reloadScheduler()
  }
}
