
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
    const tagsByBook = {};
    const tagSaves = [];
    const entriesByBook = Object.fromEntries(books.map(name => [name, data(count)]));
    if (translate) records.set('Memory Peter:0', { text: '한국어 번역 첫째', title: '번역 제목 0', stale: false });
    let lib;
    let linkedOnly = true;
    return { dom, w, calls, books, types, records, entriesByBook, tagsByBook, tagSaves,
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
                getTags: name => tagsByBook[name] || [],
                setTags: async (name, tags) => { tagsByBook[name] = tags; tagSaves.push({name,tags}); },
                getTheme: () => 'antique',
                getLinkedOnly: () => linkedOnly,
                setLinkedOnly: async enabled => { linkedOnly = enabled; },
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
        assert.equal(f.w.document.querySelectorAll('.slb-library-book-spine').length, 2);
        assert.equal(f.calls.loaded.length, 0);
        assert.equal(f.calls.ai.length, 0);
        const linkedCheck = f.w.document.querySelector('#slb-library-linked-only');
        assert.ok(linkedCheck.checked);
        linkedCheck.checked = false;
        linkedCheck.dispatchEvent(new f.w.Event('change', { bubbles: true }));
        await new Promise(resolve => setImmediate(resolve));
        assert.equal(f.w.document.querySelectorAll('.slb-library-book-spine').length, 3);
        await f.load('Cody Locations');
        assert.deepEqual(f.calls.loaded, ['Cody Locations']);
        assert.deepEqual(f.calls.translations, ['Cody Locations']);
        assert.equal(f.w.document.querySelector('#slb-library-overlay').dataset.theme, 'antique');
        assert.equal(f.w.document.querySelector('#slb-library-book-type').value, 'people');
    } finally { f.dom.window.close(); }
});

test('catalog shows title-only overlapping stack OR one detail, with back/next/previous', async () => {
    const f = fixture();
    try {
        const lib = await f.build();
        lib.open();
        await f.load();
        assert.equal(f.w.document.querySelectorAll('.slb-library-catalog-card').length, 3);
        assert.equal(f.w.document.querySelectorAll('.slb-library-detail').length, 0);
        assert.equal(f.w.document.querySelector('.slb-library-section-head').textContent, '3개 항목');
        assert.equal(f.w.document.querySelector('.slb-library-catalog-card p'), null, 'cards contain only title');
        const firstTitle=f.w.document.querySelector('.slb-library-catalog-card').textContent;
        assert.equal(firstTitle, '번역 제목 0');
        f.click('[data-action="entry"][data-uid="0"]');
        assert.equal(f.w.document.querySelectorAll('.slb-library-catalog-card').length, 0,
            'list disappears while selected record is open');
        assert.equal(f.w.document.querySelectorAll('.slb-library-detail').length, 1);
        assert.equal(f.w.document.querySelector('.slb-library-catalog-position').textContent, '01 / 03');
        assert.match(f.w.document.querySelector('.slb-library-prose').textContent, /한국어 번역 첫째/);
        assert.equal(f.w.document.querySelectorAll('[data-action="both"]').length, 0);
        f.click('[data-action="toggle-view"]');
        assert.match(f.w.document.querySelector('.slb-library-prose').textContent, /Original line 0/);
        f.click('[data-action="catalog-next"]');
        assert.equal(f.w.document.querySelector('.slb-library-catalog-position').textContent, '02 / 03');
        f.click('[data-action="catalog-prev"]');
        assert.equal(f.w.document.querySelector('.slb-library-catalog-position').textContent, '01 / 03');
        f.click('[data-action="catalog-back"]');
        assert.equal(f.w.document.querySelectorAll('.slb-library-catalog-card').length, 3);
        assert.equal(f.w.document.querySelectorAll('.slb-library-detail').length, 0);
    } finally { f.dom.window.close(); }
});

test('diary selects records from its index and pages two at a time without 240 DOM pages', async () => {
    const f = fixture({ count: 240, type: 'memory' });
    try {
        const lib = await f.build();
        lib.open();
        await f.load();
        assert.equal(f.w.document.querySelectorAll('.slb-library-diary-page').length, 2);
        assert.match(f.w.document.querySelector('.slb-library-diary-date').textContent, /2024-06-10/);
        assert.equal(f.w.document.querySelector('#slb-library-diary-select').options.length, 240);
        f.click('[data-action="diary-next"]');
        assert.equal(f.w.document.querySelectorAll('.slb-library-diary-page').length, 2);
        assert.equal(f.w.document.querySelector('#slb-library-diary-select').value, '2');
        assert.equal(f.calls.ai.length, 0, 'rendering memory never runs the AI');
        assert.equal(f.w.document.querySelectorAll('[data-slb-editor-pending]').length, 0);
    } finally { f.dom.window.close(); }
});

