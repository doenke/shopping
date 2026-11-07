// A fresh database for every run (the server migrates it on start).
import postgres from 'postgres';

const url = new URL(process.env.DATABASE_URL);
const name = url.pathname.slice(1);
url.pathname = '/postgres';
const admin = postgres(url.toString(), { max: 1, onnotice: () => {} });
await admin.unsafe(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
await admin.unsafe(`CREATE DATABASE ${name}`);
await admin.end();
