const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const vm = require('node:vm');
const { JSDOM } = require('jsdom');

const src = readFileSync(join(__dirname, '..', 'index.js'), 'utf8');
const helper = readFileSync(join(__dirname, '..', 'native-page-cache.js'), 'utf8');
const fn = name => {
    const match = src.match(new RegExp('^function ' + name + '\\([^]*?^}', 'm'));
    assert.ok(match, name + ' must exist in production');
    return match[0];
};

function fixture() {
    const dom = new JSDOM('<!doctype html><html><body>' +
        '<select id="world_info_sort_order"><option value="a">A</option><option value="z">Z</option></select>' +
        '<input id="world_info_search">' +
        '<div id="world_info_pagination"></div><div id="world_popup_entries_list"></div>' +
        '</body></html>', { pretendToBeVisual: true });
    const doc = dom.window.document;
    const plugin = { initialized: true, model: { pageNumber: 1, pageSize: 5, totalNumber: 25 } };
    const model = {plugin, book:'Book A', mode:'standard', foldy:false, open:true, filter:'all', data:{entries:{}}};
    const stats = {attach:0,dispose:0,signatures:[]};
    const pager={data: () => model.plugin};
    const list={0:doc.querySelector('#world_popup_entries_list'),length:1};
    const state={
        managerMode:'standard',currentBook:'Book A',currentBookData:model.data,
        bookSwitch:null,worldDrawerOpening:false,sorting:false,enhancing:false,
        nativePageCache:null,
    };
    const ctx = {
        document:doc, state, MANAGER_MODE_STANDARD:'standard',
        currentBookName:()=>model.book,
        getSettings:()=>({entryFilter:model.filter}),
        isFoldyLinkedMode:()=>model.foldy,
        isWorldInfoDrawerOpen:()=>model.open,
        jQuery: selector=> selector==='#world_info_pagination'?pager:list,
        attachNativePageCache(args){
            stats.attach++;
            const created={
                book:args.book,list:args.list[0],paginationData:model.plugin,
                dispose(){stats.dispose++},invalidate(){},markDirty(){},
            };
            stats.signatures.push(args.signature());
            return created;
        },
    };
    vm.runInNewContext([fn('releaseNativePageCache'),fn('nativePageSignature'),
        fn('syncNativePageCache'),'globalThis.API={syncNativePageCache,releaseNativePageCache,nativePageSignature}'].join('\n'),ctx);
    return {dom,doc,model,stats,state,api:ctx.API};
}
test('same-book stable pagination binds only one session; native replacement recreates it',()=>{
    const f=fixture();try{
        f.api.syncNativePageCache();f.api.syncNativePageCache();f.api.syncNativePageCache();
        assert.equal(f.stats.attach,1);
        assert.equal(f.stats.dispose,0);
        f.model.plugin={initialized:true,model:{pageNumber:2,pageSize:5,totalNumber:25}};
        f.api.syncNativePageCache();
        assert.equal(f.stats.attach,2);
        assert.equal(f.stats.dispose,1,'prior hook detached from replaced plugin');
        assert.equal(f.state.nativePageCache.paginationData,f.model.plugin);
    }finally{f.dom.window.close()}
});
test('book change or Foldy/native mode disengages page cache immediately',()=>{
    const f=fixture();try{
        f.api.syncNativePageCache();
        f.model.book='Book B';
        f.api.syncNativePageCache();
        assert.equal(f.stats.dispose,1);
        assert.equal(f.state.nativePageCache,null);
        f.model.book='Book A';
        f.api.syncNativePageCache();
        assert.equal(f.stats.attach,2);
        f.model.foldy=true;
        f.api.syncNativePageCache();
        assert.equal(f.stats.dispose,2);
        f.model.foldy=false;
        f.api.syncNativePageCache();
        assert.equal(f.stats.attach,3);
        f.state.managerMode='native';
        f.api.syncNativePageCache();
        assert.equal(f.stats.dispose,3);
    }finally{f.dom.window.close()}
});
test('sorting/drawer closing/pending book switch guard native event path',()=>{
    const f=fixture();try{
        const cases=['sorting','worldDrawerOpening','bookSwitch'];
        for(const key of cases){
            f.api.syncNativePageCache();assert.ok(f.state.nativePageCache);
            f.state[key]=key==='bookSwitch'?{ready:false}:true;
            f.api.syncNativePageCache();
            assert.equal(f.state.nativePageCache,null,key+' must refuse cache');
            f.state[key]=key==='bookSwitch'?null:false;
        }
        f.api.syncNativePageCache();f.model.open=false;
        f.api.syncNativePageCache();
        assert.equal(f.state.nativePageCache,null);
        assert.equal(f.stats.dispose,4);
    }finally{f.dom.window.close()}
});
test('native cache signature changes with search, sort, entry filter and book',()=>{
    const f=fixture();try{
        const a=f.api.nativePageSignature();
        f.doc.querySelector('#world_info_search').value='special';
        const b=f.api.nativePageSignature();assert.notEqual(b,a);
        f.doc.querySelector('#world_info_sort_order').value='z';
        const c=f.api.nativePageSignature();assert.notEqual(c,b);
        f.model.filter='normal';
        const d=f.api.nativePageSignature();assert.notEqual(d,c);
        f.model.book='Book Z';
        assert.notEqual(f.api.nativePageSignature(),d);
    }finally{f.dom.window.close()}
});
test('existing row input/change and kill-state updates invalidate any cached pages',()=>{
    const body=fn('handleWorkspaceEntryInput');
    assert.match(body,/state\.nativePageCache\?\.markDirty\(\)/);
    assert.match(fn('handleWorkspaceEntryClick'),/state\.nativePageCache\?\.markDirty\(\)/);
    const dom=new JSDOM('<div class="world_entry" data-uid="19"><textarea name="content"></textarea></div>');
    const entry=dom.window.document.querySelector('.world_entry'),input=entry.querySelector('textarea');
    const state={nativePageCache:{markDirty(){calls++}}};
    let calls=0,tokens=0;
    const ctx={state,Element:dom.window.Element,getUid:()=>19,
        scheduleEntryTokenCount(){tokens++},
        scheduleEntryInjectionStateSync(){throw Error('not a selector')},
        currentBookName:()=> 'Book A'};
    vm.runInNewContext(body+'\nglobalThis.handle=handleWorkspaceEntryInput',ctx);
    ctx.handle({target:input,type:'input'});
    assert.equal(calls,1);assert.equal(tokens,1);
    ctx.handle({target:input,type:'change'});
    assert.equal(calls,2);
    dom.window.close();
});
test('integration makes no extra observers, timers, ST file writes, or native row reparenting',()=>{
    const integration=fn('syncNativePageCache')+'\n'+fn('nativePageSignature')+'\n'+fn('releaseNativePageCache');
    assert.match(integration,/state\.currentBookData === bookData/);
    assert.match(integration,/maxPages:\s*2, maxRows:\s*50/);
    assert.match(integration,/!state\.bulkTranslation && !state\.backupRestoreInProgress/);
    assert.doesNotMatch(integration,/setInterval\(|setTimeout\(|new MutationObserver\(|requestAnimationFrame\(|saveWorldInfo\(|loadWorldInfo\(/);
    assert.match(fn('beginBookSwitch'),/releaseNativePageCache\(\)/);
    assert.match(src,/function applyManagerMode\([\s\S]*?if \(requestedMode !== MANAGER_MODE_STANDARD[\s\S]*?releaseNativePageCache\(\)/);
    assert.match(src,/eventSource\.on\(event_types\.WORLDINFO_UPDATED,[\s\S]*?if \(name === currentBookName\(\)\) releaseNativePageCache\(\)/);
    assert.match(src,/if \(listRevealed\) \{\s*syncNativePageCache\(\)/);
    assert.doesNotMatch(helper,/setInterval\(|setTimeout\(|new MutationObserver\(|requestAnimationFrame\(|fetch\(/);
});
