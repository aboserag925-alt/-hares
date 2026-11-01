'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const test = require('node:test');

test('bundles all 114 surahs and 6236 Uthmani Arabic ayahs as valid UTF-8', async function () {
  const file = path.join(__dirname, '..', 'app', 'quran.json');
  const bytes = await fs.readFile(file);
  const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  const data = JSON.parse(text);

  assert.equal(data.edition, 'quran-uthmani');
  assert.equal(data.surahs.length, 114);
  assert.equal(data.surahs[0].number, 1);
  assert.equal(data.surahs[0].ayahs.length, 7);
  assert.equal(data.surahs[113].number, 114);
  assert.equal(data.surahs[113].ayahs.length, 6);
  assert.equal(
    data.surahs.reduce(function (total, surah) { return total + surah.ayahs.length; }, 0),
    6236
  );
  data.surahs.forEach(function (surah, index) {
    assert.equal(surah.number, index + 1);
    surah.ayahs.forEach(function (ayah, ayahIndex) {
      assert.equal(ayah.number, ayahIndex + 1);
      assert.match(ayah.text, /[\u0600-\u06ff]/);
    });
  });
});