test('world encyclopedia opens first reference; contacts open names only until chosen', async () => {
    const f = fixture({ linked: null });
    try {
        const lib = await f.build();
        lib.open();
        await f.load('Cody Core');
        assert.equal(f.w.document.querySelector('#slb-library-overlay .slb-library-body').dataset.type, 'world');
        assert.equal(f.w.document.querySelectorAll('.slb-library-index-item').length, 3);
        assert.equal(f.w.document.querySelector('.slb-library-detail-world').dataset.uid, '0');
        f.click('[data-action="entry"][data-uid="2"]');
        assert.equal(f.w.document.querySelector('.slb-library-detail-world').dataset.uid, '2');
        f.click('[data-action="books"]');
        await f.load('Cody Locations');
        assert.equal(f.w.document.querySelector('#slb-library-overlay .slb-library-body').dataset.type, 'people');
        assert.equal(f.w.document.querySelector('.slb-library-detail-people'), null);
        assert.equal(f.w.document.querySelectorAll('.slb-library-person-row').length, 3);
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
        f.click('[data-action="toggle-view"]');
        f.click('[data-action="edit"]');
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
        f.click('[data-action="edit"]');
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
        f.click('[data-action="edit"]');
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

test('library CSS is isolated, enforces mobile fullscreen and removes dual reading view', () => {
    assert.match(css, /#slb-library-overlay .slb-library-shell\s*\{/);
    assert.match(css, /height:\s*100dvh/);
    assert.doesNotMatch(css, /slb-library-split/);
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
            'missing translation defaults to the original rather than a blank page');
        f.click('[data-action="toggle-view"]');
        assert.match(f.w.document.querySelector('.slb-library-prose').textContent, /저장된 번역본이 없습니다/);
        f.click('[data-action="edit"]');
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

test('diary entry source/translation buttons act on their own entries without side by side', async () => {
    const f = fixture({ count: 3, type: 'memory' });
    try {
        const lib = await f.build();
        lib.open();
        await f.load();
        const pages = [...f.w.document.querySelectorAll('.slb-library-diary-page')];
        assert.equal(pages.length, 2);
        assert.equal(pages[0].querySelector('.slb-library-reading').dataset.readView, 'translated');
        assert.equal(pages[1].querySelector('.slb-library-reading').dataset.readView, 'source');
        pages[0].querySelector('[data-action="toggle-view"]').click();
        let updated = [...f.w.document.querySelectorAll('.slb-library-diary-page')];
        assert.equal(updated[0].querySelector('.slb-library-reading').dataset.readView, 'source');
        assert.equal(updated[1].querySelector('.slb-library-reading').dataset.readView, 'source');
        updated[1].querySelector('[data-action="toggle-view"]').click();
        updated = [...f.w.document.querySelectorAll('.slb-library-diary-page')];
        assert.equal(updated[0].querySelector('.slb-library-reading').dataset.readView, 'source');
        assert.equal(updated[1].querySelector('.slb-library-reading').dataset.readView, 'translated');
        assert.equal(f.w.document.querySelectorAll('[data-action="both"]').length, 0);
        assert.equal(f.calls.ai.length, 0);
    } finally { f.dom.window.close(); }
});

test('bookshelf displays physical spines, no source file requests before selection, and original book order', async () => {
    const f=fixture({linked:null});
    try{
        const lib=await f.build();
        lib.open();
        const spines=[...f.w.document.querySelectorAll('.slb-library-book-spine')];
        assert.equal(spines.length,3);
        assert.deepEqual(spines.map(item=>item.dataset.book),f.books);
        assert.equal(spines[0].getAttribute('title'),'Memory Peter');
        assert.equal(spines[0].getAttribute('aria-label'),'Memory Peter · 로어북 열기');
        assert.deepEqual(f.calls.loaded,[]);
        assert.deepEqual(f.calls.translations,[]);
        assert.deepEqual(f.calls.ai,[]);
        assert.deepEqual(f.calls.sources,[]);
        f.click('[data-action="select-book"][data-book="Memory Peter"]');
        await new Promise(resolve=>setImmediate(resolve));
        assert.deepEqual(f.calls.loaded,['Memory Peter']);
    }finally{f.dom.window.close()}
});

test('one book can belong to multiple tag shelves, filtering uses settings metadata only', async()=>{
    const f=fixture({linked:null});
    try{
        f.tagsByBook['Memory Peter']=['기억','마법 세계'];
        f.tagsByBook['Cody Core']=['마법 세계'];
        const lib=await f.build();lib.open();
        assert.equal(f.w.document.querySelectorAll('.slb-library-book-spine').length,3);
        const tagChoice=f.w.document.querySelector('#slb-library-shelf-tag-select');
        tagChoice.value='tag:기억';
        tagChoice.dispatchEvent(new f.w.Event('change',{bubbles:true}));
        assert.deepEqual([...f.w.document.querySelectorAll('.slb-library-book-spine')].map(b=>b.dataset.book),['Memory Peter']);
        const tagChoiceWorld=f.w.document.querySelector('#slb-library-shelf-tag-select');
        tagChoiceWorld.value='tag:마법 세계';
        tagChoiceWorld.dispatchEvent(new f.w.Event('change',{bubbles:true}));
        assert.deepEqual([...f.w.document.querySelectorAll('.slb-library-book-spine')].map(b=>b.dataset.book),['Memory Peter','Cody Core']);
        f.click('[data-action="shelf-tag"][data-filter="untagged"]');
        assert.deepEqual([...f.w.document.querySelectorAll('.slb-library-book-spine')].map(b=>b.dataset.book),['Cody Locations']);
        assert.equal(f.calls.loaded.length,0);
        assert.equal(f.calls.translations.length,0);
        assert.equal(f.calls.ai.length,0);
        assert.equal(f.tagSaves.length,0);
    }finally{f.dom.window.close()}
});

test('book tags are edited directly inside the opened book and never in the shelf',async()=>{
    const f=fixture({linked:null});
    try{
        const lib=await f.build();lib.open();
        assert.equal(f.w.document.querySelector('[data-action="tag-mode"]'),null);
        await f.load('Memory Peter');
        const tag=f.w.document.querySelector('#slb-library-book-tag-input');
        assert.ok(tag,'tag input visible without an extra edit click');
        assert.equal(tag.value,'');
        assert.equal(f.w.document.querySelector('[data-action="book-tag-save"]').disabled,true);
        tag.value='기억,  세계관, 기억';
        tag.dispatchEvent(new f.w.Event('input',{bubbles:true}));
        assert.equal(f.w.document.querySelector('[data-action="book-tag-save"]').disabled,false);
        assert.equal(f.tagSaves.length,0,'typing tags does not save');
        f.click('[data-action="book-tag-save"]');
        await new Promise(resolve=>setImmediate(resolve));
        assert.deepEqual(f.tagsByBook['Memory Peter'],['기억','세계관']);
        assert.equal(f.tagSaves.length,1);
        assert.equal(f.calls.sources.length,0);
        assert.equal(f.calls.ai.length,0);
        assert.deepEqual(f.calls.loaded,['Memory Peter']);
        f.click('[data-action="books"]');
        assert.equal(f.w.document.querySelectorAll('.slb-library-tag-chip').length,0);
        const tagChoice=f.w.document.querySelector('#slb-library-shelf-tag-select');
        tagChoice.value='tag:기억';
        tagChoice.dispatchEvent(new f.w.Event('change',{bubbles:true}));
        assert.deepEqual([...f.w.document.querySelectorAll('.slb-library-book-spine')].map(node=>node.dataset.book),['Memory Peter']);
    }finally{f.dom.window.close()}
});

test('invalid or unchanged book tags cannot save, and dirty tag field prevents accidental leaving',async()=>{
    const f=fixture({linked:null});
    try{
        f.tagsByBook['Memory Peter']=['기억'];
        const lib=await f.build();lib.open();
        await f.load();
        let input=f.w.document.querySelector('#slb-library-book-tag-input');
        assert.equal(input.value,'기억');
        assert.equal(f.w.document.querySelector('[data-action="book-tag-save"]').disabled,true);
        f.click('[data-action="book-tag-save"]');
        assert.equal(f.tagSaves.length,0);
        input.value=Array.from({length:9},(_,i)=>'tag'+i).join(',');
        input.dispatchEvent(new f.w.Event('input',{bubbles:true}));
        f.click('[data-action="book-tag-save"]');
        await new Promise(resolve=>setImmediate(resolve));
        assert.equal(f.tagSaves.length,0);
        assert.ok(f.w.document.querySelector('#slb-library-book-tag-input'),'invalid input stays editable');
        let asked=0;
        f.w.confirm=()=>{asked++;return false};
        f.click('[data-action="books"]');
        assert.equal(asked,1);
        assert.equal(f.w.document.querySelector('.slb-library-body').dataset.type,'general');
        assert.equal(f.w.document.querySelector('#slb-library-book-tag-input').value,input.value);
        f.w.confirm=()=>true;
        f.click('[data-action="books"]');
        assert.equal(f.w.document.querySelector('.slb-library-body').dataset.type,'books');
        assert.deepEqual(f.tagsByBook['Memory Peter'],['기억']);
    }finally{f.dom.window.close()}
});

test('shelf limits initial DOM to three physical rows even for 240 books and expands by two rows',async()=>{
    const {createStandaloneLibrary}=await production();
    const dom=new JSDOM('<html><body></body></html>',{runScripts:'outside-only'});
    const w=dom.window;
    try{
        const names=Array.from({length:240},(_,i)=>'책 '+i);
        let loads=0,translations=0,tagMapReads=0,individualTagReads=0;
        const lib=createStandaloneLibrary({
            document:w.document,listBooks:()=>names,linkedBooks:()=>new Set(names),
            loadBook:async()=>{loads++;return data();},loadTranslations:async()=>{translations++;},
            translationFor:()=>({text:''}),saveContent:async()=>{},translateOne:async()=>{},
            saveTranslation:async()=>{},openAdvanced:()=>{},getType:()=> 'general',
            setType:()=>{},getTags:()=>{individualTagReads++;return [];},
            getTagMap:()=>{tagMapReads++;return {};},setTags:async()=>{},getTheme:()=> 'antique',notify:()=>{},
        });
        lib.open();
        assert.equal(w.document.querySelectorAll('.slb-library-book-spine').length,42);
        assert.equal(tagMapReads,1,'metadata snapshot is read once per shelf view');
        assert.equal(individualTagReads,0,'never repeat settings reads for each of 240 books');
        assert.equal(w.document.querySelector('.slb-library-shelf-summary span').textContent,'240권 중 42권 표시');
        w.document.querySelector('[data-action="shelf-more"]').click();
        assert.equal(w.document.querySelectorAll('.slb-library-book-spine').length,70);
        assert.equal(tagMapReads,2,'more view reuses a single metadata snapshot');
        assert.equal(loads,0);
        assert.equal(translations,0);
        assert.equal(w.document.querySelectorAll('[data-action="shelf-tag"]').length,2);
    }finally{dom.window.close()}
});

test('book spines use Unicode-aware vertical writing and inherit user theme fonts', async()=>{
    const sourceCss=readFileSync(join(__dirname,'../library-shelf.css'),'utf8');
    assert.match(sourceCss, /writing-mode:\s*vertical-rl/);
    assert.match(sourceCss, /text-orientation:\s*mixed/);
    assert.doesNotMatch(sourceCss, /(?:font-family\s*:|@font-face|Georgia|Noto Serif KR|sans-serif)/i);
    assert.match(sourceCss, /overflow-x:\s*auto/);
    assert.match(sourceCss, /#slb-library-overlay button\.slb-library-book-spine/);
    const {normalizeLibraryTags}=await production();
    assert.deepEqual(normalizeLibraryTags(['기억','뉴욕','기억',' ',null]),['기억','뉴욕']);
});

test('unsaved book tags survive same-book controls and keep the modal open when exit is declined',async()=>{
    const f=fixture({linked:null});
    try{
        const lib=await f.build();lib.open();
        await f.load();
        f.click('[data-action="entry"][data-uid="0"]');
        const input=f.w.document.querySelector('#slb-library-book-tag-input');
        input.value='미저장 태그';
        input.dispatchEvent(new f.w.Event('input',{bubbles:true}));
        f.click('[data-action="toggle-view"]');
        assert.equal(f.w.document.querySelector('#slb-library-book-tag-input').value,'미저장 태그',
            'recreating the book reading pane preserves typed tag draft');
        let confirms=0;
        f.w.confirm=()=>{confirms++;return false};
        f.click('[data-action="close"]');
        assert.equal(confirms,1);
        assert.equal(lib.isOpen(),true);
        assert.equal(f.w.document.querySelector('#slb-library-book-tag-input').value,'미저장 태그');
        assert.equal(f.tagSaves.length,0);
        f.w.confirm=()=>true;
        f.click('[data-action="close"]');
        assert.equal(lib.isOpen(),false);
    }finally{f.dom.window.close()}
});
