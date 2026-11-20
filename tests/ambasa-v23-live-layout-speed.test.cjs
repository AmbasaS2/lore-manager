const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { JSDOM } = require('jsdom');
const jquery = require('jquery');
const source = readFileSync(join(__dirname,'../index.js'),'utf8');
const css = readFileSync(join(__dirname,'../style.css'),'utf8');
const production = name => {
    const match=source.match(new RegExp('^function '+name+'\\([^]*?^}', 'm'));
    assert.ok(match,name+' missing');
    return match[0];
};
test('mixed native headers remain hidden until individual conversion finishes', () => {
    const dom = new JSDOM('<div id="WorldInfo" class="slb-active"><div id="world_popup_entries_list">'
       + '<div class="world_entry" id="ready" data-slb-display-ready="true">Converted</div>'
       + '<div class="world_entry" id="not-ready">Native fields</div></div></div>',
       {runScripts:'outside-only'});
    const start=css.indexOf('/* Prevent mixed native / manager rows');
    const end=css.indexOf('#WorldInfo.slb-active #world_popup_entries_list > .world_entry {',start);
    assert.ok(start>-1 && end>start);
    const style=dom.window.document.createElement('style');
    style.textContent=css.slice(start,end);
    dom.window.document.head.append(style);
    const ready=dom.window.document.getElementById('ready');
    const native=dom.window.document.getElementById('not-ready');
    assert.equal(dom.window.getComputedStyle(ready).visibility,'visible');
    assert.equal(dom.window.getComputedStyle(native).visibility,'hidden');
    native.dataset.slbDisplayReady='true';
    assert.equal(dom.window.getComputedStyle(native).visibility,'visible');
    native.removeAttribute('data-slb-display-ready');
    native.dataset.slbRenderFailed='true';
    assert.equal(dom.window.getComputedStyle(native).visibility,'visible',
        'after bounded failed repairs, the native editor stays accessible');
    dom.window.close();
});
test('drawer click defers editor rebuilding to the next frame and only hydrates once',()=>{
    const dom=new JSDOM('<div class="world_entry"><div class="inline-drawer"><div class="inline-drawer-outlet">'
       +'<div class="world_entry_edit"></div></div></div></div>',{runScripts:'outside-only'});
    const w=dom.window;
    w.jQuery=jquery(w);
    const jobs=[],timeouts=[];
    w.requestAnimationFrame=cb=>{jobs.push(cb);return jobs.length;};
    w.setTimeout=(cb,delay)=>{timeouts.push({cb,delay});return timeouts.length;};
    w.eval([
        "const VERSION='test';",
        "const state={closingEntryDrawers:new WeakSet(),entryFilterRefreshPending:false};",
        "const getEntryDrawer=entry=>entry.querySelector('.inline-drawer');",
        "const getResponsiveHeaderFields=()=>[];",
        "const isEntryDrawerOpen=()=>true;",
        "const isEntryEditorRendered=()=>true;",
        "const queryCompatible=(root,selectors)=>root.querySelector(Array.isArray(selectors)?selectors[0]:selectors);",
        "let rebuilds=0,layout=0;",
        "const enhanceEntry=entry=>{rebuilds++;const edit=entry.querySelector('.world_entry_edit');edit.dataset.slbEnhanced='test';if(!edit.querySelector('.slb-tabbar')){let bar=document.createElement('div');bar.className='slb-tabbar';edit.prepend(bar)}};",
        "const placeResponsiveHeaderFields=()=>{layout++;};",
        production('bindEntryDrawerLifecycle'),
        "window.api={bindEntryDrawerLifecycle,counts:()=>({rebuilds,layout})};"
    ].join('\n'));
    const row=w.document.querySelector('.world_entry');
    const drawer=w.document.querySelector('.inline-drawer');
    w.api.bindEntryDrawerLifecycle(row);
    w.jQuery(drawer).trigger('inline-drawer-toggle');
    assert.equal(w.api.counts().rebuilds,0,'native click completes before editor work');
    assert.equal(jobs.length,1);
    jobs.shift()();
    assert.equal(w.api.counts().rebuilds,1,'first frame hydrates exactly once');
    assert.equal(w.api.counts().layout,1);
    assert.equal(timeouts.length,0,'ready editor does not schedule redundant delayed rebuilds');
    w.jQuery(drawer).trigger('inline-drawer-toggle');
    jobs.shift()();
    assert.equal(w.api.counts().rebuilds,1,'ready editor not rebuilt on repeated open');
    dom.window.close();
});
test('all-open and all-close preserve immediate native toggles without a queued frame',()=>{
    const dom=new JSDOM('<div id="WorldInfo"><button id="OpenAllWIEntries"></button><button id="CloseAllWIEntries"></button>'
       +'<div id="world_popup_entries_list">'+Array.from({length:25},()=>'<div class="inline-drawer"><div class="inline-drawer-header">'
       +'<i class="inline-drawer-icon down"></i></div></div>').join('')+'</div></div>',{runScripts:'outside-only'});
    const w=dom.window;
    const raf=[];
    w.requestAnimationFrame=fn=>{raf.push(fn);return raf.length};
    w.eval([
        "const createElement=(tag,cls)=>{const e=document.createElement(tag);e.className=cls;return e;};",
        "const state={bulkEditorHydrationQueue:[],bulkEditorHydrationHead:0,bulkEditorHydrationRaf:0,bulkOpeningDrawers:false};",
        "let toggled=0;",
        "const toggleDrawer=(drawer,open)=>{toggled++;if(open && !state.bulkOpeningDrawers)throw Error('native open not immediate');drawer.querySelector('.inline-drawer-icon').classList.toggle('up',open)};",
        production('bindCombinedEntryToggle'),
        "window.api={bindCombinedEntryToggle,read:()=>toggled};"
    ].join('\n'));
    w.api.bindCombinedEntryToggle();
    w.document.getElementById('slb-toggle-all-entries').click();
    assert.equal(w.api.read(),25,'all 25 drawers switch immediately without a 4-per-frame queue');
    assert.equal(raf.length,0,'no work scheduled behind the native click');
    w.document.getElementById('slb-toggle-all-entries').click();
    assert.equal(w.api.read(),50,'closing all is also immediate');
    assert.equal(raf.length,0);
    dom.window.close();
});
test('ambasa.21 CSS restored while preserving title autosize and backup OFF',()=>{
    assert.match(source,/slb-filter-trigger slb-bulk-mode-label" title="항목 필터"/);
    assert.match(source,/selectionToolbar\.prepend\(tokenSection\)/);
    assert.match(source,/selectionToolbar\.insertBefore\(filterSection, bulkButton\)/);
    assert.match(css,/#WorldInfo\.slb-active #slb-entry-selection-toolbar > #slb-entry-filters-section\s*\{[^}]*margin:\s*0 0 0 auto/s);
    assert.match(css,/slb-bulk-edit-hidden\.slb-mobile-entry-filters-hidden\.slb-mobile-token-summary-hidden #slb-entry-selection-toolbar/);
    assert.match(css,/field-sizing:\s*content;\s*height:\s*auto !important;\s*min-height:\s*28px !important;\s*max-height:\s*152px !important/s);
    assert.match(source,/const scheduled = reason === 'auto' \|\| reason === 'opened'/);
});
