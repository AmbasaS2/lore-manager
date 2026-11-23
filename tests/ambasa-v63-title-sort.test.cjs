const { test } = require('node:test');
const assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { pathToFileURL } = require('node:url');

const root = join(__dirname, '..');
const source = readFileSync(join(root, 'library-shelf.js'), 'utf8');
const settingsSource = readFileSync(join(root, 'index.js'), 'utf8');
const css = readFileSync(join(root, 'library-shelf.css'), 'utf8');
const libURL = pathToFileURL(join(root, 'library-shelf.js')).href;
const tick = () => new Promise(resolve => setImmediate(resolve));

const names = [
    '사과', 'apple', '바나나', '10번', '가방', 'Banana', '나무', '2번',
    'APPLE', '가방', '복숭아', 'record 10', 'record 2',
];
const pager = {
    general: '.slb-library-list-pages',
    memory: '.slb-library-diary-toc .slb-library-list-pages',
    world: '.slb-library-world-pages',
    people: '.slb-library-people-pages',
};
function rowTitle(f, kind) {
    return kind === 'general'
        ? f.all('.slb-library-catalog-card strong, .slb-library-clean-list-row strong')
            .map(n => n.textContent)
        : kind === 'memory'
            ? f.all('.slb-library-diary-toc .slb-library-index-item > span:last-child')
                .map(n => n.textContent)
            : kind === 'world'
                ? f.all('.slb-library-index-item > span:last-child').map(n => n.textContent)
                : f.all('.slb-library-person-row strong').map(n => n.textContent);
}
async function fixture({ theme = 'ebook', kind = 'world', count = names.length,
    order = 'normal', translations = {}, pageSize = 5, fail = false } = {}) {
    const { createStandaloneLibrary } = await import(libURL);
    const dom = new JSDOM('<!doctype html><html><body><p id="outside">SillyTavern stays untouched</p></body></html>', {
        pretendToBeVisual: true,
    });
    const win = dom.window;
    win.confirm = () => true;
    Object.defineProperty(win, 'innerWidth', { configurable: true, value: 390 });
    const state = { order, pageSize, fail, type: kind, theme };
    const stats = { loads: 0, writes: 0, orderSaves: 0, alerts: [], titleLookups: 0 };
    const entries = Object.fromEntries(Array.from({ length: count }, (_, i) => [
        i,
        { uid: i, displayIndex: i, comment: names[i % names.length],
            content: 'Lore data ' + i, key: [i % 2 === 0 ? 'group-even' : 'group-odd'] },
    ]));
    const untouched = JSON.stringify(entries);
    const lib = createStandaloneLibrary({
        document: win.document,
        listBooks: () => ['Book One'], linkedBooks: () => new Set(['Book One']),
        loadBook: async () => { stats.loads++; return { entries }; },
        loadTranslations: async () => {},
        translationFor: (_book, entry) => {
            stats.titleLookups++;
            return { title: translations[entry.uid] || '', text: '' };
        },
        saveContent: async () => { stats.writes++; },
        saveTranslation: async () => { stats.writes++; },
        translateOne: async () => { stats.writes++; },
        openAdvanced: () => {},
        getType: () => state.type, getTypeMap: () => ({ 'Book One': state.type }),
        setType: (_book, value) => { state.type = value; },
        getTags: () => [], getTagMap: () => ({}), setTags: async () => { stats.writes++; },
        getTheme: () => state.theme, setTheme: async value => { state.theme = value; },
        getLinkedOnly: () => true,
        getListPageSize: () => state.pageSize,
        setListPageSize: async value => { state.pageSize = value; },
        getListOrder: () => state.order,
        setListOrder: async value => {
            if (state.fail) throw new Error('settings save failed');
            state.orderSaves++;
            stats.orderSaves++;
            state.order = value;
        },
        notify: (...args) => stats.alerts.push(args),
    });
    lib.open();
    const q = sel => win.document.querySelector(sel);
    const all = sel => [...win.document.querySelectorAll(sel)];
    const click = sel => {
        const node = q(sel);
        assert.ok(node, 'Missing '+sel);
        node.click();
    };
    const change = (sel, value) => {
        const node = q(sel);
        assert.ok(node, 'Missing '+sel);
        node.value = value;
        node.dispatchEvent(new win.Event('change', { bubbles: true }));
    };
    const load = async () => { click('[data-action="select-book"]'); await tick(); };
    const setOrder = async value => { change('.slb-library-order-select', value); await tick(); };
    return { dom, win, q, all, click, change, load, setOrder, state, entries,
        stats, untouched };
}
const title = (i, translations) => translations[i] || names[i % names.length];
const ko = new Intl.Collator('ko', { numeric: true, sensitivity: 'base' });
function expectedFirst(order, count, translations = {}) {
    const items = Array.from({ length: count }, (_, i) => ({ uid: i, title: title(i, translations) }));
    if (order === 'reverse') items.reverse();
    else if (order.startsWith('title-')) {
        const direction = order === 'title-desc' ? -1 : 1;
        items.sort((a, b) => direction * ko.compare(a.title, b.title));
    }
    return items.slice(0, 5).map(item => item.title);
}

