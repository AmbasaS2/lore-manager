const { test } = require('node:test');
const assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { pathToFileURL } = require('node:url');

const root = join(__dirname, '..');
const code = readFileSync(join(root, 'library-shelf.js'), 'utf8');
const css = readFileSync(join(root, 'library-shelf.css'), 'utf8');
const index = readFileSync(join(root, 'index.js'), 'utf8');
const url = pathToFileURL(join(root, 'library-shelf.js')).href;
const tick = () => new Promise(resolve => setImmediate(resolve));

async function fixture({ theme = 'mac', type = 'people', rows = 3, nBooks = 35, nEntries = 38 } = {}) {
    const { createStandaloneLibrary } = await import(url);
    const dom = new JSDOM('<!doctype html><html><body></body></html>', { pretendToBeVisual: true });
    const win = dom.window;
    win.confirm = () => true;
    Object.defineProperty(win, 'innerWidth', { value: 1120, configurable: true });
    Object.defineProperty(win, 'innerHeight', { value: 940, configurable: true });
    const saved = { rows };
    const stats = { reads: 0, writes: 0, rowSaves: 0, fail: false };
    const books = Array.from({ length: nBooks }, (_, i) => 'Book ' + i);
    const entries = Object.fromEntries(Array.from({ length: nEntries }, (_, i) => [i, {
        uid: i, displayIndex: i, comment: '인물 ' + i, content: 'Story ' + i, key: ['keyword'],
    }]));
    const original = JSON.stringify(entries);
    const lib = createStandaloneLibrary({
        document: win.document,
        listBooks: () => books, linkedBooks: () => new Set(books),
        loadBook: async () => { stats.reads++; return { entries }; },
        loadTranslations: async () => {}, translationFor: () => ({ text: '' }),
        saveContent: async () => { stats.writes++; },
        saveTranslation: async () => { stats.writes++; },
        translateOne: async () => { stats.writes++; },
        openAdvanced: () => {}, getType: () => type, setType: () => {},
        getTypeMap: () => Object.fromEntries(books.map(x => [x, type])),
        getTags: () => [], getTagMap: () => ({}), setTags: async () => {},
        getTheme: () => theme, setTheme: async () => {},
        getListPageSize: () => 5, setListPageSize: async () => {},
        getListOrder: () => 'normal', setListOrder: async () => {},
        getShelfRows: () => saved.rows,
        setShelfRows: async value => {
            stats.rowSaves++;
            if (stats.fail) throw Error('save failed');
            saved.rows = value;
        },
        getLinkedOnly: () => true, setLinkedOnly: async () => {},
        notify: () => {},
    });
    const q = sel => win.document.querySelector(sel);
    const all = sel => Array.from(win.document.querySelectorAll(sel));
    const click = sel => { const el = q(sel); assert.ok(el, 'missing ' + sel); el.click(); };
    const openBook = async () => {
        lib.open(); click('[data-action="select-book"]'); await tick();
    };
    return { dom, win, lib, saved, stats, q, all, click, openBook, books, entries, original };
}

function visibleShelf(f) {
    return f.all('[data-action="select-book"]').length;
}
function columns(f) {
    const root = f.q('.slb-library-book-spines,.slb-library-folder-grid,.slb-library-app-grid,.slb-library-cover-grid');
    assert.ok(root, 'one active book-grid exists');
    return Number(root.style.getPropertyValue('--slb-shelf-columns'));
}

test('initial 1, 2, 3 shelf rows show only row×columns on all four skins', async () => {
    for (const theme of ['mac', 'blackberry', 'ebook', 'antique']) {
        for (const rows of [1, 2, 3]) {
            const f = await fixture({ theme, rows });
            try {
                f.lib.open();
                assert.equal(f.q('#slb-library-shelf-rows').value, String(rows));
                assert.deepEqual([...f.q('#slb-library-shelf-rows').options].map(x => x.textContent),
                    ['1줄 보기', '2줄 보기', '3줄 보기']);
                assert.equal(visibleShelf(f), Math.min(f.books.length, rows * columns(f)), theme + '/' + rows);
                assert.equal(f.stats.writes, 0);
            } finally { f.dom.window.close(); }
        }
    }
});

test('changing shelf row preference persists through close/reopen, tag filter, search and theme list rebuild', async () => {
    const f = await fixture({ rows: 3 });
    try {
        f.lib.open();
        const picker = f.q('#slb-library-shelf-rows');
        picker.value = '1';
        picker.dispatchEvent(new f.win.Event('change', { bubbles: true }));
        await tick();
        assert.equal(f.saved.rows, 1);
        assert.equal(f.stats.rowSaves, 1);
        assert.equal(visibleShelf(f), columns(f));
        f.click('[data-action="shelf-more"]');
        assert.ok(visibleShelf(f) > columns(f), 'manual show-more still works');
        f.click('[data-action="shelf-tag"]');
        assert.equal(visibleShelf(f), columns(f), 'tag reset returns to the chosen number of rows');
        const search = f.q('#slb-library-shelf-search');
        search.value = 'Book';
        search.dispatchEvent(new f.win.Event('input', { bubbles: true }));
        assert.equal(visibleShelf(f), columns(f));
        f.lib.close();
        f.lib.open();
        assert.equal(f.q('#slb-library-shelf-rows').value, '1');
        assert.equal(visibleShelf(f), columns(f));
        assert.equal(f.stats.rowSaves, 1, 'opening/rebuilding never writes the setting again');
    } finally { f.dom.window.close(); }
});

