import { buildApp } from './app.js';
import { purgeExpiredSessions } from './auth/session.js';
import { loadConfig } from './config.js';
import { createDb, runMigrations } from './db/index.js';
import { seedBaseCatalog } from './db/seed.js';

const config = loadConfig();
const { db, close } = createDb(config.DATABASE_URL);
await runMigrations(db);
const seeded = await seedBaseCatalog(db);
const { app, sync, hub, mealie, icons, avatars, webhooks } = await buildApp({ config, db });
mealie.startScheduler();
icons.startScheduler();
avatars.startScheduler();
await webhooks.start();
// Keep only the newest checked entries per list: once shortly after the start, then daily.
const pruneDone = () =>
  sync
    .pruneDone()
    .then((users) => users.size && hub.notify(users))
    .catch((err: unknown) => app.log.error({ err }, 'Erledigte Einträge aufräumen'));
setTimeout(pruneDone, 60_000).unref();
setInterval(pruneDone, 24 * 3_600_000).unref();
if (seeded) app.log.info(`${seeded} Artikel in den Grundkatalog übernommen`);
await purgeExpiredSessions(db);

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, async () => {
    await app.close();
    await close();
    process.exit(0);
  });
}

await app.listen({ port: config.PORT, host: config.HOST });
