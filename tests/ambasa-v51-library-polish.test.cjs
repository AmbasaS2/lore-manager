const { test } = require('node:test');
const assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { pathToFileURL } = require('node:url');

const root = join(__dirname, '..');
const source = readFileSync(join(root, 'library-shelf.js'), 'utf8');
const css = readFileSync(join(root, 'library-shelf.css'), 'utf8');
const uri = pathToFileURL(join(root, 'library-shelf.js')).href;
const tick = () => new Promise(resolve => setImmediate(resolve));

async function fixture(theme = 'ebook') {
    const { createStandaloneLibrary } = await import(uri);
    const dom = new JSDOM('<!doctype html><html><body><div id="outside">ST content</div></body></html>', {
        pretendToBeVisual: true,
    });
    const win = dom.window;
    win.confirm = () => true;
    const stats = { reads: 0, writes: 0, translations: 0, covers: 0 };
    const books = ['No category', 'Another world'];
    const lib = createStandaloneLibrary({
        document: win.document,
        listBooks: () => books,
        linkedBooks: () => new Set(books),
        loadBook: async () => { stats.reads++; return { entries: { 1: { uid: 1, content: 'Original', comment: 'Entry', displayIndex: 0 } } }; },
        loadTranslations: async () => {},
        translationFor: () => ({ text: '' }),
        saveContent: async () => { stats.writes++; },
        saveTranslation: async () => { stats.writes++; },
        translateOne: async () => { stats.translations++; },
        openAdvanced: () => {},
        getType: () => undefined,
        getTypeMap: () => ({}),
        setType: () => { stats.writes++; },
        getTags: () => [],
        getTagMap: () => ({}),
        setTags: async () => { stats.writes++; },
        getTheme: () => theme,
        getLinkedOnly: () => true,
        getBookCover: () => '',
        getBookCoverMap: () => ({}),
        uploadBookCover: async () => { stats.covers++; },
        removeBookCover: async () => { stats.covers++; },
        notify: () => {},
    });
    lib.open();
    const q = selector => win.document.querySelector(selector);
    const qa = selector => [...win.document.querySelectorAll(selector)];
    const click = selector => { const item = q(selector); assert.ok(item, selector); item.click(); };
    return { dom, win, lib, q, qa, click, stats };
}

test('unclassified book displays as cardfile in all four shelves without modifying metadata', async () => {
    const variants = {
        antique: '.slb-library-book-spine.slb-library-spine-type-general',
        mac: '.slb-library-folder-icon.slb-library-folder-type-general',
        blackberry: '.slb-library-app-icon.slb-library-app-type-general',
        ebook: '.slb-library-cover-art.slb-library-cover-type-general',
    };
    for (const [theme, marker] of Object.entries(variants)) {
        const f = await fixture(theme);
        try {
            assert.equal(f.qa(marker).length, 2, theme);
            assert.equal(f.stats.reads, 0);
            assert.equal(f.stats.writes, 0);
        } finally { f.dom.window.close(); }
    }
});

test('search field closes when clicking elsewhere, but its trigger, input, and the library remain usable', async () => {
    for (const theme of ['antique', 'mac', 'blackberry', 'ebook']) {
        const f = await fixture(theme);
        try {
            f.click('[data-action="shelf-search-toggle"]');
            assert.equal(f.q('.slb-library-shelf-toolbar.is-search-open') !== null, true);
            f.click('#slb-library-shelf-search');
            assert.equal(f.q('.slb-library-shelf-toolbar.is-search-open') !== null, true);
            f.click('#outside');
            assert.equal(f.q('.slb-library-shelf-toolbar.is-search-open'), null);
            assert.ok(f.q('#slb-library-overlay'));
            assert.equal(f.q('[data-action="shelf-search-toggle"]').getAttribute('aria-expanded'), 'false');

            f.click('[data-action="select-book"]');
            await tick();
            f.click('[data-action="reader-search-toggle"]');
            assert.ok(f.q('.slb-library-navigation.is-search-open'));
            f.click('#slb-library-search');
            assert.ok(f.q('.slb-library-navigation.is-search-open'));
            f.click('#outside');
            assert.equal(f.q('.slb-library-navigation.is-search-open'), null);
            assert.ok(f.q('.slb-library-shell'));
            assert.equal(f.stats.reads, 1);
            assert.deepEqual([f.stats.writes, f.stats.translations, f.stats.covers], [0, 0, 0]);
        } finally { f.dom.window.close(); }
    }
});

test('cover settings are mounted and dismissed within the positioned floating shell', async () => {
    const f = await fixture('ebook');
    try {
        const shell = f.q('.slb-library-shell');
        const coords = [shell.style.left, shell.style.top, shell.style.width, shell.style.height];
        f.click('[data-action="cover-config"]');
        const backdrop = f.q('.slb-library-cover-backdrop');
        assert.equal(backdrop.parentElement, shell, 'modal anchored to the movable window');
        assert.ok(backdrop.querySelector('[aria-modal="true"]'));
        assert.deepEqual([shell.style.left, shell.style.top, shell.style.width, shell.style.height], coords);
        f.click('[data-action="cover-cancel"]');
        assert.equal(f.q('.slb-library-cover-backdrop'), null);
        assert.ok(f.q('.slb-library-shell'));
        assert.equal(f.stats.covers, 0);
    } finally { f.dom.window.close(); }
});

test('Mac Finder uses accessible icon-only categories without changing filters', async () => {
    const f = await fixture('mac');
    try {
        const icons = { all: 'layer-group', general: 'address-card', memory: 'book-open', world: 'globe', people: 'users' };
        for (const [value, icon] of Object.entries(icons)) {
            const category = f.q('[data-action="shelf-type"][data-filter="' + value + '"]');
            assert.ok(category, value);
            assert.ok(category.querySelector('.fa-' + icon));
            assert.ok(category.getAttribute('aria-label'));
            assert.ok(category.title);
            assert.equal(category.textContent.trim(), '');
        }
        f.click('[data-action="shelf-type"][data-filter="general"]');
        assert.equal(f.qa('.slb-library-folder-card').length, 2);
        f.click('[data-action="shelf-type"][data-filter="memory"]');
        assert.equal(f.qa('.slb-library-folder-card').length, 0);
        assert.equal(f.stats.writes, 0);
    } finally { f.dom.window.close(); }
});

test('appearance fixes are scoped, do not add timers or observers, and leave app toolbar untinted', () => {
    const patch = css.slice(css.lastIndexOf('/* ambasa.51:'));
    assert.match(patch, /#slb-library-overlay\s*\{[^}]*background:\s*transparent !important;[^}]*pointer-events:\s*none/s);
    assert.match(patch, /\.slb-library-shell\s*\{[^}]*pointer-events:\s*auto/s);
    assert.match(patch, /\.slb-library-finder-workspace\s*\{[^}]*grid-template-columns:\s*56px minmax\(0,1fr\)/s);
    assert.match(patch, /\.slb-library-mode-ebook \.slb-library-cover-title\s*\{[^}]*translateY\(-5px\)/s);
    assert.match(patch, /\.slb-library-book-spine\.slb-library-spine-type-general\s*\{[^}]*border-left:\s*3px[^}]*border-right:\s*3px/s);
    assert.doesNotMatch(source, /setInterval\(|new MutationObserver\(/);
});
