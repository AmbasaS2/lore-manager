
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const source = readFileSync(join(__dirname, '..', 'index.js'), 'utf8');
const css = readFileSync(join(__dirname, '..', 'style.css'), 'utf8');

function prod(name) {
    const hit = source.match(new RegExp('^(?:async )?function ' + name + '\\([^]*?^}', 'm'));
    assert.ok(hit, 'missing function ' + name);
    return hit[0];
}

test('native, integrated, and Foldy use mutually exclusive WorldInfo classes', () => {
    const dom = new JSDOM('<div id="WorldInfo"></div>', { runScripts: 'outside-only' });
    const w = dom.window;
    try {
        w.eval([
            'const MANAGER_MODE_NATIVE="native", MANAGER_MODE_FOLDY="foldy";',
            'const getSettings=()=>({managerMode:"standard"});',
            prod('applyManagerModeClasses'),
            'window.change=applyManagerModeClasses;',
        ].join('\n'));
        const root = w.document.getElementById('WorldInfo');
        w.change('standard');
        assert.equal(root.classList.contains('slb-active'), true);
        assert.equal(root.classList.contains('slb-manager-standard-mode'), true);
        w.change('native');
        assert.equal(root.classList.contains('slb-active'), false);
        assert.equal(root.classList.contains('slb-native-view'), true);
        assert.equal(root.classList.contains('slb-manager-standard-mode'), false);
        assert.equal(root.classList.contains('slb-foldy-linked-mode'), false);
        w.change('foldy');
        assert.equal(root.classList.contains('slb-active'), true);
        assert.equal(root.classList.contains('slb-foldy-linked-mode'), true);
        assert.equal(root.classList.contains('slb-native-view'), false);
    } finally { w.close(); }
});

test('native mode cancels manager conversion and restores ST only once without touching world data', () => {
    const dom = new JSDOM('<div id="WorldInfo" class="slb-active"><div id="world_popup_entries_list">'
      + '<div class="world_entry">content</div></div></div><button id="world_refresh"></button>',
      { runScripts: 'outside-only' });
    const w = dom.window;
    w.eval([
        'const MANAGER_MODE_FOLDY="foldy", MANAGER_MODE_NATIVE="native", MANAGER_MODE_STANDARD="standard";',
        'const state={managerMode:"standard",enhanceRunId:0,enhancing:true,enhancePending:true,bookSwitch:null,incompleteHeaderRetry:null,foldyLinkedActivationTimer:null};',
        'const settings={managerMode:"standard"};',
        'const getSettings=()=>settings;',
        'let refreshes=0,unbound=0,rebuilds=0,observerWork=0,combined=0,saves=0;',
        'document.getElementById("world_refresh").addEventListener("click",()=>refreshes++);',
        'const clearFoldyFolderDeleteDrawerGuard=()=>{};',
        'const clearFoldyLinkedPreparing=()=>{};',
        'const clearTimeout=()=>{};',
        'const setBookSwitchLoading=()=>{};',
        'const finishWorldDrawerOpenLoading=()=>{};',
        'const unbindWorkspaceEntries=()=>{unbound++};',
        'const createWorkspace=()=>{rebuilds++};',
        'const bindCombinedEntryToggle=()=>{combined++};',
        'const syncConnectedWorldOptions=()=>{};',
        'const isFoldySortValue=()=>false;',
        'const leaveFoldyLinkedViewOnce=()=>{};',
        'const notify=()=>{};',
        'const saveSettings=()=>{saves++};',
        'const scheduleEnhance=()=>{if(state.managerMode!=="native")observerWork++};',
        prod('applyManagerModeClasses'),
        source.slice(source.indexOf('function applyManagerMode('), source.indexOf('\nfunction captureFoldyFolderDeleteDrawerView()')),
        'window.api={apply:applyManagerMode,read:()=>({refreshes,unbound,rebuilds,observerWork,combined,saves}),state,settings};',
    ].join('\n'));
    try {
        const row = w.document.querySelector('.world_entry');
        const before = row.textContent;
        w.api.apply('native', { persist: false, announce: false });
        assert.equal(w.api.state.managerMode, 'native');
        assert.equal(w.api.state.enhancing, false);
        assert.equal(w.api.read().unbound, 1);
        assert.equal(w.api.read().refreshes, 1);
        assert.equal(w.api.read().observerWork, 0);
        assert.equal(row.textContent, before);
        assert.equal(w.api.read().saves, 0);
        w.api.apply('standard', { persist: false });
        assert.equal(w.api.state.managerMode, 'standard');
        assert.equal(w.api.read().refreshes, 2);
        assert.equal(w.api.read().rebuilds, 1);
        assert.equal(w.api.read().combined, 1);
        assert.equal(w.api.read().observerWork, 1);
    } finally { w.close(); }
});

