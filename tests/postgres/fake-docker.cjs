// Filesystem-backed daemon double. Only used via a test-owned PATH and HOME.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = process.env.HOME;
const file = name => path.join(root, name);
const args = process.argv.slice(2);
assert.deepEqual(args.splice(0, 2), ['--host', 'unix:///var/run/docker.sock']);
fs.appendFileSync(file('calls.jsonl'), JSON.stringify(args) + '\n');
const scenario = JSON.parse(fs.readFileSync(file('scenario.json'), 'utf8'));
const read = () => JSON.parse(fs.readFileSync(file('containers.json'), 'utf8'));
const save = containers => fs.writeFileSync(file('containers.json'), JSON.stringify(containers));
const fail = message => { console.error(message); process.exit(1); };

if (args[0] === 'image' && args[1] === 'inspect') {
  console.log('sha256:' + 'a'.repeat(64));
} else if (args[0] === 'create') {
  const labels = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--label') {
      const [key, value] = args[++i].split('=');
      labels[key] = value;
    }
  }
  if (scenario.mismatch) labels['knowai.test.owner'] = 'another-run';
  const container = {
    Id: 'b'.repeat(64),
    Name: '/' + args[args.indexOf('--name') + 1],
    Config: { Labels: labels },
  };
  save([...read(), container]);
  fs.writeFileSync(file('created'), JSON.stringify(container));
  if (scenario.create === 'failure') fail('Daemon created container; client lost response');
  if (scenario.create === 'pending') {
    const timer = setInterval(() => {
      if (!fs.existsSync(file('release'))) return;
      clearInterval(timer);
      console.log(container.Id);
    }, 10);
    setTimeout(() => fail('Test did not release pending create'), 5000).unref();
  } else {
    console.log(container.Id);
  }
} else if (args[0] === 'container' && args[1] === 'inspect') {
  const target = args[2];
  const container = read().find(item => item.Id === target || item.Name === '/' + target);
  if (!container) fail('Error: No such container: ' + target);
  console.log(JSON.stringify(container));
} else if (args[0] === 'rm') {
  const target = args.at(-1);
  save(read().filter(item => item.Id !== target && item.Name !== '/' + target));
  console.log(target);
} else if (args[0] === 'ps') {
  const filter = args[args.indexOf('--filter') + 1];
  assert.ok(filter.startsWith('id='), 'Never sweep a shared label');
  console.log(read().filter(item => item.Id === filter.slice(3)).map(item => item.Id).join('\n'));
} else {
  fail('Unexpected fake Docker command: ' + JSON.stringify(args));
}
