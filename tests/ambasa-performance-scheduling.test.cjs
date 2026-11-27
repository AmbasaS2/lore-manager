const {test} = require('node:test');
const assert = require('node:assert/strict');
const {readFileSync} = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = readFileSync(path.join(__dirname, '../index.js'), 'utf8');

function production(name) {
    const match=source.match(new RegExp('^function '+name+'\\([^]*?^}', 'm'));
    assert.ok(match, 'function not found: ' + name);
    return match[0];
}

test('burst resize and Foldy layout signals coalesce into one RAF and one badge pass', () => {
    let displaySync = 0, layoutSync = 0, requested = 0;
    const frames=[];
    const state = {responsiveRaf:0, responsivePendingDisplaySync:false};
    const ctx={
        state,
        requestAnimationFrame(fn){ frames.push(fn); return ++requested; },
        applyMobileDisplaySettings(){ displaySync++; },
        syncResponsiveEntryLayouts(){ layoutSync++; },
    };
    vm.runInNewContext(production('scheduleResponsiveEntryLayouts') +
        '\nglobalThis.schedule=scheduleResponsiveEntryLayouts',ctx);
    for(let i=0;i<40;i++) ctx.schedule(i===0);
    assert.equal(requested,1);
    assert.equal(frames.length,1);
    assert.equal(displaySync,0);
    frames.shift()();
    assert.equal(displaySync,1);
    assert.equal(layoutSync,1);
    assert.equal(state.responsiveRaf,0);
    assert.equal(state.responsivePendingDisplaySync,false);
    ctx.schedule();
    ctx.schedule('non-boolean Folio onLayout argument');
    frames.shift()();
    assert.equal(displaySync,1,'non-display layouts do not traverse badges');
    assert.equal(layoutSync,2);
    ctx.schedule();
    ctx.schedule(true);
    ctx.schedule();
    frames.shift()();
    assert.equal(displaySync,2,'late display request is never lost');
    assert.equal(layoutSync,3);
});

test('collapsed rows skip expensive edit visibility probes while kill-state updates survive', () => {
    const numberOfRows = 300;
    const entries = {};
    const nodes=[];
    let layoutReads=0, summaryQueued=0, tokenRequests=0;
    for(let i=0;i<numberOfRows;i++){
        entries[i]={uid:i,content:'body'+i,disable:false};
        const editor = i===51 ? {tagName:'SECTION'}:null;
        const source = i===51 ? {value:'body51'}:null;
        const kill = i===72 ? {classList:{contains(cls){return cls==='fa-toggle-off';}}}:null;
        nodes.push({
            uid:String(i),
            querySelector(selector){
                if(selector==='[name="entryKillSwitch"]')return kill;
                if(selector==='.world_entry_edit, .world-entry-edit, [data-role="entry-editor"]')return editor;
                if(selector==='textarea[name="content"]')return source;
                return null;
            },
        });
    }
    const state={
        currentBook:'book',currentBookData:{entries}, sorting:false,navDragging:false,
        liveActiveStates:new Map(), entryTokenTimers:new Map(),tokenRefreshRunId:0,
        pendingBookSwitch:'',tokenCache:new Map()
    };
    const ctx={
        state, document:{visibilityState:'visible'}, currentBookName:()=> 'book',
        getBookTokenCache:()=>new Map([['51',{hash:'body51',count:10}]]),
        renderedEntries:()=>nodes,
        getUid:el=>el.uid,
        isEntryEditorRendered:()=>{layoutReads++;return true},
        hashText:v=>v,
        queueTokenSummaryRender:()=>{summaryQueued++},
        scheduleEntryTokenCount:()=>{tokenRequests++},
    };
    vm.runInNewContext(production('syncLiveEditorTokens')+'\nglobalThis.sync=syncLiveEditorTokens',ctx);
    ctx.sync();
    assert.equal(layoutReads,1, 'only one existing editor triggers a layout-sensitive visibility check');
    assert.equal(summaryQueued,1, 'toggle-off changes are reflected in summary');
    assert.equal(entries[72].disable,true);
    assert.equal(tokenRequests,0);
    ctx.sync();
    assert.equal(layoutReads,2);
    assert.equal(summaryQueued,1,'no redundant total render when stable');
    assert.equal(state.liveActiveStates.get('book:72'),true);
});

