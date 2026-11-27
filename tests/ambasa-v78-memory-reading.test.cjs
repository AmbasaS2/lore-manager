const { test } = require('node:test');
const assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');
const { join } = require('node:path');
const { pathToFileURL } = require('node:url');
const libURL = pathToFileURL(join(__dirname, '..', 'library-shelf.js')).href;
const tick = () => new Promise(resolve => setImmediate(resolve));

async function fixture(theme = 'mac', width = 390, initial = 'timeline', openBook = true) {
    const { createStandaloneLibrary } = await import(libURL);
    const dom = new JSDOM('<!doctype html><html><body></body></html>', { pretendToBeVisual: true });
    const win = dom.window;
    Object.defineProperty(win, 'innerWidth', { configurable: true, value: width });
    win.confirm = () => true;
    const entries = Object.fromEntries(Array.from({ length: 240 }, (_, i) => [
        i, { uid: i, order: i, comment: 'Record ' + i,
            content: i === 3 ? 'Old plain record without date or result. ' + 'x'.repeat(250)
                : '**Timeline**: 1975 September ' + (i + 1) + '\n\n**Scene**\nFull scene ' + i + '\n\n**Result**\nOutcome ' + i },
    ]));
    const original = JSON.stringify(entries);
    const state = { mode: initial, size: 5, order: 'normal', reads: 0, writes: 0, viewWrites: 0, rejectView: false };
    const lib = createStandaloneLibrary({
        document: win.document, listBooks: () => ['Book'], linkedBooks: () => new Set(['Book']),
        loadBook: async () => { state.reads++; return { entries }; },
        loadTranslations: async () => {},
        translationFor: (_book, entry) => entry.uid === 1 ? { title:'번역 1',text:'**타임라인**: 1975년 9월 2일\n\n**장면**\n번역 본문\n\n**결과**\n번역 결과' } : {},
        saveContent: async () => { state.writes++; }, saveTranslation: async () => { state.writes++; },
        translateOne: async () => { state.writes++; }, openAdvanced: () => {},
        getType: () => 'memory', getTypeMap: () => ({ Book: 'memory' }), setType: () => {},
        getTags: () => [], getTagMap: () => ({}), setTags: async () => {},
        getTheme: () => theme, getListPageSize: () => state.size, setListPageSize: async n => { state.size = n; },
        getListOrder: () => state.order, setListOrder: async n => { state.order = n; },
        getMemoryView: () => state.mode, setMemoryView: async mode => { if (state.rejectView) throw new Error('save failed'); state.mode = mode; state.viewWrites++; },
        getLinkedOnly: () => true, notify: () => {},
    });
    const q = sel => win.document.querySelector(sel);
    const all = sel => [...win.document.querySelectorAll(sel)];
    const click = sel => { const el = q(sel); assert.ok(el, 'Missing '+sel); el.click(); };
    const mode = async name => {
        if (q('#slb-library-settings-panel').hidden) click('[data-action="settings"]');
        const select = q('#slb-library-memory-view');
        select.value = name;
        select.dispatchEvent(new win.Event('change', { bubbles: true }));
        await tick();
        if (!q('#slb-library-settings-panel').hidden) click('[data-action="settings"]');
    };
    const records = () => all('.slb-library-memory-record');
    lib.open(); if (openBook) { click('[data-action="select-book"]'); await tick(); }
    return { dom,win,lib,q,all,click,mode,records,state,entries,original };
}
test('timeline uses actual saved Result or explicitly labeled excerpt without invented dates', async () => {
    const { memoryTimelinePreview } = await import(libURL);
    assert.deepEqual(memoryTimelinePreview('**Timeline**: 1975-09-01\n\n**Scene**\nFull\n\n**Result**\nActual result'),
        {date:'1975-09-01',text:'Actual result',isResult:true});
    assert.deepEqual(memoryTimelinePreview('**타임라인**: 미상\n\n**장면**\n사건\n\n**결과**\n결과 문장'),
        {date:'',text:'결과 문장',isResult:true});
    assert.deepEqual(memoryTimelinePreview('No date or result'), {date:'',text:'No date or result',isResult:false});
    assert.equal(memoryTimelinePreview('x'.repeat(240)).text, 'x'.repeat(200)+'…');
});
test('all four skins: 240 entries use bounded initial batches and append without replacing previous DOM', async () => {
    for (const theme of ['mac','blackberry','ebook','antique']) {
        const f=await fixture(theme);
        try {
            assert.equal(f.records().length,5);
            assert.equal(f.all('.slb-library-detail').length,0);
            assert.equal(f.q('#slb-library-memory-view').value,'timeline');
            assert.equal(f.all('[data-action="memory-view"], .slb-library-memory-views').length,0);
            assert.ok(f.q('.slb-library-memory-heading .slb-library-page-size-select'));
            assert.equal(f.q('#slb-library-memory-contents').hidden,true);
            assert.equal(f.all('.slb-library-page-size-select').length,1);
            assert.equal(f.records()[0].querySelector('.slb-library-memory-preview').textContent,'Outcome 0');
            assert.equal(f.records()[1].querySelector('.slb-library-memory-preview').textContent,'번역 결과');
            assert.ok(f.records()[3].querySelector('.slb-library-memory-excerpt-label'));
            const previous = f.records()[0];
            f.click('[data-action="memory-more"]');
            assert.equal(f.records().length,10);
            assert.equal(f.records()[0],previous);
            assert.equal(f.state.reads,1);
            await f.mode('continuous');
            assert.equal(f.records().length,5);
            assert.equal(f.all('.slb-library-detail').length,5);
            assert.match(f.records()[0].textContent,/Full scene 0/);
            const detail=f.q('.slb-library-detail[data-uid="0"]');
            f.click('[data-action="memory-more"]');
            assert.equal(f.records().length,10);
            assert.equal(f.q('.slb-library-detail[data-uid="0"]'),detail);
            f.click('[data-action="toggle-view"][data-uid="1"]');
            assert.match(f.records()[1].textContent,/Full scene 1/);
            await f.mode('page');
            assert.equal(f.q('.slb-library-diary-page').dataset.uid,'0');
            assert.ok(f.q('[data-action="diary-next"]'));
            assert.equal(f.state.writes,0);
            assert.equal(JSON.stringify(f.entries),f.original);
        } finally {f.dom.window.close();}
    }
});
test('timeline expands only the selected record, and page/view navigation folds records without extra loads', async () => {
    const f=await fixture();
    try {
        f.click('[data-action="memory-more"]');
        const oldRecords = f.records();
        const target = oldRecords[7];
        const toggle = target.querySelector('[data-action="memory-toggle-full"]');
        assert.equal(toggle.getAttribute('aria-expanded'),'false');
        toggle.click();
        assert.equal(toggle.getAttribute('aria-expanded'),'true');
        assert.equal(f.q('.slb-library-diary-page'),null);
        assert.equal(f.q('.slb-library-detail').dataset.uid,'7');
        assert.match(f.q('.slb-library-detail').textContent,/Full scene 7/);
        assert.equal(target.querySelector('.slb-library-memory-summary').hidden,true);
        assert.deepEqual(f.records(),oldRecords);
        assert.equal(f.all('.slb-library-detail').length,1);
        assert.equal(f.state.mode,'timeline');
        assert.equal(f.q('#slb-library-memory-view').value,'timeline');
        toggle.click();
        assert.equal(toggle.getAttribute('aria-expanded'),'false');
        assert.equal(target.querySelector('.slb-library-memory-summary').hidden,false);
        assert.equal(f.all('.slb-library-detail').length,0);
        assert.deepEqual(f.records(),oldRecords);
        toggle.click();
        f.click('[data-action="memory-list-next"]');
        assert.equal(f.all('.slb-library-detail').length,0);
        assert.equal(f.state.viewWrites,0);
        await f.mode('continuous');
        assert.equal(f.records()[0].dataset.uid,'5');
        assert.ok(f.q('[data-action="memory-more-prev"]:not([hidden])'));
        f.click('[data-action="memory-more-prev"]');
        assert.equal(f.records()[0].dataset.uid,'0');
        assert.equal(f.records().length,10);
        const size=f.q('.slb-library-page-size-select'); size.value='10'; size.dispatchEvent(new f.win.Event('change',{bubbles:true})); await tick();
        assert.equal(f.records().length,10);
        const order=f.q('.slb-library-order-select'); order.value='reverse'; order.dispatchEvent(new f.win.Event('change',{bubbles:true})); await tick();
        assert.equal(f.records()[0].dataset.uid,'239');
        assert.equal(f.records().length,10);
        await f.mode('timeline');
        await f.lib.openEntry('Book',123); await tick();
        assert.equal(f.q('.slb-library-detail').dataset.uid,'123');
        assert.ok(f.q('.slb-library-memory-timeline'));
        assert.equal(f.q('.slb-library-diary-page'),null);
        assert.equal(f.state.reads,1);
        assert.equal(f.state.writes,0);
        assert.equal(JSON.stringify(f.entries),f.original);
    } finally {f.dom.window.close();}
});
test('unsaved edits block changing reader mode', async () => {
    const f=await fixture('mac',390,'continuous');
    try {
        f.click('[data-action="more-tools"][data-uid="0"]');
        f.click('[data-action="edit"][data-uid="0"]');
        f.q('.slb-library-editor-text').value='unsaved text';
        f.win.confirm=()=>false;
        await f.mode('timeline');
        assert.equal(f.state.mode,'continuous');
        assert.equal(f.q('.slb-library-editor-text').value,'unsaved text');
        assert.equal(f.state.viewWrites,0);
        assert.equal(f.q('#slb-library-memory-view').value,'continuous');
    } finally {f.dom.window.close();}
});

