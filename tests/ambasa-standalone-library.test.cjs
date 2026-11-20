
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { pathToFileURL } = require('node:url');
const productionURL = pathToFileURL(join(__dirname, '..', 'library-shelf.js')).href;
const css = readFileSync(join(__dirname, '..', 'library-shelf.css'), 'utf8');
const index = readFileSync(join(__dirname, '..', 'index.js'), 'utf8');

async function production() { return import(productionURL); }
function data(count = 3) {
    const entries = {};
    for (let i = 0; i < count; i++) {
        entries[i] = {
            uid: i, displayIndex: i,
            comment: (i === 0 ? '2024/06/10 · ' : '') + (i === 1 ? 'Dana Dawson' : 'Event ' + i),
            content: 'Original line ' + i + '\nImportant details about entry ' + i,
            key: ['keyword' + i], constant: i === 0,
            probability: 60 + i, excludeRecursion: true, preventRecursion: false,
        };
    }
    return { entries };
}
function fixture({ count = 3, linked = new Set(['Memory Peter', 'Cody Core']), type = 'general', translate = true } = {}) {
    const dom = new JSDOM('<html><head></head><body><div id="WorldInfo"><div id="world_popup_entries_list"></div></div></body></html>',
        { runScripts: 'outside-only', pretendToBeVisual: true });
    const w = dom.window;
    w.confirm = () => true;
    const types = { 'Memory Peter': type, 'Cody Core': 'world', 'Cody Locations': 'people' };
    const books = ['Memory Peter', 'Cody Core', 'Cody Locations'];
    const calls = { loaded: [], translations: [], sources: [], savedTranslations: [], ai: [], advanced: [], notify: [] };
    const records = new Map();
    const entriesByBook = Object.fromEntries(books.map(name => [name, data(count)]));
    if (translate) records.set('Memory Peter:0', { text: '한국어 번역 첫째', title: '번역 제목 0', stale: false });
    let lib;
    return { dom, w, calls, books, types, records, entriesByBook,
        async build() {
            const { createStandaloneLibrary } = await production();
            lib = createStandaloneLibrary({
                document: w.document,
                listBooks: () => books,
                linkedBooks: () => linked,
                loadBook: async name => {
                    calls.loaded.push(name);
                    return structuredClone(entriesByBook[name]);
                },
                saveContent: async (name, uid, prev, next) => {
                    calls.sources.push({ name, uid, prev, next });
                    const target = entriesByBook[name].entries[uid];
                    if (target.content !== prev) throw Error('concurrent edit');
                    target.content = next;
                    return structuredClone(entriesByBook[name]);
                },
                loadTranslations: async name => { calls.translations.push(name); },
                translationFor: (name, item) => records.get(name + ':' + item.uid)
                    || { text: '', pair: { sourceLanguage: 'English', translationLanguage: 'Korean' } },
                translateOne: async (name, item) => {
                    calls.ai.push([name, item.uid]);
                    records.set(name + ':' + item.uid, { text: '새 번역 내용' });
                },
                saveTranslation: async (name, item, next, old) => {
                    calls.savedTranslations.push([name, item.uid, next, old]);
                    if ((records.get(name + ':' + item.uid)?.text || '') !== old) throw Error('translation conflict');
                    records.set(name + ':' + item.uid, { text: next });
                },
                openAdvanced: (name, uid) => { calls.advanced.push([name, uid]); },
                getType: name => types[name] || 'general',
                setType: (name, value) => { types[name] = value; },
                getTheme: () => 'antique',
                notify: (message, tone) => calls.notify.push([message, tone]),
            });
            return lib;
        },
        click(selector, index = 0) {
            const target = w.document.querySelectorAll(selector)[index];
            assert.ok(target, 'missing ' + selector + ' #' + index);
            target.click();
        },
        get(libInstance) {
            return libInstance || lib;
        },
        async load(name = 'Memory Peter') {
            this.click('[data-action="select-book"][data-book="' + name + '"]');
            await new Promise(resolve => setImmediate(resolve));
            await new Promise(resolve => setImmediate(resolve));
        }
    };
}

