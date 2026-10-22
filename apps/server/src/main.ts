import { buildApp } from './app.js';
import { purgeExpiredSessions } from './auth/session.js';
import { loadConfig } from './config.js';
import { createDb, runMigrations } from './db/index.js';
import { seedBaseCatalog } from './db/seed.js';

const config = loadConfig();
const { db, close } = createDb(config.DATABASE_URL);
await runMigrations(db);
const seeded = await seedBaseCatalog(db);
const { app, mealie } = await buildApp({ config, db });
mealie.startScheduler();
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
