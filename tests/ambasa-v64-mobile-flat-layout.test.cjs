const { test } = require('node:test');
const assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { pathToFileURL } = require('node:url');

const root = join(__dirname, '..');
const css = readFileSync(join(root,'library-shelf.css'),'utf8');
const js = readFileSync(join(root,'library-shelf.js'),'utf8');
const url = pathToFileURL(join(root,'library-shelf.js')).href;
const tick = () => new Promise(resolve => setImmediate(resolve));

async function fixture({theme='antique',type='general',n=24,width=290,sort='title-asc'}={}) {
    const { createStandaloneLibrary } = await import(url);
    const dom = new JSDOM('<!doctype html><html><body><div id="outside">Outside ST</div></body></html>', {
        pretendToBeVisual: true,
    });
    const win = dom.window; win.confirm = () => true;
    Object.defineProperty(win,'innerWidth',{configurable:true,value:width});
    const data = Object.fromEntries(Array.from({length:n},(_,i)=>[i,{
        uid:i,displayIndex:i,comment:'Entry '+i,
        content:'Some very long English and 한국어 원문 '+i,key:['tag'],
    }]));
    const before = JSON.stringify(data);
    const stats = {loads:0, writes:0, alert:[]};
    const state={theme,type,sort,tags:['world','reader'],size:5};
    const lib=createStandaloneLibrary({
        document:win.document,listBooks:()=>['My World'],linkedBooks:()=>new Set(['My World']),
        loadBook:async()=>{stats.loads++;return {entries:data}},
        loadTranslations:async()=>{},translationFor:()=>({text:''}),
        saveContent:async()=>{stats.writes++},saveTranslation:async()=>{stats.writes++},
        translateOne:async()=>{stats.writes++},openAdvanced:()=>{},
        getType:()=>state.type,setType:(book,val)=>{state.type=val},
        getTypeMap:()=>({'My World':state.type}),
        getTags:()=>state.tags,getTagMap:()=>({'My World':state.tags}),
        setTags:async(book,tags)=>{state.tags=tags;stats.writes++},
        getTheme:()=>state.theme,setTheme:async val=>{state.theme=val},
        getLinkedOnly:()=>true,getListPageSize:()=>state.size,
        setListPageSize:async val=>{state.size=val},getListOrder:()=>state.sort,
        setListOrder:async val=>{state.sort=val},
        notify:(...args)=>stats.alert.push(args),
    });
    lib.open();
    const q=sel=>win.document.querySelector(sel);
    const all=sel=>[...win.document.querySelectorAll(sel)];
    const click=sel=>{const el=q(sel);assert.ok(el,'missing '+sel);el.click();};
    const change=(sel,value)=>{const el=q(sel);assert.ok(el,sel);el.value=value;el.dispatchEvent(new win.Event('change',{bubbles:true}))};
    const load=async()=>{click('[data-action="select-book"]');await tick()};
    return {dom,win,lib,q,all,click,change,load,stats,state,before,data};
}
const pagers={
    general:'.slb-library-list-pages',memory:'.slb-library-diary-toc .slb-library-list-pages',
    world:'.slb-library-world-pages',people:'.slb-library-people-pages',
};

test('all 16 theme/type readers have no extra collapse heading, show actual entries and one pager',async()=>{
    for(const theme of ['antique','mac','blackberry','ebook'])for(const type of ['general','memory','world','people']){
        const f=await fixture({theme,type});
        try {
            await f.load();
            assert.equal(f.all('.slb-library-contents-heading,.slb-library-world-menu').length,0,theme+'/'+type);
            assert.equal(f.all('.slb-library-contents-count,.slb-library-world-count').length,0);
            const pager=f.q(pagers[type]);
            assert.ok(pager,theme+'/'+type);
            assert.match(pager.getAttribute('aria-label'),/24개 항목/);
            assert.ok(pager.querySelector('.slb-library-order-select'));
            assert.ok(pager.querySelector('.slb-library-page-size-select'));
            assert.equal(f.q('#slb-library-catalog-contents')?.hidden ?? false,false);
            assert.equal(f.q('#slb-library-memory-contents')?.hidden ?? false,false);
            assert.equal(f.q('#slb-library-people-contents')?.hidden ?? false,false);
            assert.equal(f.all('.slb-library-book-meta').length,1,'book tags only once');
            assert.equal(f.stats.loads,1,'no extra data loads');
        } finally{f.dom.window.close()}
    }
});

test('world contents remain permanently available after record switch and page changes',async()=>{
    const f=await fixture({type:'world',n:125});
    try {
        await f.load();
        const details=f.q('.slb-library-detail-world');
        assert.ok(details);
        f.click('[data-action="world-next"]');
        f.click('[data-action="entry"][data-uid="7"]');
        assert.ok(f.q('.slb-library-index-layout.is-index-open'));
        assert.equal(f.all('.slb-library-index-item').length,5);
        assert.equal(f.q('.slb-library-page-jump').textContent,'2 / 25');
        assert.equal(f.q('[data-action="world-menu"]'),null);
        assert.equal(f.stats.loads,1);
    } finally{f.dom.window.close()}
});

