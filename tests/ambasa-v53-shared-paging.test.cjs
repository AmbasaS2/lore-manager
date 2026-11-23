const { test } = require('node:test');
const assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { pathToFileURL } = require('node:url');

const root = join(__dirname, '..');
const css = readFileSync(join(root, 'library-shelf.css'), 'utf8');
const indexSource = readFileSync(join(root, 'index.js'), 'utf8');
const libSource = readFileSync(join(root, 'library-shelf.js'), 'utf8');
const moduleUrl = pathToFileURL(join(root, 'library-shelf.js')).href;
const tick = () => new Promise(resolve => setImmediate(resolve));

async function fixture({
    theme = 'antique', kind = 'world', n = 24,
    width = 460, pageSize = 5, tags = ['world'],
} = {}) {
    const { createStandaloneLibrary } = await import(moduleUrl);
    const dom = new JSDOM('<!doctype html><html><body><div id="original-chat">SillyTavern</div></body></html>', {
        pretendToBeVisual: true,
    });
    const win = dom.window;
    win.confirm = () => true;
    Object.defineProperty(win, 'innerWidth', { configurable: true, value: width });
    Object.defineProperty(win, 'innerHeight', { configurable: true, value: 880 });
    const settings = { pageSize, tags: { 'The Book': [...tags] }, fail: false };
    const stats = { loads: 0, translations: 0, contentWrites: 0, translationWrites: 0, settingWrites: 0, tagWrites: 0, alerts: [] };
    const entries = Object.fromEntries(Array.from({ length: n }, (_, i) => [i, {
        uid: i, displayIndex: i, comment: 'Entry ' + String(i),
        content: 'Lore body ' + i, key: ['tag' + i],
    }]));
    const lib = createStandaloneLibrary({
        document: win.document, listBooks: () => ['The Book'], linkedBooks: () => new Set(['The Book']),
        loadBook: async () => { stats.loads++; return { entries }; },
        loadTranslations: async () => {}, translationFor: () => ({ text: '' }),
        saveContent: async () => { stats.contentWrites++; },
        saveTranslation: async () => { stats.translationWrites++; },
        translateOne: async () => { stats.translations++; },
        openAdvanced: () => {},
        getType: () => kind, getTypeMap: () => ({ 'The Book': kind }),
        setType: () => {},
        getTags: book => settings.tags[book] || [],
        getTagMap: () => settings.tags,
        setTags: async (book, list) => { stats.tagWrites++; settings.tags[book] = list; },
        getTheme: () => theme, setTheme: async () => {},
        getLinkedOnly: () => true, setLinkedOnly: async () => {},
        getListPageSize: () => settings.pageSize,
        setListPageSize: async count => {
            if (settings.fail) throw new Error('settings write rejected');
            stats.settingWrites++; settings.pageSize = count;
        },
        notify: (...args) => stats.alerts.push(args),
    });
    lib.open();
    const q = selector => win.document.querySelector(selector);
    const all = selector => [...win.document.querySelectorAll(selector)];
    const click = selector => { const node = q(selector); assert.ok(node, 'missing ' + selector); node.click(); };
    const load = async () => { click('[data-action="select-book"]'); await tick(); };
    const setSize = async count => {
        const select = q('#slb-library-page-size');
        select.value = String(count);
        select.dispatchEvent(new win.Event('change', { bubbles: true }));
        await tick();
    };
    return { dom, win, lib, q, all, click, load, setSize, settings, stats };
}

test('settings exposes a single 5/10/20 listing control shared by four themes and all entry types', async () => {
    for (const theme of ['antique', 'mac', 'blackberry', 'ebook']) {
        const f = await fixture({ theme });
        try {
            const select = f.q('#slb-library-page-size');
            assert.deepEqual([...select.options].map(option => option.value), ['5', '10', '20']);
            assert.equal(select.value, '5');
            assert.equal(f.all('#slb-library-page-size').length, 1);
            assert.equal(f.stats.loads, 0);
        } finally { f.dom.window.close(); }
    }
    assert.match(indexSource, /libraryListPageSize:\s*5/);
    assert.match(indexSource, /settings\.libraryListPageSize\s*=\s*\[5, 10, 20\]/);
    assert.match(indexSource, /setListPageSize:\s*async value =>/);
});

