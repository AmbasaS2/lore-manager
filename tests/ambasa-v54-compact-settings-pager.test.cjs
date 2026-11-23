const { test } = require('node:test');
const assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { pathToFileURL } = require('node:url');

const root = join(__dirname, '..');
const css = readFileSync(join(root, 'library-shelf.css'), 'utf8');
const js = readFileSync(join(root, 'library-shelf.js'), 'utf8');
const moduleUrl = pathToFileURL(join(root, 'library-shelf.js')).href;
const tick = () => new Promise(resolve => setImmediate(resolve));

async function fixture({ theme = 'antique', type = 'world', size = 5, records = 24 } = {}) {
    const { createStandaloneLibrary } = await import(moduleUrl);
    const dom = new JSDOM('<!doctype html><html><body><div id="chat"></div></body></html>', {
        pretendToBeVisual: true,
    });
    const win = dom.window;
    win.confirm = () => true;
    const state = { theme, type, size, reject: false };
    const stats = { reads: 0, writes: 0, settingWrites: 0, alerts: [] };
    const entries = Object.fromEntries(Array.from({ length: records }, (_, i) => [
        i, { uid: i, displayIndex: i, content: 'Original lore ' + i, comment: 'Record ' + i },
    ]));
    const lib = createStandaloneLibrary({
        document: win.document,
        listBooks: () => ['A Book'],
        linkedBooks: () => new Set(['A Book']),
        loadBook: async () => { stats.reads++; return { entries }; },
        loadTranslations: async () => {},
        translationFor: () => ({ text: '' }),
        saveContent: async () => { stats.writes++; },
        saveTranslation: async () => { stats.writes++; },
        translateOne: async () => { stats.writes++; },
        openAdvanced: () => {},
        getType: () => state.type,
        setType: (book, value) => { state.type = value; },
        getTags: () => [],
        getTagMap: () => ({}),
        setTags: async () => { stats.writes++; },
        getTheme: () => state.theme,
        setTheme: async value => { state.theme = value; stats.settingWrites++; },
        getListPageSize: () => state.size,
        setListPageSize: async value => {
            if (state.reject) throw new Error('settings refused');
            state.size = value;
            stats.settingWrites++;
        },
        getLinkedOnly: () => true,
        setLinkedOnly: async () => {},
        notify: (...args) => stats.alerts.push(args),
    });
    lib.open();
    const q = selector => win.document.querySelector(selector);
    const all = selector => [...win.document.querySelectorAll(selector)];
    const click = selector => { const target = q(selector); assert.ok(target, selector); target.click(); };
    const change = (selector, value) => {
        const target = q(selector);
        assert.ok(target, 'missing ' + selector);
        target.value = value;
        target.dispatchEvent(new win.Event('change', { bubbles: true }));
    };
    const load = async () => { click('[data-action="select-book"]'); await tick(); };
    return { dom, win, q, all, click, change, load, state, stats };
}

test('settings has the exact formal copy and only theme + linked-books preference', async () => {
    const f = await fixture();
    try {
        const panel = f.q('.slb-library-settings-panel');
        assert.ok(panel);
        assert.equal(panel.querySelector('.slb-library-settings-title').textContent, '로어북 서재 설정');
        assert.equal(panel.querySelector('.slb-library-appearance label').textContent, '테마');
        assert.equal(panel.querySelector('.slb-library-linked-setting span').textContent,
            '현재 캐릭터에 연결된 로어북만 보기');
        assert.equal(panel.querySelector('.slb-library-linked-hint').textContent,
            '연결된 로어북이 없으면 모든 책이 표시됩니다.');
        assert.equal(panel.querySelector('#slb-library-page-size'), null);
        assert.equal(panel.querySelector('.slb-library-page-size-select'), null);
        assert.equal(panel.querySelectorAll('select').length, 1);
        assert.equal(panel.querySelector('#slb-library-theme-mode').value, 'antique');
        assert.equal(f.stats.settingWrites, 0);
    } finally { f.dom.window.close(); }
});

