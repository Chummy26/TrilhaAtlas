const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');

// Windows stat synthesizes permission bits. Observe the requested modes there;
// on POSIX verify the modes on disk after the atomic rename.
module.exports = function observePrivateSource(t) {
	if (process.platform !== 'win32') return file => {
		assert.equal(fs.statSync(file).mode & 0o777, 0o600);
		assert.equal(fs.statSync(path.dirname(file)).mode & 0o777, 0o700);
	};
	const open = t.mock.method(fs, 'openSync'), mkdir = t.mock.method(fs, 'mkdirSync');
	return file => {
		assert.ok(open.mock.calls.some(({ arguments: [target, flag, mode] }) =>
			typeof target === 'string' && target.startsWith(file + '.') && flag === 'wx' && mode === 0o600));
		assert.ok(mkdir.mock.calls.some(({ arguments: [target, options] }) =>
			target === path.dirname(file) && options?.mode === 0o700));
	};
};
