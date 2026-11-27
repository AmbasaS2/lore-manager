const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { JSDOM } = require('./fixture-ui-language.cjs');

const source = readFileSync(join(__dirname, '../index.js'), 'utf8');
const css = readFileSync(join(__dirname, '../style.css'), 'utf8');
const extract = name => {
    const match = source.match(new RegExp('^function ' + name + '\\([^]*?^}', 'm'));
    assert.ok(match, 'missing function: ' + name);
    return match[0];
};

test('settings header has readable spacing and no redundant introduction', () => {
    assert.match(source, /class="slb-extension-title"/);
    assert.match(source, /class="slb-extension-title"><i class="fa-solid fa-otter" aria-hidden="true"><\/i>&nbsp;&nbsp;\$\{uiHtml\("로어북 매니저"\)\}<\/b>/);
    assert.match(source, /fa-solid fa-otter extensionsMenuExtensionButton/);
    assert.doesNotMatch(css, /#slb-ai-tools\s*\{[^}]*(?:font-size|line-height)\s*:/s);
    assert.doesNotMatch(css, /\.slb-extension-title(?:\s|>)*[^{}]*\{/);
    assert.match(css, /#slb-ai-tools > \.inline-drawer > \.inline-drawer-content\s*\{[^}]*font-size:\s*max\(13px, 0\.95em\);[^}]*line-height:\s*1\.35;/s);
    assert.ok(!source.includes('필요한 설정만 펼쳐서 변경할 수 있습니다.'));
    assert.ok(!css.includes('slb-settings-intro'));
});

test('status badge uses one Font Awesome icon, preserves picker callbacks and keyboard access', () => {
    const dom = new JSDOM(
        '<div id="WorldInfo" class="slb-active slb-mobile-entry-state-enabled"><div id="world_popup_entries_list">' +
        '<div class="world_entry slb-compact-entry" data-uid="51">' +
        '<div class="slb-entry-header-shell"><div class="slb-header-grid">' +
        '<div class="slb-strategy-field"><select name="entryStateSelector">' +
        '<option value="normal" selected>Normal</option><option value="constant">Constant</option>' +
        '<option value="vectorized">Vectorized</option></select></div></div>' +
        '<div class="slb-header-actions"></div></div></div></div></div>',
        { runScripts: 'outside-only' },
    );
    const w = dom.window;
    const stubs = [
        'const createElement=(tag,cls,text)=>{const e=document.createElement(tag);if(cls)e.className=cls;if(text)e.textContent=text;return e;};',
        'const getUid=e=>e.dataset.uid;',
        'const queryCompatible=(el,selects)=>selects.map(s=>el.querySelector(s)).find(Boolean)||null;',
        'const entryData=()=>({constant:false,vectorized:false});',
        'let writes=0;',
        'const applyEntryStrategy=(entry,value)=>{writes++;entry.querySelector("select").value=value;};',
    ].join('\n');
    w.eval(stubs + '\n' + [
        'syncCompactStrategyIcon','closeStrategyPicker','openStrategyPicker','syncMobileEntryStateBadge',
    ].map(extract).join('\n') +
        '\nwindow.sync=syncMobileEntryStateBadge;window.writes=()=>writes;');
    try {
        const entry = w.document.querySelector('.world_entry');
        w.sync(entry);
        w.sync(entry);
        const badge = entry.querySelector('.slb-mobile-entry-state-badge');
        assert.ok(badge);
        assert.equal(badge.tagName,'BUTTON');
        assert.ok(!badge.classList.contains('menu_button'), 'the visible state glyph must not inherit menu button backgrounds');
        assert.equal(badge.querySelectorAll('.slb-state-symbol').length, 1);
        assert.ok(badge.querySelector('.slb-state-symbol').classList.contains('fa-circle'));
        assert.equal(badge.getAttribute('tabindex'), '0');
        assert.equal(badge.style.backgroundColor, '');
        const originalSelect = entry.querySelector('select');

        badge.dispatchEvent(new w.KeyboardEvent('keydown', { key:'Enter', bubbles:true, cancelable:true }));
        const picker = badge.querySelector('#slb-strategy-picker');
        assert.ok(picker, 'Enter opens accessible picker');
        assert.equal(picker.querySelectorAll('button.menu_button.slb-strategy-picker-option').length, 3);
        assert.equal(picker.querySelectorAll('.slb-picker-glyph.fa-solid').length, 3);
        assert.equal(picker.textContent.trim(), '', 'no emoji/text-only tiles');
        const option = picker.querySelector('button[data-strategy="constant"]');
        assert.equal(option.getAttribute('aria-label'), '상시 주입 (파랑)');
        assert.ok(option.querySelector('.fa-circle'));
        option.dispatchEvent(new w.MouseEvent('click', { bubbles:true, cancelable:true }));
        assert.equal(w.writes(),1,'original state handler invoked exactly once');
        assert.equal(originalSelect.value,'constant');
        assert.equal(w.document.getElementById('slb-strategy-picker'),null,'menu closes on click');
        assert.equal(entry.querySelector('select'),originalSelect,'native select is not replaced');
        w.sync(entry);
        assert.equal(badge.querySelectorAll('.slb-state-symbol').length,1);
        assert.ok(badge.querySelector('.slb-state-symbol').classList.contains('fa-circle'));
    } finally { w.close(); }
});

test('legacy injected chip gradients and fixed background no longer exist', () => {
    const start = source.indexOf('function ensureCriticalLayoutStyles()');
    const end = source.indexOf('function getSettings()',start);
    const critical = source.slice(start,end);
    assert.ok(start >= 0 && end > start);
    assert.ok(!critical.includes('slb-mobile-entry-state-badge'));
    assert.ok(!critical.includes('#slb-strategy-picker'));
    assert.ok(!css.includes('background: #fff !important'));
    assert.ok(!css.includes('linear-gradient(145deg, #73eba4, #2bbd6c)'));
    assert.ok(!source.includes('refreshBadgeThemeColors('));
    assert.ok(!source.includes('readBadgeThemeColor('));
});
