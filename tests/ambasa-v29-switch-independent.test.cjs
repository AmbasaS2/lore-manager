'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {readFileSync}=require('node:fs');
const {join}=require('node:path');
const {JSDOM}=require('jsdom');

const source=readFileSync(join(__dirname,'../index.js'),'utf8');
function prod(name){
    const match=source.match(new RegExp('^function '+name+'\\([^]*?^}', 'm'));
    assert.ok(match,'missing production function: '+name);
    return match[0];
}
function fixture(independent=true) {
    const dom=new JSDOM('<div id="WorldInfo" class="slb-active"><select id="world_editor_select">'
        +'<option value="a">A</option><option value="b">B</option><option value="c">C</option>'
        +'</select><div id="world_popup_entries_list">'
        +'<div id="WIEntryHeaderTitlesPC"></div><div class="world_entry" data-uid="0">'
        +'<textarea name="comment">A title</textarea></div></div></div>',
        {runScripts:'outside-only'});
    const w=dom.window;
    let nextTimer=0;
    const pending=new Map();
    w.setTimeout=callback=>{const id=++nextTimer;pending.set(id,callback);return id;};
    w.clearTimeout=id=>pending.delete(id);
    w.eval([
        "const MANAGER_MODE_STANDARD='standard', MANAGER_MODE_FOLDY='foldy';",
        "const state={currentBook:'A',managerMode:'standard',bulkTranslation:{book:'A',independent:"
            +independent+",cancelled:false,abortController:new AbortController()},"
            +"bulkEditorHydrationRaf:0,bulkEditorHydrationQueue:[],bulkEditorHydrationHead:0,"
            +"bulkOpeningDrawers:false,incompleteHeaderRetry:null,bookSwitch:null,"
            +"bookSwitchRunId:0,enhanceRunId:0,enhanceChunkRaf:0,enhancing:false,enhancePending:false};",
        "let cancellations=0,enhances=0,translationLoads=0;",
        "const currentBookName=()=>document.getElementById('world_editor_select').selectedOptions[0].textContent;",
        "const renderedEntries=()=>[...document.querySelectorAll('#world_popup_entries_list > .world_entry')];",
        "const getUid=entry=>entry.dataset.uid;",
        "const loadTranslationBook=()=>{translationLoads++};",
        "const entryBulkEditor={reset:()=>{}};",
        "const isFoldyLinkedMode=()=>false;",
        "const markFoldyLinkedPreparing=()=>{};",
        "const finishWorldDrawerOpenLoading=()=>{};",
        "const hydrateCurrentBookDataAfterReveal=()=>{};",
        "const cancelBulkTranslation=()=>{cancellations++;state.bulkTranslation.cancelled=true;"
            +"state.bulkTranslation.abortController.abort();state.bulkTranslation=null;};",
        "const cancelAnimationFrame=()=>{};",
        "const scheduleEnhance=()=>enhanceAll();",
        "const isEntryHeaderReadyForReveal=entry=>entry.dataset.slbHeaderEnhanced==='yes';",
        "const enhanceAll=()=>{enhances++;for(const row of renderedEntries()){"
            +"row.dataset.slbHeaderEnhanced='yes';row.dataset.slbDisplayReady='true';}"
            +"revealCompletedEntryList(currentBookName(),renderedEntries());};",
        prod('setBookSwitchLoading'),
        prod('bookSwitchTitleControl'),
        prod('bookSwitchStateControl'),
        prod('snapshotBookSwitchRows'),
        prod('sameBookSwitchRowSnapshot'),
        prod('captureBookSwitchBoundary'),
        prod('bookSwitchRowsChanged'),
        prod('isStableBookSwitchCandidate'),
        prod('isCurrentBookDomReady'),
        prod('scheduleBookSwitchReadyCheck'),
        prod('beginBookSwitch'),
        prod('finishBookSwitch'),
        prod('revealCompletedEntryList'),
        "window.api={state,begin:beginBookSwitch,boundary:captureBookSwitchBoundary,"
            +"schedule:scheduleBookSwitchReadyCheck,counts:()=>({cancellations,enhances,translationLoads})};",
    ].join('\n'));
    function nextTick(){
        assert.ok(pending.size,'missing scheduled transition check');
        const [id,callback]=pending.entries().next().value;
        pending.delete(id);
        callback();
    }
    function switchTo(book){
        const boundary=w.api.boundary();
        w.document.getElementById('world_editor_select').value=book.toLowerCase();
        w.api.begin(book,boundary);
    }
    function nativeRender(book){
        w.document.getElementById('world_popup_entries_list').innerHTML=
            '<div id="WIEntryHeaderTitlesPC"></div>'
            +'<div class="world_entry" data-uid="0">'
            +'<textarea name="comment">'+book+' title</textarea></div>';
        const transition=w.api.state.bookSwitch;
        transition.domMutationObserved=true;
        transition.domMutationVersion++;
        transition.readyCandidate=null;
        w.api.schedule(0);
    }
    return {w,dom,nextTick,switchTo,nativeRender,pending,api:w.api};
}

test('A -> B -> C while independent translation runs: job survives and C becomes visible',()=>{
    const f=fixture(true);
    try {
        const originalJob=f.api.state.bulkTranslation;
        f.switchTo('B');
        assert.equal(f.api.state.bulkTranslation,originalJob,'switch cannot cancel independent job');
        assert.equal(originalJob.abortController.signal.aborted,false);
        assert.ok(f.w.document.getElementById('WorldInfo').classList.contains('slb-book-switching'));
        f.switchTo('C');
        f.nativeRender('C');
        for(let index=0;index<4 && f.api.state.bookSwitch;index++)f.nextTick();
        assert.equal(f.api.state.bookSwitch,null,'native C render must settle switch');
        assert.equal(f.api.state.bulkTranslation,originalJob);
        assert.equal(f.api.counts().cancellations,0);
        assert.ok(f.api.counts().enhances>0);
        assert.equal(f.w.document.getElementById('WorldInfo').classList.contains('slb-book-switching'),false);
        assert.equal(f.w.document.getElementById('world_popup_entries_list').hasAttribute('aria-busy'),false);
        assert.equal(f.w.document.querySelector('.world_entry textarea').value,'C title');
    }finally{f.dom.window.close()}
});

test('display-bound translation still cancels on book switch',()=>{
    const f=fixture(false);
    try{
        f.switchTo('B');
        assert.equal(f.api.counts().cancellations,1);
        assert.equal(f.api.state.bulkTranslation,null);
    }finally{f.dom.window.close()}
});
