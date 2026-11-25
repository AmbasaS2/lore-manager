const { test } = require('node:test');
const assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { pathToFileURL } = require('node:url');

const root = join(__dirname, '..');
const css = readFileSync(join(root, 'library-shelf.css'), 'utf8');
const source = readFileSync(join(root, 'library-shelf.js'), 'utf8');
const moduleURL = pathToFileURL(join(root, 'library-shelf.js')).href;
const tick = () => new Promise(resolve => setImmediate(resolve));

async function fixture({ theme = 'antique', type = 'general', n = 24,
    name = '바람이 부는 모험의 로어북과 오래된 기록들 이야기',
    width = 300, tags = ['마법', '장편', '시계탑'] } = {}) {
    const { createStandaloneLibrary } = await import(moduleURL);
    const dom = new JSDOM('<!doctype html><html><body><p id="outside">SillyTavern unaffected</p></body></html>', {
        pretendToBeVisual: true,
    });
    const win = dom.window;
    win.confirm = () => true;
    Object.defineProperty(win, 'innerWidth', { configurable: true, value: width });
    Object.defineProperty(win, 'innerHeight', { configurable: true, value: 750 });
    const state = { tags: [...tags], theme, type };
    const stats = { bookReads: 0, writes: 0, translationReads: 0 };
    const entries = Object.fromEntries(Array.from({ length: n }, (_, i) => [i, {
        uid: i, displayIndex: i, comment: '항목 이름 ' + (i + 1),
        content: 'Original ' + i, key: ['key' + i],
    }]));
    const library = createStandaloneLibrary({
        document: win.document,
        listBooks: () => [name],
        linkedBooks: () => new Set([name]),
        loadBook: async () => { stats.bookReads++; return { entries }; },
        loadTranslations: async () => { stats.translationReads++; },
        translationFor: () => ({ text: '' }),
        saveContent: async () => { stats.writes++; },
        saveTranslation: async () => { stats.writes++; },
        translateOne: async () => { stats.writes++; },
        openAdvanced: () => {},
        getType: () => state.type,
        setType: (book, val) => { state.type = val; },
        getTypeMap: () => ({ [name]: state.type }),
        getTags: () => state.tags,
        getTagMap: () => ({ [name]: state.tags }),
        setTags: async (book, selected) => { state.tags = selected; stats.writes++; },
        getTheme: () => state.theme, setTheme: async val => { state.theme = val; },
        getLinkedOnly: () => true, setLinkedOnly: async () => {},
        getListPageSize: () => 5,
        getListOrder: () => 'normal',
        notify: () => {},
    });
    library.open();
    const q = sel => win.document.querySelector(sel);
    const all = sel => [...win.document.querySelectorAll(sel)];
    const click = sel => { const element = q(sel); assert.ok(element, 'missing ' + sel); element.click(); };
    const change = (sel, value) => {
        const el = q(sel); assert.ok(el, 'missing '+sel);
        el.value = value;
        el.dispatchEvent(new win.Event('change', { bubbles: true }));
    };
    const load = async () => { click('[data-action="select-book"]'); await tick(); };
    return { dom, win, library, q, all, click, change, load, state, stats, name };
}
const expectedTitles = { general: 'INDEX', memory: 'CONTENTS', world: 'CONTENTS', people: 'DIRECTORY' };

test('all 16 theme/type readers show exactly one real book title and tag editor inside the skin', async () => {
    for (const theme of ['antique', 'mac', 'blackberry', 'ebook']) {
        for (const type of ['general', 'memory', 'world', 'people']) {
            const f = await fixture({ theme, type });
            try {
                await f.load();
                const line = f.q('.slb-library-reader-bookline');
                assert.ok(line, theme + '/' + type);
                assert.equal(f.all('.slb-library-reader-bookline').length, 1);
                assert.equal(f.q('.slb-library-reader-book-title').textContent, f.name);
                assert.equal(f.q('.slb-library-reader-book-title').title, f.name);
                assert.ok(line.contains(f.q('details.slb-library-book-meta')));
                assert.equal(f.all('details.slb-library-book-meta').length, 1);
                assert.equal(f.q('.slb-library-book-chips').children.length, 3);
                assert.equal(f.q('.slb-library-nav-tags').children.length, 0);
                assert.equal(f.q('.slb-library-current').textContent, f.name, 'fallback semantic title retained');
                assert.equal(f.q('.slb-library-body').dataset.type, type);
                assert.equal(f.q('#slb-library-book-type').value, type, 'functional type switch stays');
                assert.equal(f.q('#outside').textContent, 'SillyTavern unaffected');
                assert.deepEqual(f.stats, { bookReads: 1, writes: 0, translationReads: 1 });
            } finally { f.dom.window.close(); }
        }
    }
});