test('each type in each theme has one small 5 / page dropdown beside its contents pagination', async () => {
    for (const theme of ['antique', 'mac', 'blackberry', 'ebook']) {
        for (const type of ['general', 'memory', 'world', 'people']) {
            const f = await fixture({ theme, type });
            try {
                await f.load();
                const pager = type === 'general' ? '.slb-library-list-pages'
                    : type === 'memory' ? '.slb-library-diary-toc .slb-library-list-pages'
                    : type === 'world' ? '.slb-library-world-pages'
                    : '.slb-library-people-pages';
                const select = f.q(pager + ' select.slb-library-page-size-select');
                assert.ok(select, 'missing '+theme+' / '+type);
                assert.equal(select.value, '5');
                assert.equal(select.getAttribute('aria-label'), '한 페이지에 표시할 항목 수');
                assert.deepEqual([...select.options].map(option => option.textContent),
                    ['5 / page', '10 / page', '20 / page']);
                assert.ok(f.q(pager + ' .slb-library-page-navigation'));
                assert.ok(f.q(pager + ' .slb-library-page-navigation > small'));
                assert.equal(f.all('.slb-library-page-size-select').length, 1);
                if (type === 'memory')
                    assert.equal(f.q('.slb-library-diary-pager select'), null, 'journal reading pages unchanged');
                assert.equal(f.stats.reads, 1);
                assert.equal(f.stats.settingWrites, 0);
            } finally { f.dom.window.close(); }
        }
    }
});

test('changing page size from the pager persists and follows a theme change', async () => {
    const f = await fixture({ theme: 'antique', type: 'world', records: 46 });
    try {
        await f.load();
        f.change('.slb-library-page-size-select', '10');
        await tick();
        assert.equal(f.state.size, 10);
        assert.equal(f.q('.slb-library-page-size-select').value, '10');
        assert.equal(f.all('.slb-library-index-item').length, 10);
        assert.equal(f.q('.slb-library-world-pages small').textContent, '1 / 5');
        f.change('#slb-library-theme-mode', 'ebook');
        await tick();
        assert.equal(f.q('.slb-library-page-size-select').value, '10');
        f.change('.slb-library-page-size-select', '20');
        await tick();
        assert.equal(f.all('.slb-library-index-item').length, 20);
        assert.equal(f.q('.slb-library-world-pages small').textContent, '1 / 3');
        assert.equal(f.stats.settingWrites, 3, 'two page size saves + one theme save');
        assert.deepEqual([f.stats.reads, f.stats.writes], [1, 0]);
    } finally { f.dom.window.close(); }
});

test('page size change rejection restores the dropdown and leaves original records intact', async () => {
    const f = await fixture({ theme: 'mac', type: 'memory' });
    try {
        await f.load();
        f.state.reject = true;
        f.change('.slb-library-page-size-select', '20');
        await tick();
        assert.equal(f.state.size, 5);
        assert.equal(f.q('.slb-library-page-size-select').value, '5');
        assert.equal(f.all('.slb-library-diary-toc .slb-library-index-item').length, 5);
        assert.equal(f.stats.settingWrites, 0);
        assert.equal(f.stats.writes, 0);
        assert.equal(f.stats.alerts.length, 1);
        assert.equal(f.stats.alerts[0][1], 'error');
    } finally { f.dom.window.close(); }
});

test('small typography and tight spacing explicitly override shared ST form CSS', () => {
    const final = css.slice(css.indexOf('/* ambasa.54 — compact'), css.indexOf('/* ambasa.54: KongTalk-style minimization'));
    assert.match(final, /\.slb-library-settings-panel \.slb-library-linked-setting\s*\{[^}]*font-size:\s*11px !important/s);
    assert.match(final, /\.slb-library-settings-panel \.slb-library-linked-hint\s*\{[^}]*margin:\s*2px 0 0;[^}]*font-size:\s*10px !important/s);
    assert.match(final, /\.slb-library-settings-panel \.slb-library-appearance\s*\{[^}]*flex-direction:\s*row;/s);
    assert.match(final, /select\.slb-library-page-size-select\s*\{[^}]*font-size:\s*11px !important;/s);
    assert.match(final, /select\.slb-library-page-size-select\s*\{[^}]*appearance:\s*auto !important;/s);
    assert.doesNotMatch(js, /const pagesSetting =/);
    assert.doesNotMatch(final, /font-family\s*:/i);
});
