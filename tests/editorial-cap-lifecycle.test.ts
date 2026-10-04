import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test, { type TestContext } from 'node:test';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';

const runner = fileURLToPath(new URL('./run-editorial-cap-postgres.mjs', import.meta.url));
const unrelated = {
  Id: 'c'.repeat(64), Name: '/another-editorial-test',
  Config: { Labels: { 'knowai.test': 'editorial-cap' } },
};

async function launch(t: TestContext, scenario: { create: string; mismatch?: boolean }) {
  const root = await mkdtemp(join(tmpdir(), 'knowai-cap-lifecycle-'));
  const fixture = await readFile(new URL('./postgres/fake-docker.cjs', import.meta.url), 'utf8');
  await writeFile(join(root, 'docker'), `#!${process.execPath}\n${fixture}`, { mode: 0o700 });
  await writeFile(join(root, 'scenario.json'), JSON.stringify(scenario));
  await writeFile(join(root, 'containers.json'), JSON.stringify([unrelated]));
  await writeFile(join(root, 'calls.jsonl'), '');
  // Exercise the actual stateful runner and its execFile/signal/finally paths.
  // The executable double cannot reach a Docker daemon or a database.
  await writeFile(join(root, 'events.jsonl'), '');
  const probe = fileURLToPath(new URL('./postgres/runner-lifecycle-probe.cjs', import.meta.url));
  const child = spawn(process.execPath, ['--require', probe, runner], {
    env: { PATH: root, HOME: root, LANG: 'C.UTF-8', NODE_ENV: 'test' },
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
  });
  const signalHandled = new Promise<void>(resolve => child.on('message', message => {
    if (message === 'signal-handled') resolve();
  }));
  let output = '';
  assert.ok(child.stdout && child.stderr);
  child.stdout.on('data', chunk => { output += chunk; });
  child.stderr.on('data', chunk => { output += chunk; });
  const done = new Promise<number | null>((resolve, reject) => {
    child.once('error', reject);
    child.once('close', code => resolve(code));
  });
  const timer = setTimeout(() => child.kill('SIGKILL'), 5000);
  t.after(async () => {
    child.kill('SIGKILL');
    await done;
    clearTimeout(timer);
    await rm(root, { recursive: true, force: true });
  });
  return {
    child, done, root, signalHandled, output: () => output,
    events: async (): Promise<string[]> => (await readFile(join(root, 'events.jsonl'), 'utf8'))
      .trim().split('\n').filter(Boolean).map(line => JSON.parse(line)),
    containers: async () => JSON.parse(await readFile(join(root, 'containers.json'), 'utf8')),
    calls: async (): Promise<string[][]> => (await readFile(join(root, 'calls.jsonl'), 'utf8'))
      .trim().split('\n').filter(Boolean).map(line => JSON.parse(line)),
  };
}

test('recovers owned create when the daemon succeeds but the client loses its response', async t => {
  const run = await launch(t, { create: 'failure' });
  assert.equal(await run.done, 1, run.output());
  assert.deepEqual(await run.containers(), [unrelated], 'No owned container may be orphaned');
  const calls = await run.calls();
  assert.equal(calls.filter(args => args[0] === 'rm').length, 1);
  assert.equal(calls.some(args => args[0] === 'start'), false);
});

test('SIGTERM waits for pending create before cleanup and never starts after cancellation', async t => {
  const run = await launch(t, { create: 'pending' });
  const deadline = Date.now() + 4000;
  while (true) {
    try { await readFile(join(run.root, 'created')); break; }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT' || Date.now() > deadline) throw error;
      await delay(10); // Wait for an explicit daemon event, not a guessed race window.
    }
  }
  run.child.kill('SIGTERM');
  await Promise.race([run.signalHandled, run.done.then(() => { throw new Error(run.output()); })]);
  await writeFile(join(run.root, 'release'), '');
  assert.equal(await run.done, 143, run.output());
  const events = await run.events();
  assert.ok(events.indexOf('create-return') >= 0 && events.indexOf('container') > events.indexOf('create-return'),
    `Cleanup must await in-flight create: ${events.join(', ')}`);
  assert.deepEqual(await run.containers(), [unrelated]);
  const calls = await run.calls();
  assert.equal(calls.some(args => args[0] === 'start'), false, 'No start after cancellation');
  assert.equal(calls.filter(args => args[0] === 'rm').length, 1, 'Concurrent finally/signal cleanup is idempotent');
});

test('refuses to remove a recovered name with another run\'s ownership label', async t => {
  const run = await launch(t, { create: 'failure', mismatch: true });
  assert.equal(await run.done, 1, run.output());
  const created = JSON.parse(await readFile(join(run.root, 'created'), 'utf8'));
  assert.deepEqual(await run.containers(), [unrelated, created]);
  assert.equal((await run.calls()).some(args => args[0] === 'rm'), false);
  assert.match(run.output(), /Refusing cleanup without this run's ownership label/);
});
