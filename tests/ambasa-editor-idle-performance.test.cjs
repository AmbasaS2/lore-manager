const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const source = readFileSync(join(__dirname, '../index.js'), 'utf8');

async function verify(source, assert) {
    function production(name) {
        const match = source.match(new RegExp('^(?:async )?function ' + name + '\\([^]*?^}', 'm'));
        assert.ok(match, 'missing function: ' + name);
        return match[0];
    }
    function bind(names, ctx) {
        return new Function(...Object.keys(ctx), names.map(production).join('\n') +
            '\nreturn {' + names.join(',') + '};')(...Object.values(ctx));
    }
    function clock() {
        let id = 0;
        const jobs = new Map();
        return {
            jobs,
            setTimeout(fn, delay) { jobs.set(++id, {fn, delay}); return id; },
            clearTimeout(key) { jobs.delete(key); },
            run() {
                const list = [...jobs.entries()];
                for (const [key, job] of list) {
                    if (jobs.delete(key)) job.fn();
                }
            },
        };
    }
    {
        const timer = clock(), state = {editorUiSuspended:true, managerMode:'standard'};
        let renders = 0, frames = 0;
        const api = bind(['scheduleEnhance','scheduleTokenSummary','queueTokenSummaryRender','scheduleInitialTokenSummary'], {
            state, setTimeout: timer.setTimeout, clearTimeout: timer.clearTimeout,
            requestAnimationFrame(){frames++; return 1;}, cancelAnimationFrame(){},
            enhanceAll(){renders++;}, refreshTokenSummary(){renders++;}, renderTokenSummary(){renders++;},
            currentBookName:()=> 'book', scheduleBookSwitchReadyCheck(){}, 
        });
        for(let i=0;i<100;i++){
            api.scheduleEnhance(); api.scheduleTokenSummary(); api.queueTokenSummaryRender('book', {}); api.scheduleInitialTokenSummary();
        }
        assert.equal(timer.jobs.size,0); assert.equal(frames,0); assert.equal(renders,0);
        assert.equal(state.deferredEditorEnhance,true); assert.equal(state.deferredTokenSummary,true);
    }
    {
        const timer = clock();
        const state = {editorUiSuspended:false, currentBook:'book', currentBookData:{entries:{}}};
        let rendered = 0;
        const api = bind(['queueTokenSummaryRender'], {state,setTimeout:timer.setTimeout,clearTimeout:timer.clearTimeout,
            renderTokenSummary(book, data){assert.equal(book,'book'); assert.equal(data,state.currentBookData); rendered++;}});
        for(let i=0;i<100;i++)api.queueTokenSummaryRender('book', {}, 200);
        assert.equal(timer.jobs.size,1); assert.equal([...timer.jobs.values()][0].delay,200);
        timer.run(); assert.equal(rendered,1); assert.equal(state.tokenRenderTimer,null);
        api.queueTokenSummaryRender('book', {}, 200);
        api.queueTokenSummaryRender('book', {}, 16);
        assert.equal(timer.jobs.size,1); assert.equal([...timer.jobs.values()][0].delay,16);
        timer.run(); assert.equal(rendered,2);
    }
    {
        const timer=clock(), state={editorUiSuspended:false,enhancing:true};
        let refreshed=0;
        const api=bind(['isTokenSummaryWaitingForPage','resumeDeferredTokenSummary','scheduleInitialTokenSummary','scheduleTokenSummary'],{
            state,setTimeout:timer.setTimeout,clearTimeout:timer.clearTimeout,
            requestIdleCallback:undefined,cancelIdleCallback:undefined,
            currentBookName:()=> 'book',document:{getElementById:()=>null},isFoldyLinkedMode:()=>false,
            refreshTokenSummary(){refreshed++;},
        });
        api.scheduleInitialTokenSummary();
        timer.run();timer.run();
        assert.equal(timer.jobs.size,0); assert.equal(refreshed,0); assert.equal(state.deferredTokenSummary,true);
        for(let i=0;i<100;i++)api.resumeDeferredTokenSummary();
        assert.equal(timer.jobs.size,0);
        state.enhancing=false;
        api.resumeDeferredTokenSummary();api.resumeDeferredTokenSummary();
        assert.equal(timer.jobs.size,1);timer.run();assert.equal(refreshed,1);
    }
    {
        const timer=clock(), state={editorUiSuspended:false,refreshTimer:1,enhancing:true,enhanceChunkRaf:2,
            enhanceRunId:5,tokenRunId:4,tokenRefreshRunId:4,tokenTimer:timer.setTimeout(()=>{},1),
            tokenRenderTimer:timer.setTimeout(()=>{},200),tokenIdleHandle:3,entryTokenTimers:new Map(),
            bulkEditorHydrationRaf:4,bulkEditorHydrationQueue:[1,2],bulkEditorHydrationHead:1,
            responsiveRaf:5,bookSwitch:{timer:timer.setTimeout(()=>{},120),ready:false}};
        state.entryTokenTimers.set('book:1',timer.setTimeout(()=>{},80));
        const frames=[], idle=[]; let open=true, paused=0, resumed=0, layouts=0, tokens=0, transition=0;
        const doc={visibilityState:'visible'};
        const api=bind(['pauseEditorUiWork','syncEditorActivity'],{state, document:doc, isNativeLorebookMode:()=>false,
            isWorldInfoDrawerOpen:()=>open,syncLiveEditorTimer(){},cancelAnimationFrame(id){frames.push(id)},
            setTimeout:timer.setTimeout,clearTimeout:timer.clearTimeout,cancelIdleCallback(id){idle.push(id)},
            finishWorldDrawerOpenLoading(){paused++},setBookSwitchLoading(){},releaseNativePageCache(){},
            scheduleBookSwitchReadyCheck(){transition++},scheduleEnhance(){resumed++},
            scheduleResponsiveEntryLayouts(){layouts++},resumeDeferredTokenSummary(){tokens++}});
        open=false;api.syncEditorActivity();api.syncEditorActivity();
        assert.equal(paused,1);assert.equal(timer.jobs.size,0);assert.equal(state.enhancing,false);
        assert.equal(state.tokenRunId,5);assert.equal(state.tokenRefreshRunId,0);assert.equal(state.entryTokenTimers.size,0);
        assert.equal(state.bookSwitch.timer,null);assert.equal(state.deferredEntryRecheck,true);
        assert.equal(frames.length,4);assert.equal(idle.length,1);
        open=true;api.syncEditorActivity();api.syncEditorActivity();
        assert.equal(transition,1);assert.equal(resumed,0);assert.equal(layouts,1);assert.equal(tokens,1);
        state.bookSwitch=null;
        doc.visibilityState='hidden';api.syncEditorActivity();
        doc.visibilityState='visible';api.syncEditorActivity();
        assert.equal(resumed,1);
    }
    {
        const api=bind(['mapLimit'],{});
        let active=true, started=0;
        await api.mapLimit(Array.from({length:100},(_,i)=>i),1,async()=>{started++;active=false;},()=>active);
        assert.equal(started,1);
    }
    assert.doesNotMatch(source,/setTimeout\(run, 60\)/);
    assert.match(source,/new MutationObserver\(syncEditorActivity\)/);
    assert.match(source,/scheduleAutomaticLorebookBackup\(name\);\s*if \(state.editorUiSuspended\) \{[\s\S]*?state.deferredTokenSummary = true;\s*return;\s*\}\s*entryBulkEditor.prune\(data\)/);
    assert.match(source,/queueTokenSummaryRender\(book, data, 200\)/);
}

test('closed editor suspends work and resumes existing render paths once', () => verify(source, assert));
