const { test } = require('node:test');
const assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');
const { join } = require('node:path');
const { readFileSync } = require('node:fs');
const { pathToFileURL } = require('node:url');

const root = join(__dirname, '..');
const js = readFileSync(join(root, 'library-shelf.js'), 'utf8');
const css = readFileSync(join(root, 'library-shelf.css'), 'utf8');
const index = readFileSync(join(root, 'index.js'), 'utf8');
const libURL = pathToFileURL(join(root, 'library-shelf.js')).href;
const tick = () => new Promise(resolve => setImmediate(resolve));

async function fixture({ theme = 'ebook', kind = 'world', extras = 0, renderMarkdown = false } = {}) {
    const { createStandaloneLibrary } = await import(libURL);
    const dom = new JSDOM('<!doctype html><html><body><div id="outside">SillyTavern</div></body></html>', { pretendToBeVisual: true });
    const w = dom.window;
    w.confirm = () => true;
    const books = ['Book Alpha', 'Book Beta', 'Book Both', ...Array.from({ length: extras }, (_, i) => 'Other ' + i)];
    const tags = { 'Book Alpha': ['alpha'], 'Book Beta': ['beta'], 'Book Both': ['alpha', 'beta'] };
    const stats = { loads: 0, writes: 0, translations: 0, rendered: 0, coverSaves: 0 };
    const entries = Object.fromEntries(Array.from({ length: 7 }, (_, i) => [i, {
        uid: i, displayIndex: i, comment: 'Entry ' + i,
        content: i === 0 ? '### 바다의 괴수\n\n**굵게** 기록' : 'Original lore ' + i,
        key: ['ocean'],
    }]));
    const lib = createStandaloneLibrary({
        document: w.document, listBooks: () => books, linkedBooks: () => new Set(books),
        loadBook: async () => { stats.loads++; return { entries }; },
        loadTranslations: async () => {}, translationFor: () => ({ text: '' }),
        renderReadMarkdown: renderMarkdown ? (target, source) => {
            stats.rendered++;
            if (source.includes('### 바다의 괴수')) target.innerHTML = '<h3>바다의 괴수</h3><p><strong>굵게</strong> 기록</p>';
            else target.textContent = source;
        } : undefined,
        saveContent: async () => { stats.writes++; },
        saveTranslation: async () => { stats.writes++; },
        translateOne: async () => { stats.translations++; }, openAdvanced: () => {},
        getType: () => kind, getTypeMap: () => Object.fromEntries(books.map(name => [name, kind])),
        setType: () => { stats.writes++; },
        getTags: name => tags[name] || [], getTagMap: () => tags,
        setTags: async (book, list) => { tags[book] = list; stats.writes++; },
        getTheme: () => theme, getLinkedOnly: () => true,
        getBookCover: () => '', getBookCoverMap: () => ({}),
        uploadBookCover: async () => { stats.coverSaves++; },
        removeBookCover: async () => { stats.coverSaves++; },
        notify: () => {},
    });
    lib.open();
    const q = selector => w.document.querySelector(selector);
    const qa = selector => [...w.document.querySelectorAll(selector)];
    const click = selector => { const node = q(selector); assert.ok(node, 'missing ' + selector); node.click(); };
    const load = async () => { click('[data-action="select-book"][data-book="Book Alpha"]'); await tick(); };
    return { dom, w, q, qa, click, load, books, tags, stats };
}

test('More is centered instead of occupying bottom-right corner in all four shelves', async () => {
    for (const theme of ['antique', 'mac', 'blackberry', 'ebook']) {
        const f = await fixture({ theme, extras: 70 });
        try {
            assert.ok(f.q('.slb-library-shelf-summary > button.slb-library-shelf-more'));
            assert.equal(f.stats.loads, 0);
        } finally { f.dom.window.close(); }
    }
    const final = css.slice(css.lastIndexOf('/* ambasa.52'));
    assert.match(final, /grid-template-columns:\s*minmax\(0, 1fr\) auto minmax\(0, 1fr\)/);
    assert.match(final, /\.slb-library-shelf-summary > button\.slb-library-shelf-more\s*\{[^}]*grid-column:\s*2/s);
    assert.match(final, /\.slb-library-shelf-summary[^}]*padding:\s*9px 16px 17px/s);
});

