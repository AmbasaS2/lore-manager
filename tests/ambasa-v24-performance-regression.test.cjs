const {test} = require('node:test');
const assert = require('node:assert/strict');
const {readFileSync} = require('node:fs');
const {join} = require('node:path');
const {JSDOM} = require('jsdom');

const source = readFileSync(join(__dirname,'../index.js'),'utf8');
function func(name) {
    const found = source.match(new RegExp('^function ' + name + '\\([^]*?^}', 'm'));
    assert.ok(found, 'missing production '+name);
    return found[0];
}

function fixture({count=240, readyCount=count-1}={}) {
    const VERSION='1.4.85-ambasa.24';
    const html='<div id="world_popup_entries_list">'
       +Array.from({length:count},(_,i)=>'<div class="world_entry" data-uid="'+i+'"'
          +(i<readyCount?' data-slb-header-enhanced="'+VERSION+'" data-slb-display-ready="true"':'')
          +'><div class="world_entry_edit"></div></div>').join('')
       +'</div>';
    const dom=new JSDOM(html,{runScripts:'outside-only'});
    const w=dom.window;
    const frames=[];
    w.requestAnimationFrame=callback=>{frames.push(callback);return frames.length};
    w.eval([
        'const VERSION="1.4.85-ambasa.24";',
        'const rows=[...document.querySelectorAll(".world_entry")];',
        'const state={sorting:false,enhancing:false,enhancePending:false,enhanceRunId:0,enhanceChunkRaf:0,incompleteHeaderRetry:null,bookSwitch:null,tokenTimer:null,tokenIdleHandle:null,tokenRefreshRunId:0};',
        'const calls={enhance:0,metadata:0,fullLayout:0,editorRects:0,drawerChecks:0,display:0,revealed:0};',
        'const bindFoldyFolderDeleteDrawerGuards=()=>{};',
        'const isFoldyLinkedMode=()=>false;',
        'const markFoldyLinkedPreparing=()=>{};',
        'const ensureCriticalLayoutStyles=()=>{};',
        'const bindCombinedEntryToggle=()=>{};',
        'const createAIBar=()=>{};',
        'const createBulkLorebookExportControls=()=>{};',
        'const createWorkspace=()=>{};',
        'const hideNativeHeaderRows=()=>{};',
        'const renderedEntries=()=>rows;',
        'const currentBookName=()=>"B";',
        'const isNarrowEntryLayout=()=>true;',
        'const getUid=e=>e.dataset.uid;',
        'const enhanceEntryHeader=(e,options)=>{calls.enhance++;if(!options?.initialCompact)throw Error("noncompact row");e.dataset.slbHeaderEnhanced=VERSION;};',
        'const syncMetadataTranslations=()=>{calls.metadata++};',
        'const queryCompatible=(e)=>e.querySelector(".world_entry_edit");',
        'const isEntryDrawerOpen=()=>{calls.drawerChecks++;return false};',
        'const isEntryEditorRendered=()=>{calls.editorRects++;return true};',
        'const isEntryHeaderReadyForReveal=e=>e.dataset.slbHeaderEnhanced===VERSION;',
        'const applyMobileDisplaySettings=()=>{calls.display++};',
        'const syncResponsiveEntryLayouts=()=>{calls.fullLayout++};',
        'const syncFilterButtons=()=>{};',
        'const syncAutoControls=()=>{};',
        'const scheduleInitialTokenSummary=()=>{};',
        'const revealCompletedEntryList=()=>{if(rows.every(isEntryHeaderReadyForReveal)){calls.revealed++;return true;}return false;};',
        'const scheduleEnhance=()=>enhanceAll();',
        func('enhanceAll'),
        'window.api={run:enhanceAll,rows,calls,state};',
    ].join('\n'));
    const flush=()=>{
        let framesProcessed=0;
        while(frames.length){
            if(++framesProcessed>200)throw Error('unbounded enhancement RAF recursion');
            frames.shift()();
        }
        return framesProcessed;
    };
    return {w,dom,flush,api:w.api};
}

test('one late native row no longer rerenders 239 already completed rows',()=>{
    const f=fixture();
    try{
        f.api.run();
        f.flush();
        assert.equal(f.api.calls.enhance,1,'only the new row is processed');
        assert.equal(f.api.calls.metadata,1,'metadata sync is local to that row');
        assert.equal(f.api.calls.fullLayout,0,'no second full-book layout pass');
        assert.equal(f.api.calls.editorRects,0,'closed editor DOM does not getClientRects');
        assert.equal(f.api.calls.revealed,1);
        assert.equal(f.api.state.enhancing,false);
        assert.equal(f.api.rows[239].dataset.slbDisplayReady,'true');
        f.api.run();
        f.flush();
        assert.equal(f.api.calls.enhance,1,'a stable second pass is a no-op for every header');
        assert.equal(f.api.calls.metadata,1,'stable pass does not repaint translations');
        assert.equal(f.api.calls.fullLayout,0);
        assert.equal(f.api.calls.editorRects,0);
    }finally{f.dom.window.close()}
});