test('cardfile archive/ebook shows a bounded five-card list with next and back restoring the same page', async () => {
    for (const theme of ['antique', 'ebook']) {
        const f = await fixture({ theme, kind: 'general', n: 240 });
        try {
            await f.load();
            assert.equal(f.all('.slb-library-catalog-card').length, 5);
            assert.equal(f.q('.slb-library-list-pages small').textContent, '1 / 48');
            f.click('[data-action="catalog-list-next"]');
            assert.equal(f.q('.slb-library-list-pages small').textContent, '2 / 48');
            assert.ok(f.q('[data-action="entry"][data-uid="7"]'));
            f.click('[data-action="entry"][data-uid="7"]');
            assert.equal(f.q('.slb-library-detail[data-uid="7"]').dataset.uid, '7');
            f.click('[data-action="catalog-back"]');
            assert.equal(f.q('.slb-library-list-pages small').textContent, '2 / 48');
            assert.ok(f.q('[data-action="entry"][data-uid="7"]'));
            f.click('[data-action="catalog-menu"]');
            assert.equal(f.q('#slb-library-catalog-contents').hidden, true);
            f.click('[data-action="catalog-menu"]');
            assert.equal(f.all('.slb-library-catalog-card').length, 5);
            assert.deepEqual([f.stats.loads, f.stats.contentWrites, f.stats.translations], [1, 0, 0]);
        } finally { f.dom.window.close(); }
    }
});

test('Mac/BlackBerry card lists paginate with preview always bound to visible selection', async () => {
    for (const theme of ['mac', 'blackberry']) {
        const f = await fixture({ theme, kind: 'general', n: 72 });
        try {
            await f.load();
            assert.equal(f.all('.slb-library-clean-list-row').length, 5);
            assert.equal(f.q('.slb-library-clean-preview .slb-library-detail').dataset.uid, '0');
            f.click('[data-action="catalog-list-next"]');
            assert.equal(f.all('.slb-library-clean-list-row').length, 5);
            assert.equal(f.q('.slb-library-clean-preview .slb-library-detail').dataset.uid, '5');
            f.click('[data-action="entry"][data-uid="8"]');
            assert.equal(f.q('.slb-library-clean-preview .slb-library-detail').dataset.uid, '8');
            assert.equal(f.q('.slb-library-list-pages small').textContent, '2 / 15');
            assert.equal(f.stats.loads, 1);
            assert.equal(f.stats.contentWrites, 0);
        } finally { f.dom.window.close(); }
    }
});

test('memory TOC is truly bounded (no 240-option select) while journal spread stays one/two pages', async () => {
    for (const width of [390, 910]) {
        const f = await fixture({ theme: 'antique', kind: 'memory', n: 240, width });
        try {
            await f.load();
            const count = width < 710 ? 1 : 2;
            assert.equal(f.q('#slb-library-diary-select'), null);
            assert.equal(f.all('.slb-library-diary-toc .slb-library-index-item').length, 5);
            assert.equal(f.all('.slb-library-diary-page').length, count);
            assert.equal(f.q('.slb-library-diary-toc .slb-library-list-pages small').textContent, '1 / 48');
            for (let i = 0; i < 12; i++) f.click('[data-action="memory-list-next"]');
            assert.equal(f.q('.slb-library-diary-toc .slb-library-list-pages small').textContent, '13 / 48');
            assert.equal(f.all('.slb-library-diary-toc .slb-library-index-item').length, 5);
            f.click('[data-action="diary-entry"][data-index="62"]');
            assert.equal(f.q('.slb-library-diary-page').dataset.uid, '62');
            assert.equal(f.all('.slb-library-diary-page').length, count);
            assert.equal(f.q('#slb-library-memory-contents').hidden, true);
            f.click('[data-action="memory-menu"]');
            assert.equal(f.q('.slb-library-list-pages small').textContent, '13 / 48');
            assert.equal(f.stats.loads, 1);
            assert.equal(f.stats.contentWrites, 0);
        } finally { f.dom.window.close(); }
    }
});

test('encyclopedia contents use the shared page size without overwriting selected record or source', async () => {
    for (const theme of ['antique', 'mac', 'blackberry', 'ebook']) {
        const f = await fixture({ theme, kind: 'world', n: 240 });
        try {
            await f.load();
            assert.equal(f.all('.slb-library-index-item').length, 5);
            assert.equal(f.q('.slb-library-world-count').textContent, '240개 항목');
            assert.equal(f.q('.slb-library-world-pages small').textContent, '1 / 48');
            await f.setSize(10);
            assert.equal(f.all('.slb-library-index-item').length, 10);
            assert.equal(f.q('.slb-library-world-pages small').textContent, '1 / 24');
            f.click('[data-action="world-next"]');
            assert.equal(f.q('.slb-library-world-pages small').textContent, '2 / 24');
            f.click('[data-action="entry"][data-uid="12"]');
            assert.equal(f.q('.slb-library-detail-world').dataset.uid, '12');
            f.click('[data-action="world-menu"]');
            assert.equal(f.q('.slb-library-world-pages small').textContent, '2 / 24');
            await f.setSize(20);
            assert.equal(f.all('.slb-library-index-item').length, 20);
            assert.equal(f.q('.slb-library-world-pages small').textContent, '1 / 12');
            assert.equal(f.stats.settingWrites, 2);
            assert.deepEqual([f.stats.loads, f.stats.contentWrites, f.stats.translationWrites], [1, 0, 0]);
        } finally { f.dom.window.close(); }
    }
});

