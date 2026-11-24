const { test } = require('node:test');
const assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { pathToFileURL } = require('node:url');

const root = join(__dirname, '..');
const uri = pathToFileURL(join(root, 'library-shelf.js')).href;

async function fixture({ width = 1120, height = 990, saved = {} } = {}) {
    const { createStandaloneLibrary } = await import(uri);
    const dom = new JSDOM('<!doctype html><html><body></body></html>', {
        pretendToBeVisual: true,
    });
    const win = dom.window;
    win.confirm = () => true;
    let vw = width, vh = height;
    Object.defineProperty(win, 'innerWidth', { configurable: true, get: () => vw });
    Object.defineProperty(win, 'innerHeight', { configurable: true, get: () => vh });
    const settings = { wide: saved.wide || null, narrow: saved.narrow || null };
    const stats = { sizeWrites: [], bookLoads: 0, aiCalls: 0, sourceWrites: 0 };
    const lib = createStandaloneLibrary({
        document: win.document,
        listBooks: () => ['Sample World'],
        linkedBooks: () => new Set(['Sample World']),
        loadBook: async () => {
            stats.bookLoads++;
            return { entries: { 4: { uid: 4, displayIndex: 4, comment: 'Title', content: 'Source' } } };
        },
        loadTranslations: async () => {},
        translationFor: () => ({ text: '' }),
        saveContent: async () => { stats.sourceWrites++; },
        saveTranslation: async () => { stats.sourceWrites++; },
        translateOne: async () => { stats.aiCalls++; },
        openAdvanced: () => {},
        getType: () => 'general', setType: () => {},
        getTags: () => [], getTagMap: () => ({}), setTags: async () => {},
        getTheme: () => 'antique', setTheme: async () => {},
        getListPageSize: () => 5, setListPageSize: async () => {},
        getListOrder: () => 'normal', setListOrder: async () => {},
        getLinkedOnly: () => true, setLinkedOnly: async () => {},
        getWindowSize: narrow => settings[narrow ? 'narrow' : 'wide'],
        setWindowSize: (size, narrow) => {
            const key = narrow ? 'narrow' : 'wide';
            settings[key] = { ...size };
            stats.sizeWrites.push({ key, ...size });
        },
        notify: () => {},
    });
    const q = selector => win.document.querySelector(selector);
    const getSize = () => {
        const shell = q('.slb-library-shell');
        return shell && { width: Number.parseFloat(shell.style.width),
            height: Number.parseFloat(shell.style.height) };
    };
    const getShell = () => {
        const shell = q('.slb-library-shell');
        // JSDOM does not measure inline layout; emulate the actual fixed
        // rectangle that placeFloatingShell writes.
        shell.getBoundingClientRect = () => {
            const left = Number.parseFloat(shell.style.left);
            const top = Number.parseFloat(shell.style.top);
            const width = Number.parseFloat(shell.style.width);
            const height = Number.parseFloat(shell.style.height);
            return { x: left, y: top, left, top, width, height,
                right: left + width, bottom: top + height };
        };
        return shell;
    };
    const point = (type, x, y, id = 17) => {
        const ev = new win.MouseEvent(type, {
            bubbles: true, cancelable: true, button: 0, clientX: x, clientY: y,
        });
        Object.defineProperty(ev, 'pointerId', { value: id });
        return ev;
    };
    return {
        lib, win, dom, settings, stats, q, getSize, getShell, point,
        viewport(w, h) { vw = w; vh = h; win.dispatchEvent(new win.Event('resize')); },
        key(key, shift = false) {
            const el = q('.slb-library-resize-grip');
            assert.ok(el, 'resize control exists');
            el.dispatchEvent(new win.KeyboardEvent('keydown', {
                key, shiftKey: shift, bubbles: true, cancelable: true,
            }));
        },
    };
}

test('user-chosen height persists across close/reopen and is not reset to 785px', async () => {
    const f = await fixture();
    try {
        f.lib.open();
        assert.equal(f.getSize().height, 785);
        f.key('ArrowUp', true);
        f.key('ArrowUp', true);
        assert.equal(f.getSize().height, 685);
        assert.deepEqual(f.settings.wide, { width: 460, height: 685 });
        assert.equal(f.lib.close(), true);
        f.lib.open();
        assert.deepEqual(f.getSize(), { width: 460, height: 685 });
        assert.equal(f.stats.sizeWrites.length, 2, 'reopening does not write settings');
        assert.deepEqual([f.stats.bookLoads, f.stats.aiCalls, f.stats.sourceWrites], [0, 0, 0]);
    } finally { f.dom.window.close(); }
});

