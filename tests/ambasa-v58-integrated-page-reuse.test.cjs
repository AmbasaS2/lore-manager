const { test } = require('node:test');
const assert = require('node:assert/strict');
const { JSDOM, uiText, uiHtml } = require('./fixture-ui-language.cjs');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const vm = require('node:vm');

const source = readFileSync(join(__dirname, '..', 'index.js'), 'utf8');
function functionSource(name) {
    const match = source.match(new RegExp('^function ' + name + '\\([^]*?^}', 'm'));
    assert.ok(match, 'missing ' + name);
    return match[0];
}

function fixture() {
    const dom = new JSDOM(
        '<div id="WorldInfo"><div id="world_popup">' +
        '<div id="world_popup_entries_list"></div></div></div>',
        { pretendToBeVisual: true },
    );
    const document = dom.window.document;
    const popup = document.getElementById('world_popup');
    const initialList = document.getElementById('world_popup_entries_list');
    let book = 'Existing Book';
    let foldy = false;
    const counts = {
        compact: 0, drag: 0, section: 0, bindFilter: 0,
        toolbar: 0, bindEntries: 0, popupObserver: 0,
        filters: 0, mobile: 0,
    };
    const state = { managerMode: 'standard', workspace: null };

    const ctx = {
        uiText, uiHtml,
        state, document,
        jQuery: {}, notify: () => {}, getBookTokenCache: () => new Map(),
        currentBookName: () => book,
        isFoldyLinkedMode: () => foldy,
        compactNativeSort: () => { counts.compact++; },
        enableNativeEntryDrag: () => { counts.drag++; return true; },
        ensureWorkspaceSummarySection({ id, bodyId }) {
            counts.section++;
            let section = document.getElementById(id);
            if (!section) {
                section = document.createElement('section');
                section.id = id;
                const content = document.createElement('div');
                content.id = bodyId;
                section.append(content);
            }
            return { section, body: section.querySelector('#' + bodyId) };
        },
        createTokenStrip: () => document.createElement('span'),
        createEntryFilters: () => document.createElement('div'),
        bindEntryFilterControls: () => { counts.bindFilter++; },
        entryBulkEditor: {
            ensureToolbar(popup, entries) {
                counts.toolbar++;
                let toolbar = document.getElementById('slb-entry-selection-toolbar');
                if (!toolbar) {
                    toolbar = document.createElement('div');
                    toolbar.id = 'slb-entry-selection-toolbar';
                    const bulk = document.createElement('button');
                    bulk.className = 'slb-bulk-mode-label';
                    toolbar.append(bulk);
                    popup.insertBefore(toolbar, entries);
                }
                return toolbar;
            },
        },
        bindWorkspaceEntries(entries) {
            counts.bindEntries++;
            state.workspace = { entries };
            state.observer = { active: true };
        },
        bindWorkspacePopupObserver() {
            counts.popupObserver++;
            state.workspaceObserver = { active: true };
        },
        syncFilterButtons() { counts.filters++; },
        applyMobileDisplaySettings() { counts.mobile++; },
    };
    vm.runInNewContext(functionSource('createWorkspace') +
        '\nglobalThis.build=createWorkspace;', ctx);
    return {
        dom, counts, state, popup, initialList,
        build: () => ctx.build(),
        setBook(value) { book = value; },
        setFoldy(value) { foldy = value; },
    };
}

test('100 same-book page turns reuse live toolbar rather than rebuilding it 100 times', () => {
    const f = fixture();
    try {
        f.build();
        assert.equal(f.counts.section, 2, 'initial token/filter sections created once');
        assert.equal(f.counts.toolbar, 1);
        assert.equal(f.counts.bindEntries, 1);
        assert.equal(f.counts.popupObserver, 1);
        assert.equal(f.counts.mobile, 1);
        for (let i = 0; i < 100; i++) f.build();
        assert.equal(f.counts.section, 2, 'zero extra summary section construction');
        assert.equal(f.counts.toolbar, 1, 'zero repeated toolbar construction');
        assert.equal(f.counts.bindEntries, 1, 'existing input/observer listeners retained');
        assert.equal(f.counts.popupObserver, 1);
        assert.equal(f.counts.mobile, 1, 'no duplicate mobile class sync on each page');
        assert.equal(f.counts.filters, 101, 'filter state still synchronized');
        assert.equal(f.counts.drag, 101, 'ST may recreate sortable; native drag wrapper still checked');
        assert.equal(f.counts.compact, 101, 'native sort select kept synchronized');
        assert.equal(f.popup.querySelectorAll('#slb-entry-selection-toolbar').length, 1);
        assert.equal(f.popup.querySelectorAll('#slb-token-summary-section').length, 1);
    } finally { f.dom.window.close(); }
});

