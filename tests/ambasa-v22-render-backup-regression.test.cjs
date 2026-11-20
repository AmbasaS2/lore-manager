const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { JSDOM } = require('jsdom');
const vm = require('node:vm');

const source = readFileSync(join(__dirname, '../index.js'), 'utf8');
const css = readFileSync(join(__dirname, '../style.css'), 'utf8');
function prod(name) {
    const match = source.match(new RegExp('^(?:async )?function ' + name + '\\([^]*?^}', 'm'));
    assert.ok(match, 'missing function: ' + name);
    return match[0];
}

test('even a pre-marked fast batch never exposes a partly native row list', () => {
    const dom = new JSDOM('<div id="world_popup_entries_list">'
      + '<div class="world_entry" data-ready="yes"></div>'
      + '<div class="world_entry" data-ready="yes"></div>'
      + '<div class="world_entry" data-ready="no"></div>'
      + '</div>', {runScripts:'outside-only'});
    const rows = [...dom.window.document.querySelectorAll('.world_entry')];
    const events = [];
    const ctx = {
        document:dom.window.document,
        state:{enhancePending:false,bookSwitch:null},
        currentBookName:()=> 'Remus',
        renderedEntries:()=>rows,
        isEntryHeaderReadyForReveal:entry=>entry.dataset.ready==='yes',
        isFoldyLinkedMode:()=>false,
        finishWorldDrawerOpenLoading:()=>events.push('finished'),
        setBookSwitchLoading:visible=>events.push(['mask',visible]),
        hydrateCurrentBookDataAfterReveal:()=>events.push('hydrated'),
    };
    vm.runInNewContext(prod('revealCompletedEntryList')
      +'\nglobalThis.check=revealCompletedEntryList;',ctx);
    assert.equal(ctx.check('Remus',rows,true),false,
        'old headersVerified fast path must not allow an incomplete third row');
    assert.deepEqual(events,[]);
    rows[2].dataset.ready='yes';
    assert.equal(ctx.check('Remus',rows,true),true);
    assert.deepEqual(events,['finished',['mask',false],'hydrated']);
    dom.window.close();
});

test('turning automatic backup off prevents pending open/edit snapshots from writing', async () => {
    let enabled=true;
    const stored=[];
    let resolveRead;
    const ctx={
        structuredClone,
        state:{backupRestoreInProgress:false},
        getSettings:()=>({autoBackupEnabled:enabled}),
        loadWorldInfo:()=>new Promise(resolve=>{resolveRead=resolve;}),
        lorebookTranslations:()=>[],
        backupSnapshotHash:()=> 'hash',
        listLorebookBackups:async()=>[],
        backupId:()=> 'id',
        BACKUP_SCHEMA_VERSION:1,
        VERSION:'1.4.85-ambasa.22',
        putLorebookBackup:async record=>stored.push(record),
        pruneLorebookBackups:async()=>{},
        renderBackupList:()=>{},
    };
    vm.runInNewContext(prod('createLorebookBackupInternal')
       + '\nglobalThis.backup=createLorebookBackupInternal;',ctx);
    const pending=ctx.backup('Remus',{reason:'opened'});
    enabled=false;
    resolveRead({entries:{1:{uid:1,content:'hello'}}});
    const result=await pending;
    assert.equal(result.status,'disabled');
    assert.equal(stored.length,0,'no write may occur after the checkbox turns OFF');
    const automatic=await ctx.backup('Remus',{reason:'auto'});
    assert.equal(automatic.status,'disabled');
    assert.equal(stored.length,0);
    const manualPending=ctx.backup('Remus',{reason:'manual',force:true});
    resolveRead({entries:{1:{uid:1,content:'hello'}}});
    assert.equal((await manualPending).status,'created','manual backups remain available');
    assert.equal(stored.length,1);
});

test('compact title rows no longer impose 32px on short titles; long titles can grow',()=>{
    assert.match(css,/field-sizing:\s*content;\s*height:\s*auto !important;\s*min-height:\s*28px !important;\s*max-height:\s*152px !important/s);
    assert.match(css,/\.slb-entry-header-shell\s*\{[^}]*grid-auto-rows:\s*minmax\(28px,\s*auto\)/s);
    assert.match(css,/\.slb-header-actions > \.menu_button\s*\{[^}]*height:\s*28px !important/s);
    assert.match(source,/if \(state\.incompleteHeaderRetry\?\.timer\)/);
    assert.match(source,/const delay = \[70, 160, 350\]/);
    assert.match(source,/항목 헤더 렌더 오류/);
});

test('one malformed row cannot abort the rest of a 25-row enhancement batch',()=>{
    const dom = new JSDOM('<div id="world_popup_entries_list">'
      + Array.from({length:25}, (_,i)=>'<div class="world_entry" data-uid="'+i+'"></div>').join('')
      + '</div>',{runScripts:'outside-only'});
    const w=dom.window;
    const setup=[
        'const rows=[...document.querySelectorAll(".world_entry")];',
        'const state={sorting:false,enhancing:false,enhancePending:false,enhanceRunId:0,enhanceChunkRaf:0,incompleteHeaderRetry:null,bookSwitch:null,tokenTimer:null,tokenIdleHandle:null,tokenRefreshRunId:0};',
        'const VERSION="1.4.85-ambasa.22";',
        'const getUid=e=>e.dataset.uid;',
        'let failThird=true;let revealed=0;',
        'const timers=[];',
        'const setTimeout=(callback,delay)=>{timers.push(callback);return timers.length};',
        'const clearTimeout=()=>{};',
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
        'const enhanceEntryHeader=e=>{if(e.dataset.uid==="2"&&failThird)throw Error("synthetic third row");e.dataset.slbHeaderEnhanced=VERSION;};',
        'const syncMetadataTranslations=()=>{};',
        'const queryCompatible=()=>null;',
        'const isEntryEditorRendered=()=>false;',
        'const isEntryHeaderReadyForReveal=e=>e.dataset.slbHeaderEnhanced===VERSION;',
        'const applyMobileDisplaySettings=()=>{};',
        'const syncResponsiveEntryLayouts=()=>{};',
        'const syncFilterButtons=()=>{};',
        'const syncAutoControls=()=>{};',
        'const scheduleInitialTokenSummary=()=>{};',
        'const revealCompletedEntryList=()=>{if(rows.every(isEntryHeaderReadyForReveal)){revealed++;return true;}return false;};',
        'const scheduleEnhance=()=>enhanceAll();',
        'const requestAnimationFrame=callback=>{callback();return 1};',
    ].join('\n');
    w.eval(setup+'\n'+prod('enhanceAll')+'\nwindow.api={run:enhanceAll,rows,timers,fix:()=>{failThird=false},getReveal:()=>revealed,state};');
    try{
        w.api.run();
        assert.equal(w.api.rows.filter(e=>e.dataset.slbHeaderEnhanced=== '1.4.85-ambasa.22').length,24,
            'one failed row should not halt enhancement of the rest');
        assert.equal(w.api.state.enhancing,false,'one row error cannot leave the loading scheduler stuck');
        assert.equal(w.api.getReveal(),0,'do not publish a partly enhanced list');
        assert.equal(w.api.timers.length,1,'only one bounded retry timer');
        w.api.fix();
        w.api.timers.shift()();
        assert.equal(w.api.rows.filter(e=>e.dataset.slbHeaderEnhanced=== '1.4.85-ambasa.22').length,25);
        assert.equal(w.api.getReveal(),1,'fully repaired list is made visible');
        assert.equal(w.api.state.incompleteHeaderRetry,null);
    }finally { w.close(); }
});
