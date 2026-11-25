const { test } = require('node:test');
const assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');
const { join } = require('node:path');
const { pathToFileURL } = require('node:url');
const { readFileSync } = require('node:fs');

const root = join(__dirname, '..');
const loadLibrary = async () => import(pathToFileURL(join(root, 'library-shelf.js')).href);

async function fixture({ theme = 'antique', type = 'general', n = 45, order = 'normal' } = {}) {
    const { createStandaloneLibrary } = await loadLibrary();
    const dom = new JSDOM('<!doctype html><html><body></body></html>', { pretendToBeVisual: true });
    const win = dom.window;
    win.confirm = () => true;
    const data = Object.fromEntries(['Book A', 'Book B'].map(book => [book, {
        entries: Object.fromEntries(Array.from({ length: n }, (_, i) => [i, {
            uid: i, displayIndex: i, comment: 'Shared title ' + i, key: ['key'],
            content: book + ' content ' + i,
        }])),
    }]));
    const before = JSON.stringify(data);
    const stats = { reads: 0, translations: 0, writes: 0, warnings: [] };
    const lib = createStandaloneLibrary({
        document: win.document,
        listBooks: () => ['Book A', 'Book B'],
        linkedBooks: () => new Set(['Book A']),
        loadBook: async book => { stats.reads++; return data[book]; },
        loadTranslations: async () => { stats.translations++; },
        translationFor: () => ({ text: '' }),
        saveContent: async () => { stats.writes++; },
        saveTranslation: async () => { stats.writes++; },
        translateOne: async () => { stats.writes++; },
        openAdvanced: () => {},
        getType: () => type, setType: () => {},
        getTypeMap: () => ({ 'Book A': type, 'Book B': type }),
        getTags: () => [], getTagMap: () => ({}), setTags: async () => { stats.writes++; },
        getTheme: () => theme, setTheme: async () => {},
        getListPageSize: () => 5, setListPageSize: async () => {},
        getListOrder: () => order, setListOrder: async () => {},
        getLinkedOnly: () => true, setLinkedOnly: async () => {},
        notify: (...args) => stats.warnings.push(args),
    });
    return {
        dom, win, lib, stats, data, before,
        q: sel => win.document.querySelector(sel),
    };
}

test('16 reader/theme combinations open the exact UID, including unlinked books and deep pages', async () => {
    for (const theme of ['antique', 'mac', 'blackberry', 'ebook']) {
        for (const type of ['general', 'memory', 'world', 'people']) {
            const f = await fixture({ theme, type });
            try {
                assert.equal(await f.lib.openEntry('Book B', 37), true, theme + '/' + type);
                assert.ok(f.q('.slb-library-detail[data-uid="37"]'), theme + '/' + type);
                assert.equal(f.q('.slb-library-current')?.textContent, 'Book B');
                assert.equal(f.stats.reads, 1, theme + '/' + type + ': no duplicate book load');
                assert.equal(f.stats.translations, 1);
                assert.equal(f.stats.writes, 0);
                assert.equal(JSON.stringify(f.data), f.before, 'no WorldInfo changes');
            } finally { f.dom.window.close(); }
        }
    }
});

test('missing book, invalid UID and missing record return false without opening a modal', async () => {
    const f = await fixture();
    try {
        assert.equal(await f.lib.openEntry('Book Missing', 3), false);
        assert.equal(await f.lib.openEntry('Book A', '../1'), false);
        assert.equal(await f.lib.openEntry('Book A', 999), false);
        assert.equal(f.lib.isOpen(), false);
        assert.equal(f.stats.writes, 0);
    } finally { f.dom.window.close(); }
});

test('repeated entry deep links reuse current book and preserve saved source data', async () => {
    const f = await fixture({ type: 'world', n: 240, order: 'reverse' });
    try {
        assert.equal(await f.lib.openEntry('Book A', 12), true);
        assert.ok(f.q('.slb-library-detail[data-uid="12"]'));
        assert.equal(f.stats.reads, 1);
        assert.equal(await f.lib.openEntry('Book A', 13), true);
        assert.ok(f.q('.slb-library-detail[data-uid="13"]'));
        assert.equal(f.stats.reads, 1, 'existing book is not fetched again');
        assert.equal(f.stats.writes, 0);
        assert.equal(JSON.stringify(f.data), f.before);
    } finally { f.dom.window.close(); }
});

test('an unsaved edit can reject external navigation without losing the draft', async () => {
    const f = await fixture({ type: 'general' });
    try {
        assert.equal(await f.lib.openEntry('Book A', 4), true);
        const more = f.q('[data-action="more-tools"]');
        assert.ok(more);
        more.click();
        const edit = f.q('[data-action="edit"]');
        assert.ok(edit);
        edit.click();
        const textarea = f.q('textarea.slb-library-editor-text');
        assert.ok(textarea, 'editable source textarea');
        textarea.value = 'Unsaved user draft';
        f.win.confirm = () => false;
        assert.equal(await f.lib.openEntry('Book B', 4), false);
        assert.equal(textarea.value, 'Unsaved user draft');
        assert.equal(f.lib.isOpen(), true);
        assert.equal(f.stats.writes, 0);
    } finally { f.dom.window.close(); }
});

test('manager publishes only versioned opt-in navigation without changing native manager mode', () => {
    const js = readFileSync(join(root, 'index.js'), 'utf8');
    const shelf = readFileSync(join(root, 'library-shelf.js'), 'utf8');
    const manifest = JSON.parse(readFileSync(join(root, 'manifest.json'), 'utf8'));
    assert.equal(manifest.version, '1.4.85-ambasa.78');
    assert.match(js, /window\.__slbLoreLibraryBridge = Object\.freeze/);
    assert.match(js, /apiVersion: 1/);
    assert.match(shelf, /return \{ open, openEntry, close, isOpen,/);
    assert.doesNotMatch(shelf, /setInterval\(/);
});
