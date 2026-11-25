const {test} = require('node:test');
const assert = require('node:assert/strict');
const {JSDOM} = require('jsdom');
const {join} = require('node:path');
const {pathToFileURL} = require('node:url');
const tick = () => new Promise(resolve => setImmediate(resolve));
async function fixture(count = 240, theme = 'antique', type = 'memory') {
    const {createStandaloneLibrary} = await import(pathToFileURL(join(__dirname,'../library-shelf.js')).href);
    const dom = new JSDOM('<body></body>', {pretendToBeVisual:true, url:'http://localhost'});
    const w = dom.window, doc = w.document;
    const books = ['A', 'B', 'C'];
    const make = book => ({entries:Object.fromEntries(Array.from({length:count},(_,uid)=>[uid,{
        uid, order:uid, comment:book+' '+uid, content:'source '+book+' '+uid, key:['key '+uid]
    }]))});
    const data = Object.fromEntries(books.map(book=>[book,make(book)]));
    let favorites = [], recent = null, translations = 0;
    const reads = [];
    const lib = createStandaloneLibrary({
        document:doc,listBooks:()=>books,linkedBooks:()=>new Set(books),
        loadBook:async book=>{reads.push(book);return structuredClone(data[book]);},
        loadTranslations:async()=>{},
        translationFor:(_book,entry)=>{translations++;return {text:'translation '+entry.uid,title:entry.comment};},
        getTheme:()=>theme,getType:()=>type,getListOrder:()=> 'title-desc',
        getFavorites:()=>favorites,setFavorites:async value=>{favorites=value;},
        getRecent:()=>recent,setRecent:value=>{recent=value;},
        notify:()=>{},
    });
    const q = selector=>doc.querySelector(selector);
    const click = selector=>{const node=q(selector);assert.ok(node,selector);node.click();};
    const input = (selector,value,composing=false)=>{
        const el=q(selector);el.value=value;el.focus();
        el.dispatchEvent(new w.InputEvent('input',{bubbles:true,isComposing:composing}));
    };
    return {w,doc,lib,data,reads,q,click,input,stats:()=>({favorites,recent,translations}),
        close:()=>{lib.close();w.close();}};
}
for (const count of [25,240]) test('shelf '+count+' entries: stable input/IME, no eager reads; unchanged resize and local detail update',async()=>{
    const f=await fixture(count);
    try{
        f.lib.open();
        const search=f.q('#slb-library-shelf-search'), shelf=f.q('.slb-library-bookshelf');
        f.input('#slb-library-shelf-search','B',true);
        assert.equal(f.q('.slb-library-bookshelf'),shelf);
        search.dispatchEvent(new f.w.CompositionEvent('compositionend',{bubbles:true}));
        assert.equal(f.q('#slb-library-shelf-search'),search);
        assert.equal(f.q('[data-action="select-book"]').dataset.book,'B');
        assert.equal(f.reads.length,0);
        const shelfAfter=f.q('.slb-library-bookshelf');
        f.w.dispatchEvent(new f.w.Event('resize'));
        assert.equal(f.q('.slb-library-bookshelf'),shelfAfter);
        f.click('[data-action="select-book"]');
        await tick();await tick();
        const toc=f.q('#slb-library-memory-toc'), frame=f.q('.slb-library-reader-frame');
        const n=f.stats().translations;
        f.click('[data-action="toggle-view"]');
        assert.equal(f.q('#slb-library-memory-toc'),toc);
        assert.equal(f.q('.slb-library-reader-frame'),frame);
        assert.ok(f.stats().translations-n<10);
        const detail=f.q('.slb-library-detail'), uid=detail.dataset.uid;
        const update=structuredClone(f.data.B);update.entries[uid].probability=90;
        f.lib.onExternalWorldUpdate('B',update);
        assert.equal(f.q('.slb-library-detail'),detail);
        update.entries[uid].content='new source';
        f.lib.onExternalWorldUpdate('B',update);
        assert.equal(f.q('#slb-library-memory-toc'),toc);
        assert.notEqual(f.q('.slb-library-detail'),detail);
        f.input('#slb-library-search','source B 1');
        assert.match(f.q('.slb-library-diary-page-number').textContent,new RegExp(' / '+String(count).padStart(2,'0')+'$'));
    }finally{f.close();}
});
test('favorites survive close, recent resumes exact UID, global search is explicitly on-demand',async()=>{
    const f=await fixture(25,'mac','general');
    try{
        f.lib.open();
        assert.deepEqual(f.reads,[]);
        f.click('[data-action="select-book"][data-book="C"]');
        await tick();await tick();
        f.click('[data-action="favorite-book"]');await tick();
        assert.deepEqual(f.stats().favorites,['C']);
        assert.equal(await f.lib.openEntry('C','4'),true);
        assert.equal(f.stats().recent.uid,'4');
        f.lib.close();f.lib.open();
        assert.equal(f.q('[data-action="select-book"]').dataset.book,'C');
        f.click('[data-action="resume-reading"]');await tick();await tick();
        assert.equal(f.q('.slb-library-detail').dataset.uid,'4');
        f.click('[data-action="books"]');
        const before=f.reads.length;
        f.click('[data-action="global-search"]');
        f.input('#slb-library-global-query','source B 7');
        assert.equal(f.reads.length,before);
        f.click('[data-action="run-global-search"]');await tick();await tick();
        const result=f.q('[data-action="global-result"]');
        assert.equal(result.dataset.book,'B');assert.equal(result.dataset.uid,'7');
        result.click();await tick();await tick();
        assert.equal(f.q('.slb-library-detail').dataset.uid,'7');
    }finally{f.close();}
});
test('native jump ignores old-book rows sharing a UID and navigates to the correct page',async()=>{
    const source=require('node:fs').readFileSync(join(__dirname,'../index.js'),'utf8');
    const fn=source.match(/^function openLibraryAdvanced\([^]*?^}/m)[0];
    const dom=new JSDOM('<select id="world_editor_select"><option value="0" selected>A</option><option value="1">B</option></select><div id="world_popup_entries_list"><div class="world_entry" data-uid="8"><div class="inline-drawer"></div></div></div><div id="world_info_pagination"></div>',{runScripts:'outside-only'});
    const w=dom.window,list=w.document.querySelector('#world_popup_entries_list'),select=w.document.querySelector('select');
    let plugin={initialized:true,model:{pageSize:5,pageNumber:1},currentPageData:[{uid:8}]};
    const calls=[], notifications=[];
    const addRow=uid=>{
        const row=w.document.createElement('div');row.className='world_entry';row.dataset.uid=String(uid);
        const drawer=w.document.createElement('div');drawer.className='inline-drawer';row.append(drawer);list.replaceChildren(row);
    };
    Object.assign(w,{state:{managerMode:'native'},currentBookName:()=>select.selectedOptions[0].textContent,
        isWorldInfoDrawerOpen:()=>true,getUid:r=>r.dataset.uid,getEntryDrawer:r=>r.querySelector('.inline-drawer'),
        isEntryDrawerOpen:()=>false,toggleDrawer:d=>d.dataset.open='yes',notify:(...args)=>notifications.push(args),
        loadWorldInfo:async()=>({entries:Object.fromEntries(Array.from({length:12},(_,uid)=>[uid,{uid}]))}),
        worldInfoFilter:{applyFilters:x=>x},sortWorldInfoEntries:x=>x,
        jQuery:()=>({data:()=>plugin,pagination:(action,page)=>{calls.push([action,page]);plugin.model.pageNumber=page;addRow(8);}})});
    w.eval(fn+'\nwindow.go=openLibraryAdvanced;');
    try{
        const old=list.querySelector('.inline-drawer');
        w.go('B','8');await tick();assert.equal(old.dataset.open,undefined);assert.deepEqual(calls,[]);
        plugin={initialized:true,model:{pageSize:5,pageNumber:1},currentPageData:[{uid:0}]};addRow(0);
        await tick();await tick();
        assert.deepEqual(calls,[['go',2]]);
        assert.equal(list.querySelector('.inline-drawer').dataset.open,'yes');
        assert.equal(old.dataset.open,undefined);assert.deepEqual(notifications,[]);assert.equal(w.state.libraryAdvancedCancel,null);
    }finally{w.state.libraryAdvancedCancel?.();w.close();}
});
