'use strict';
const assert = require('node:assert/strict');
const S = require('../omni_security_browser.js');

function mustFail(fn) {
  assert.throws(fn);
}

// SEC-004: Deck schema validation, attribute sanitization, and safe image data URLs
const validPngDataUrl = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
const deck = S.parseDeckJSON(JSON.stringify({
  redmarkDeck: 2,
  theme: 'ocean',
  slides: [
    { layout: 'content" onmouseover="alert(1)', title: 'Safe Title', body: 'Body copy', image: { src: 'javascript:alert(1)' } },
    { layout: 'image', title: 'Valid Image Slide', image: { src: validPngDataUrl, w: 400, h: 300 } }
  ]
}));
assert.equal(deck.theme, 'ocean');
assert.equal(deck.slides[0].layout, 'content');
assert.equal(deck.slides[0].image, null);
assert.equal(deck.slides[1].layout, 'image');
assert.equal(deck.slides[1].image.src, validPngDataUrl);
mustFail(() => S.parseDeckJSON(JSON.stringify({ redmarkDeck: 99, slides: [{ layout: 'title' }] })));
mustFail(() => S.parseDeckJSON(JSON.stringify({ redmarkDeck: 2, slides: [] })));

// SEC-005: Sanitizer fail-closed fallback (null or broken sanitizer renders escaped plain text)
assert.ok(!S.escapeHTML('" onerror="x').includes('"'));
const clean = S.sanitizerOrPlainText('<img src=x onerror=alert(1)>', null);
assert.equal(clean.rich, false);
assert.ok(clean.html.startsWith('&lt;img'));

const cleanWithMockPurify = S.sanitizerOrPlainText('<p onclick="evil()">Hello</p><script>evil()</script>', {
  sanitize(input) {
    return input.replace(/<script[\s\S]*?<\/script>/gi, '').replace(/\son\w+="[^"]*"/gi, '');
  }
});
assert.equal(cleanWithMockPurify.rich, true);
assert.equal(cleanWithMockPurify.html, '<p>Hello</p>');

// SEC-023: Reject prototype pollution keys (__proto__, constructor, prototype)
mustFail(() => S.rejectPoisonKeys(JSON.parse('{"__proto__":{"polluted":1}}')));
mustFail(() => S.rejectPoisonKeys({ constructor: { prototype: { polluted: 1 } } }));
assert.equal({}.polluted, undefined);

// SEC-026 & SEC-028: CSV formula neutralization and XML key/value escaping
assert.ok(S.safeCsv([{ x: '=1+1', y: '-42.5', z: '-cmd' }]).includes("'=1+1"));
assert.ok(S.safeCsv([{ x: '=1+1', y: '-42.5', z: '-cmd' }]).includes('"-42.5"'));
assert.ok(S.safeCsv([{ x: '=1+1', y: '-42.5', z: '-cmd' }]).includes("'-cmd"));
assert.ok(S.safeXml([{ '1 bad': '<hello>&"world"' }]).includes('key="1 bad"'));
assert.ok(S.safeXml([{ '1 bad': '<hello>&"world"' }]).includes('&lt;hello&gt;&amp;&quot;world&quot;'));

// SEC-027: ZIP metadata budget + decompressed streaming extraction budget
const zip = { files: { 'ok.txt': { name: 'ok.txt', dir: false, _data: { uncompressedSize: 12 } } } };
assert.equal(S.zipBudget(zip, 100).count, 1);
mustFail(() => S.zipBudget({ files: { '../bad.txt': { name: '../bad.txt', dir: false, _data: { uncompressedSize: 12 } } } }, 100));
mustFail(() => S.zipBudget({ files: { '/abs.txt': { name: '/abs.txt', dir: false, _data: { uncompressedSize: 12 } } } }, 100));

(async () => {
  const fakeJSZip = {
    async loadAsync() {
      return {
        files: {
          'spoofed.bin': {
            name: 'spoofed.bin',
            dir: false,
            _data: { uncompressedSize: 16 },
            async: async () => new Uint8Array(65 * 1024 * 1024) // exceeds 60 MB per-entry limit despite 16-byte header
          }
        }
      };
    }
  };
  S.installZipBudget(fakeJSZip);
  const loaded = await fakeJSZip.loadAsync(new Uint8Array(32));
  await assert.rejects(() => loaded.files['spoofed.bin'].async('uint8array'), /Decompressed archive entry exceeds byte limit/);

  // SEC-036: Media URL & metadata pairing
  const good = S.validMediaPairs(
    { downloads: [{ url: 'javascript:bad' }, { url: 'https://cdn.example/a.mp4' }] },
    'https://api.example',
    url => url.startsWith('https://') ? url : ''
  );
  assert.equal(good.length, 1);
  assert.equal(good[0].download.url, 'https://cdn.example/a.mp4');

  console.log('Browser reference security tests passed');
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