test('keeps the saved displayIndex order instead of inventing chronological or alphabetical sorting', async () => {
    const { orderedLoreEntries, uniqueLibraryBooks, LIBRARY_BOOK_TYPES } = await production();
    const mixed = data();
    mixed.entries[0].displayIndex = 30;
    mixed.entries[1].displayIndex = 10;
    mixed.entries[2].displayIndex = 20;
    assert.deepEqual(orderedLoreEntries(mixed).map(x => x.uid), [1, 2, 0]);
    assert.deepEqual(orderedLoreEntries({ entries: { 0: { uid: 0, content: 'a' }, 1: { uid: 1, content: 'b' } } }).map(x => x.uid), [0, 1]);
    assert.equal(Object.keys(LIBRARY_BOOK_TYPES).length, 4);
    assert.deepEqual(uniqueLibraryBooks(['A', 'A', 'B'], new Set(['A'])), [
        { name: 'A', linked: true }, { name: 'B', linked: false }
    ]);
});

test('start screen shows linked lorebooks only, with explicit all-books option; no automatic loading or AI', async () => {
    const f = fixture();
    try {
        const lib = await f.build();
        lib.open();
        assert.equal(f.w.document.querySelectorAll('.slb-library-book-cover').length, 2);
        assert.equal(f.calls.loaded.length, 0);
        assert.equal(f.calls.ai.length, 0);
        f.click('[data-action="all-books"]');
        assert.equal(f.w.document.querySelectorAll('.slb-library-book-cover').length, 3);
        await f.load('Cody Locations');
        assert.deepEqual(f.calls.loaded, ['Cody Locations']);
        assert.deepEqual(f.calls.translations, ['Cody Locations']);
        assert.equal(f.w.document.querySelector('#slb-library-overlay').dataset.theme, 'antique');
        assert.equal(f.w.document.querySelector('#slb-library-book-type').value, 'people');
    } finally { f.dom.window.close(); }
});

test('catalog expands only its selected card and reads translated, original or side by side', async () => {
    const f = fixture();
    try {
        const lib = await f.build();
        lib.open();
        await f.load();
        assert.equal(f.w.document.querySelectorAll('.slb-library-catalog-card').length, 3);
        assert.equal(f.w.document.querySelectorAll('.slb-library-detail').length, 0);
        f.click('[data-action="entry"][data-uid="0"]');
        assert.equal(f.w.document.querySelectorAll('.slb-library-detail').length, 1);
        assert.match(f.w.document.querySelector('.slb-library-prose').textContent, /한국어 번역 첫째/);
        f.click('[data-action="toggle-view"]');
        assert.match(f.w.document.querySelector('.slb-library-prose').textContent, /Original line 0/);
        f.click('[data-action="both"]');
        assert.equal(f.w.document.querySelectorAll('.slb-library-reading').length, 2);
        f.click('[data-action="both"]');
        assert.equal(f.w.document.querySelectorAll('.slb-library-reading').length, 1);
        f.click('[data-action="entry"][data-uid="0"]');
        assert.equal(f.w.document.querySelectorAll('.slb-library-detail').length, 0);
    } finally { f.dom.window.close(); }
});

test('diary is continuous in original order and makes later records explicit, not 240 enormous DOM pages', async () => {
    const f = fixture({ count: 240, type: 'memory' });
    try {
        const lib = await f.build();
        lib.open();
        await f.load();
        assert.equal(f.w.document.querySelectorAll('.slb-library-diary-page').length, 12);
        assert.match(f.w.document.querySelector('.slb-library-diary-date').textContent, /2024-06-10/);
        f.click('[data-action="more"]');
        assert.equal(f.w.document.querySelectorAll('.slb-library-diary-page').length, 24);
        assert.equal(f.calls.ai.length, 0, 'rendering memory never runs the AI');
        assert.equal(f.w.document.querySelectorAll('[data-slb-editor-pending]').length, 0);
    } finally { f.dom.window.close(); }
});

