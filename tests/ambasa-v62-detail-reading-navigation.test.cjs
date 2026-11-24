const { test } = require('node:test');
const assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { pathToFileURL } = require('node:url');

const root = join(__dirname, '..');
const source = readFileSync(join(root, 'library-shelf.js'), 'utf8');
const css = readFileSync(join(root, 'library-shelf.css'), 'utf8');
const libURL = pathToFileURL(join(root, 'library-shelf.js')).href;
const tick = () => new Promise(resolve => setImmediate(resolve));

async function fixture({ kind = 'general', theme = 'antique', n = 24, width = 390,
    reverse = false } = {}) {
    const { createStandaloneLibrary } = await import(libURL);
    const dom = new JSDOM('<!doctype html><html><body><div id="chat">Untouched</div></body></html>', {
        pretendToBeVisual: true,
    });
    const win = dom.window;
    Object.defineProperty(win, 'innerWidth', { configurable: true, value: width });
    win.confirm = () => true;
    const state = { reverse, confirmations: 0 };
    const stats = { reads: 0, writes: 0 };
    const entries = Object.fromEntries(Array.from({ length: n }, (_, i) => [
        i, { uid: i, displayIndex: i, comment: 'Record ' + i, content: 'Body ' + i },
    ]));
    const lib = createStandaloneLibrary({
        document: win.document,
        listBooks: () => ['Book'], linkedBooks: () => new Set(['Book']),
        loadBook: async () => { stats.reads++; return { entries }; },
        loadTranslations: async () => {}, translationFor: () => ({ text: '' }),
        saveContent: async () => { stats.writes++; },
        saveTranslation: async () => { stats.writes++; },
        translateOne: async () => { stats.writes++; },
        openAdvanced: () => {},
        getType: () => kind, getTypeMap: () => ({ Book: kind }), setType: () => {},
        getTags: () => [], getTagMap: () => ({}), setTags: async () => { stats.writes++; },
        getTheme: () => theme, getLinkedOnly: () => true, getListPageSize: () => 5,
        getListOrder: () => state.reverse ? 'reverse' : 'normal', notify: () => {},
    });
    lib.open();
    const q = sel => win.document.querySelector(sel);
    const all = sel => [...win.document.querySelectorAll(sel)];
    const click = sel => { const node = q(sel); assert.ok(node, 'Missing '+sel); node.click(); };
    const load = async () => { click('[data-action="select-book"]'); await tick(); };
    return { dom, win, lib, q, all, click, load, stats, state };
}

test('catalogue detail in antique and ebook has « ‹ record/total › » with first/last actions', async () => {
    for (const theme of ['antique', 'ebook']) {
        const f = await fixture({ theme });
        try {
            await f.load();
            f.click('[data-action="catalog-list-next"]');
            f.click('[data-action="entry"][data-uid="7"]');
            const pager = f.q('.slb-library-catalog-pager');
            assert.ok(pager);
            assert.equal(pager.querySelector('small').textContent, '8 / 24');
            const arrows = ['first','prev','next','last'].map(k => f.q('[data-action="catalog-'+k+'"]'));
            assert.deepEqual(arrows.map(e => e.textContent), ['«','‹','›','»']);
            assert.deepEqual(arrows.map(e => e.disabled), [false,false,false,false]);
            assert.equal(arrows[0].getAttribute('aria-label'), '첫 기록');
            assert.equal(arrows[3].getAttribute('aria-label'), '마지막 기록');
            f.click('[data-action="catalog-last"]');
            assert.equal(f.q('.slb-library-detail-general').dataset.uid, '23');
            assert.equal(f.q('[data-action="catalog-last"]').disabled, true);
            f.click('[data-action="catalog-prev"]');
            assert.equal(f.q('.slb-library-detail-general').dataset.uid, '22');
            f.click('[data-action="catalog-first"]');
            assert.equal(f.q('.slb-library-detail-general').dataset.uid, '0');
            assert.equal(f.q('[data-action="catalog-first"]').disabled, true);
            f.click('[data-action="catalog-back"]');
            assert.equal(f.q('[data-action="page-jump"]').textContent, '1 / 5');
            assert.equal(f.stats.writes, 0);
            assert.equal(f.stats.reads, 1);
        } finally { f.dom.window.close(); }
    }
});

