const { test } = require('node:test');
const assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');
const { join } = require('node:path');
const { readFileSync } = require('node:fs');
const { pathToFileURL } = require('node:url');

const root = join(__dirname, '..');
const code = readFileSync(join(root, 'library-shelf.js'), 'utf8');
const css = readFileSync(join(root, 'library-shelf.css'), 'utf8');
const moduleURL = pathToFileURL(join(root, 'library-shelf.js')).href;
const tick = () => new Promise(resolve => setImmediate(resolve));

async function fixture({ theme = 'ebook', type = 'world', count = 18 } = {}) {
    const { createStandaloneLibrary } = await import(moduleURL);
    const dom = new JSDOM('<!doctype html><html><body><div id="chat">Chat content</div></body></html>', {
        pretendToBeVisual: true,
    });
    const win = dom.window;
    win.confirm = () => true;
    Object.defineProperty(win, 'innerWidth', { configurable: true, value: 900 });
    Object.defineProperty(win, 'innerHeight', { configurable: true, value: 820 });
    const entries = Object.fromEntries(Array.from({ length: count }, (_, i) =>
        [i, { uid: i, displayIndex: i, content: 'Lore ' + i, comment: 'Record ' + i }]));
    const stats = { bookReads: 0, translationReads: 0, originalWrites: 0, translationWrites: 0, ai: 0 };
    const lib = createStandaloneLibrary({
        document: win.document,
        listBooks: () => ['My Lorebook'],
        linkedBooks: () => new Set(['My Lorebook']),
        loadBook: async () => { stats.bookReads++; return { entries }; },
        loadTranslations: async () => { stats.translationReads++; },
        translationFor: () => ({ text: '' }),
        saveContent: async () => { stats.originalWrites++; },
        saveTranslation: async () => { stats.translationWrites++; },
        translateOne: async () => { stats.ai++; },
        openAdvanced: () => {},
        getType: () => type, getTypeMap: () => ({ 'My Lorebook': type }), setType: () => {},
        getTags: () => [], getTagMap: () => ({}), setTags: async () => {},
        getTheme: () => theme, getLinkedOnly: () => true,
        getListPageSize: () => 5,
        notify: () => {},
    });
    lib.open();
    const q = selector => win.document.querySelector(selector);
    const all = selector => [...win.document.querySelectorAll(selector)];
    const click = selector => { const el = q(selector); assert.ok(el, 'missing ' + selector); el.click(); };
    const load = async () => { click('[data-action="select-book"]'); await tick(); };
    return { dom, win, lib, q, all, click, load, stats };
}
const expected = { bookReads: 1, translationReads: 1, originalWrites: 0, translationWrites: 0, ai: 0 };

test('the minimize button is between Settings and X, with a hidden book-icon launcher', async () => {
    const f = await fixture();
    try {
        const actions = f.all('.slb-library-header-actions > button').map(el => el.dataset.action);
        assert.deepEqual(actions, ['minimize', 'settings', 'close']);
        const minimize = f.q('[data-action="minimize"]');
        const restore = f.q('[data-action="restore"]');
        assert.ok(minimize.querySelector('.fa-minus'));
        assert.equal(minimize.getAttribute('aria-label'), '서재 최소화');
        assert.ok(restore.querySelector('.fa-book-open'));
        assert.equal(restore.getAttribute('aria-label'), '서재 다시 열기');
        assert.equal(restore.hidden, true);
    } finally { f.dom.window.close(); }
});

test('minimizing and restoring retain book, TOC page, exact DOM nodes and scroll positions', async () => {
    for (const theme of ['antique', 'mac', 'blackberry', 'ebook']) {
        const f = await fixture({ theme, type: 'world' });
        try {
            await f.load();
            f.click('[data-action="world-next"]');
            const body = f.q('.slb-library-body');
            const inner = f.q('.slb-library-detail-world');
            const contents = f.q('.slb-library-index');
            body.scrollTop = 128;
            contents.scrollTop = 35;
            const shell = f.q('.slb-library-shell');
            const prevLeft = shell.style.left, prevTop = shell.style.top;
            f.click('[data-action="minimize"]');
            assert.equal(shell.hidden, true);
            assert.equal(f.q('[data-action="restore"]').hidden, false);
            assert.equal(f.q('#slb-library-overlay').classList.contains('slb-library-is-minimized'), true);
            assert.equal(f.lib.isOpen(), true);
            assert.equal(f.q('.slb-library-detail-world'), inner, 'reader DOM retained');
            assert.deepEqual(f.stats, expected);
            f.click('[data-action="restore"]');
            assert.equal(shell.hidden, false);
            assert.equal(f.q('[data-action="restore"]').hidden, true);
            assert.equal(f.q('.slb-library-world-pages small').textContent, '2 / 4');
            assert.equal(f.q('.slb-library-body'), body);
            assert.equal(f.q('.slb-library-detail-world'), inner);
            assert.equal(body.scrollTop, 128);
            assert.equal(contents.scrollTop, 35);
            assert.equal(shell.style.left, prevLeft);
            assert.equal(shell.style.top, prevTop);
            assert.deepEqual(f.stats, expected);
        } finally { f.dom.window.close(); }
    }
});

