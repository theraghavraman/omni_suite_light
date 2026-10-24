'use strict';
const assert = require('node:assert/strict');
const S = require('../omni_security_browser.js');
function mustFail(fn) { assert.throws(fn); }
const deck = S.parseDeckJSON(JSON.stringify({redmarkDeck:2, theme:'light', slides:[
  {layout:'content\" onmouseover=\"alert(1)', title:'safe', image:{src:'javascript:alert(1)'}}
]}));
assert.equal(deck.slides[0].layout, 'content');
assert.equal(deck.slides[0].image, null);
assert.ok(!S.escapeHTML('" onerror="x').includes('"'));
const clean = S.sanitizerOrPlainText('<img src=x onerror=alert(1)>',null);
assert.equal(clean.rich, false);
assert.ok(clean.html.startsWith('&lt;img'));
mustFail(() => S.rejectPoisonKeys(JSON.parse('{"__proto__":{"polluted":1}}')));
assert.equal({}.polluted, undefined);
assert.ok(S.safeCsv([{x:'=1+1'}]).includes("'=1+1"));
assert.ok(S.safeXml([{'1 bad':'<hello>'}]).includes('key="1 bad"'));
const zip={files:{'ok.txt':{name:'ok.txt',dir:false,_data:{uncompressedSize:12}}}};
assert.equal(S.zipBudget(zip,100).count,1);
mustFail(() => S.zipBudget({files:{'../bad.txt':{name:'../bad.txt',dir:false,_data:{uncompressedSize:12}}}},100));
const good = S.validMediaPairs({downloads:[{url:'javascript:bad'},{url:'https://cdn.example/a.mp4'}]},
  'https://api.example', url => url.startsWith('https://') ? url : '');
assert.equal(good.length,1);
assert.equal(good[0].download.url,'https://cdn.example/a.mp4');
console.log('Browser reference security tests passed');