test('world encyclopedia and contacts are different navigation UIs with no forced auto-selection', async () => {
    const f = fixture({ linked: null });
    try {
        const lib = await f.build();
        lib.open();
        await f.load('Cody Core');
        assert.equal(f.w.document.querySelector('#slb-library-overlay .slb-library-body').dataset.type, 'world');
        assert.equal(f.w.document.querySelectorAll('.slb-library-index-item').length, 3);
        assert.equal(f.w.document.querySelector('.slb-library-detail'), null);
        f.click('[data-action="entry"][data-uid="2"]');
        assert.equal(f.w.document.querySelector('.slb-library-detail-world').dataset.uid, '2');
        f.click('[data-action="books"]');
        await f.load('Cody Locations');
        assert.equal(f.w.document.querySelector('#slb-library-overlay .slb-library-body').dataset.type, 'people');
        assert.equal(f.w.document.querySelector('.slb-library-detail-people'), null);
        f.click('[data-action="entry"][data-uid="1"]');
        assert.equal(f.w.document.querySelector('.slb-library-detail-people h3').textContent, 'Dana Dawson');
        assert.ok(f.w.document.querySelector('.slb-library-avatar'), 'contacts use an initial when no portrait exists');
    } finally { f.dom.window.close(); }
});

test('per-book type setting is independent of world entry data and has all four choices', async () => {
    const f = fixture();
    try {
        const lib = await f.build();
        const snapshot = JSON.stringify(f.entriesByBook['Memory Peter']);
        lib.open();
        await f.load();
        const select = f.w.document.querySelector('#slb-library-book-type');
        assert.equal(select.options.length, 4);
        select.value = 'people';
        select.dispatchEvent(new f.w.Event('change', { bubbles: true }));
        assert.equal(f.types['Memory Peter'], 'people');
        assert.equal(JSON.stringify(f.entriesByBook['Memory Peter']), snapshot);
        assert.equal(f.calls.sources.length, 0);
        assert.equal(f.calls.savedTranslations.length, 0);
    } finally { f.dom.window.close(); }
});

test('source edit saves only after explicit button, preserves original activation attributes', async () => {
    const f = fixture();
    try {
        const lib = await f.build();
        lib.open();
        await f.load();
        f.click('[data-action="entry"][data-uid="0"]');
        f.click('[data-action="edit-source"]');
        const area = f.w.document.querySelector('.slb-library-editor-text');
        assert.ok(area);
        area.value = 'New content';
        area.dispatchEvent(new f.w.Event('input', { bubbles: true }));
        assert.equal(f.calls.sources.length, 0, 'input alone never saves');
        f.click('[data-action="save-edit"]');
        await new Promise(resolve => setImmediate(resolve));
        assert.equal(f.calls.sources.length, 1);
        assert.equal(f.entriesByBook['Memory Peter'].entries[0].content, 'New content');
        assert.equal(f.entriesByBook['Memory Peter'].entries[0].probability, 60);
        assert.equal(f.entriesByBook['Memory Peter'].entries[0].excludeRecursion, true);
        assert.equal(f.entriesByBook['Memory Peter'].entries[0].constant, true);
    } finally { f.dom.window.close(); }
});

test('unsaved editing asks before closing; cancel stays in modal and preserves text', async () => {
    const f = fixture();
    try {
        const lib = await f.build();
        lib.open();
        await f.load();
        f.click('[data-action="entry"][data-uid="1"]');
        f.click('[data-action="edit-source"]');
        const area = f.w.document.querySelector('.slb-library-editor-text');
        area.value = 'not saved';
        let prompts = 0;
        f.w.confirm = () => { prompts++; return false; };
        f.click('[data-action="close"]');
        assert.equal(prompts, 1);
        assert.equal(lib.isOpen(), true);
        assert.equal(f.w.document.querySelector('.slb-library-editor-text').value, 'not saved');
        f.w.confirm = () => true;
        f.click('[data-action="close"]');
        assert.equal(lib.isOpen(), false);
        assert.equal(f.calls.sources.length, 0);
    } finally { f.dom.window.close(); }
});