test('content edits update the live source immediately but coalesce total redraws',()=>{
    const entry = {content:'original'};
    const state={
        currentBook:'book',currentBookData:{entries:{'51':entry}},
        entryTokenTimers:new Map(),
    };
    let countQueued=0, fullRedraws=0, tokenTimers=0;
    const ctx={
        state,
        currentBookName:()=> 'book',
        scheduleTokenSummary:()=>{throw Error('unexpected cross-book refresh')},
        queueTokenSummaryRender:()=>{countQueued++},
        renderTokenSummary:()=>{fullRedraws++},
        clearTimeout:()=>{},
        setTimeout:()=>{tokenTimers++; return tokenTimers},
        hashText:v=>v,
        getTokenCountAsync:async()=>0,
        getBookTokenCache:()=>new Map(),
        schedulePersistTokenCache:()=>{},
        console,
    };
    vm.runInNewContext(production('scheduleEntryTokenCount')+'\nglobalThis.schedule=scheduleEntryTokenCount',ctx);
    ctx.schedule('book','51','typing');
    ctx.schedule('book','51','typing more');
    assert.equal(entry.content,'typing more','original edit state is updated synchronously');
    assert.equal(countQueued,2,'near-frame batched redraw requested');
    assert.equal(fullRedraws,0,'full-book sums are not calculated synchronously on keypress');
    assert.equal(state.entryTokenTimers.size,1,'only latest async token count remains scheduled');
});

test('fallback interval only runs while the integrated editor is open',()=>{
    assert.match(source,/const LIVE_SYNC_FALLBACK_INTERVAL_MS = 4000;/);
    const init=source.slice(source.indexOf('function init()'),source.indexOf('jQuery(() => {'));
    let drawerOpen = false;
    let checks = 0, scans = 0, tokenChecks = 0;
    const rows = [{}];
    let active = null;
    const context = {
        document: { visibilityState: 'visible' },
        state: { liveSyncTimer: null },
        isNativeLorebookMode: () => false,
        isWorldInfoDrawerOpen: () => drawerOpen,
        clearInterval: () => { active = null; },
        setInterval: (fn, ms) => { assert.equal(ms, 4000); active = fn; return 1; },
        renderedEntries: () => { scans++; return rows; },
        enforceActivationOverviewIntegrity: entries => { assert.equal(entries, rows); checks++; },
        syncLiveEditorTokens: entries => { assert.equal(entries, rows); tokenChecks++; },
        LIVE_SYNC_FALLBACK_INTERVAL_MS: 4000,
    };
    vm.runInNewContext(production('syncLiveEditorTimer')+'\nglobalThis.sync=syncLiveEditorTimer',context);
    context.sync();
    assert.equal(active, null);
    drawerOpen = true;
    context.sync();
    active();
    assert.equal(checks, 1);
    assert.equal(scans, 1);
    assert.equal(tokenChecks, 1);
    for (const key of ['editorUiSuspended', 'sorting', 'navDragging', 'enhancing', 'bookSwitch']) {
        context.state[key] = true;
        active();
        context.state[key] = false;
    }
    context.document.visibilityState = 'hidden';
    active();
    context.document.visibilityState = 'visible';
    assert.equal(scans, 1, 'busy and hidden ticks must not walk DOM rows');
    active();
    assert.equal(scans, 2);
    assert.equal(checks, 2);
    assert.equal(tokenChecks, 2);
    drawerOpen = false;
    context.sync();
    assert.equal(active, null);
    assert.match(init,/if \(width === state\.responsiveViewportWidth && narrow === state\.responsiveBreakpoint\) return;/);
    assert.match(init,/scheduleResponsiveEntryLayouts\(true\)/);
});