test('settings can persist a reader preference on the shelf, reopen it, and recover from save failure', async () => {
    const f=await fixture('mac',390,'timeline',false);
    try {
        await f.mode('continuous');
        assert.equal(f.state.mode,'continuous');
        assert.equal(f.state.reads,0);
        f.click('[data-action="select-book"]'); await tick();
        assert.equal(f.records().length,5);
        assert.ok(f.q('.slb-library-memory-continuous'));
        const first=f.records()[0];
        f.state.rejectView=true;
        await f.mode('page');
        assert.equal(f.state.mode,'continuous');
        assert.equal(f.q('#slb-library-memory-view').value,'continuous');
        assert.equal(f.q('#slb-library-memory-view').disabled,false);
        assert.equal(f.records()[0],first);
        f.state.rejectView=false;
        await f.mode('page');
        assert.ok(f.q('.slb-library-diary-page'));
        f.lib.close();
        f.lib.open(); f.click('[data-action="select-book"]'); await tick();
        assert.ok(f.q('.slb-library-diary-page'));
        assert.equal(f.q('#slb-library-memory-view').value,'page');
        assert.equal(f.state.writes,0);
    } finally {f.dom.window.close();}
});
test('timeline expands lazily with actual translated/source content, preserves other records, and protects unsaved edits', async () => {
    const f=await fixture();
    try {
        const first=f.records()[0],second=f.records()[1];
        f.click('[data-action="memory-toggle-full"][data-uid="1"]');
        assert.match(second.querySelector('.slb-library-prose').textContent,/번역 본문/);
        assert.equal(f.records()[0],first);
        f.click('[data-action="toggle-view"][data-uid="1"]');
        assert.match(second.querySelector('.slb-library-prose').textContent,/Full scene 1/);
        f.click('[data-action="memory-toggle-full"][data-uid="0"]');
        const firstDetail=first.querySelector('.slb-library-detail');
        f.click('[data-action="memory-more"]');
        assert.equal(first.querySelector('.slb-library-detail'),firstDetail);
        assert.equal(f.records().length,10);
        f.click('[data-action="more-tools"][data-uid="1"]');
        f.click('[data-action="edit"][data-uid="1"]');
        f.q('.slb-library-editor-text').value='unsaved';
        f.win.confirm=()=>false;
        f.click('[data-action="memory-toggle-full"][data-uid="1"]');
        assert.equal(f.q('.slb-library-editor-text').value,'unsaved');
        f.win.confirm=()=>true;
        f.click('[data-action="memory-toggle-full"][data-uid="1"]');
        assert.equal(second.querySelector('.slb-library-detail'),null);
        assert.equal(second.querySelector('.slb-library-memory-preview').textContent,'Outcome 1');
        assert.equal(first.querySelector('.slb-library-detail'),firstDetail);
        assert.equal(f.state.reads,1);
        assert.equal(f.state.writes,0);
        assert.equal(JSON.stringify(f.entries),f.original);
        await f.mode('page');
        assert.equal(f.state.mode,'page');
        assert.ok(f.q('.slb-library-diary-page'));
        assert.equal(f.q('.slb-library-memory-expanded'),null);
        await f.mode('timeline');
        assert.equal(f.all('.slb-library-detail').length,0);
    } finally {f.dom.window.close();}
});

