const { test } = require('node:test');
const assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { pathToFileURL } = require('node:url');

const root = join(__dirname, '..');
const css = readFileSync(join(root, 'library-shelf.css'), 'utf8');
const js = readFileSync(join(root, 'library-shelf.js'), 'utf8');
const moduleURL = pathToFileURL(join(root, 'library-shelf.js')).href;
const tick = () => new Promise(resolve => setImmediate(resolve));

async function fixture({ theme='ebook', kind='world', n=125, pageSize=5, order='normal',
    width=320 }={}) {
    const { createStandaloneLibrary } = await import(moduleURL);
    const dom = new JSDOM('<!doctype html><html><body><div id="chat">Original ST chat</div></body></html>', {
        pretendToBeVisual: true,
    });
    const win = dom.window; win.confirm = () => true;
    Object.defineProperty(win,'innerWidth',{configurable:true,value:width});
    Object.defineProperty(win,'innerHeight',{configurable:true,value:710});
    const entries = Object.fromEntries(Array.from({length:n},(_,i)=>[i,{
        uid:i, displayIndex:i, comment:'Record '+i, content:'Original lore '+i, key:['record'],
    }]));
    const original = JSON.stringify(entries);
    const state = {theme,kind,order,pageSize};
    const stats = {books:0,readTranslations:0,saves:0,ai:0};
    const lib = createStandaloneLibrary({
        document:win.document, listBooks:()=>['My Book'], linkedBooks:()=>new Set(['My Book']),
        loadBook:async()=>{stats.books++;return {entries}},
        loadTranslations:async()=>{stats.readTranslations++},
        translationFor:()=>({text:''}),
        saveContent:async()=>{stats.saves++},
        saveTranslation:async()=>{stats.saves++},
        translateOne:async()=>{stats.ai++},
        openAdvanced:()=>{},
        getType:()=>state.kind, getTypeMap:()=>({'My Book':state.kind}),
        setType:(book,value)=>{state.kind=value},
        getTags:()=>[],getTagMap:()=>({}),setTags:async()=>{stats.saves++},
        getTheme:()=>state.theme,setTheme:async value=>{state.theme=value},
        getListPageSize:()=>state.pageSize,
        setListPageSize:async value=>{state.pageSize=value},
        getListOrder:()=>state.order,setListOrder:async value=>{state.order=value},
        getLinkedOnly:()=>true,setLinkedOnly:async()=>{},notify:()=>{},
    });
    lib.open();
    const q=sel=>win.document.querySelector(sel);
    const all=sel=>[...win.document.querySelectorAll(sel)];
    const click=sel=>{const el=q(sel);assert.ok(el,'missing '+sel);el.click();};
    const load=async()=>{click('[data-action="select-book"]');await tick();};
    const change=(sel,val)=>{const el=q(sel);assert.ok(el);el.value=String(val);el.dispatchEvent(new win.Event('change',{bubbles:true}));};
    return {dom,win,q,all,click,load,change,stats,state,entries,original};
}
const actionPrefix = {
    general:'catalog-list', memory:'memory-list', world:'world', people:'people',
};
const firstRecord = kind=>kind==='general'
    ? '.slb-library-catalog-card, .slb-library-clean-list-row'
    : kind==='memory'
        ? '.slb-library-diary-toc .slb-library-index-item'
        : kind==='world' ? '.slb-library-index-item' : '.slb-library-person-row';

test('all 16 reader combinations have four ordered chevron buttons, direct numeric jump and 5/page selector',async()=>{
    for (const theme of ['antique','mac','blackberry','ebook']) {
        for (const kind of ['general','memory','world','people']) {
            const f=await fixture({theme,kind,n:125});
            try {
                await f.load();
                const prefix=actionPrefix[kind];
                const nav=f.q('.slb-library-page-navigation');
                assert.ok(nav,theme+'/'+kind);
                const actions=[...nav.querySelectorAll('button')].map(el=>el.dataset.action);
                assert.deepEqual(actions,[
                    prefix+'-first',prefix+'-prev','page-jump',prefix+'-next',prefix+'-last',
                ]);
                assert.deepEqual(
                    [...nav.querySelectorAll('button')].map(el=>el.textContent),
                    ['«','‹','1 / 25','›','»'],
                );
                assert.equal(f.q('[data-action="'+prefix+'-first"]').disabled,true);
                assert.equal(f.q('[data-action="'+prefix+'-prev"]').disabled,true);
                assert.equal(f.q('[data-action="'+prefix+'-next"]').disabled,false);
                assert.equal(f.q('[data-action="'+prefix+'-last"]').disabled,false);
                assert.equal(f.q('.slb-library-page-size-select').value,'5');
                assert.equal(f.q('.slb-library-order-select').value,'normal');
                assert.equal(f.stats.books,1);
                assert.equal(f.stats.saves,0);
            } finally {f.dom.window.close();}
        }
    }
});

