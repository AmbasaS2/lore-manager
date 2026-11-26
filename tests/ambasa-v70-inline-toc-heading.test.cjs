const { test } = require('node:test');
const assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { pathToFileURL } = require('node:url');
const root = join(__dirname, '..');
const url = pathToFileURL(join(root, 'library-shelf.js')).href;
const css = readFileSync(join(root, 'library-shelf.css'), 'utf8');
const js = readFileSync(join(root, 'library-shelf.js'), 'utf8');
const tick = () => new Promise(resolve => setImmediate(resolve));
async function fixture(theme, type) {
    const { createStandaloneLibrary } = await import(url);
    const dom = new JSDOM('<!doctype html><html><body></body></html>', { pretendToBeVisual: true });
    const win = dom.window;
    win.confirm = () => true;
    const entries = Object.fromEntries(Array.from({ length: 25 }, (_, i) => [i,
        { uid: i, displayIndex: i, comment: 'Entry ' + i, content: 'Body ' + i, key: ['tag'] }]));
    let reads = 0, writes = 0;
    const lib = createStandaloneLibrary({
        document: win.document,
        listBooks: () => ['Book'],
        linkedBooks: () => new Set(['Book']),
        loadBook: async () => { reads++; return { entries }; },
        loadTranslations: async () => {},
        translationFor: () => ({ text: '' }),
        saveContent: async () => { writes++; },
        saveTranslation: async () => { writes++; },
        translateOne: async () => { writes++; },
        openAdvanced: () => {},
        getTheme: () => theme, getType: () => type,
        getTypeMap: () => ({ Book: type }), setType: () => {},
        getTags: () => [], getTagMap: () => ({}), setTags: async () => {},
        getListPageSize: () => 5, getListOrder: () => 'normal',
        getLinkedOnly: () => true, notify: () => {},
    });
    const q = selector => win.document.querySelector(selector);
    const click = selector => { const el = q(selector); assert.ok(el, selector); el.click(); };
    const open = async () => {
        lib.open(); click('[data-action="select-book"]'); await tick();
        if (type === 'people') click('[data-action="entry"]');
    };
    return { dom, win, lib, q, click, open, reads: () => reads, writes: () => writes };
}
for (const type of ['memory', 'world', 'people']) {
    test(type + ' has exactly ONE CONTENTS · 목차 heading with adjacent chevron in all 4 skins', async () => {
        for (const theme of ['mac', 'blackberry', 'ebook', 'antique']) {
            const f = await fixture(theme, type);
            try {
                await f.open();
                assert.equal(f.q('.slb-library-reader-bookline [data-action$="-toc-toggle"]'), null,
                    theme + ': no duplicate header toggle');
                const toggle = f.q('[data-action="' + type + '-toc-toggle"]');
                const caption = f.q('.slb-library-toc-label');
                assert.ok(toggle && caption, theme);
                assert.equal(caption.textContent, 'CONTENTS · 목차');
                assert.equal(caption.parentElement, toggle, 'caption & chevron are one button');
                assert.equal(f.win.document.querySelectorAll('.slb-library-toc-heading').length, 1,
                    'exactly one real TOC heading');
                assert.equal(toggle.querySelector('.slb-library-toc-chevron').textContent, '▴');
                const article = f.q('.slb-library-detail');
                assert.ok(article);
                const count = f.reads();
                toggle.click();
                assert.equal(toggle.getAttribute('aria-expanded'), 'false');
                assert.equal(toggle.getAttribute('aria-label'), '목차 펼치기');
                assert.equal(toggle.querySelector('.slb-library-toc-chevron').textContent, '▾');
                assert.equal(f.q('.slb-library-detail'), article, 'must not recreate article/editor');
                if (type === 'memory') assert.equal(f.q('#slb-library-memory-contents').hidden, true);
                if (type === 'people') assert.equal(f.q('#slb-library-people-contents').hidden, true);
                if (type === 'world') assert.equal(f.q('.slb-library-index-layout').classList.contains('is-index-open'), false);
                toggle.click();
                assert.equal(toggle.getAttribute('aria-expanded'), 'true');
                assert.equal(toggle.querySelector('.slb-library-toc-chevron').textContent, '▴');
                assert.equal(f.reads(), count);
                assert.equal(f.writes(), 0);
            } finally { f.dom.window.close(); }
        }
    });
}
test('person directory-only mode retains its one CONTENTS title without a hide button', async () => {
    const f = await fixture('mac', 'people');
    try {
        f.lib.open(); f.click('[data-action="select-book"]'); await tick();
        assert.equal(f.q('.slb-library-toc-label').textContent, 'CONTENTS · 목차');
        assert.equal(f.q('[data-action="people-toc-toggle"]'), null);
        assert.equal(f.q('#slb-library-people-contents').hidden, false);
        assert.equal(f.writes(), 0);
    } finally { f.dom.window.close(); }
});
test('all three TOC headings remain visible after hiding their content, with no watchers or book-data changes', () => {
    const final = css.slice(css.lastIndexOf('/* ambasa.70'), css.indexOf('/* ambasa.71'));
    assert.match(final, /slb-library-toc-heading/);
    assert.match(final, /#slb-library-memory-contents\[hidden\]/);
    assert.match(final, /#slb-library-people-contents\[hidden\]/);
    assert.match(final, /#slb-library-world-contents\s*\{[^}]*display: flex !important/s);
    assert.doesNotMatch(final, /MutationObserver|ResizeObserver|setInterval|setTimeout|font-family/);
    assert.match(js, /function inlineTocHeading\(/);
    assert.doesNotMatch(js, /setInterval\(/);
    assert.equal(JSON.parse(readFileSync(join(root, 'manifest.json'), 'utf8')).version,
        '1.4.85-ambasa.81');
});
