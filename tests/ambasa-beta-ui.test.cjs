const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { JSDOM } = require('jsdom');
const makeJQuery = require('jquery');
const source = readFileSync(join(__dirname, '../index.js'), 'utf8');
function functionBody(name) {
    const match = source.match(new RegExp('^function ' + name + '\\([^]*?^}', 'm'));
    assert.ok(match, 'missing production function ' + name);
    return match[0];
}

test('always-compact header does not duplicate native strategy icon or alter values', () => {
    const dom = new JSDOM('<div class="world_entry"><div class="slb-strategy-field"><select name="entryStateSelector"><option value="normal">normal</option><option value="constant">constant</option><option value="vectorized">vectorized</option></select></div></div>', { runScripts: 'outside-only' });
    const w = dom.window;
    w.eval(functionBody('syncCompactStrategyIcon'));
    const entry = w.document.querySelector('.world_entry');
    const select = entry.querySelector('select');
    let count = 0;
    select.addEventListener('input', () => count++);
    try {
        w.syncCompactStrategyIcon(entry, 'normal');
        w.syncCompactStrategyIcon(entry, 'normal');
        assert.equal(entry.querySelectorAll('.slb-strategy-icon').length, 0, 'unused wide-header glyph removed');
        assert.equal(entry.querySelector('select'), select, 'original native select node retained');
        assert.equal(select.getAttribute('aria-label'), '로어 등장 방식');
        select.value = 'vectorized';
        select.dispatchEvent(new w.Event('input', { bubbles: true }));
        w.syncCompactStrategyIcon(entry, select.value);
        assert.equal(count, 1, 'original listener survives');
        assert.equal(entry.querySelectorAll('.slb-strategy-icon').length, 0);
        assert.equal(select.value, 'vectorized', 'no value modification');
    } finally { w.close(); }
});

test('character filter preference lives in extension settings without an extra toolbar button', () => {
    const dom = new JSDOM('<div id="world_popup"><select id="world_editor_select"><option value="">Choose</option><option value="0">Remus</option><option value="1" selected>Other</option><option value="2">Sirius</option></select></div>', { runScripts: 'outside-only' });
    const w = dom.window;
    w.eval(`
        const world_names = ['Remus', 'Other', 'Sirius'];
        let this_chid = 0;
        const characters = [{avatar: 'remus.png'}];
        const settings = {showOnlyLinkedLorebooks: true};
        const getSettings = () => settings;
        const currentCharacterLinkedBooks = () => this_chid === undefined ? null : new Set(['Remus','Sirius']);
        const isVisibleWorldOption = (id,text,names,links) => links === null || id === '' || links.has(names[Number(id)] || text);
        const renderConnectedWorldResults = () => {};
        ${functionBody('syncConnectedWorldOptions')}
        window.syncFilter = syncConnectedWorldOptions;
        window.changeCharacter = () => {this_chid = undefined;};
        window.showAll = () => {settings.showOnlyLinkedLorebooks = false;};
        window.showLinked = () => {settings.showOnlyLinkedLorebooks = true;};
    `);
    try {
        const select = w.document.querySelector('select');
        w.syncFilter();
        assert.equal(select.value,'1', 'currently selected book is not changed');
        assert.equal(select.options[0].hidden,false);
        assert.equal(select.options[1].hidden,false);
        assert.equal(select.options[2].hidden,true);
        assert.equal(select.options[3].hidden,false);
        w.showAll(); w.syncFilter();
        assert.equal(select.options[2].hidden,false, 'disabled preference shows all books');
        w.showLinked(); w.syncFilter();
        assert.equal(select.options[2].hidden,true, 'enabled preference restores filtering');
        w.changeCharacter(); w.syncFilter();
        assert.equal(select.options[2].hidden,false,'no character shows all');
        assert.equal(select.value,'1', 'still no selection change');
        assert.equal(w.document.querySelectorAll('#slb-connected-world-toggle').length,0,'no toolbar button');
    } finally { w.close(); }
});

test('reopening with incomplete rows repairs them before revealing a mixed native/manager UI', () => {
    const dom = new JSDOM('<div id="world_popup_entries_list"><div class="world_entry" data-slb-header-enhanced="1"></div><div class="world_entry"></div></div>', { runScripts: 'outside-only' });
    const w = dom.window;
    w.eval(`
        const state = {drawerOpenLoadingTimer:null, worldDrawerOpening:false, currentBook:'Remus',bookSwitch:null};
        const currentBookName = () => 'Remus';
        const renderedEntries = () => [...document.querySelectorAll('.world_entry')];
        const isEntryHeaderReadyForReveal = row => row.dataset.slbHeaderEnhanced === '1';
        const hasCompleteVisibleEntryHeaders = () => false;
        let masked = 0, scheduled = 0;
        const setBookSwitchLoading = value => { if (value) masked++; };
        const scheduleEnhance = () => { scheduled++; };
        ${functionBody('beginWorldDrawerOpenLoading')}
        window.reopen = beginWorldDrawerOpenLoading;
        window.readCounts = () => ({masked, scheduled});
    `);
    try {
        w.reopen();
        assert.equal(w.readCounts().masked, 1, 'incomplete rows are not exposed');
        assert.equal(w.readCounts().scheduled, 1, 'repair is still scheduled without polling');
    } finally { w.close(); }
});
