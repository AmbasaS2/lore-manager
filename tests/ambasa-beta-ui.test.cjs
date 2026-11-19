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

test('compact Font Awesome strategy leaves the native select intact and keeps handlers', () => {
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
        assert.equal(entry.querySelectorAll('.slb-strategy-icon').length, 1, 'no duplicated icon');
        assert.equal(entry.querySelector('select'), select, 'original native select node retained');
        assert.equal(entry.querySelector('.slb-strategy-field').dataset.slbState, 'normal');
        select.value = 'vectorized';
        select.dispatchEvent(new w.Event('input', { bubbles: true }));
        w.syncCompactStrategyIcon(entry, select.value);
        assert.equal(count, 1, 'original listener survives');
        assert.ok(entry.querySelector('.slb-strategy-icon').classList.contains('fa-link'));
        assert.equal(select.value, 'vectorized', 'no value modification');
    } finally { w.close(); }
});

test('character filter hides unrelated native options but never changes selection', () => {
    const dom = new JSDOM('<div id="world_popup"><button id="slb-connected-world-toggle"><span class="slb-linked-world-label"></span></button><select id="world_editor_select"><option value="">Choose</option><option value="0">Remus</option><option value="1" selected>Other</option><option value="2">Sirius</option></select></div>', { runScripts: 'outside-only' });
    const w = dom.window;
    w.eval(`
        const world_names = ['Remus', 'Other', 'Sirius'];
        let this_chid = 0;
        const characters = [{avatar: 'remus.png'}];
        const state = {linkedBookCharacterKey:'',linkedBookAllMode:false,linkedBookButton:document.getElementById('slb-connected-world-toggle')};
        const currentCharacterLinkedBooks = () => new Set(['Remus','Sirius']);
        const isVisibleWorldOption = (id,text,names,links) => links === null || id === '' || links.has(names[Number(id)] || text);
        const renderConnectedWorldResults = () => {};
        ${functionBody('syncConnectedWorldOptions')}
        window.syncFilter = syncConnectedWorldOptions;
        window.changeCharacter = () => {this_chid = undefined;};
        window.showAll = () => {state.linkedBookAllMode = true;};
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
        assert.equal(select.options[2].hidden,false, 'explicit all-mode shows unrelated');
        w.changeCharacter(); w.syncFilter();
        assert.equal(select.options[2].hidden,false,'no character shows all');
        assert.equal(select.value,'1', 'still no selection change');
    } finally { w.close(); }
});

test('reopening an already hydrated book with one repaired row avoids the full loading mask', () => {
    const dom = new JSDOM('<div id="world_popup_entries_list"><div class="world_entry" data-slb-header-enhanced="1"></div><div class="world_entry"></div></div>', { runScripts: 'outside-only' });
    const w = dom.window;
    w.eval(`
        const state = {drawerOpenLoadingTimer:null, worldDrawerOpening:false, currentBook:'Remus',bookSwitch:null};
        const currentBookName = () => 'Remus';
        const renderedEntries = () => [...document.querySelectorAll('.world_entry')];
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
        assert.equal(w.readCounts().masked, 0);
        assert.equal(w.readCounts().scheduled, 1);
    } finally { w.close(); }
});