test('each of 16 readers has the four compact labels beside 5/page and preserves legacy values', async () => {
    for (const theme of ['antique', 'mac', 'blackberry', 'ebook']) {
        for (const kind of ['general', 'memory', 'world', 'people']) {
            const f = await fixture({ theme, kind });
            try {
                await f.load();
                const options = f.q(pager[kind] + ' .slb-library-page-options');
                assert.ok(options, theme + '/'+kind);
                const sort = options.querySelector('.slb-library-order-select');
                const size = options.querySelector('.slb-library-page-size-select');
                assert.ok(sort && size);
                assert.equal(size.nextElementSibling, sort);
                assert.deepEqual([...sort.options].map(opt => opt.textContent),
                    ['목록순', '목록 역순', '제목 A–Z', '제목 Z–A']);
                assert.deepEqual([...sort.options].map(opt => opt.value),
                    ['normal', 'reverse', 'title-asc', 'title-desc']);
                assert.equal(sort.value, 'normal');
                assert.equal(f.all('.slb-library-order-select').length, 1);
                assert.equal(f.stats.writes, 0);
            } finally { f.dom.window.close(); }
        }
    }
});

test('Korean 가나다, Latin A–Z, numeric titles and equal-case ties sort stably without source mutation', async () => {
    const translations = { 0: '다람쥐' };
    for (const order of ['normal','reverse','title-asc','title-desc']) {
        const f = await fixture({ order, translations });
        try {
            await f.load();
            assert.deepEqual(rowTitle(f, 'world'), expectedFirst(order, names.length, translations));
            if (order === 'title-asc') {
                const allTitles = [...names];
                const collated = allTitles.sort(ko.compare);
                assert.ok(collated.indexOf('가방') < collated.indexOf('나무'), 'Korean 가나다 order');
                assert.ok(collated.indexOf('apple') < collated.indexOf('Banana'), 'Latin A-Z order');
                assert.ok(collated.indexOf('2번') < collated.indexOf('10번'), 'natural numeric order');
                assert.equal(f.q('.slb-library-order-select').value, 'title-asc');
            }
            assert.equal(JSON.stringify(f.entries), f.untouched);
            assert.equal(f.stats.writes, 0);
        } finally { f.dom.window.close(); }
    }
});

test('title A–Z/Z–A sort visible record titles across all four types and four themes', async () => {
    const translations = { 0: '다람쥐' };
    for (const theme of ['antique', 'mac', 'blackberry', 'ebook']) {
        for (const kind of ['general','memory','world','people']) {
            const f = await fixture({ theme, kind, translations });
            try {
                await f.load();
                await f.setOrder('title-asc');
                assert.equal(f.state.order, 'title-asc');
                assert.deepEqual(rowTitle(f, kind), expectedFirst('title-asc', names.length, translations), theme+'/'+kind);
                if (kind === 'memory') {
                    const sorted = expectedFirst('title-asc', names.length, translations);
                    assert.ok(sorted.includes(f.q('.slb-library-diary-heading h3').textContent),
                        'journal actual reading starts at the new sorted first entry');
                }
                await f.setOrder('title-desc');
                assert.deepEqual(rowTitle(f, kind), expectedFirst('title-desc', names.length, translations), theme+'/'+kind);
                assert.equal(f.q('.slb-library-page-jump').textContent, '1 / 3');
                assert.equal(f.stats.loads, 1);
                assert.equal(f.stats.writes, 0);
                assert.equal(JSON.stringify(f.entries), f.untouched);
            } finally { f.dom.window.close(); }
        }
    }
});