test('invalid settings changes are rejected and failed saves restore the old choice without writing lore', async () => {
    const f = await fixture({ rows: 2 });
    try {
        f.lib.open();
        const picker = f.q('#slb-library-shelf-rows');
        picker.value = '3';
        f.stats.fail = true;
        picker.dispatchEvent(new f.win.Event('change', { bubbles: true }));
        await tick();
        assert.equal(f.saved.rows, 2);
        assert.equal(picker.value, '2');
        assert.equal(visibleShelf(f), 2 * columns(f));
        assert.equal(f.stats.writes, 0);
    } finally { f.dom.window.close(); }
});

test('in all 4 skins, selecting an individual reveals an actual directory TOC + live profile', async () => {
    for (const theme of ['mac', 'blackberry', 'ebook', 'antique']) {
        const f = await fixture({ theme, type: 'people' });
        try {
            await f.openBook();
            assert.equal(f.q('[data-action="people-toc-toggle"]'), null,
                'do not hide the only directory while no profile is selected');
            f.click('[data-action="entry"]');
            const toggle = f.q('[data-action="people-toc-toggle"]');
            const toc = f.q('#slb-library-people-contents');
            const detail = f.q('.slb-library-person-profile .slb-library-detail-people');
            assert.ok(toggle && toc && detail, theme);
            assert.equal(toggle.getAttribute('aria-controls'), toc.id);
            assert.equal(toggle.getAttribute('aria-expanded'), 'true');
            assert.ok(toc.querySelector('.slb-library-people-pages'));
            const initialReads = f.stats.reads;
            toggle.click();
            assert.equal(toc.hidden, true);
            assert.equal(toggle.querySelector('.slb-library-toc-chevron').textContent, '▾');
            assert.equal(toggle.getAttribute('aria-expanded'), 'false');
            assert.equal(f.q('.slb-library-person-profile .slb-library-detail-people'), detail,
                'profile and open editors must survive TOC collapse');
            toggle.click();
            assert.equal(toc.hidden, false);
            assert.equal(toggle.querySelector('.slb-library-toc-chevron').textContent, '▴');
            assert.equal(f.q('.slb-library-person-profile .slb-library-detail-people'), detail);
            assert.equal(f.stats.reads, initialReads);
            assert.equal(f.stats.writes, 0);
            assert.equal(JSON.stringify(f.entries), f.original);
        } finally { f.dom.window.close(); }
    }
});

test('profile table of contents remains collapsed across paging, but is visible on fresh book visit', async () => {
    const f = await fixture({ theme: 'ebook', type: 'people', nEntries: 240 });
    try {
        await f.openBook();
        f.click('[data-action="entry"]');
        f.click('[data-action="people-toc-toggle"]');
        f.click('[data-action="people-next"]');
        assert.equal(f.q('#slb-library-people-contents').hidden, true);
        assert.ok(f.q('.slb-library-detail-people'));
        f.click('[data-action="people-back"]');
        assert.equal(f.q('#slb-library-people-contents').hidden, false,
            'directory-only view must never disappear');
        f.click('[data-action="books"]');
        f.click('[data-action="select-book"]');
        await tick();
        f.click('[data-action="entry"]');
        assert.equal(f.q('#slb-library-people-toc').hidden, false);
        assert.equal(f.stats.writes, 0);
    } finally { f.dom.window.close(); }
});

test('deep link selects matching UID with its TOC page, even among 240 names', async () => {
    const f = await fixture({ type: 'people', nEntries: 240 });
    try {
        const opened = await f.lib.openEntry('Book 1', 119);
        assert.equal(opened, true);
        const profile = f.q('.slb-library-detail-people');
        assert.ok(profile && profile.dataset.uid === '119');
        const toc = f.q('#slb-library-people-contents');
        assert.ok(toc.querySelector('.slb-library-person-row[data-uid="119"]'));
        assert.equal(f.q('.slb-library-people-pages [data-action="page-jump"]').dataset.page, '24');
        assert.equal(f.stats.writes, 0);
    } finally { f.dom.window.close(); }
});

test('CSS layout stays narrow-friendly, all TOC controls use same real data and no new global observers', () => {
    const part = css.slice(css.lastIndexOf('/* ambasa.69'));
    assert.ok(part.includes('grid-template-columns: minmax(0, 1fr)'));
    assert.match(part, /@container \(min-width: 760px\)/);
    assert.match(part, /slb-library-people-detail-layout .*\.slb-library-person-directory\[hidden\]/);
    assert.match(part, /slb-library-shelf-rows-setting/);
    assert.match(part, /select\.slb-library-shelf-rows-select/);
    assert.doesNotMatch(part, /MutationObserver|ResizeObserver|setInterval|setTimeout|font-family/);
    assert.match(code, /if \(selected\) \{/);
    assert.match(code, /peopleTocCollapsed/);
    assert.match(index, /libraryShelfRows: 3/);
    assert.match(index, /getShelfRows: \(\) => getSettings\(\)\.libraryShelfRows/);
    assert.equal(JSON.parse(readFileSync(join(root, 'manifest.json'), 'utf8')).version,
        '1.4.85-ambasa.78');
});
