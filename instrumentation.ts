export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { runMigrations } = await import('./lib/migrate')
    const { reloadScheduler } = await import('./lib/scheduler')
    runMigrations()
    await reloadScheduler()
  }
}