test('pointer up stores preferred width and height once, not on every movement', async () => {
    const f = await fixture();
    try {
        f.lib.open();
        const shell = f.getShell(), box = shell.getBoundingClientRect();
        const grip = f.q('.slb-library-resize-grip');
        grip.dispatchEvent(f.point('pointerdown', box.right, box.bottom));
        f.win.dispatchEvent(f.point('pointermove', box.right + 40, box.bottom - 60));
        f.win.dispatchEvent(f.point('pointermove', box.right + 55, box.bottom - 85));
        assert.equal(f.stats.sizeWrites.length, 0, 'no disk writes while dragging');
        f.win.dispatchEvent(f.point('pointerup', box.right + 55, box.bottom - 85));
        assert.equal(f.stats.sizeWrites.length, 1);
        assert.deepEqual(f.settings.wide, f.getSize());
        const preferred = { ...f.settings.wide };
        f.lib.close(); f.lib.open();
        assert.deepEqual(f.getSize(), preferred);
    } finally { f.dom.window.close(); }
});

test('a simple resize-grip tap and a cancelled pointer do not overwrite the saved size', async () => {
    const f = await fixture({ saved: { wide: { width: 500, height: 470 } } });
    try {
        f.lib.open();
        const shell = f.getShell(), rect = shell.getBoundingClientRect();
        const grip = f.q('.slb-library-resize-grip');
        grip.dispatchEvent(f.point('pointerdown', rect.right, rect.bottom, 22));
        f.win.dispatchEvent(f.point('pointerup', rect.right, rect.bottom, 22));
        assert.equal(f.stats.sizeWrites.length, 0);
        grip.dispatchEvent(f.point('pointerdown', rect.right, rect.bottom, 23));
        f.win.dispatchEvent(f.point('pointermove', rect.right + 33, rect.bottom + 11, 23));
        f.win.dispatchEvent(f.point('pointercancel', rect.right + 33, rect.bottom + 11, 23));
        assert.deepEqual(f.settings.wide, { width: 500, height: 470 });
        assert.equal(f.stats.sizeWrites.length, 0);
    } finally { f.dom.window.close(); }
});

test('mobile and desktop settings are independent; a temporarily short viewport never replaces saved height', async () => {
    const f = await fixture({ saved: { wide: { width: 620, height: 640 } } });
    try {
        f.lib.open();
        assert.deepEqual(f.getSize(), { width: 620, height: 640 });
        f.viewport(390, 710);
        assert.deepEqual(f.settings.wide, { width: 620, height: 640 });
        assert.equal(f.stats.sizeWrites.length, 0, 'viewport resize cannot save');
        f.lib.close();
        f.lib.open();
        assert.equal(f.getSize().width, 370);
        f.key('ArrowUp', true);
        const mobile = { ...f.settings.narrow };
        assert.equal(mobile.width, 370);
        assert.ok(mobile.height > 0);
        f.lib.close();
        f.viewport(1120, 990);
        f.lib.open();
        assert.deepEqual(f.getSize(), { width: 620, height: 640 }, 'wide size unchanged');
        f.lib.close();
        f.viewport(390, 710);
        f.lib.open();
        assert.deepEqual(f.getSize(), mobile, 'narrow size restored');
    } finally { f.dom.window.close(); }
});

test('restoring minimized library preserves its current size without saving a new size', async () => {
    const f = await fixture({ saved: { wide: { width: 600, height: 510 } } });
    try {
        f.lib.open();
        f.q('[data-action="minimize"]').click();
        assert.equal(f.q('.slb-library-is-minimized') !== null, true);
        f.q('[data-action="restore"]').click();
        assert.deepEqual(f.getSize(), { width: 600, height: 510 });
        assert.equal(f.stats.sizeWrites.length, 0);
        f.lib.close(); f.lib.open();
        assert.deepEqual(f.getSize(), { width: 600, height: 510 });
    } finally { f.dom.window.close(); }
});

test('external WorldInfo Info deep link respects the same saved size', async () => {
    const f = await fixture({ saved: { wide: { width: 540, height: 440 } } });
    try {
        assert.equal(await f.lib.openEntry('Sample World', 4), true);
        assert.deepEqual(f.getSize(), { width: 540, height: 440 });
        f.lib.close();
        assert.equal(await f.lib.openEntry('Sample World', 4), true);
        assert.deepEqual(f.getSize(), { width: 540, height: 440 });
        assert.equal(f.stats.sizeWrites.length, 0);
    } finally { f.dom.window.close(); }
});

test('only explicit resize paths save size; CSS, data and watcher contracts remain untouched', () => {
    const js = readFileSync(join(root, 'library-shelf.js'), 'utf8');
    const index = readFileSync(join(root, 'index.js'), 'utf8');
    const manifest = JSON.parse(readFileSync(join(root, 'manifest.json'), 'utf8'));
    assert.match(js, /getWindowSize\(vp\.width <= 760\)/);
    assert.match(js, /resized && move\?\.type === 'pointerup'/);
    assert.match(js, /rememberWindowSize\(\);\s*refreshAfterResize\(\);/);
    assert.doesNotMatch(js, /setInterval\(/);
    assert.doesNotMatch(js, /new MutationObserver|new ResizeObserver/);
    assert.match(index, /libraryWindowSizes: \{\}/);
    assert.match(index, /saveSettingsDebounced\(\);/);
    assert.equal(manifest.version, '1.4.85-ambasa.67');
});