test('timeline page size change folds every record and clears the discarded editor', async () => {
    const f=await fixture();
    try {
        f.click('[data-action="memory-toggle-full"][data-uid="1"]');
        f.click('[data-action="more-tools"][data-uid="1"]');
        f.click('[data-action="edit"][data-uid="1"]');
        f.q('.slb-library-editor-text').value='draft';
        f.win.confirm=()=>true;
        const size=f.q('.slb-library-page-size-select');
        size.value='10'; size.dispatchEvent(new f.win.Event('change',{bubbles:true})); await tick();
        assert.equal(f.all('.slb-library-detail').length,0);
        f.click('[data-action="memory-toggle-full"][data-uid="1"]');
        assert.equal(f.q('.slb-library-editor-text'),null);
        assert.match(f.q('.slb-library-detail').textContent,/번역 본문/);
        assert.equal(f.state.writes,0);
    } finally {f.dom.window.close();}
});
test('external content update refreshes only the changed timeline preview and full record', async () => {
    const f=await fixture();
    try {
        const first=f.records()[0],second=f.records()[1],third=f.records()[2];
        f.click('[data-action="memory-toggle-full"][data-uid="0"]');
        const changed=structuredClone(f.entries);
        changed[0].content='**Scene**\nUpdated full scene\n\n**Result**\nUpdated result';
        changed[2].content='**Scene**\nUpdated other scene\n\n**Result**\nUpdated other result';
        f.lib.onExternalWorldUpdate('Book',{entries:changed});
        assert.equal(f.records()[0],first);
        assert.equal(f.records()[1],second);
        assert.equal(f.records()[2],third);
        assert.match(first.querySelector('.slb-library-detail').textContent,/Updated full scene/);
        assert.equal(third.querySelector('.slb-library-memory-preview').textContent,'Updated other result');
        f.click('[data-action="memory-toggle-full"][data-uid="0"]');
        assert.equal(first.querySelector('.slb-library-memory-preview').textContent,'Updated result');
        assert.equal(f.state.reads,1);
        assert.equal(f.state.writes,0);
    } finally {f.dom.window.close();}
});
