const { test } = require('node:test');
const assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { pathToFileURL } = require('node:url');

const root = join(__dirname, '..');
const css = readFileSync(join(root, 'library-shelf.css'), 'utf8');
const index = readFileSync(join(root, 'index.js'), 'utf8');
const js = readFileSync(join(root, 'library-shelf.js'), 'utf8');
const url = pathToFileURL(join(root, 'library-shelf.js')).href;
const tick = () => new Promise(resolve => setImmediate(resolve));

async function fixture({ theme = 'ebook', kind = 'world', n = 12, order = 'normal',
    size = 5, width = 400 } = {}) {
    const { createStandaloneLibrary } = await import(url);
    const dom = new JSDOM('<!doctype html><html><body><div id="chat">SillyTavern chat</div></body></html>', {
        pretendToBeVisual: true,
    });
    const win = dom.window;
    win.confirm = () => true;
    Object.defineProperty(win, 'innerWidth', { configurable: true, value: width });
    const entries = Object.fromEntries(Array.from({ length: n }, (_, i) => [
        i, {
            uid: i, order: i, displayIndex: n - i, comment: 'Record ' + i,
            content: 'Original content ' + i, key: ['tag'],
        },
    ]));
    const original = JSON.stringify(entries);
    const stats = { loads: 0, translationReads: 0, writes: 0, orderSaves: 0, sizeSaves: 0, alerts: [] };
    const state = { theme, kind, order, size, orderFailure: false, linked: true };
    const lib = createStandaloneLibrary({
        document: win.document,
        listBooks: () => ['My Book'],
        linkedBooks: () => new Set(['My Book']),
        loadBook: async () => { stats.loads++; return { entries }; },
        loadTranslations: async () => { stats.translationReads++; },
        translationFor: () => ({ text: '' }),
        saveContent: async () => { stats.writes++; },
        saveTranslation: async () => { stats.writes++; },
        translateOne: async () => { stats.writes++; },
        openAdvanced: () => {},
        getType: () => state.kind,
        getTypeMap: () => ({ 'My Book': state.kind }),
        setType: (book, type) => { state.kind = type; },
        getTags: () => [], getTagMap: () => ({}),
        setTags: async () => { stats.writes++; },
        getTheme: () => state.theme,
        setTheme: async theme => { state.theme = theme; },
        getLinkedOnly: () => state.linked,
        setLinkedOnly: async enabled => { state.linked = enabled; },
        getListPageSize: () => state.size,
        setListPageSize: async size => { stats.sizeSaves++; state.size = size; },
        getListOrder: () => state.order,
        setListOrder: async order => {
            if (state.orderFailure) throw new Error('order save failed');
            stats.orderSaves++; state.order = order;
        },
        notify: (...args) => stats.alerts.push(args),
    });
    lib.open();
    const q = selector => win.document.querySelector(selector);
    const all = selector => [...win.document.querySelectorAll(selector)];
    const click = selector => { const el = q(selector); assert.ok(el, 'missing ' + selector); el.click(); };
    const change = (selector, value) => {
        const el = q(selector); assert.ok(el, 'missing ' + selector);
        el.value = value;
        el.dispatchEvent(new win.Event('change', { bubbles: true }));
    };
    const load = async () => { click('[data-action="select-book"]'); await tick(); };
    const setOrder = async value => { change('.slb-library-order-select', value); await tick(); };
    const setSize = async value => { change('.slb-library-page-size-select', String(value)); await tick(); };
    const openJump = () => { click('[data-action="page-jump"]'); return q('.slb-library-page-jump-input'); };
    const jump = (target, key = 'Enter') => {
        const input = openJump();
        assert.ok(input);
        if (key === 'Escape') input.value = String(target);
        else input.value = String(target);
        input.dispatchEvent(new win.KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
    };
    return { dom, win, entries, original, lib, q, all, click, change, load, setOrder, setSize,
        openJump, jump, state, stats };
}

const pagerSelector = {
    general: '.slb-library-list-pages',
    memory: '.slb-library-diary-toc .slb-library-list-pages',
    world: '.slb-library-world-pages',
    people: '.slb-library-people-pages',
};

test('normal/reverse and page-size selectors sit together on each of 16 theme/type contents pagers', async () => {
    for (const theme of ['antique', 'mac', 'blackberry', 'ebook']) {
        for (const kind of ['general', 'memory', 'world', 'people']) {
            const f = await fixture({ theme, kind });
            try {
                await f.load();
                const pager = f.q(pagerSelector[kind]);
                assert.ok(pager, theme + '/' + kind);
                const options = pager.querySelector('.slb-library-page-options');
                assert.ok(options);
                const size = options.querySelector('.slb-library-page-size-select');
                const order = options.querySelector('.slb-library-order-select');
                assert.ok(size && order);
                assert.equal(size.nextElementSibling, order);
                assert.deepEqual([...order.options].map(x => x.textContent),
                    ['Order↑', 'Order↓', '제목↑', '제목↓']);
                assert.deepEqual([...order.options].map(x => x.value),
                    ['normal', 'reverse', 'title-asc', 'title-desc']);
                assert.equal(order.value, 'normal');
                assert.ok(pager.querySelector('[data-action="page-jump"]'));
                assert.equal(f.q('.slb-library-settings-panel .slb-library-order-select'), null);
                assert.equal(f.all('.slb-library-order-select').length, 1);
                assert.equal(f.stats.loads, 1);
            } finally { f.dom.window.close(); }
        }
    }
});

test('reverse order shows most recent memory entry in BOTH the TOC and journal reading page', async () => {
    for (const theme of ['antique', 'mac', 'blackberry', 'ebook']) {
        const f = await fixture({ theme, kind: 'memory', n: 240, width: 390 });
        try {
            await f.load();
            assert.equal(f.q('.slb-library-diary-page').dataset.uid, '0');
            await f.setOrder('reverse');
            assert.equal(f.state.order, 'reverse');
            assert.equal(f.q('.slb-library-diary-page').dataset.uid, '239');
            assert.equal(f.q('.slb-library-diary-page-number').textContent, '240 / 240');
            assert.deepEqual(f.all('.slb-library-diary-toc .slb-library-index-initial')
                .map(x => x.textContent), ['240', '239', '238', '237', '236']);
            assert.equal(f.q('.slb-library-diary-toc .slb-library-list-pages .slb-library-page-jump').textContent,
                '1 / 48');
            f.click('[data-action="diary-next"]');
            assert.equal(f.q('.slb-library-diary-page').dataset.uid, '238');
            assert.equal(f.q('.slb-library-diary-page-number').textContent, '239 / 240');
            assert.equal(f.stats.orderSaves, 1);
            assert.deepEqual([f.stats.loads, f.stats.translationReads, f.stats.writes], [1, 1, 0]);
            assert.equal(JSON.stringify(f.entries), f.original, 'WorldInfo entries untouched');
        } finally { f.dom.window.close(); }
    }
});

test('reverse cardfile and people pages show last original record first; back preserves the page', async () => {
    for (const theme of ['antique', 'mac', 'blackberry', 'ebook']) {
        for (const kind of ['general', 'people']) {
            const f = await fixture({ theme, kind, n: 23 });
            try {
                await f.load();
                await f.setOrder('reverse');
                if (kind === 'general') {
                    if (['mac', 'blackberry'].includes(theme)) {
                        assert.equal(f.q('.slb-library-clean-list-row').textContent.includes('Record 22'), true);
                        assert.equal(f.q('.slb-library-clean-preview .slb-library-detail').dataset.uid, '22');
                    } else assert.match(f.q('.slb-library-catalog-card').textContent, /Record 22/);
                    f.click('[data-action="catalog-list-next"]');
                    if (['mac', 'blackberry'].includes(theme))
                        assert.equal(f.q('.slb-library-clean-preview .slb-library-detail').dataset.uid, '17');
                    else {
                        f.click('[data-action="entry"][data-uid="17"]');
                        f.click('[data-action="catalog-back"]');
                    }
                    assert.equal(f.q('.slb-library-page-jump').textContent, '2 / 5');
                } else {
                    assert.match(f.q('.slb-library-person-row').textContent, /Record 22/);
                    f.click('[data-action="people-next"]');
                    f.click('[data-action="entry"][data-uid="17"]');
                    assert.equal(f.q('.slb-library-detail-people').dataset.uid, '17');
                    f.click('[data-action="people-back"]');
                    assert.equal(f.q('.slb-library-page-jump').textContent, '2 / 5');
                }
                assert.equal(f.stats.orderSaves, 1);
                assert.equal(JSON.stringify(f.entries), f.original);
                assert.equal(f.stats.writes, 0);
            } finally { f.dom.window.close(); }
        }
    }
});

test('clicking 1 / 25 opens numeric page input, Enter jumps to page 18, next/prev still work', async () => {
    for (const kind of ['general', 'memory', 'world', 'people']) {
        const f = await fixture({ theme: 'antique', kind, n: 125, size: 5 });
        try {
            await f.load();
            const current = f.q('[data-action="page-jump"]');
            assert.equal(current.textContent, '1 / 25');
            assert.equal(current.getAttribute('aria-label'), '페이지 이동 · 1 / 25');
            const input = f.openJump();
            assert.equal(current.hidden, true);
            assert.equal(input.closest('.slb-library-page-jump-editor').hidden, false);
            assert.deepEqual([input.min, input.max, input.value, input.placeholder], ['1', '25', '', '1']);
            input.value = '18';
            input.dispatchEvent(new f.win.KeyboardEvent('keydown', {
                key: 'Enter', bubbles: true, cancelable: true,
            }));
            const next = f.q('[data-action="page-jump"]');
            assert.equal(next.textContent, '18 / 25');
            if (kind === 'general') {
                assert.ok(f.q('[data-action="entry"][data-uid="85"]'));
                f.click('[data-action="catalog-list-next"]');
            } else if (kind === 'memory') {
                assert.ok(f.q('[data-action="diary-entry"][data-uid="85"]'));
                f.click('[data-action="memory-list-next"]');
            } else if (kind === 'world') {
                assert.ok(f.q('.slb-library-index-item[data-uid="85"]'));
                f.click('[data-action="world-next"]');
            } else {
                assert.ok(f.q('.slb-library-person-row[data-uid="85"]'));
                f.click('[data-action="people-next"]');
            }
            assert.equal(f.q('[data-action="page-jump"]').textContent, '19 / 25');
            assert.equal(f.stats.loads, 1);
            assert.equal(f.stats.writes, 0);
        } finally { f.dom.window.close(); }
    }
});

test('page jump clamps too-large/zero input, handles blank, and Escape cancels without closing', async () => {
    const f = await fixture({ theme: 'ebook', kind: 'world', n: 125 });
    try {
        await f.load();
        f.jump(999);
        assert.equal(f.q('[data-action="page-jump"]').textContent, '25 / 25');
        f.jump(0);
        assert.equal(f.q('[data-action="page-jump"]').textContent, '1 / 25');
        const input = f.openJump();
        input.value = '';
        input.dispatchEvent(new f.win.Event('blur'));
        assert.equal(f.q('[data-action="page-jump"]').textContent, '1 / 25');
        f.jump(15, 'Escape');
        assert.equal(f.q('[data-action="page-jump"]').textContent, '1 / 25');
        assert.equal(f.lib.isOpen(), true);
        assert.equal(f.q('.slb-library-shell').hidden, false);
        assert.equal(f.stats.writes, 0);
    } finally { f.dom.window.close(); }
});

test('reverse order search filters first, then reverses matching results without changing original order', async () => {
    const f = await fixture({ theme: 'ebook', kind: 'world', n: 31 });
    try {
        await f.load();
        await f.setOrder('reverse');
        const search = f.q('#slb-library-search');
        search.value = 'Record 2';
        search.dispatchEvent(new f.win.Event('input', { bubbles: true }));
        f.q('#slb-library-search').dispatchEvent(new f.win.KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true}));
        const titles = f.all('.slb-library-index-item').map(x => x.textContent);
        assert.equal(titles.length, 5);
        assert.match(titles[0], /Record 29/);
        assert.match(titles[1], /Record 28/);
        assert.match(titles[2], /Record 27/);
        assert.match(f.q('.slb-library-world-pages').getAttribute('aria-label'),/11개 항목/);
        assert.equal(JSON.stringify(f.entries), f.original);
        assert.equal(f.stats.loads, 1);
    } finally { f.dom.window.close(); }
});

