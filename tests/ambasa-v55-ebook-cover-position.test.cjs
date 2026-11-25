const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');

const root = join(__dirname, '..');
const css = readFileSync(join(root, 'library-shelf.css'), 'utf8');
const js = readFileSync(join(root, 'library-shelf.js'), 'utf8');
const manifest = JSON.parse(readFileSync(join(root, 'manifest.json'), 'utf8'));

test('ebook cover title rises only 4px from ambasa.54 without changing other skins or metadata', () => {
    const rule = '#slb-library-overlay .slb-library-mode-ebook .slb-library-cover-title';
    const matching = [...css.matchAll(/#slb-library-overlay \.slb-library-mode-ebook \.slb-library-cover-title\s*\{([^}]*)\}/g)];
    assert.equal(matching.length, 2, 'the existing earlier fallback and final override remain');
    assert.match(matching[0][1], /transform:\s*translateY\(-5px\)/);
    assert.match(matching[1][1], /transform:\s*translateY\(-14px\)/);
    assert.doesNotMatch(css, /translateY\(-10px\)/);
    assert.match(js, /element\(doc, 'span', 'slb-library-cover-title', item\.name\)/);
    assert.equal(manifest.version, '1.4.85-ambasa.78');
    assert.ok(rule);
});