test('manual translation edit never saves the source and passes the previous text for conflict checking', async () => {
    const f = fixture();
    try {
        const lib = await f.build();
        lib.open();
        await f.load();
        f.click('[data-action="entry"][data-uid="0"]');
        f.click('[data-action="edit-translated"]');
        f.w.document.querySelector('.slb-library-editor-text').value = '새로 쓴 번역';
        f.click('[data-action="save-edit"]');
        await new Promise(resolve => setImmediate(resolve));
        assert.deepEqual(f.calls.savedTranslations, [['Memory Peter', 0, '새로 쓴 번역', '한국어 번역 첫째']]);
        assert.equal(f.calls.sources.length, 0);
        assert.equal(f.records.get('Memory Peter:0').text, '새로 쓴 번역');
    } finally { f.dom.window.close(); }
});

test('paid AI never starts until the user confirms an individual translation', async () => {
    const f = fixture();
    try {
        const lib = await f.build();
        lib.open();
        await f.load();
        f.click('[data-action="entry"][data-uid="2"]');
        f.w.confirm = () => false;
        f.click('[data-action="translate"]');
        assert.equal(f.calls.ai.length, 0);
        f.w.confirm = () => true;
        f.click('[data-action="translate"]');
        await new Promise(resolve => setImmediate(resolve));
        assert.deepEqual(f.calls.ai, [['Memory Peter', 2]]);
        assert.match(f.w.document.querySelector('.slb-library-detail .slb-library-prose').textContent, /새 번역 내용/);
    } finally { f.dom.window.close(); }
});

test('advanced settings deep link leaves the modal and targets the exact original UID', async () => {
    const f = fixture();
    try {
        const lib = await f.build();
        lib.open();
        await f.load();
        f.click('[data-action="entry"][data-uid="2"]');
        f.click('[data-action="advanced"]');
        assert.equal(lib.isOpen(), false);
        assert.deepEqual(f.calls.advanced, [['Memory Peter', '2']]);
    } finally { f.dom.window.close(); }
});

test('untrusted lorebook text stays literal; modal does not inject markup or run HTML', async () => {
    const f = fixture();
    f.entriesByBook['Memory Peter'].entries[0].comment = '<img src=x onerror=alert(1)>';
    f.entriesByBook['Memory Peter'].entries[0].content = '<script>window.infected=true</script>';
    try {
        const lib = await f.build();
        lib.open();
        await f.load();
        f.click('[data-action="entry"][data-uid="0"]');
        assert.equal(f.w.document.querySelector('#slb-library-overlay img'), null);
        assert.equal(f.w.document.querySelector('#slb-library-overlay script'), null);
        f.click('[data-action="toggle-view"]');
        assert.match(f.w.document.querySelector('.slb-library-prose').textContent, /<script>/);
    } finally { f.dom.window.close(); }
});

