// Observe real runner events without replacing its lifecycle or execFile logic.
const fs = require('node:fs');
const path = require('node:path');
const childProcess = require('node:child_process');
const { syncBuiltinESMExports } = require('node:module');
const record = event => fs.appendFileSync(path.join(process.env.HOME, 'events.jsonl'), JSON.stringify(event) + '\n');
const execFile = childProcess.execFile;
childProcess.execFile = function (command, args, options, callback) {
  record(args[2]);
  return execFile(command, args, options, (error, stdout, stderr) => {
    if (args[2] === 'create') record('create-return');
    callback(error, stdout, stderr);
  });
};
childProcess.execFile[require('node:util').promisify.custom] = (...args) => new Promise((resolve, reject) => {
  childProcess.execFile(...args, (error, stdout, stderr) => {
    if (error) reject(Object.assign(error, { stdout, stderr }));
    else resolve({ stdout, stderr });
  });
});
syncBuiltinESMExports();
const once = process.once;
process.once = function (event, listener) {
  if (!['SIGTERM', 'SIGINT'].includes(event)) return once.call(this, event, listener);
  return once.call(this, event, (...args) => {
    listener(...args);
    process.send?.('signal-handled');
  });
};
