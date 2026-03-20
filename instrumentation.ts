// Called once by Next.js when the server starts (both dev and production).
// https://nextjs.org/docs/app/building-your-application/optimizing/instrumentation
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { initDb, seedSettingsFromEnv } = await import('./lib/db');
    await initDb();
    await seedSettingsFromEnv();
    // Start the modem daemon unless we're running via server.ts (which calls it directly).
    // SKIP_MODEM_DAEMON is set by server.ts to avoid double-init.
    if (!process.env.SKIP_MODEM_DAEMON) {
      const { startDaemon } = await import('./lib/modem');
      await startDaemon();
    }
  }
}