test('title search filters entries before alphabetic sorting, and first/last page arrows still work', async () => {
    const f = await fixture({ kind: 'world', count: 240 });
    try {
        await f.load();
        const search = f.q('#slb-library-search');
        search.value = 'group-even';
        search.dispatchEvent(new f.win.Event('input', { bubbles: true }));
        await f.setOrder('title-asc');
        assert.equal(f.q('.slb-library-world-count').textContent, '120개 항목');
        assert.equal(f.q('.slb-library-page-jump').textContent, '1 / 24');
        f.click('[data-action="world-last"]');
        assert.equal(f.q('.slb-library-page-jump').textContent, '24 / 24');
        f.click('[data-action="world-first"]');
        assert.equal(f.q('.slb-library-page-jump').textContent, '1 / 24');
        assert.equal(f.stats.loads, 1);
        assert.equal(f.stats.writes, 0);
        assert.equal(JSON.stringify(f.entries), f.untouched);
    } finally { f.dom.window.close(); }
});

test('order is saved and remains after page-size/theme changes; failing save restores prior option', async () => {
    const f = await fixture({ kind: 'world', count: 28 });
    try {
        await f.load();
        await f.setOrder('title-asc');
        assert.equal(f.state.order, 'title-asc');
        f.change('.slb-library-page-size-select', '10');
        await tick();
        assert.equal(f.q('.slb-library-order-select').value, 'title-asc');
        assert.equal(f.q('.slb-library-page-jump').textContent, '1 / 3');
        f.change('#slb-library-theme-mode', 'mac');
        await tick();
        assert.equal(f.q('.slb-library-order-select').value, 'title-asc');
        f.state.fail = true;
        await f.setOrder('title-desc');
        assert.equal(f.state.order, 'title-asc');
        assert.equal(f.q('.slb-library-order-select').value, 'title-asc');
        assert.equal(f.stats.alerts.length, 1);
        assert.equal(f.stats.alerts[0][1], 'error');
        assert.equal(f.stats.writes, 0);
    } finally { f.dom.window.close(); }
});

test('sorting 240 entries translates/reads each title once, not once per comparator invocation', async () => {
    const f = await fixture({ kind: 'world', count: 240, order: 'title-asc' });
    try {
        await f.load();
        assert.equal(f.q('.slb-library-page-jump').textContent, '1 / 48');
        assert.ok(f.stats.titleLookups < 300, 'title cached once per item for sort, small visible-list overhead');
        assert.equal(f.stats.writes, 0);
    } finally { f.dom.window.close(); }
});

test('invalid stored order uses original order; source settings validates all four choices', async () => {
    const f = await fixture({ order: 'unexpected', kind: 'world' });
    try {
        await f.load();
        assert.equal(f.q('.slb-library-order-select').value, 'normal');
        assert.deepEqual(rowTitle(f, 'world'), names.slice(0, 5));
    } finally { f.dom.window.close(); }
    assert.match(settingsSource, /\['normal', 'reverse', 'title-asc', 'title-desc'\]\.includes\(settings\.libraryListOrder\)/);
    assert.match(settingsSource, /setListOrder:\s*async value =>/);
    assert.match(source, /LIBRARY_TITLE_COLLATOR = new Intl\.Collator\('ko'/);
    const sortCSS = css.match(/#slb-library-overlay select\.slb-library-order-select\s*\{([^}]*)\}/s)?.[1];
    assert.ok(sortCSS);
    assert.match(sortCSS, /width:\s*106px !important;/);
    assert.match(sortCSS, /font-size:\s*11px !important;/);
    assert.doesNotMatch(source, /setInterval\(/);
});