test('native mode causes no scheduled enhance and no ST book-switch overlays', () => {
    const dom = new JSDOM('<div id="world_popup_entries_list"></div>', { runScripts: 'outside-only' });
    const w = dom.window;
    w.eval([
        'const state={managerMode:"native",bookSwitch:null,enhancing:false,refreshTimer:0};',
        'let frames=0,loaded=0;',
        'const requestAnimationFrame=()=>{frames++};',
        'const loadTranslationBook=()=>{loaded++};',
        prod('scheduleEnhance'),
        prod('beginBookSwitch'),
        'window.run=()=>{scheduleEnhance();beginBookSwitch("Book")};',
        'window.counters=()=>({frames,loaded})',
    ].join('\n'));
    try {
        w.run();
        assert.equal(w.counters().frames, 0);
        assert.equal(w.counters().loaded, 0);
        assert.match(css, /#WorldInfo\.slb-native-view #slb-entry-selection-toolbar/);
    } finally { w.close(); }
});

test('standalone theme is lazy loaded on menu click; not an always-on stylesheet', () => {
    assert.match(source, /function bindStandaloneLibraryMenu/);
    assert.match(source, /id = 'slb-library-menu-container'/);
    assert.match(source, /new URL\('\.\/library-shelf\.css', import\.meta\.url\)/);
    assert.match(source, /async function openStandaloneLibrary/);
    assert.match(source, /libraryStylesPromise/);
    assert.doesNotMatch(source, /setInterval\(.*standaloneLibrary/);
    assert.match(source, /function saveLibraryOriginal/);
    assert.match(source, /setWIOriginalDataValue\(fresh, entry\.uid, 'content', nextContent\)/);
    assert.match(source, /saveWorldInfo\(book, fresh, true\)/);
});

test('advanced action targets exact UID and opens activation settings without touching other entries', () => {
    const dom = new JSDOM('<div id="WorldInfo"></div><select id="world_editor_select">'
        + '<option value="">—</option><option value="3" selected>Example</option></select>'
        + '<div id="world_popup_entries_list"><div class="world_entry" data-uid="1"></div>'
        + '<div class="world_entry" data-uid="2"><div class="inline-drawer">'
        + '<button class="slb-tab" data-tab="activation">Activation</button></div></div></div>',
        { runScripts: 'outside-only' });
    const w = dom.window;
    w.eval([
        'const state={managerMode:"standard"};',
        'const currentBookName=()=>"Example";',
        'const isWorldInfoDrawerOpen=()=>true;',
        'const getUid=entry=>entry.dataset.uid;',
        'const getEntryDrawer=entry=>entry.querySelector(".inline-drawer");',
        'const isEntryDrawerOpen=()=>false;',
        'let toggles=0,notices=0;',
        'const toggleDrawer=(drawer,open)=>{toggles++;drawer.dataset.open=String(open)};',
        'const notify=()=>{notices++};',
        prod('openLibraryAdvanced'),
        'window.go=openLibraryAdvanced;window.stats=()=>({toggles,notices});',
    ].join('\n'));
    try {
        const other = w.document.querySelector('[data-uid="1"]');
        const target = w.document.querySelector('[data-uid="2"]');
        let clicked = 0;
        target.querySelector('[data-tab="activation"]').addEventListener('click',()=>clicked++);
        w.go('Example', '2');
        assert.equal(clicked, 1);
        assert.equal(target.dataset.slbActiveTab, 'activation');
        assert.equal(target.querySelector('.inline-drawer').dataset.open, 'true');
        assert.equal(other.dataset.slbActiveTab, undefined);
        assert.equal(w.stats().toggles, 1);
        assert.equal(w.stats().notices, 0);
    } finally { w.close(); }
});

test('original content save uses ST compatibility copy, preserves triggers, rejects concurrent edits', async () => {
    const dom = new JSDOM('<div id="world_popup_entries_list"></div><button id="world_refresh"></button>',
        { runScripts: 'outside-only' });
    const w = dom.window;
    const original = {
        entries: { 2: { uid: 2, content:'before', constant:true, probability:73, excludeRecursion:true } },
        originalData: { entries: [{ uid: 2, content:'before', constant:true, probability:73, excludeRecursion:true }] }
    };
    w.eval([
        'const original=' + JSON.stringify(original) + ';',
        'let saves=0,refreshes=0;',
        'document.getElementById("world_refresh").addEventListener("click",()=>refreshes++);',
        'const currentBookName=()=>"Example";',
        'const loadWorldInfo=async()=>original;',
        'const saveWorldInfo=async(name,data,force)=>{if(name!=="Example"||!force)throw Error("wrong save");saves++};',
        'const setWIOriginalDataValue=(data,uid,key,value)=>{const item=data.originalData.entries.find(x=>x.uid===uid);item[key]=value;};',
        prod('saveLibraryOriginal').replace('async function','async function'),
        'window.save=saveLibraryOriginal;',
        'window.stats=()=>({saves,refreshes,original});'
    ].join('\n'));
    try {
        await assert.rejects(w.save('Example','2','stale','new'), /다른 화면에서 원문이 변경/);
        assert.equal(w.stats().saves,0);
        await w.save('Example','2','before','edited content');
        assert.equal(w.stats().saves,1);
        assert.equal(w.stats().refreshes,1);
        assert.equal(w.stats().original.entries[2].content,'edited content');
        assert.equal(w.stats().original.originalData.entries[0].content,'edited content');
        assert.equal(w.stats().original.entries[2].excludeRecursion,true);
        assert.equal(w.stats().original.entries[2].probability,73);
    } finally { w.close(); }
});
