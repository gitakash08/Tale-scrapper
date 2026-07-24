/**
 * Next.js instrumentation hook — runs once when the server process boots.
 * We start the schedule tick loop here (Node runtime only) so scheduled
 * scrapes fire even when nobody has the Schedules page open.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { startScheduler } = await import("./lib/scheduler");
    startScheduler();
  }
}
