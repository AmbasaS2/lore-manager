const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { JSDOM } = require('jsdom');

const index = readFileSync(join(__dirname, '../index.js'), 'utf8');
const css = readFileSync(join(__dirname, '../style.css'), 'utf8');

test('library settings have a readable standalone launcher without a redundant theme picker', () => {
    const match = index.match(/<fieldset class="slb-library-settings">([\s\S]*?)<\/fieldset>/);
    assert.ok(match, 'library settings fieldset must remain inside extension management');
    const dom = new JSDOM('<div id="slb-ai-tools">' + match[0] + '</div>');
    const fieldset = dom.window.document.querySelector('.slb-library-settings');
    const button = fieldset.querySelector('#slb-open-library');
    assert.ok(button, 'standalone library launcher remains');
    assert.equal(button.type, 'button');
    assert.match(button.textContent, /독립 서재 열기/);
    assert.equal(fieldset.querySelector('#slb-library-theme'), null, 'theme picker removed');
    assert.equal(fieldset.querySelectorAll('select').length, 0);
    assert.equal(fieldset.querySelector('legend').textContent, '독립 로어북 매니저 · 서재');
    dom.window.close();
});

test('only antique is selected at runtime and old theme preference is left intact', () => {
    assert.match(index, /getTheme:\s*\(\)\s*=>\s*'antique'/);
    assert.doesNotMatch(index, /const libraryThemeControl = document.getElementById/);
    assert.match(index, /libraryTheme:\s*'antique'/, 'keep existing settings schema for backward compatibility');
    assert.match(index, /function openStandaloneLibrary\(/, 'the original launcher stays available');
});

test('narrow extension settings keep horizontal button words and full-width hit target', () => {
    assert.match(css, /#slb-ai-tools \.slb-library-settings\s*\{\s*display:\s*grid;\s*grid-template-columns:\s*minmax\(0,\s*1fr\);/);
    const block = css.match(/#slb-ai-tools \.slb-library-settings #slb-open-library\s*\{([^}]*)\}/)?.[1];
    assert.ok(block, 'specific isolated launcher CSS exists');
    assert.match(block, /display:\s*inline-flex/);
    assert.match(block, /width:\s*100%\s*!important/);
    assert.match(block, /white-space:\s*nowrap\s*!important/);
    assert.match(block, /word-break:\s*keep-all/);
    assert.match(block, /writing-mode:\s*horizontal-tb/);
    assert.doesNotMatch(css, /#WorldInfo[^{]*#slb-open-library/, 'no changes to native lorebook layout');
});
