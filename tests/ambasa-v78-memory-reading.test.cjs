const { test } = require('node:test');
const assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');
const { join } = require('node:path');
const { pathToFileURL } = require('node:url');
const libURL = pathToFileURL(join(__dirname, '..', 'library-shelf.js')).href;
const tick = () => new Promise(resolve => setImmediate(resolve));

async function fixture(theme = 'mac', width = 390, initial = 'timeline') {
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
    const state = { mode: initial, size: 5, order: 'normal', reads: 0, writes: 0, viewWrites: 0 };
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
        getMemoryView: () => state.mode, setMemoryView: async mode => { state.mode = mode; state.viewWrites++; },
        getLinkedOnly: () => true, notify: () => {},
    });
    const q = sel => win.document.querySelector(sel);
    const all = sel => [...win.document.querySelectorAll(sel)];
    const click = sel => { const el = q(sel); assert.ok(el, 'Missing '+sel); el.click(); };
    const mode = async name => { click('[data-action="memory-view"][data-mode="'+name+'"]'); await tick(); };
    const records = () => all('.slb-library-memory-record');
    lib.open(); click('[data-action="select-book"]'); await tick();
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
            assert.equal(f.q('[data-action="memory-view"][data-mode="timeline"]').getAttribute('aria-pressed'),'true');
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
test('timeline full record, TOC jump, reverse and page size retain real UID and no extra data loads', async () => {
    const f=await fixture();
    try {
        f.click('[data-action="memory-more"]');
        f.click('[data-action="memory-open-page"][data-uid="7"]');
        await tick();
        assert.equal(f.q('.slb-library-diary-page').dataset.uid,'7');
        assert.equal(f.state.mode,'timeline'); // temporary full-text open does not overwrite preference
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
    } finally {f.dom.window.close();}
});
