const {test}=require('node:test');
const assert=require('node:assert/strict');
const {readFileSync}=require('node:fs');
const {join}=require('node:path');
const {JSDOM}=require('jsdom');
const jquery=require('jquery');
const source=readFileSync(join(__dirname,'../index.js'),'utf8');
const css=readFileSync(join(__dirname,'../style.css'),'utf8');
const production=name=>{
    const match=source.match(new RegExp('^function '+name+'\\([^]*?^}','m'));
    assert.ok(match,'missing '+name);
    return match[0];
};
const appendEditorCSS=window=>{
    const matches=css.match(/#WorldInfo\.slb-active #world_popup_entries_list[^{]*\[data-slb-editor-pending="true"\][^{]*\{[^}]+\}/);
    assert.ok(matches,'only pending native editors should be hidden');
    const style=window.document.createElement('style');
    style.textContent=matches[0];
    window.document.head.append(style);
};

function bookFixture({count=25,editorFails=false}={}){
    const html='<div id="WorldInfo" class="slb-active"><div id="world_popup_entries_list">'
      +Array.from({length:count},(_,i)=>'<div class="world_entry" data-uid="'+i+'"'
       +' data-slb-header-enhanced="test" data-slb-display-ready="true"'
       +(i===0?' data-slb-drawer-open="true"':'')+'>'
       +'<div class="inline-drawer"><div class="inline-drawer-header"><i class="inline-drawer-icon '+(i===0?'up':'down')+'"></i></div>'
       +'<div class="inline-drawer-content" style="display:'+(i===0?'block':'none')+'"><div class="world_entry_edit">'
       +'<textarea name="content">original '+i+'</textarea></div></div></div></div>').join('')
      +'</div></div>';
    const dom=new JSDOM(html,{runScripts:'outside-only'});
    const w=dom.window,frames=[];
    w.requestAnimationFrame=callback=>{frames.push(callback);return frames.length};
    w.eval([
        'const VERSION="test";',
        'const rows=[...document.querySelectorAll(".world_entry")];',
        'const state={sorting:false,enhancing:false,enhancePending:false,enhanceRunId:0,enhanceChunkRaf:0,incompleteHeaderRetry:null,bookSwitch:null,tokenTimer:null,tokenIdleHandle:null,tokenRefreshRunId:0};',
        'const calls={head:0,metadata:0,edit:0,rects:0,revealed:0,display:0,layout:0,atReveal:null};',
        'const bindFoldyFolderDeleteDrawerGuards=()=>{};',
        'const isFoldyLinkedMode=()=>false;',
        'const markFoldyLinkedPreparing=()=>{};',
        'const ensureCriticalLayoutStyles=()=>{};',
        'const bindCombinedEntryToggle=()=>{};',
        'const createAIBar=()=>{};',
        'const createBulkLorebookExportControls=()=>{};',
        'const createWorkspace=()=>{};',
        'const syncNativePageCache=()=>{};',
        'const hideNativeHeaderRows=()=>{};',
        'const renderedEntries=()=>rows;',
        'const currentBookName=()=>"A";',
        'const isNarrowEntryLayout=()=>true;',
        'const getUid=entry=>entry.dataset.uid;',
        'const enhanceEntryHeader=()=>{calls.head++};',
        'const syncMetadataTranslations=()=>{calls.metadata++};',
        'const queryCompatible=(entry)=>entry.querySelector(".world_entry_edit");',
        'const isEntryDrawerOpen=entry=>entry.querySelector(".inline-drawer-icon").classList.contains("up");',
        'const isEntryEditorRendered=entry=>{calls.rects++;return entry.querySelector(".inline-drawer-content").style.display==="block"};',
        'const isEntryHeaderReadyForReveal=()=>true;',
        'const enhanceEntry=entry=>{calls.edit++;if('+editorFails+')return;entry.querySelector(".world_entry_edit").dataset.slbEnhanced=VERSION;};',
        'const applyMobileDisplaySettings=()=>{calls.display++};',
        'const syncAutoControls=()=>{};',
        'const scheduleInitialTokenSummary=()=>{};',
        'const revealCompletedEntryList=()=>{calls.revealed++;calls.atReveal=rows[0].dataset.slbEditorPending;return true;};',
        'const scheduleEnhance=()=>enhanceAll();',
        production('enhanceAll'),
        'window.api={run:enhanceAll,calls,rows,state};',
    ].join('\n'));
    return {dom,w,frames,api:w.api,flush(){let n=0;while(frames.length){if(++n>60)throw Error('unbounded frames');frames.shift()();}return n}};
}

test('already-open native editor does not flash when header list is revealed',()=>{
    const f=bookFixture();
    try {
        appendEditorCSS(f.w);
        const open=f.api.rows[0],closed=f.api.rows[1],edit=open.querySelector('.world_entry_edit');
        f.api.run();
        assert.equal(f.api.calls.atReveal,'true','pending marker exists before revealing headers');
        assert.equal(f.api.calls.edit,0,'editor conversion is still deferred');
        assert.equal(f.w.getComputedStyle(edit).visibility,'hidden','native form is not shown during scheduled work');
        assert.equal(closed.dataset.slbEditorPending,undefined,'closed rows are never hidden or hydrated');
        const frames=f.flush();
        assert.ok(frames>0,'existing frame scheduling remains');
        assert.equal(f.api.calls.edit,1);
        assert.equal(open.dataset.slbEditorPending,undefined,'marker cleared after enhancement');
        assert.equal(f.w.getComputedStyle(edit).visibility,'visible');
        assert.equal(f.api.calls.head,0,'already completed headers stay untouched');
        assert.equal(f.api.calls.layout,0,'no whole-book relayout');
        assert.equal(f.api.calls.rects,2,'only the open editor is checked in the existing header and edit passes');
    } finally {f.dom.window.close()}
});

test('failed editor conversion restores native form without a new retry loop',()=>{
    const f=bookFixture({editorFails:true});
    try{
        appendEditorCSS(f.w);
        const edit=f.api.rows[0].querySelector('.world_entry_edit');
        f.api.run();
        assert.equal(f.w.getComputedStyle(edit).visibility,'hidden');
        f.flush();
        assert.equal(f.api.rows[0].dataset.slbEditorPending,undefined);
        assert.equal(f.w.getComputedStyle(edit).visibility,'visible','native editor must remain usable after failure');
        assert.equal(f.frames.length,0,'no extra recovery frames');
    }finally{f.dom.window.close()}
});

test('native single-drawer open hides only its pending form and close always restores it',()=>{
    const dom=new JSDOM('<div id="WorldInfo" class="slb-active"><div id="world_popup_entries_list">'
     +'<div class="world_entry" data-slb-display-ready="true"><div class="inline-drawer">'
     +'<div class="inline-drawer-header"><i class="inline-drawer-icon up"></i></div>'
     +'<div class="inline-drawer-content"><div class="world_entry_edit">Original</div></div></div></div></div></div>',
     {runScripts:'outside-only'});
    const w=dom.window;
    w.jQuery=jquery(w);
    const frames=[],timers=[];
    w.requestAnimationFrame=callback=>{frames.push(callback);return frames.length};
    w.setTimeout=(callback,delay)=>{timers.push({callback,delay});return timers.length};
    w.eval([
        'const VERSION="test";',
        'const state={closingEntryDrawers:new WeakSet(),entryFilterRefreshPending:false,bulkOpeningDrawers:false};',
        'const getEntryDrawer=entry=>entry.querySelector(".inline-drawer");',
        'const getResponsiveHeaderFields=()=>[];',
        'const isEntryDrawerOpen=entry=>entry.querySelector(".inline-drawer-icon").classList.contains("up");',
        'const isEntryEditorRendered=()=>true;',
        'const queryCompatible=(entry)=>entry.querySelector(".world_entry_edit");',
        'let enhanced=0,layout=0;',
        'const enhanceEntry=entry=>{enhanced++;const edit=entry.querySelector(".world_entry_edit");edit.dataset.slbEnhanced=VERSION;const tab=document.createElement("div");tab.className="slb-tabbar";edit.append(tab);};',
        'const placeResponsiveHeaderFields=()=>{layout++};',
        production('bindEntryDrawerLifecycle'),
        'window.api={bind:bindEntryDrawerLifecycle,counts:()=>({enhanced,layout})};',
    ].join('\n'));
    try{
        appendEditorCSS(w);
        const row=w.document.querySelector('.world_entry');
        const edit=row.querySelector('.world_entry_edit');
        const drawer=row.querySelector('.inline-drawer');
        w.api.bind(row);
        w.jQuery(drawer).trigger('inline-drawer-toggle');
        assert.equal(row.dataset.slbEditorPending,'true');
        assert.equal(w.getComputedStyle(edit).visibility,'hidden');
        assert.equal(w.api.counts().enhanced,0);
        assert.equal(frames.length,1,'same single animation frame as before');
        frames.shift()();
        assert.equal(w.api.counts().enhanced,1);
        assert.equal(row.dataset.slbEditorPending,undefined);
        assert.equal(w.getComputedStyle(edit).visibility,'visible');
        assert.equal(timers.length,0,'no extra timeouts');
        drawer.querySelector('i').classList.replace('up','down');
        w.jQuery(drawer).trigger('inline-drawer-toggle');
        assert.equal(row.dataset.slbEditorPending,undefined,'closing never leaves invisible editor');
    }finally{w.close()}
});

test('25 and 240 rows keep the existing two checks for the single open editor',()=>{
    for(const count of [25,240]){
        const f=bookFixture({count});
        try{
            f.api.run();
            assert.equal(f.api.calls.edit,0);
            assert.equal(f.api.calls.rects,1);
            assert.equal(f.api.rows.filter(row=>row.dataset.slbEditorPending).length,1);
            f.flush();
            assert.equal(f.api.calls.edit,1);
            assert.equal(f.api.calls.rects,2,'closed editors do not get visibility/layout probes');
            assert.equal(f.api.calls.head,0,'other completed headers stay untouched');
            assert.equal(f.api.calls.metadata,0);
            assert.equal(f.api.calls.layout,0);
            assert.equal(f.api.rows.filter(row=>row.dataset.slbEditorPending).length,0);
        }finally{f.dom.window.close()}
    }
});

test('book change clears old editor marker in the existing row-invalidation scan',()=>{
    const dom=new JSDOM('<div id="world_popup_entries_list"><div class="world_entry" data-slb-display-ready="true" data-slb-editor-pending="true"></div></div>',
        {runScripts:'outside-only'});
    const w=dom.window;
    w.eval([
        'const state={bulkTranslation:null,bulkEditorHydrationRaf:0,bulkEditorHydrationQueue:[],bulkEditorHydrationHead:0,bulkOpeningDrawers:false,incompleteHeaderRetry:null,bookSwitch:null,bookSwitchRunId:0,enhanceRunId:0,enhanceChunkRaf:0,enhancing:false,enhancePending:false,currentBook:"Old",managerMode:"standard",pendingBookSwitch:""};',
        'let scans=0;',
        'const entryBulkEditor={reset:()=>{}};',
        'const currentBookName=()=>"New";',
        'const renderedEntries=()=>{scans++;return [...document.querySelectorAll(".world_entry")]};',
        'const loadTranslationBook=()=>{};',
        'const cancelAnimationFrame=()=>{};',
        'const clearTimeout=()=>{};',
        'const isFoldyLinkedMode=()=>false;',
        'const setBookSwitchLoading=()=>{};',
        'const markFoldyLinkedPreparing=()=>{};',
        'const captureBookSwitchBoundary=()=>({capturedAt:Date.now(),mode:"standard",book:"Old",previousRows:[],previousRowSet:new Set(),previousRowSnapshot:[],previousHeader:null});',
        'const scheduleBookSwitchReadyCheck=()=>{};',
        'const scheduleEnhance=()=>{};',
        'const releaseNativePageCache=()=>{};',
        production('beginBookSwitch'),
        'window.api={run:beginBookSwitch,read:()=>scans};',
    ].join('\n'));
    try{
        w.api.run('New');
        const row=w.document.querySelector('.world_entry');
        assert.equal(row.dataset.slbEditorPending,undefined);
        assert.equal(row.dataset.slbDisplayReady,undefined);
        assert.equal(w.api.read(),1,'reuse existing book-switch row scan, no extra scan');
    }finally{w.close()}
});
