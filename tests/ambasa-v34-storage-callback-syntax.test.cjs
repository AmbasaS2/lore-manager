const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');

test('translation storage lifecycle callback object parses as valid JavaScript', () => {
    const source = readFileSync(join(__dirname, '../index.js'), 'utf8');
    const start = source.indexOf('const translationFiles = createLoreTranslationStorage({');
    const end = source.indexOf('const pendingTranslationFallbackBooks', start);
    assert.ok(start >= 0 && end > start);
    // Syntax-only compile: unlike extracting methods one at a time, this
    // catches a missing comma between onBookLoaded() and onError().
    assert.doesNotThrow(() => new Function(source.slice(start, end)));
    assert.match(source.slice(start, end), /onBookLoaded\(book\)\s*\{[\s\S]*?\},\s*onError\(error\)/);
});