test('order selection persists within session through type and theme changes; failed save restores select', async () => {
    const f = await fixture({ theme: 'antique', kind: 'world', n: 60, size: 10 });
    try {
        await f.load();
        await f.setOrder('reverse');
        assert.equal(f.state.order, 'reverse');
        f.change('#slb-library-book-type', 'people');
        assert.equal(f.q('.slb-library-order-select').value, 'reverse');
        assert.match(f.q('.slb-library-person-row').textContent, /Record 59/);
        f.change('#slb-library-theme-mode', 'ebook');
        await tick();
        assert.equal(f.q('.slb-library-order-select').value, 'reverse');
        assert.match(f.q('.slb-library-person-row').textContent, /Record 59/);
        await f.setSize(20);
        assert.equal(f.q('.slb-library-order-select').value, 'reverse');
        assert.equal(f.q('.slb-library-page-jump').textContent, '1 / 3');
        f.state.orderFailure = true;
        await f.setOrder('normal');
        assert.equal(f.state.order, 'reverse');
        assert.equal(f.q('.slb-library-order-select').value, 'reverse');
        assert.equal(f.stats.alerts.length, 1);
        assert.equal(f.stats.alerts[0][1], 'error');
        assert.equal(f.stats.writes, 0);
    } finally { f.dom.window.close(); }
});

