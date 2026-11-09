'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

if (process.platform !== 'darwin') {
  process.exit(0);
}

const root = path.resolve(__dirname, '../..');
const appdmgPath = path.join(root, 'node_modules', 'appdmg');
if (!fs.existsSync(appdmgPath)) {
  throw new Error('Expected appdmg on macOS so the patched DMG maker can be installed.');
}

const patchPackageBin = path.join(root, 'node_modules', '.bin', 'patch-package');
const result = spawnSync(process.execPath, [patchPackageBin], {
  cwd: root,
  stdio: 'inherit',
});

if (result.error) throw result.error;
process.exit(result.status ?? 1);
