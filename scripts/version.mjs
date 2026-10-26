#!/usr/bin/env node
// Prints the version of a component (app | homeassistant) as x.yy.zzz:
//   x   major, set by hand in versions.json
//   yy  number of days (Europe/Berlin) since `since` on which the component's files changed
//   zzz the CI run (GITHUB_RUN_NUMBER), 0 for local builds
// Needs the full git history (CI: fetch-depth 0).
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const component = process.argv[2];
const config = JSON.parse(readFileSync(new URL('../versions.json', import.meta.url), 'utf8'))[component];
if (!config) {
  console.error(`usage: version.mjs <${Object.keys(JSON.parse(readFileSync(new URL('../versions.json', import.meta.url), 'utf8'))).filter((k) => !k.startsWith('$')).join('|')}>`);
  process.exit(1);
}

const dates = execFileSync('git', ['log', `--since=${config.since} 00:00`, '--date=format-local:%Y-%m-%d', '--format=%cd', '--', ...config.paths], {
  cwd: root,
  encoding: 'utf8',
  env: { ...process.env, TZ: 'Europe/Berlin' },
});
const days = new Set(dates.split('\n').filter((d) => d && d >= config.since)).size;
const run = Number(process.env.GITHUB_RUN_NUMBER ?? 0);
console.log(`${config.major}.${days}.${run}`);