test('library CSS is isolated, enforces mobile fullscreen and desktop split view', () => {
    assert.match(css, /#slb-library-overlay .slb-library-shell\s*\{/);
    assert.match(css, /height:\s*100dvh/);
    assert.match(css, /grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)/);
    assert.match(css, /@media \(max-width:\s*760px\)/);
    assert.doesNotMatch(css, /#WorldInfo/);
    assert.match(index, /new URL\('\.\/library-shelf\.css', import\.meta\.url\)/);
    assert.match(index, /getSettings\(\)\.managerMode === 'native'/);
});

test('translation with no saved record can be created manually with no paid AI call', async () => {
    const f = fixture({ translate: false });
    try {
        const lib = await f.build();
        lib.open();
        await f.load();
        f.click('[data-action="entry"][data-uid="2"]');
        assert.match(f.w.document.querySelector('.slb-library-prose').textContent, /Original line 2/,
            'missing translation exposes the original rather than an empty page');
        f.click('[data-action="edit-translated"]');
        const input = f.w.document.querySelector('.slb-library-editor-text');
        assert.equal(input.value, '');
        input.value = '수동 번역 내용';
        assert.equal(f.calls.ai.length, 0);
        assert.equal(f.calls.savedTranslations.length, 0);
        f.click('[data-action="save-edit"]');
        await new Promise(resolve => setImmediate(resolve));
        assert.equal(f.records.get('Memory Peter:2')?.text, '수동 번역 내용');
        assert.equal(f.calls.ai.length, 0);
        assert.equal(f.calls.sources.length, 0);
    } finally { f.dom.window.close(); }
});

test('old asynchronous book response cannot replace a newly selected book or corrupt its entries', async () => {
    const f = fixture({ linked: null });
    const lib = await f.build();
    try {
        let resolveSlow;
        const original = f.entriesByBook['Memory Peter'];
        // Rebuild the fixture with a slow first response by replacing its
        // underlying book object after creating a second library instance.
        const { createStandaloneLibrary } = await production();
        const delays = [];
        const standalone = createStandaloneLibrary({
            document: f.w.document,
            listBooks: () => f.books,
            linkedBooks: () => null,
            loadBook: book => {
                if (book === 'Memory Peter') return new Promise(resolve => { resolveSlow = resolve; });
                return Promise.resolve(f.entriesByBook[book]);
            },
            loadTranslations: async () => {},
            translationFor: () => ({ text: '' }),
            saveContent: async () => {},
            saveTranslation: async () => {},
            translateOne: async () => {},
            openAdvanced: () => {},
            getType: book => f.types[book],
            setType: () => {},
            getTheme: () => 'antique',
            notify: () => {},
        });
        standalone.open();
        f.click('[data-action="select-book"][data-book="Memory Peter"]');
        f.click('[data-action="books"]');
        f.click('[data-action="select-book"][data-book="Cody Core"]');
        await new Promise(resolve => setImmediate(resolve));
        resolveSlow(original);
        await new Promise(resolve => setImmediate(resolve));
        assert.equal(f.w.document.querySelector('.slb-library-current').textContent, 'Cody Core');
        assert.equal(f.w.document.querySelector('.slb-library-body').dataset.type, 'world');
        assert.equal(f.w.document.querySelectorAll('.slb-library-index-item').length, 3);
        assert.equal(delays.length, 0);
    } finally { f.dom.window.close(); }
});

test('in the continuous diary each entry switches source and translation independently', async () => {
    const f = fixture({ count: 3, type: 'memory' });
    try {
        const lib = await f.build();
        lib.open();
        await f.load();
        const pages = [...f.w.document.querySelectorAll('.slb-library-diary-page')];
        assert.equal(pages.length, 3);
        assert.equal(pages[0].querySelector('.slb-library-reading').dataset.readView, 'translated');
        assert.equal(pages[1].querySelector('.slb-library-reading').dataset.readView, 'translated');
        pages[0].querySelector('[data-action="toggle-view"]').click();
        const updated = [...f.w.document.querySelectorAll('.slb-library-diary-page')];
        assert.equal(updated[0].querySelector('.slb-library-reading').dataset.readView, 'source');
        assert.equal(updated[1].querySelector('.slb-library-reading').dataset.readView, 'translated');
        updated[1].querySelector('[data-action="both"]').click();
        const after = [...f.w.document.querySelectorAll('.slb-library-diary-page')];
        assert.equal(after[0].querySelectorAll('.slb-library-reading').length, 1);
        assert.equal(after[1].querySelectorAll('.slb-library-reading').length, 2);
        assert.equal(f.calls.ai.length, 0);
    } finally { f.dom.window.close(); }
});