test('journal single/two-page reading keeps original spread size and four-arrow navigation', async () => {
    for (const width of [390, 910]) {
        const f = await fixture({ kind: 'memory', width, theme: 'antique' });
        try {
            await f.load();
            const step = width < 710 ? 1 : 2;
            assert.equal(f.all('.slb-library-diary-page').length, step);
            assert.deepEqual(['first','prev','next','last'].map(k =>
                f.q('[data-action="diary-'+k+'"]').textContent), ['«','‹','›','»']);
            assert.equal(f.q('[data-action="diary-first"]').disabled, true);
            f.click('[data-action="diary-last"]');
            assert.equal(f.q('.slb-library-diary-page').dataset.uid, String(24-step));
            assert.equal(f.all('.slb-library-diary-page').length, step);
            assert.equal(f.q('[data-action="diary-last"]').disabled, true);
            f.click('[data-action="diary-prev"]');
            assert.equal(f.q('.slb-library-diary-page').dataset.uid, String(24-2*step));
            f.click('[data-action="diary-first"]');
            assert.equal(f.q('.slb-library-diary-page').dataset.uid, '0');
            assert.equal(f.q('[data-action="diary-first"]').disabled, true);
            assert.equal(f.q('.slb-library-diary-toc .slb-library-page-size-select').value, '5');
            assert.equal(f.q('.slb-library-diary-pager .slb-library-page-size-select'), null);
            assert.equal(f.stats.writes, 0);
        } finally { f.dom.window.close(); }
    }
});

test('reverse journal begins with latest source record; last jumps to oldest without editing data', async () => {
    const f = await fixture({ kind: 'memory', reverse: true, n: 24 });
    try {
        await f.load();
        assert.equal(f.q('.slb-library-diary-page').dataset.uid, '23');
        f.click('[data-action="diary-last"]');
        assert.equal(f.q('.slb-library-diary-page').dataset.uid, '0');
        f.click('[data-action="diary-first"]');
        assert.equal(f.q('.slb-library-diary-page').dataset.uid, '23');
        assert.equal(f.stats.writes, 0);
    } finally { f.dom.window.close(); }
});

test('single-record book disables all 4 card-detail and journal-reading arrows', async () => {
    for (const kind of ['general','memory']) {
        const f = await fixture({ kind, n: 1 });
        try {
            await f.load();
            if (kind === 'general') f.click('[data-action="entry"][data-uid="0"]');
            const prefix = kind === 'general' ? 'catalog' : 'diary';
            for (const step of ['first','prev','next','last']) {
                assert.equal(f.q('[data-action="' + prefix + '-' + step + '"]').disabled, true);
            }
            assert.equal(f.stats.writes, 0);
        } finally { f.dom.window.close(); }
    }
});

test('unsaved edit blocks detail first/last navigation when user cancels discard confirmation', async () => {
    const f = await fixture({ kind: 'general', n: 24 });
    try {
        await f.load();
        f.click('[data-action="entry"][data-uid="2"]');
        f.click('[data-action="edit"][data-uid="2"]');
        const editor = f.q('.slb-library-editor-text');
        assert.ok(editor);
        editor.value = 'Modified but unsaved';
        f.win.confirm = () => { f.state.confirmations++; return false; };
        f.click('[data-action="catalog-last"]');
        assert.equal(f.q('.slb-library-detail-general').dataset.uid, '2');
        assert.equal(f.q('.slb-library-editor-text'), editor);
        assert.equal(editor.value, 'Modified but unsaved');
        assert.equal(f.state.confirmations, 1);
        assert.equal(f.stats.writes, 0);
    } finally { f.dom.window.close(); }
});

test('detail pager CSS only changes reader controls; shared .61 title-bar border remains intact', () => {
    const segment = css.slice(css.lastIndexOf('/* ambasa.62'));
    assert.match(segment, /\.slb-library-catalog-pager > button,/);
    assert.match(segment, /\.slb-library-diary-pager > button/);
    assert.match(segment, /width: 26px !important;/);
    assert.match(segment, /font-size: 11px !important;/);
    assert.doesNotMatch(segment, /#WorldInfo|\.world_entry\s*\{/);
    assert.match(css, /\.slb-library-header-actions > button\.slb-library-close \{[\s\S]*border-color: color-mix\(in srgb, currentColor 24%, transparent\) !important;/);
    assert.doesNotMatch(source, /setInterval\(/);
});
