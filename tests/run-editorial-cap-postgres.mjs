// Disposable, local-only PostgreSQL tests. Never reads a DSN or publishes a port.
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { PsqlSession } from './postgres/psql-session.mjs';
import * as capSuite from './postgres/editorial-cap.mjs';

const options = {};
for (let i = 2; i < process.argv.length; i += 2) {
  const flag = process.argv[i], value = process.argv[i + 1];
  assert.ok(['--suite', '--mutate', '--case'].includes(flag) && value && !options[flag],
    'Usage: node tests/run-editorial-cap-postgres.mjs [--suite cap|events] [--mutate generator|suggestion|setter (cap only)] [--case name]');
  options[flag] = value;
}
assert.ok(['cap', 'events'].includes(options['--suite'] ?? 'cap'), 'Unknown --suite');
if (options['--mutate']) {
  assert.notEqual(options['--suite'], 'events', '--mutate is only supported by the cap suite');
  assert.ok(['generator', 'suggestion', 'setter'].includes(options['--mutate']));
}
const { install, mutate, runSuite } = options['--suite'] === 'events'
  ? await import('./postgres/editorial-events.mjs') : capSuite;

// Fixed Unix socket and minimal environment prevent remote Docker/PG config reuse.
const dockerArgs = ['--host', 'unix:///var/run/docker.sock'];
const env = { PATH: process.env.PATH, HOME: process.env.HOME, LANG: 'C.UTF-8' };
const exec = promisify(execFile);
async function docker(...args) {
  const result = await exec('docker', [...dockerArgs, ...args], { env, timeout: 30000, maxBuffer: 2 ** 20 });
  return result.stdout.trim();
}
const name = `knowai-cap-test-${randomUUID()}`;
const owner = randomUUID();
let createAttempted = false;
let container;
let provisioning;
const sessions = [];
let stopping;
function assertActive() {
  assert.ok(!stopping, 'Disposable PostgreSQL provisioning cancelled');
}
async function cleanup() {
  if (stopping) return stopping;
  stopping = (async () => {
    // A failed/timed-out client may still have created the named container.
    // Let in-flight provisioning settle before resolving ownership and deleting.
    await provisioning?.catch(() => {});
    await Promise.all(sessions.map(session => session.close()));
    if (createAttempted) {
      let owned;
      try {
        // Recover a daemon-side success even if create never returned its ID.
        owned = JSON.parse(await docker('container', 'inspect', container ?? name, '--format', '{{json .}}'));
      } catch (error) {
        if (/No such (?:object|container):/.test(error.stderr ?? '')) return;
        throw error;
      }
      assert.equal(owned.Name, `/${name}`, 'Refusing cleanup of a different container');
      assert.equal(owned.Config?.Labels?.['knowai.test.owner'], owner,
        'Refusing cleanup without this run\'s ownership label');
      assert.match(owned.Id, /^[a-f0-9]{64}$/);
      // Delete the inspected immutable ID, never a reassignable name/shared label.
      await docker('rm', '--force', '--volumes', owned.Id);
      const remaining = await docker('ps', '--all', '--quiet', '--filter', `id=${owned.Id}`);
      assert.equal(remaining, '', 'Owned disposable container must be removed');
      console.log('CLEANUP verified: owned container and temporary data removed');
    }
  })();
  return stopping;
}
for (const [signal, code] of [['SIGINT', 130], ['SIGTERM', 143]]) {
  process.once(signal, () => { void cleanup().then(() => process.exit(code), error => {
    console.error(`Cleanup failed: ${error.message}`); process.exit(code);
  }); });
}
async function provision() {
  assertActive();
  // Explicit prerequisite: docker --host unix:///var/run/docker.sock pull postgres:18
  // Do not silently download a runtime, use a mutable network endpoint or host data.
  const image = await docker('image', 'inspect', 'postgres:18', '--format', '{{.Id}}');
  assert.match(image, /^sha256:[a-f0-9]{64}$/);
  assertActive();
  createAttempted = true;
  container = await docker('create', '--name', name, '--label', 'knowai.test=editorial-cap',
    '--label', `knowai.test.owner=${owner}`,
    '--network', 'none', '--memory', '512m', '--cpus', '1',
    '--tmpfs', '/var/lib/postgresql:rw,nosuid,nodev,size=268435456',
    '--env', 'POSTGRES_DB=editorial_cap_test', '--env', 'POSTGRES_HOST_AUTH_METHOD=trust',
    image, 'postgres', '-c', 'listen_addresses=', '-c', 'timezone=UTC');
  assert.match(container, /^[a-f0-9]{64}$/);
  assertActive();
  await docker('start', container);
  assertActive();
  return image;
}
try {
  provisioning = provision();
  const image = await provisioning;
  const deadline = performance.now() + 30000;
  let ready = false;
  while (performance.now() < deadline) {
    assertActive();
    const logs = await docker('logs', container);
    assertActive();
    if (logs.includes('PostgreSQL init process complete; ready for start up.')) {
      try {
        await docker('exec', container, 'pg_isready', '-h', '/var/run/postgresql', '-U', 'postgres', '-d', 'editorial_cap_test');
        ready = true;
        break;
      } catch { /* bounded readiness polling; no test assertions depend on sleep */ }
    }
    await delay(100);
  }
  assertActive();
  assert.ok(ready, 'Disposable PostgreSQL did not become ready within 30s');
  const [observer, a, b] = ['observer', 'a', 'b'].map(label => {
    const session = new PsqlSession(dockerArgs, env, container, label);
    sessions.push(session);
    return session;
  });
  for (const session of sessions) {
    await session.run("set statement_timeout='12s'; set idle_in_transaction_session_timeout='20s'; set timezone='UTC';");
    session.pid = Number(await session.run('select pg_backend_pid();'));
    assert.ok(Number.isSafeInteger(session.pid) && session.pid > 0);
  }
  assert.equal(new Set(sessions.map(session => session.pid)).size, 3);
  console.log(`SERVER ${await observer.run('select version();')}`);
  console.log(`ISOLATION network=none ports=none image=${image} backends=${sessions.map(session => session.pid).join(',')}`);
  await install(observer);
  if (options['--mutate']) await mutate(observer, options['--mutate']);
  await runSuite(observer, a, b, options['--case']);
} catch (error) {
  console.error(error.stack ?? error.message);
  process.exitCode = 1;
} finally {
  await cleanup();
}