test('new rows on desktop follow compact path without forced closed-row visibility reads',()=>{
    const f=fixture({count:240,readyCount:0});
    try{
        f.api.run();
        const frames=f.flush();
        assert.equal(f.api.calls.enhance,240);
        assert.equal(f.api.calls.metadata,240);
        assert.equal(f.api.calls.editorRects,0);
        assert.equal(f.api.calls.fullLayout,0);
        assert.ok(frames>0,'large first render still yields between bounded batches');
        assert.equal(f.api.calls.revealed,1);
    }finally{f.dom.window.close()}
});

test('book-switch timeout waits for real native mutation instead of 16ms resnapshot polling',()=>{
    const due=[];
    const clock={now:()=>50};
    let scans=0;
    const transition={book:'B',ready:false,startedAt:0,readyCandidate:null,timer:null,mode:'standard'};
    const ctx={
        state:{bookSwitch:transition,navigatorDirty:false,sorting:false,enhancing:false},
        Date:clock,
        currentBookName:()=> 'B',
        setTimeout(callback,delay){due.push({callback,delay});return due.length;},
        clearTimeout(){},
        isCurrentBookDomReady(){scans++;return false;},
        finishWorldDrawerOpenLoading(){},
        setBookSwitchLoading(){},
        scheduleEnhance(){},
        enhanceAll(){},
        MANAGER_MODE_STANDARD:'standard',
        console,
    };
    const vm=require('node:vm');
    vm.runInNewContext(func('scheduleBookSwitchReadyCheck')
        +'\nglobalThis.schedule=scheduleBookSwitchReadyCheck;',ctx);
    ctx.schedule();
    const first=due.shift();
    assert.equal(first.delay,0,'initial ready check is immediate');
    first.callback();
    assert.equal(due[0].delay,120,'without a native candidate do not scan every 16ms');
    assert.equal(scans,1);
    transition.readyCandidate={};
    due.shift().callback();
    assert.equal(due[0].delay,16,'only a concrete candidate gets one quick confirmation frame');
});

test('bulk expand creates exactly one bounded hydration queue, never 25 heavy callbacks in one frame',()=>{
    const vm=require('node:vm');
    const frames=[];
    const state={bulkEditorHydrationQueue:[],bulkEditorHydrationHead:0,bulkEditorHydrationRaf:0};
    let hydrated=0,clock=0;
    const ctx={
        state,
        performance:{now(){return clock++}},
        requestAnimationFrame(callback){frames.push(callback);return frames.length+10;},
        console,
    };
    vm.runInNewContext(func('enqueueBulkEditorHydration')
        +'\nglobalThis.enqueue=enqueueBulkEditorHydration;',ctx);
    for(let i=0;i<25;i++)ctx.enqueue(()=>{hydrated++});
    assert.equal(frames.length,1,'all 25 share a single scheduled callback');
    assert.equal(hydrated,0,'native click handler stays cheap');
    let count=0;
    while(frames.length){
        const before=hydrated;
        frames.shift()();
        assert.ok(hydrated-before<=3,'no frame builds more than three editor panels');
        if(++count>50)throw Error('queue did not drain');
    }
    assert.equal(hydrated,25);
    assert.equal(state.bulkEditorHydrationQueue.length,0);
    assert.equal(state.bulkEditorHydrationRaf,0);
});