test('last, previous, next and first work in all 16 combinations without refetching or saving lore',async()=>{
    for (const theme of ['antique','mac','blackberry','ebook']) {
        for (const kind of ['general','memory','world','people']) {
            const f=await fixture({theme,kind,n:125});
            try {
                await f.load();
                const prefix=actionPrefix[kind];
                f.click('[data-action="'+prefix+'-last"]');
                assert.equal(f.q('[data-action="page-jump"]').textContent,'25 / 25',theme+'/'+kind);
                assert.equal(f.q('[data-action="'+prefix+'-last"]').disabled,true);
                assert.equal(f.q('[data-action="'+prefix+'-next"]').disabled,true);
                assert.equal(f.q('[data-action="'+prefix+'-first"]').disabled,false);
                assert.ok(f.q('[data-action="entry"][data-uid="120"]') ||
                    f.q('[data-action="diary-entry"][data-uid="120"]'),'last page starts with UID120');
                f.click('[data-action="'+prefix+'-prev"]');
                assert.equal(f.q('[data-action="page-jump"]').textContent,'24 / 25');
                f.click('[data-action="'+prefix+'-next"]');
                assert.equal(f.q('[data-action="page-jump"]').textContent,'25 / 25');
                f.click('[data-action="'+prefix+'-first"]');
                assert.equal(f.q('[data-action="page-jump"]').textContent,'1 / 25');
                assert.equal(f.q('[data-action="'+prefix+'-first"]').disabled,true);
                assert.equal(f.q('[data-action="'+prefix+'-prev"]').disabled,true);
                assert.equal(f.stats.books,1,'no reload');
                assert.equal(f.stats.saves,0,'original lore unchanged');
                assert.equal(f.stats.ai,0,'no new translation');
                assert.equal(JSON.stringify(f.entries),f.original);
                assert.equal(f.q('#chat').textContent,'Original ST chat');
            } finally {f.dom.window.close();}
        }
    }
});

test('single-page lists disable all four chevrons across all book types',async()=>{
    for(const kind of ['general','memory','world','people']){
        const f=await fixture({kind,n:2});
        try{
            await f.load();
            const prefix=actionPrefix[kind];
            for(const suffix of ['first','prev','next','last'])
                assert.equal(f.q('[data-action="'+prefix+'-'+suffix+'"]').disabled,true);
            assert.equal(f.q('.slb-library-page-jump').textContent,'1 / 1');
            assert.equal(f.stats.books,1);
        }finally{f.dom.window.close();}
    }
});

test('boundary paging respects reversed order and does not reorder original lore',async()=>{
    for(const kind of ['general','memory','world','people']){
        const f=await fixture({kind,n:121,order:'reverse'});
        try{
            await f.load();
            assert.equal(f.q(firstRecord(kind)).dataset.uid,'120');
            const prefix=actionPrefix[kind];
            f.click('[data-action="'+prefix+'-last"]');
            assert.equal(f.q('.slb-library-page-jump').textContent,'25 / 25');
            assert.equal(f.q(firstRecord(kind)).dataset.uid,'0');
            f.click('[data-action="'+prefix+'-first"]');
            assert.equal(f.q(firstRecord(kind)).dataset.uid,'120');
            assert.equal(JSON.stringify(f.entries),f.original);
        }finally{f.dom.window.close();}
    }
});

test('last-page count follows shared 10/20 page size and numeric jump still works',async()=>{
    const f=await fixture({n:121});
    try{
        await f.load();
        f.change('.slb-library-page-size-select','10');await tick();
        f.click('[data-action="world-last"]');
        assert.equal(f.q('[data-action="page-jump"]').textContent,'13 / 13');
        f.change('.slb-library-page-size-select','20');await tick();
        f.click('[data-action="world-last"]');
        assert.equal(f.q('[data-action="page-jump"]').textContent,'7 / 7');
        f.click('[data-action="world-first"]');
        f.click('[data-action="page-jump"]');
        const input=f.q('.slb-library-page-jump-input');
        input.value='4';
        input.dispatchEvent(new f.win.KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true}));
        assert.equal(f.q('[data-action="page-jump"]').textContent,'4 / 7');
        f.click('[data-action="world-last"]');
        assert.equal(f.q('[data-action="page-jump"]').textContent,'7 / 7');
    }finally{f.dom.window.close();}
});

test('three title-bar buttons share one final border, size, opacity and icon rule',async()=>{
    const f=await fixture();
    try{
        const actions=f.all('.slb-library-header-actions > button');
        assert.deepEqual(actions.map(x=>x.dataset.action),['minimize','settings','close']);
        const final=css.slice(css.lastIndexOf('/* ambasa.61:'));
        assert.match(final,/\.slb-library-settings-button,[\s\S]*\.slb-library-minimize-button,[\s\S]*\.slb-library-close\s*\{/);
        for(const re of [
            /box-sizing:\s*border-box !important;/,
            /width:\s*27px !important;/,/min-width:\s*27px !important;/,
            /height:\s*27px !important;/,/min-height:\s*27px !important;/,
            /border:\s*1px solid currentColor !important;/,
            /border-radius:\s*6px !important;/,/opacity:\s*1 !important;/,
        ])assert.match(final,re);
        assert.equal(actions.every(x=>x.querySelector('.fa-solid')),true);
    } finally {f.dom.window.close();}
});

test('all four boundary actions use existing book-local rendering and never ST core paging',()=>{
    assert.match(js,/const first = button\(doc, 'slb-library-page-edge'/);
    assert.match(js,/const last = button\(doc, 'slb-library-page-edge'/);
    assert.match(js,/\^world-\(first\|prev\|next\|last\)\$/);
    assert.match(js,/\^people-\(first\|prev\|next\|last\)\$/);
    const patch=css.slice(css.lastIndexOf('/* ambasa.61:'));
    assert.doesNotMatch(patch,/#WorldInfo|\.world_entry\s*\{|font-family/i);
});