test('minimize is not close: preserves an unsaved edit and lets external open restore', async () => {
    const f = await fixture({ theme: 'ebook', type: 'general' });
    try {
        await f.load();
        f.click('[data-action="entry"][data-uid="3"]');
        f.click('[data-action="edit"][data-uid="3"]');
        const area = f.q('.slb-library-editor-text');
        assert.ok(area);
        area.value = 'Draft: never saved';
        const shell = f.q('.slb-library-shell');
        const inner = f.q('.slb-library-detail-general');
        f.click('[data-action="minimize"]');
        assert.equal(f.lib.isOpen(), true);
        assert.equal(shell.hidden, true);
        f.lib.open();
        assert.equal(shell.hidden, false);
        assert.equal(f.q('.slb-library-editor-text'), area);
        assert.equal(area.value, 'Draft: never saved');
        assert.equal(f.q('.slb-library-detail-general'), inner);
        assert.deepEqual(f.stats, expected);
    } finally { f.dom.window.close(); }
});

test('Escape while minimized must not close a hidden reader or consume Escape', async () => {
    const f = await fixture();
    try {
        await f.load();
        f.click('[data-action="minimize"]');
        const e = new f.win.KeyboardEvent('keydown', { key: 'Escape', cancelable: true, bubbles: true });
        assert.equal(f.win.document.dispatchEvent(e), true);
        assert.equal(e.defaultPrevented, false);
        assert.equal(f.lib.isOpen(), true);
        assert.equal(f.q('.slb-library-shell').hidden, true);
        f.click('[data-action="restore"]');
        assert.equal(f.q('.slb-library-shell').hidden, false);
    } finally { f.dom.window.close(); }
});

test('minimized book launcher drags without restoring; a subsequent click restores', async () => {
    const f = await fixture();
    try {
        await f.load();
        f.click('[data-action="minimize"]');
        const launcher = f.q('[data-action="restore"]');
        const oldLeft = Number.parseFloat(launcher.style.left);
        const oldTop = Number.parseFloat(launcher.style.top);
        const event = (name, x, y, detail = 1) => {
            const e = new f.win.MouseEvent(name, { bubbles: true, cancelable: true, detail, button: 0, clientX: x, clientY: y });
            Object.defineProperty(e, 'pointerId', { value: 9 });
            Object.defineProperty(e, 'pointerType', { value: 'mouse' });
            return e;
        };
        launcher.dispatchEvent(event('pointerdown', 100, 110));
        f.win.dispatchEvent(event('pointermove', 165, 155));
        f.win.dispatchEvent(event('pointerup', 165, 155));
        launcher.dispatchEvent(event('click', 165, 155));
        assert.equal(f.q('.slb-library-shell').hidden, true, 'drag click does not reopen');
        assert.equal(Number.parseFloat(launcher.style.left), oldLeft + 65);
        assert.equal(Number.parseFloat(launcher.style.top), oldTop + 45);
        launcher.dispatchEvent(event('pointerdown', 165, 155));
        f.win.dispatchEvent(event('pointerup', 165, 155));
        launcher.dispatchEvent(event('click', 165, 155));
        assert.equal(f.q('.slb-library-shell').hidden, false);
        assert.deepEqual(f.stats, expected);
    } finally { f.dom.window.close(); }
});

test('viewport resize while minimized only clamps launcher without rerendering content', async () => {
    const f = await fixture({ type: 'world' });
    try {
        await f.load();
        const oldDetail = f.q('.slb-library-detail-world');
        f.click('[data-action="minimize"]');
        Object.defineProperty(f.win, 'innerWidth', { configurable: true, value: 350 });
        Object.defineProperty(f.win, 'innerHeight', { configurable: true, value: 440 });
        f.win.dispatchEvent(new f.win.Event('resize'));
        const launcher = f.q('[data-action="restore"]');
        assert.ok(Number.parseFloat(launcher.style.left) >= 8);
        assert.ok(Number.parseFloat(launcher.style.left) <= 350 - 42);
        assert.ok(Number.parseFloat(launcher.style.top) <= 440 - 42);
        assert.equal(f.q('.slb-library-detail-world'), oldDetail);
        assert.deepEqual(f.stats, expected);
        f.click('[data-action="restore"]');
        assert.ok(f.q('.slb-library-shell'));
    } finally { f.dom.window.close(); }
});

test('after restoring, regular X close still closes and next open starts clean', async () => {
    const f = await fixture();
    try {
        await f.load();
        f.click('[data-action="minimize"]');
        f.click('[data-action="restore"]');
        f.click('[data-action="close"]');
        assert.equal(f.lib.isOpen(), false);
        assert.equal(f.q('#slb-library-overlay'), null);
        f.lib.open();
        assert.equal(f.lib.isOpen(), true);
        assert.equal(f.q('[data-action="restore"]').hidden, true);
        assert.equal(f.q('.slb-library-shell').hidden, false);
        assert.equal(f.q('.slb-library-body').dataset.type, 'books');
    } finally { f.dom.window.close(); }
});

test('minimization styles are scoped and no polling/observer was added', () => {
    const patch = css.slice(css.lastIndexOf('/* ambasa.54: KongTalk-style minimization'));
    assert.match(patch, /\.slb-library-shell\[hidden\]\s*\{\s*display:\s*none !important/);
    assert.match(patch, /button\.slb-library-minimize-button\s*\{[\s\S]*width:\s*27px !important/);
    assert.match(patch, /button\.slb-library-minimized-launcher\s*\{[\s\S]*width:\s*34px !important/);
    assert.match(patch, /button\.slb-library-minimized-launcher\[hidden\]\s*\{\s*display:\s*none !important/);
    assert.match(code, /function setMinimized\(value\)/);
    assert.doesNotMatch(code, /setInterval\(/);
    assert.doesNotMatch(code, /new MutationObserver\(/);
});