test('switching books cancels stale editor hydration without modifying native data',()=>{
    const w=new JSDOM('<div id="world_popup_entries_list"><div class="world_entry" data-slb-display-ready="true"></div></div>',
        {runScripts:'outside-only'}).window;
    const setup=[
      "const MANAGER_MODE_STANDARD='standard', MANAGER_MODE_FOLDY='foldy';",
      "const rows=[...document.querySelectorAll('.world_entry')];",
      "const state={bulkTranslation:null,bulkEditorHydrationRaf:17,bulkEditorHydrationQueue:[()=>{}],bulkEditorHydrationHead:0,bulkOpeningDrawers:true,incompleteHeaderRetry:null,bookSwitch:null,bookSwitchRunId:0,enhanceRunId:0,enhanceChunkRaf:0,enhancing:false,enhancePending:false,currentBook:'Old',managerMode:'standard',pendingBookSwitch:'',bulkTranslation:null};",
      "const cancellations=[];",
      "const cancelAnimationFrame=id=>cancellations.push(id);",
      "const clearTimeout=()=>{};",
      "const entryBulkEditor={reset:()=>{}};",
      "const currentBookName=()=>'New';",
      "const renderedEntries=()=>rows;",
      "const captureBookSwitchBoundary=()=>({mode:'standard',capturedAt:Date.now(),book:'Old',previousRows:rows,previousRowSet:new Set(rows),previousRowSnapshot:[],previousHeader:null});",
      "const setBookSwitchLoading=()=>{};",
      "const scheduleEnhance=()=>{};",
      "const scheduleBookSwitchReadyCheck=()=>{};",
      "const isFoldyLinkedMode=()=>false;",
      "const markFoldyLinkedPreparing=()=>{};",
      func('beginBookSwitch'),
      "window.api={run:beginBookSwitch,rows,state,cancellations};",
    ].join('\n');
    w.eval(setup);
    try{
      w.api.run('New');
      assert.equal(w.api.rows[0].dataset.slbDisplayReady,undefined,
        'reused row must not preserve old book display');
      assert.deepEqual([...w.api.cancellations],[17]);
      assert.equal(w.api.state.bulkEditorHydrationQueue.length,0);
      assert.equal(w.api.state.bulkEditorHydrationRaf,0);
      assert.equal(w.api.state.bulkOpeningDrawers,false);
      w.api.state.currentBook='New';
      w.api.rows[0].dataset.slbDisplayReady='true';
      w.api.run('New');
      assert.equal(w.api.rows[0].dataset.slbDisplayReady,'true',
        'same book must not lose a completed marker');
      assert.match(source,/const nativeReplacement = node\.matches\(/,
        'a replaced native header explicitly invalidates its own row');
    }finally{w.close()}
});

test('native expand-all immediately toggles 25 real drawer events while UI work stays frame-bounded',()=>{
    const jquery=require('jquery');
    const dom=new JSDOM('<div id="WorldInfo"><button id="OpenAllWIEntries"></button><button id="CloseAllWIEntries"></button>'
       +'<div id="world_popup_entries_list">'
       +Array.from({length:25},(_,i)=>'<div class="world_entry" data-uid="'+i+'">'
           +'<div class="inline-drawer"><div class="inline-drawer-header"><i class="inline-drawer-icon down"></i></div>'
           +'<div class="inline-drawer-content" style="display:none"><div class="world_entry_edit"></div></div>'
           +'</div></div>').join('')
       +'</div></div>',{runScripts:'outside-only',pretendToBeVisual:true});
    const w=dom.window;
    w.jQuery=jquery(w);
    const frames=[];
    w.requestAnimationFrame=callback=>{frames.push(callback);return frames.length+1;};
    w.setTimeout=()=>0;
    const setup=[
      "const VERSION='test';",
      "const state={bulkOpeningDrawers:false,bulkEditorHydrationQueue:[],bulkEditorHydrationHead:0,bulkEditorHydrationRaf:0,closingEntryDrawers:new WeakSet(),entryFilterRefreshPending:false};",
      "let nativeToggles=0,hydrated=0;",
      "const getEntryDrawer=entry=>entry.querySelector('.inline-drawer');",
      "const getResponsiveHeaderFields=()=>[];",
      "const isEntryDrawerOpen=entry=>entry.querySelector('.inline-drawer-icon').classList.contains('up');",
      "const isEntryEditorRendered=entry=>entry.querySelector('.inline-drawer-content').style.display==='block';",
      "const queryCompatible=(entry,selectors)=>entry.querySelector(Array.isArray(selectors)?selectors[0]:selectors);",
      "const createElement=(tag,cls)=>{const el=document.createElement(tag);el.className=cls;return el;};",
      "const enhanceEntry=entry=>{hydrated++;const edit=entry.querySelector('.world_entry_edit');edit.dataset.slbEnhanced=VERSION;const bar=document.createElement('div');bar.className='slb-tabbar';edit.append(bar);};",
      "const placeResponsiveHeaderFields=()=>{};",
      "const toggleDrawer=(drawer,open)=>{nativeToggles++;drawer.querySelector('.inline-drawer-icon').classList.toggle('up',open);drawer.querySelector('.inline-drawer-content').style.display=open?'block':'none';drawer.dispatchEvent(new CustomEvent('inline-drawer-toggle',{bubbles:true}));};",
      func('enqueueBulkEditorHydration'),
      func('bindEntryDrawerLifecycle'),
      func('bindCombinedEntryToggle'),
      "window.api={bindEntryDrawerLifecycle,bindCombinedEntryToggle,read:()=>({nativeToggles,hydrated,queued:state.bulkEditorHydrationQueue.length})};",
    ].join('\n');
    w.eval(setup);
    try {
        w.document.querySelectorAll('.world_entry').forEach(row=>w.api.bindEntryDrawerLifecycle(row));
        w.api.bindCombinedEntryToggle();
        w.document.getElementById('slb-toggle-all-entries').click();
        assert.equal(w.api.read().nativeToggles,25,'all native controls open synchronously');
        assert.equal(w.api.read().hydrated,0,'no heavy editor work blocks the click');
        assert.equal(w.api.read().queued,25);
        assert.equal(frames.length,1,'only one RAF is scheduled for all 25 editors');
        let iterations=0;
        while(frames.length){
            const before=w.api.read().hydrated;
            frames.shift()();
            const added=w.api.read().hydrated-before;
            assert.ok(added<=3,'at most three editors hydrate in a frame');
            if(++iterations>30)throw Error('unbounded bulk work');
        }
        assert.equal(w.api.read().hydrated,25);
        assert.equal(w.api.read().queued,0);
        w.document.getElementById('slb-toggle-all-entries').click();
        assert.equal(w.api.read().nativeToggles,50,'native close remains immediate');
    }finally{w.close()}
});