test('book switch is NOT misclassified as pagination even when native list node is reused', () => {
    const f = fixture();
    try {
        f.build();
        f.setBook('Different Book');
        f.build();
        assert.equal(f.counts.section, 4, 'new book uses the full guard/setup path');
        assert.equal(f.counts.bindEntries, 2);
        assert.equal(f.state.workspace.book, 'Different Book');
        f.build();
        assert.equal(f.counts.section, 4, 'subsequent same-book page skips again');
    } finally { f.dom.window.close(); }
});

test('replaced list node or broken toolbar/filter is rebuilt, never reused incorrectly', () => {
    const f = fixture();
    try {
        f.build();
        const filter = f.popup.querySelector('#slb-entry-filters-section');
        filter.remove();
        f.build();
        assert.equal(f.counts.section, 4, 'detached filter triggers normal repair');
        assert.equal(f.popup.querySelector('#slb-entry-filters-section')?.parentElement,
            f.popup.querySelector('#slb-entry-selection-toolbar'));
        f.build();
        assert.equal(f.counts.section, 4);
        const nextList = f.popup.ownerDocument.createElement('div');
        nextList.id = 'world_popup_entries_list';
        f.initialList.replaceWith(nextList);
        f.build();
        assert.equal(f.counts.section, 6, 'native replacement list detected');
        assert.equal(f.state.workspace.entries, nextList);
        assert.equal(f.counts.bindEntries, 3);
        assert.equal(f.counts.popupObserver, 3);
    } finally { f.dom.window.close(); }
});

test('missing observer bindings force repair instead of skipping workspace setup', () => {
    const f = fixture();
    try {
        f.build();
        f.state.observer = null;
        f.build();
        assert.equal(f.counts.bindEntries, 2);
        f.state.workspaceObserver = null;
        f.build();
        assert.equal(f.counts.popupObserver, 3);
        assert.equal(f.counts.section, 6);
    } finally { f.dom.window.close(); }
});

test('Foldy mode transition initializes once; 100 same-book folder/page changes reuse the workspace', () => {
    const f = fixture();
    try {
        f.build();
        f.setFoldy(true);
        f.build();
        assert.equal(f.counts.section, 4, 'mode transition retains full guard/setup');
        assert.equal(f.counts.bindEntries, 2);
        for (let i = 0; i < 100; i++) f.build();
        assert.equal(f.counts.section, 4);
        assert.equal(f.counts.toolbar, 2);
        assert.equal(f.counts.bindEntries, 2);
        assert.equal(f.counts.popupObserver, 2);
        assert.equal(f.counts.mobile, 2);
        f.setBook('Next Book');
        f.build();
        assert.equal(f.counts.section, 6, 'book change repairs/rebinds');
        f.setFoldy(false);
        f.build();
        assert.equal(f.counts.section, 8, 'leaving Foldy reinitializes mode');
    } finally { f.dom.window.close(); }
});

test('paging optimization does not replace ST pagination, save, translation, or entry DOM', () => {
    const part = functionSource('createWorkspace');
    assert.match(part, /enableNativeEntryDrag\(/);
    assert.match(part, /workspace\?\.entries === entries/);
    assert.match(part, /workspace\?\.book === currentBookName\(\)/);
    assert.match(part, /workspace\?\.foldyLinked === linkedMode/);
    assert.doesNotMatch(part, /cloneNode\(|replaceChildren\(/);
    assert.doesNotMatch(part, /setInterval\(|setTimeout\(|new MutationObserver\(/);
    assert.match(source, /function bindEntryDrawerLifecycle\(/);
    assert.match(source, /function setBookSwitchLoading\(/);
});
