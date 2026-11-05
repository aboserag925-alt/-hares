'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, 'lectures.js'), 'utf8');

test('hides managed lectures without requesting an unconfigured API', function () {
  const host = { hidden: false };
  const requests = [];
  const context = {
    window: { AHL_API_BASE_URL: '' },
    document: {
      getElementById: function () { return host; }
    },
    fetch: function (url) { requests.push(url); }
  };

  vm.runInNewContext(source, context);

  assert.equal(host.hidden, true);
  assert.deepEqual(requests, []);
});