test('all 16 reading modes remove folding header and preserve count in accessible pager', async () => {
    for (const theme of ['antique', 'mac', 'blackberry', 'ebook']) {
        for (const type of ['general', 'memory', 'world', 'people']) {
            const f = await fixture({ theme, type });
            try {
                await f.load();
                assert.equal(f.all('.slb-library-contents-heading, .slb-library-world-menu').length, 0);
                const pager = type === 'general' ? f.q('.slb-library-list-pages')
                    : type === 'memory' ? f.q('.slb-library-diary-toc .slb-library-list-pages')
                    : type === 'world' ? f.q('.slb-library-world-pages')
                    : f.q('.slb-library-people-pages');
                assert.ok(pager);
                assert.match(pager.getAttribute('aria-label'), /24개 항목/);
                assert.equal(f.all('.slb-library-section-head').length, 0);
                const text = f.q('.slb-library-reader-frame').textContent;
                assert.doesNotMatch(text, /CATALOGUE|DRAWER 01|PERSONAL JOURNAL|PRIVATE COLLECTION|CONFIDENTIAL|ENCYCLOPAEDIA · VOL|PERSONAL REGISTER|SELECTED RECORD|ARCHIVE FILE|CONTACT RECORD/);
                assert.equal(f.stats.bookReads, 1);
            } finally { f.dom.window.close(); }
        }
    }
});

test('each theme uses its existing chrome for the book title; no extra duplicated chrome or date', async () => {
    for (const theme of ['antique', 'mac', 'blackberry', 'ebook']) {
        const f = await fixture({ theme, type: 'general' });
        try {
            await f.load();
            const frame = f.q('.slb-library-reader-frame');
            assert.equal(frame.dataset.libraryMode, theme);
            if (theme === 'antique') {
                assert.ok(frame.querySelector('.slb-library-classic-banner .slb-library-reader-bookline'));
                assert.equal(frame.querySelectorAll('.slb-library-classic-banner').length, 1);
            } else if (theme === 'mac') {
                assert.ok(frame.querySelector('.slb-library-clean-chrome .slb-library-window-dots'));
                assert.ok(frame.querySelector('.slb-library-clean-chrome .slb-library-reader-bookline'));
                assert.equal(frame.querySelector('.slb-library-clean-sidebar'), null);
            } else if (theme === 'blackberry') {
                assert.ok(frame.querySelector('.slb-library-app-device-head .slb-library-reader-bookline'));
                assert.ok(frame.querySelector('.slb-library-device-signal'), 'nonfunctional original signal element retained but CSS-hidden');
                assert.ok(frame.querySelector('.slb-library-device-keyboard'));
            } else {
                assert.ok(frame.querySelector('.slb-library-ebook-paper > .slb-library-reader-bookline'));
                assert.equal(frame.querySelector('.slb-library-ebook-heading'), null);
            }
        } finally { f.dom.window.close(); }
    }
});

test('page changes, searches and tag editing reuse the same editor input and never save without click', async () => {
    for (const type of ['general', 'memory', 'world', 'people']) {
        const f = await fixture({ theme: 'antique', type });
        try {
            await f.load();
            const input = f.q('#slb-library-book-tag-input');
            const panel = f.q('.slb-library-book-meta');
            input.value = '마법, 아직 저장 전';
            input.dispatchEvent(new f.win.Event('input', { bubbles: true }));
            const next = type === 'general' ? '[data-action="catalog-list-next"]'
                : type === 'memory' ? '[data-action="memory-list-next"]'
                : type === 'world' ? '[data-action="world-next"]'
                : '[data-action="people-next"]';
            f.click(next);
            assert.equal(f.q('#slb-library-book-tag-input'), input, 'same input node survives paging');
            assert.equal(f.q('.slb-library-book-meta'), panel);
            assert.equal(input.value, '마법, 아직 저장 전');
            assert.equal(f.stats.writes, 0);
            if (type === 'world') f.change('#slb-library-search', '항목 이름 17');
            else f.change('#slb-library-search', '항목 이름 17');
            f.click('[data-action="submit-reader-search"]');
            assert.equal(f.q('#slb-library-book-tag-input'), input);
            assert.equal(f.stats.writes, 0);
            assert.ok(f.q('[data-action="book-tag-save"]'));
            f.click('[data-action="book-tag-save"]');
            await tick();
            assert.equal(f.stats.writes, 1);
            assert.deepEqual(f.state.tags, ['마법', '아직 저장 전']);
        } finally { f.dom.window.close(); }
    }
});

test('small windows preserve entire book title in source DOM, compact controls and no global CSS changes', async () => {
    for (const theme of ['antique', 'mac', 'blackberry', 'ebook']) {
        const f = await fixture({ theme, width: 280, name: '이 세계의 아주 길고 긴 문서 제목 :: ' + '가'.repeat(64) });
        try {
            await f.load();
            assert.equal(f.q('.slb-library-reader-book-title').textContent, f.name);
            assert.equal(f.q('.slb-library-reader-book-title').title, f.name);
            assert.equal(f.q('.slb-library-book-meta-summary') != null, true);
            assert.ok(f.q('.slb-library-reader-book-tags').contains(f.q('.slb-library-book-meta')));
            assert.equal(f.stats.bookReads, 1);
        } finally { f.dom.window.close(); }
    }
    const segment = css.slice(css.lastIndexOf('/* Compact reader context:'));
    assert.match(segment, /\.slb-library-reader-book-title\s*\{[^}]*overflow-wrap:\s*anywhere;/s);
    assert.match(segment, /\.slb-library-navigation\.slb-library-has-book \.slb-library-current,[\s\S]*display:\s*none !important/s);
    assert.match(segment, /\.slb-library-reader-book-tags \.slb-library-book-tag-picker\s*\{[^}]*right:\s*0;/s);
    assert.doesNotMatch(segment, /#WorldInfo|body\s*\{|\.world_entry\s*\{/);
    assert.doesNotMatch(source, /CATALOGUE · DRAWER 01|PERSONAL JOURNAL · VOL/);
});
