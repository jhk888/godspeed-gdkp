'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require('node:path').join(__dirname, '../functions/index.js'), 'utf8');
const helper = source.match(/function safeRaiderKey\(value\)\{[\s\S]*?\n\}/);
assert.ok(helper, 'raider key validator exists');
const context = {Buffer, HttpsError: class extends Error {constructor(code,message){super(message);this.code=code;}}};
vm.createContext(context);
vm.runInContext(helper[0], context);
for (const name of ['Átal','Îf','Choná','한국','hard']) {
  const key = encodeURIComponent(name.trim().toLowerCase()).replace(/\./g, '%2E');
  assert.equal(context.safeRaiderKey(key), key);
}
assert.equal(context.safeRaiderKey('a'.repeat(768)), 'a'.repeat(768));
for (const key of ['',null,42,'a/b','a.b','a#b','a$b','a[b','a]b','a\u0000b','a\u007fb','a'.repeat(769),'한'.repeat(257)]) {
  assert.throws(() => context.safeRaiderKey(key), /Invalid raider key/);
}
assert.equal((source.match(/safeRaiderKey\(data\.raiderKey\)/g)||[]).length, 3);
assert.ok(!source.includes('safe(data.raiderKey)'));
console.log('Unicode raider keys preserved; forbidden database keys rejected.');