test('memory reading does not hide its TOC with no way to reopen it',async()=>{
    const f=await fixture({type:'memory',n:48});
    try {
        await f.load();
        f.click('[data-action="memory-list-next"]');
        f.click('[data-action="diary-entry"][data-uid="8"]');
        assert.equal(f.q('.slb-library-diary-page').dataset.uid,'8');
        assert.equal(f.q('#slb-library-memory-contents').hidden,false);
        assert.equal(f.q('.slb-library-page-jump').textContent,'2 / 10');
        assert.equal(f.all('.slb-library-diary-toc .slb-library-index-item').length,5);
        assert.equal(f.q('[data-action="memory-menu"]'),null);
        assert.equal(f.stats.writes,0);
    } finally{f.dom.window.close()}
});

test('record ellipsis removes tag editing but retains save, translate, jump and image controls',async()=>{
    for(const type of ['general','memory','world','people']){
        const f=await fixture({type});
        try {
            await f.load();
            if(type==='general')f.click('[data-action="entry"][data-uid="0"]');
            if(type==='people')f.click('[data-action="entry"][data-uid="0"]');
            f.click('[data-action="more-tools"]');
            const actions=f.all('.slb-library-tools-popover:not([hidden]) [data-action]')
                .map(el=>el.dataset.action);
            assert.deepEqual(actions,['edit','translate','advanced','image-pick']);
            assert.equal(f.q('[data-action="tag-edit"]'),null);
            assert.ok(f.q('.slb-library-reader-book-tags .slb-library-book-meta'));
            assert.equal(f.stats.writes,0);
        } finally{f.dom.window.close()}
    }
});

test('book-level tag drafts are kept through page turns even after deleting record-level tag shortcut',async()=>{
    const f=await fixture({type:'world',n:48});
    try {
        await f.load();
        const input=f.q('#slb-library-book-tag-input');
        input.value='world,unsaved';
        input.dispatchEvent(new f.win.Event('input',{bubbles:true}));
        f.click('[data-action="world-next"]');
        assert.equal(f.q('#slb-library-book-tag-input'),input);
        assert.equal(input.value,'world,unsaved');
        assert.equal(f.stats.writes,0);
        f.click('[data-action="book-tag-save"]');
        await tick();
        assert.deepEqual(f.state.tags,['world','unsaved']);
        assert.equal(f.stats.writes,1);
    } finally{f.dom.window.close()}
});

test('narrow pager CSS forces separate non-overlapping rows and makes both selectors smaller',()=>{
    const part=css.slice(css.lastIndexOf('/* ambasa.64'));
    assert.match(part, /@container \(max-width: 420px\)/);
    assert.match(part, /\.slb-library-list-pages,[\s\S]*flex-wrap: wrap !important;/);
    assert.match(part, /\.slb-library-page-navigation\s*\{[^}]*flex: 0 0 100%;/s);
    assert.match(part, /select\.slb-library-page-size-select\s*\{[^}]*width: 72px !important;/s);
    assert.match(part, /select\.slb-library-order-select\s*\{[^}]*width: 88px !important;/s);
    assert.match(part, /\.slb-library-reader-frame \.slb-library-paged-list,[\s\S]*border: 0 !important;/s);
    assert.doesNotMatch(js,/function contentsHeading\(/);
    assert.doesNotMatch(js,/function toggleContents\(/);
});

test('record popover is narrowly capped and header/settings/menus outside library remain unchanged',()=>{
    const part=css.slice(css.lastIndexOf('/* ambasa.64'));
    assert.match(part,/\.slb-library-reader-tools > \.slb-library-tools-popover\s*\{[^}]*width: min\(146px,/s);
    assert.match(part,/max-width: 146px !important;/);
    assert.doesNotMatch(part,/#WorldInfo|\.world_entry\s*\{|\.mes_text/);
    assert.match(js,/menu\.append\(button\(doc, '', uiText\("로어북 바로가기"\)/);
    assert.doesNotMatch(js,/menu\.append\(button\(doc, '', (?:'태그 편집'|uiText\("태그 편집"\))/);
    assert.doesNotMatch(js,/setInterval\(/);
});

test('reverse/title sort and 240-item pagination still work without writing source data',async()=>{
    const f=await fixture({type:'world',n:240,sort:'title-asc'});
    try {
        await f.load();
        f.click('[data-action="world-last"]');
        assert.equal(f.q('.slb-library-page-jump').textContent,'48 / 48');
        f.click('[data-action="world-first"]');
        assert.equal(f.q('.slb-library-page-jump').textContent,'1 / 48');
        f.change('.slb-library-order-select','reverse');
        await tick();
        assert.equal(f.q('.slb-library-order-select').value,'reverse');
        assert.equal(JSON.stringify(f.data),f.before);
        assert.equal(f.stats.writes,0);
    }finally{f.dom.window.close()}
});