test('right click exposes cover menu without a permanently visible settings row; popup stays inside shell', async () => {
    const f = await fixture({ theme: 'ebook' });
    try {
        const opener = f.q('[data-action="select-book"][data-book="Book Alpha"]');
        const menu = f.q('.slb-library-cover-item .slb-library-cover-menu');
        assert.ok(menu.hidden);
        assert.equal(f.q('.slb-library-cover-item').children.length, 2, 'only opener and hidden menu');
        const event = new f.w.MouseEvent('contextmenu', { bubbles: true, cancelable: true, button: 2 });
        const allowed = opener.dispatchEvent(event);
        assert.equal(allowed, false);
        assert.equal(menu.hidden, false);
        assert.equal(f.stats.loads, 0);
        f.click('[data-action="cover-config"][data-book="Book Alpha"]');
        assert.equal(f.q('.slb-library-cover-backdrop').parentElement, f.q('.slb-library-shell'));
        assert.equal(f.q('.slb-library-cover-backdrop [aria-modal="true"]') !== null, true);
        f.click('[data-action="cover-cancel"]');
        assert.equal(f.stats.coverSaves, 0);
    } finally { f.dom.window.close(); }
});

test('long-press opens menu without opening book; scrolling gesture cancels hold', async () => {
    const f = await fixture({ theme: 'ebook' });
    const opener = f.q('[data-action="select-book"][data-book="Book Alpha"]');
    const menu = f.q('.slb-library-cover-menu');
    const pointer = (name, x, y) => {
        const event = new f.w.MouseEvent(name, { bubbles: true, button: 0, clientX: x, clientY: y });
        Object.defineProperties(event, { pointerType: { value: 'touch' }, pointerId: { value: 7 } });
        opener.dispatchEvent(event);
    };
    try {
        pointer('pointerdown', 20, 20);
        pointer('pointermove', 20, 40);
        await new Promise(resolve => setTimeout(resolve, 550));
        assert.equal(menu.hidden, true, 'moving finger cancels long press');
        pointer('pointerdown', 20, 20);
        await new Promise(resolve => setTimeout(resolve, 560));
        pointer('pointerup', 20, 20);
        assert.equal(menu.hidden, false);
        opener.click();
        assert.equal(menu.hidden, false, 'synthetic click must not open book');
        assert.equal(f.stats.loads, 0);
        f.w.document.dispatchEvent(new f.w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        assert.equal(menu.hidden, true);
        opener.click();
        await tick();
        assert.equal(f.stats.loads, 1);
    } finally { f.dom.window.close(); }
});

test('TOC heading contains count and toggles without a re-render or changing tag row, all themes', async () => {
    for (const theme of ['antique', 'mac', 'blackberry', 'ebook']) {
        const f = await fixture({ theme, kind: 'world' });
        try {
            await f.load();
            const heading = f.q('[data-action="world-menu"]');
            assert.ok(heading);
            assert.ok(heading.classList.contains('slb-library-index-heading'));
            assert.match(heading.textContent, /목차 · CONTENTS/);
            assert.match(heading.textContent, /7개 항목/);
            assert.equal(heading.getAttribute('aria-expanded'), 'true');
            assert.equal(f.qa('.slb-library-section-head').length, 0, 'count is not duplicated above reader');
            assert.ok(f.q('.slb-library-reader-meta-row > details.slb-library-book-meta'));
            assert.equal(f.q('.slb-library-reader-meta-row [data-action="world-menu"]'), null);
            assert.equal(f.qa('.slb-library-index-item').length, 5);
            const record = f.q('.slb-library-detail-world');
            f.click('[data-action="world-menu"]');
            assert.equal(heading.getAttribute('aria-expanded'), 'false');
            assert.equal(heading.getAttribute('aria-label'), '목차 펼치기');
            assert.equal(f.q('.slb-library-index-layout.is-index-open'), null);
            assert.equal(f.q('.slb-library-detail-world'), record, 'no unnecessary detail rerender');
            f.click('[data-action="world-menu"]');
            assert.equal(heading.getAttribute('aria-expanded'), 'true');
            assert.equal(f.stats.loads, 1);
            assert.equal(f.stats.writes, 0);
            if (theme === 'ebook') assert.equal(f.q('.slb-library-ebook-heading'), null);
        } finally { f.dom.window.close(); }
    }
});

test('tag menu lists existing tags, reuses them without writes, stays detached from TOC row', async () => {
    const f = await fixture({ theme: 'ebook', kind: 'world' });
    try {
        await f.load();
        const row = f.q('.slb-library-reader-meta-row');
        const tags = f.q('details.slb-library-book-meta');
        const toc = f.q('[data-action="world-menu"]');
        assert.ok(tags && !tags.open);
        assert.equal(f.qa('.slb-library-book-tag-suggestion').length, 2);
        tags.querySelector('summary').click();
        assert.equal(tags.open, true);
        assert.ok(f.q('.slb-library-book-tag-picker'));
        assert.equal(f.q('[data-action="book-tag-suggest"][data-tag="alpha"]').getAttribute('aria-pressed'), 'true');
        f.click('[data-action="book-tag-suggest"][data-tag="beta"]');
        assert.equal(f.q('#slb-library-book-tag-input').value, 'alpha, beta');
        assert.equal(f.q('[data-action="book-tag-suggest"][data-tag="beta"]').getAttribute('aria-pressed'), 'true');
        assert.equal(f.stats.writes, 0);
        assert.equal(f.q('.slb-library-reader-meta-row'), row);
        assert.equal(f.q('[data-action="world-menu"]'), toc);
        f.click('[data-action="book-tag-save"]');
        await tick();
        assert.deepEqual(f.tags['Book Alpha'], ['alpha', 'beta']);
        assert.equal(f.stats.writes, 1);
        assert.equal(f.stats.loads, 1);
    } finally { f.dom.window.close(); }
    const final = css.slice(css.lastIndexOf('/* ambasa.52'));
    assert.match(final, /\.slb-library-book-tag-picker\s*\{[^}]*position:\s*absolute/s);
    assert.match(final, /details\.slb-library-book-meta\[open\]\s*\{[^}]*max-width:\s*55%/s);
});

test('when there are no registered tags, the picker shows only text input', async () => {
    const f = await fixture({ theme: 'ebook' });
    try {
        f.tags['Book Alpha'] = [];
        f.tags['Book Beta'] = [];
        f.tags['Book Both'] = [];
        await f.load();
        assert.equal(f.qa('.slb-library-book-tag-suggestion').length, 0);
        assert.ok(f.q('#slb-library-book-tag-input'));
    } finally { f.dom.window.close(); }
});

test('sequential tag filter selections use OR, show removable chips and reset with All', async () => {
    const f = await fixture({ theme: 'ebook' });
    try {
        const select = tag => {
            const input = f.q('#slb-library-shelf-tag-select');
            input.value = 'tag:' + tag;
            input.dispatchEvent(new f.w.Event('change', { bubbles: true }));
        };
        select('alpha');
        assert.equal(f.qa('.slb-library-cover-item').length, 2);
        assert.equal(f.qa('.slb-library-active-tag').length, 1);
        select('beta');
        assert.equal(f.qa('.slb-library-cover-item').length, 3, 'OR includes all 3 books');
        assert.equal(f.qa('.slb-library-active-tag').length, 2);
        f.click('[data-action="shelf-tag-chip"][data-tag="alpha"]');
        assert.equal(f.qa('.slb-library-cover-item').length, 2);
        f.click('[data-action="shelf-tag"][data-filter="all"]');
        assert.equal(f.qa('.slb-library-active-tag').length, 0);
        assert.equal(f.qa('.slb-library-cover-item').length, 3);
        assert.equal(f.stats.loads, 0);
        assert.equal(f.stats.writes, 0);
    } finally { f.dom.window.close(); }
});

test('Markdown renders through optional ST callback and never mutates raw lore or settings', async () => {
    const f = await fixture({ theme: 'ebook', renderMarkdown: true });
    try {
        await f.load();
        const prose = f.q('.slb-library-prose.is-markdown');
        assert.ok(prose);
        assert.equal(prose.querySelector('h3').textContent, '바다의 괴수');
        assert.equal(prose.querySelector('strong').textContent, '굵게');
        assert.ok(f.stats.rendered >= 1);
        assert.equal(f.stats.writes, 0);
        assert.equal(f.stats.translations, 0);
    } finally { f.dom.window.close(); }
    assert.match(index, /import\s*\{\s*showdown,\s*DOMPurify\s*\}\s*from '\.\.\/\.\.\/\.\.\/\.\.\/lib\.js'/);
    assert.match(index, /DOMPurify\.sanitize\(loreLibraryMarkdown\.makeHtml/);
    assert.match(index, /renderReadMarkdown:\s*renderLibraryReadingMarkdown/);
    assert.match(js, /prose\.classList\.add\('is-markdown'\)/);
    assert.doesNotMatch(css, /font-family\s*:/i);
});