test('all user data and native pathways remain unchanged',()=>{
    assert.match(source,/const EXTENSION_NAME = 'simple-lorebook';/);
    assert.match(source,/const BACKUP_DB_NAME = 'simple-lorebook-backups';/);
    assert.match(source,/function syncMetadataFieldAppearance\(/,'native metadata style sync left intact');
    assert.match(source,/function bindWorkspaceEntries\(/,'native ST input delegation intact');
    assert.match(source,/function bindEntryDrawerLifecycle\(/,'native ST drawer lifecycle intact');
});

test('WeakMap content hashes are reused but invalidated by an actual text change',()=>{
    let hashCalls=0;
    const ctx={
        WeakMap,
        hashText(value){hashCalls++;return 'hash:'+String(value);},
    };
    const code='const entryContentHashCache = new WeakMap();\n'+production('hashEntryContent')+
        '\nglobalThis.hashEntryContent=hashEntryContent';
    vm.runInNewContext(code,ctx);
    const first={content:'love and war'};
    assert.equal(ctx.hashEntryContent(first),'hash:love and war');
    for(let i=0;i<100;i++)assert.equal(ctx.hashEntryContent(first),'hash:love and war');
    assert.equal(hashCalls,1,'unchanged content is hashed only once');
    first.content='live and war'; // same length; source string still changes
    assert.equal(ctx.hashEntryContent(first),'hash:live and war');
    assert.equal(hashCalls,2);
    const replacement={content:'live and war'};
    assert.equal(ctx.hashEntryContent(replacement),'hash:live and war');
    assert.equal(hashCalls,3,'new ST entry identity is not given stale cache');
    replacement.content=null;
    assert.equal(ctx.hashEntryContent(replacement),'hash:null');
    assert.equal(hashCalls,4,'non-string content is not cached');
});

test('summary reuses hashes without altering persisted cache or token counts',()=>{
    const {JSDOM}=require('jsdom');
    const ids=['slb-total-tokens','slb-constant-tokens','slb-selective-tokens','slb-vectorized-tokens','slb-entry-count'];
    const dom=new JSDOM(ids.map(id=>'<span id="'+id+'"></span>').join(''));
    const data={entries:{}},tokenCache=new Map();
    const entries=Array.from({length:100},(_,uid)=>({uid,content:'text '+uid,disable:false,constant:uid%2===0,vectorized:false}));
    for(const entry of entries) {
        data.entries[entry.uid]=entry;
        tokenCache.set(String(entry.uid),{hash:'hash:'+entry.content,count:5});
    }
    let hashCalls=0;
    const ctx={
        document:dom.window.document, WeakMap,
        state: {editorUiSuspended:false},
        currentBookName:()=> 'book',
        lorebookEntries:()=> entries,
        getBookTokenCache:()=> tokenCache,
        hashText(value){hashCalls++;return 'hash:'+String(value);}
    };
    vm.runInNewContext('const entryContentHashCache=new WeakMap();\n'+production('hashEntryContent')+
        '\n'+production('updateTokenStatDisplay')+
        '\n'+production('renderTokenSummary')+'\nglobalThis.render=renderTokenSummary',ctx);
    try{
        ctx.render('book',data);
        assert.equal(hashCalls,100);
        assert.equal(dom.window.document.getElementById('slb-total-tokens').textContent,'500');
        for(let i=0;i<20;i++)ctx.render('book',data);
        assert.equal(hashCalls,100,'refreshes without text changes do not rehash 100 bodies');
        entries[37].content='changed string';
        ctx.render('book',data);
        assert.equal(hashCalls,101,'exactly one entry invalidates its content hash');
        assert.equal(dom.window.document.getElementById('slb-total-tokens').textContent,'…');
        tokenCache.set('37',{hash:'hash:changed string',count:7});
        ctx.render('book',data);
        assert.equal(hashCalls,101);
        assert.equal(dom.window.document.getElementById('slb-total-tokens').textContent,'502');
    }finally{dom.window.close();}
});

test('state selector repair targets only the changed row; watchdog retains whole-page fallback',()=>{
    assert.match(production('syncEntryInjectionState'),/enforceActivationOverviewIntegrity\(\[entry\]\)/);
    const sourceFn=production('enforceActivationOverviewIntegrity');
    const state={sorting:false,closingEntryDrawers:new WeakSet()};
    let fullScans=0, queried=0;
    const ctx={
      state,
      renderedEntries:()=>{fullScans++;return []},
    };
    vm.runInNewContext(sourceFn+'\nglobalThis.repair=enforceActivationOverviewIntegrity',ctx);
    ctx.repair([]);
    assert.equal(fullScans,0,'per-row event does not rescan every entry');
    const row={querySelector(){queried++;return null}};
    ctx.repair([row]);
    assert.equal(fullScans,0);
    assert.equal(queried,1);
    ctx.repair();
    assert.equal(fullScans,1,'periodic fallback still can verify the whole page');
    const updated=source.slice(source.indexOf('if (event_types.WORLDINFO_UPDATED)'),
        source.indexOf("for (const eventName of ['CONNECTION_PROFILE_CREATED'",source.indexOf('if (event_types.WORLDINFO_UPDATED)')));
    assert.match(updated,/if \(!edit \|\| !isEntryEditorRendered\(entry\)\) return false/);
});


test('token cache invalidates on effective tokenizer changes without mixing old counts',()=>{
 const ctx={main_api:'openai',getTokenizerModel:()=>ctx.model,model:'gpt-4',state:{tokenCache:new Map(),tokenCacheTouched:new Map()},power_user:{tokenizer:99},tokenizers:{BEST_MATCH:99,API_TEXTGENERATIONWEBUI:9,API_KOBOLD:10},getTokenizerBestMatch:()=>12,getTextGenModel:()=>'',online_status:''};
 vm.runInNewContext(production('getTokenCacheScope')+'\n'+production('syncTokenCacheScope')+'\n'+production('getBookTokenCache')+'\nthis.getCache=getBookTokenCache;',ctx);
 const old=ctx.getCache('Memory');old.set('0',{hash:'same',count:42});
 assert.equal(ctx.getCache('Memory'),old);
 ctx.model='claude';const fresh=ctx.getCache('Memory');
 assert.notEqual(fresh,old);assert.equal(fresh.size,0);
 assert.equal(ctx.getCache('Memory'),fresh);
});