test('ordering and page jumps are read-only and use compact, scoped UI controls', () => {
    assert.match(index, /libraryListOrder:\s*'normal'/);
    assert.match(index, /\['normal', 'reverse', 'title-asc', 'title-desc'\]\.includes\(settings\.libraryListOrder\)/);
    assert.match(index, /setListOrder:\s*async value =>/);
    assert.match(js, /if \(order === 'reverse'\) result = found\.reverse\(\);/);
    assert.match(js, /LIBRARY_TITLE_COLLATOR\.compare/);
    assert.match(js, /function finishPageJump\(input, commit\)/);
    const scoped = css.slice(css.lastIndexOf('/* ambasa.56'));
    assert.match(scoped, /select\.slb-library-order-select\s*\{[^}]*font-size:\s*11px !important/s);
    assert.match(scoped, /button\.slb-library-page-jump small,[\s\S]*font-size:\s*11px !important/s);
    assert.match(scoped, /\.slb-library-page-jump-editor\[hidden\]\s*\{[^}]*display:\s*none !important/s);
    assert.doesNotMatch(js, /new MutationObserver\(|setInterval\(/);
});

test('jumping to a far page in reverse order shows corresponding original-order records', async () => {
    for (const kind of ['general', 'memory', 'world', 'people']) {
        const f = await fixture({ theme: 'ebook', kind, n: 125, size: 5 });
        try {
            await f.load();
            await f.setOrder('reverse');
            const input = f.openJump();
            input.value = '18';
            input.dispatchEvent(new f.win.KeyboardEvent('keydown', {
                key: 'Enter', bubbles: true, cancelable: true,
            }));
            assert.equal(f.q('[data-action="page-jump"]').textContent, '18 / 25');
            // The eighteenth five-entry page of a 125-entry reversed list
            // begins at original UID 39: never rewrite that entry's order/UID.
            if (kind === 'general') assert.ok(f.q('[data-action="entry"][data-uid="39"]'));
            if (kind === 'memory') {
                assert.ok(f.q('[data-action="diary-entry"][data-uid="39"]'));
                f.click('[data-action="diary-entry"][data-uid="39"]');
                assert.equal(f.q('.slb-library-diary-page').dataset.uid, '39');
            }
            if (kind === 'world') assert.ok(f.q('.slb-library-index-item[data-uid="39"]'));
            if (kind === 'people') assert.ok(f.q('.slb-library-person-row[data-uid="39"]'));
            assert.equal(JSON.stringify(f.entries), f.original);
            assert.equal(f.stats.writes, 0);
        } finally { f.dom.window.close(); }
    }
});