test('people directory remains bounded and returns to the correct page after profile back', async () => {
    for (const theme of ['antique', 'mac', 'blackberry', 'ebook']) {
        const f = await fixture({ theme, kind: 'people', n: 240 });
        try {
            await f.load();
            assert.equal(f.all('.slb-library-person-row').length, 5);
            f.click('[data-action="people-next"]');
            f.click('[data-action="people-next"]');
            assert.equal(f.q('.slb-library-people-pages small').textContent, '3 / 48');
            f.click('[data-action="entry"][data-uid="12"]');
            assert.equal(f.q('.slb-library-detail-people').dataset.uid, '12');
            f.click('[data-action="people-back"]');
            assert.equal(f.q('.slb-library-people-pages small').textContent, '3 / 48');
            assert.ok(f.q('[data-action="entry"][data-uid="12"]'));
            await f.setSize(20);
            assert.equal(f.all('.slb-library-person-row').length, 20);
            assert.equal(f.q('.slb-library-people-pages small').textContent, '1 / 12');
            assert.equal(f.stats.contentWrites, 0);
        } finally { f.dom.window.close(); }
    }
});

test('tag badge stays next to book title in all sixteen theme/type combinations and is not recreated on paging', async () => {
    for (const theme of ['antique', 'mac', 'blackberry', 'ebook']) {
        for (const kind of ['general', 'memory', 'world', 'people']) {
            const f = await fixture({ theme, kind, n: 36 });
            try {
                await f.load();
                const nav = f.q('.slb-library-nav-top');
                const title = f.q('.slb-library-current');
                const tags = f.q('.slb-library-nav-tags > .slb-library-book-meta');
                assert.ok(nav.contains(title) && nav.contains(tags));
                assert.equal(title.nextElementSibling, f.q('.slb-library-nav-tags'));
                assert.equal(f.all('details.slb-library-book-meta').length, 1);
                assert.equal(f.q('.slb-library-reader-inner .slb-library-book-meta'), null);
                const input = f.q('#slb-library-book-tag-input');
                input.value = 'world, draft';
                input.dispatchEvent(new f.win.Event('input', { bubbles: true }));
                if (kind === 'general') f.click('[data-action="catalog-list-next"]');
                if (kind === 'world') f.click('[data-action="world-next"]');
                if (kind === 'people') f.click('[data-action="people-next"]');
                if (kind === 'memory') f.click('[data-action="memory-list-next"]');
                assert.equal(f.q('#slb-library-book-tag-input'), input);
                assert.equal(input.value, 'world, draft');
                assert.equal(f.stats.tagWrites, 0);
            } finally { f.dom.window.close(); }
        }
    }
});

test('Mac book reader omits duplicate left COLLECTIONS rail but Finder shelf keeps categories', async () => {
    const f = await fixture({ theme: 'mac', kind: 'world' });
    try {
        assert.ok(f.q('.slb-library-finder-sidebar'), 'Mac bookcase Finder sidebar retained');
        await f.load();
        assert.ok(f.q('.slb-library-reader-mac .slb-library-clean-workspace'));
        assert.equal(f.q('.slb-library-reader-mac .slb-library-clean-sidebar'), null);
        assert.equal(f.q('.slb-library-reader-mac .slb-library-clean-workspace').children.length, 1);
        assert.match(css, /\.slb-library-reader-mac \.slb-library-clean-workspace\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\)/s);
        assert.equal(f.stats.loads, 1);
    } finally { f.dom.window.close(); }
});

test('success/loading toasts and bottom-left status are absent; real save failures still notify', async () => {
    const f = await fixture({ theme: 'ebook', kind: 'world', n: 24 });
    try {
        assert.equal(f.q('#slb-library-status'), null);
        assert.ok(f.q('.slb-library-footer'));
        await f.load();
        assert.deepEqual(f.stats.alerts, []);
        await f.setSize(10);
        assert.deepEqual(f.stats.alerts, [], 'successful settings change is silent');
        f.settings.fail = true;
        await f.setSize(20);
        assert.equal(f.settings.pageSize, 10);
        assert.equal(f.q('#slb-library-page-size').value, '10');
        assert.equal(f.stats.alerts.length, 1);
        assert.equal(f.stats.alerts[0][1], 'error');
    } finally { f.dom.window.close(); }
    assert.match(css, /\.slb-library-footer\s*\{\s*display:\s*none !important;/);
    assert.match(libSource, /if \(type === 'warning' \|\| type === 'error'\) notify\?\./);
});

test('shared pagination uses original ordering and no interval or observer was added to the library module', async () => {
    assert.match(libSource, /getListPageSize = \(\) => 5/);
    assert.match(libSource, /const pageCount = Math\.max\(1, Math\.ceil\(total \/ size\)\)/);
    assert.doesNotMatch(libSource, /setInterval\(/);
    assert.doesNotMatch(libSource, /new MutationObserver\(/);
    assert.doesNotMatch(libSource, /new ResizeObserver\(/);
});
