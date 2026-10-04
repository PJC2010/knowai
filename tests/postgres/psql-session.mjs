import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';

// One persistent psql process = one real PostgreSQL backend, not a query pool.
// All connections use the owned container's Unix socket, never host PG* defaults.
export class PsqlSession {
  constructor(dockerArgs, env, container, name) {
    this.name = name;
    this.sequence = 0;
    this.buffer = '';
    this.stderr = '';
    this.child = spawn('docker', [...dockerArgs, 'exec', '-i',
      '--env', `PGAPPNAME=cap-test-${name}`, container,
      'psql', '-X', '-qAt', '-P', 'pager=off', '-h', '/var/run/postgresql',
      '-p', '5432', '-U', 'postgres', '-d', 'editorial_cap_test'],
    { env, stdio: ['pipe', 'pipe', 'pipe'] });
    this.child.stdout.setEncoding('utf8');
    this.child.stderr.setEncoding('utf8');
    this.child.stdout.on('data', chunk => this.receive(chunk));
    this.child.stderr.on('data', chunk => { this.stderr = (this.stderr + chunk).slice(-12000); });
    this.child.stdin.on('error', error => this.fail(error));
    this.child.on('error', error => this.fail(error));
    this.closed = new Promise(resolve => this.child.on('close', (code, signal) => {
      this.exited = true;
      this.fail(new Error(`${name}: psql exited (${code ?? signal}): ${this.stderr}`));
      resolve();
    }));
  }

  fail(error) {
    if (!this.pending) return;
    clearTimeout(this.pending.timer);
    this.pending.reject(error);
    this.pending = undefined;
  }

  receive(chunk) {
    this.buffer += chunk;
    let end;
    while ((end = this.buffer.indexOf('\n')) !== -1) {
      const line = this.buffer.slice(0, end).replace(/\r$/, '');
      this.buffer = this.buffer.slice(end + 1);
      const pending = this.pending;
      if (!pending) continue;
      if (line.startsWith(`${pending.marker} `)) {
        const rest = line.slice(pending.marker.length + 1);
        const result = { state: rest.slice(0, 5), message: rest.slice(6), output: pending.lines.join('\n').trim() };
        clearTimeout(pending.timer);
        this.pending = undefined;
        pending.resolve(result);
      } else {
        pending.lines.push(line);
      }
    }
  }

  start(sql, { allowError = false } = {}) {
    assert.ok(!this.pending && !this.exited, `${this.name}: session is busy or closed`);
    const marker = `__cap_end_${++this.sequence}__`;
    const handle = { done: false };
    handle.promise = new Promise((resolve, reject) => {
      this.pending = { marker, lines: [], resolve, reject,
        timer: setTimeout(() => {
          this.fail(new Error(`${this.name}: command exceeded 15 seconds: ${sql.slice(0, 180)}`));
          this.child.kill('SIGKILL');
        }, 15000) };
      // ON_ERROR_STOP catches *any* failed setup statement, not just the last one.
      // Only deliberately rejected single-statement RPCs use allowError.
      this.child.stdin.write(`\\set ON_ERROR_STOP ${allowError ? 'off' : 'on'}\n${sql}\n\\echo ${marker} :SQLSTATE :LAST_ERROR_MESSAGE\n`);
    }).then(result => {
      handle.done = true;
      handle.result = result;
      return result;
    }, error => {
      handle.done = true;
      handle.error = error;
      throw error;
    });
    // Observation may reject before the concurrent command finishes. Cleanup still
    // owns that process; do not turn its later cancellation into an unhandled error.
    handle.promise.catch(() => {});
    return handle;
  }

  async run(sql) {
    const result = await this.start(sql).promise;
    assert.equal(result.state, '00000', `${this.name}: ${result.message}`);
    return result.output;
  }

  async json(sql) { return JSON.parse(await this.run(sql)); }

  async close() {
    if (this.exited) return;
    this.child.stdin.end('\\q\n');
    const timer = setTimeout(() => this.child.kill('SIGKILL'), 1000);
    await this.closed;
    clearTimeout(timer);
  }
}
