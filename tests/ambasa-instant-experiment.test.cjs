const {test}=require('node:test');
const assert=require('node:assert/strict');
const {readFileSync}=require('node:fs');
const {join}=require('node:path');
const {JSDOM}=require('jsdom');
const jquery=require('jquery');
const source=readFileSync(join(__dirname,'../index.js'),'utf8');
const fn=source.match(/^function bindEntryDrawerLifecycle\([^]*?^}/m)?.[0];
assert.ok(fn,'missing production drawer lifecycle');

function fixture({ready=true,bulk=false,buildMs=0}={}){
 const html='<div id="WorldInfo"><div id="world_popup_entries_list"><div class="world_entry">'
   +'<div class="inline-drawer"><div class="inline-drawer-header"><i class="inline-drawer-icon up"></i></div>'
   +'<div class="inline-drawer-outlet"><div class="world_entry_edit"><textarea name="content">original text</textarea></div></div>'
   +'</div></div></div></div>';
 const dom=new JSDOM(html,{runScripts:'outside-only'});
 const w=dom.window;
 w.jQuery=jquery(w);
 const frames=[],calls=[],queued=[],timers=[];
 w.requestAnimationFrame=cb=>{frames.push(cb);return frames.length};
 w.setTimeout=(cb,ms)=>{timers.push({cb,ms});return timers.length};
 w.eval([
  'const VERSION="test";',
  'const state={closingEntryDrawers:new WeakSet(),entryFilterRefreshPending:false,bulkOpeningDrawers:'+bulk+'};',
  'const translationFiles={isBookReady:()=>'+ready+'};',
  'const currentBookName=()=>"A";',
  'const getEntryDrawer=entry=>entry.querySelector(".inline-drawer");',
  'const getResponsiveHeaderFields=()=>[];',
  'const isEntryDrawerOpen=entry=>entry.querySelector(".inline-drawer-icon").classList.contains("up");',
  'const isEntryEditorRendered=()=>true;',
  'const queryCompatible=entry=>entry.querySelector(".world_entry_edit");',
  'const hasCompleteEnhancedEditor=edit=>Boolean(edit.querySelector(".slb-tabbar"));',
  'const enqueueBulkEditorHydration=cb=>window.__queued.push(cb);',
  'let hydrated=0,layouts=0;',
  'const enhanceEntry=entry=>{const edit=entry.querySelector(".world_entry_edit");'
  +'const start=performance.now();while(performance.now()-start<'+buildMs+'){};'
  +'if(!edit.querySelector(".slb-tabbar")){const tab=document.createElement("div");tab.className="slb-tabbar";edit.append(tab);}'
  +'edit.dataset.slbEnhanced=VERSION;hydrated++;placeResponsiveHeaderFields(entry);};',
  'const placeResponsiveHeaderFields=()=>{layouts++;};',
  fn,
  'window.api={bind:bindEntryDrawerLifecycle,counts:()=>({hydrated,layouts})};',
 ].join('\n'));
 w.__queued=queued;
 const entry=w.document.querySelector('.world_entry');
 w.api.bind(entry);
 return {dom,w,entry,frames,queued,timers,calls,trigger(){w.jQuery(entry.querySelector('.inline-drawer')).trigger('inline-drawer-toggle')},counts(){return w.api.counts()}};
}

test('ready single drawer converts before native click yields without extra frames',()=>{
 const f=fixture({ready:true});
 try{
  f.trigger();
  assert.equal(f.counts().hydrated,1);
  assert.equal(f.counts().layouts,1);
  assert.equal(f.frames.length,0);
  assert.equal(f.timers.length,0);
  assert.ok(f.entry.querySelector('.slb-tabbar'));
 }finally{f.dom.window.close()}
});

test('unready translation storage follows existing deferred callback',()=>{
 const f=fixture({ready:false});
 try{
  f.trigger();
  assert.equal(f.counts().hydrated,0);
  assert.equal(f.frames.length,1);
  assert.equal(f.timers.length,0);
  f.frames.shift()();
  assert.equal(f.counts().hydrated,1);
 }finally{f.dom.window.close()}
});

test('bulk open preserves bounded queued editor work instead of immediate conversions',()=>{
 const f=fixture({bulk:true,ready:true});
 try{
  f.trigger();
  assert.equal(f.counts().hydrated,0);
  assert.equal(f.queued.length,1);
  assert.equal(f.frames.length,0);
  f.queued.shift()();
  assert.equal(f.counts().hydrated,1);
 }finally{f.dom.window.close()}
});

test('already prepared editor is reused and no duplicate hydration occurs',()=>{
 const f=fixture({ready:true});
 try{
  f.trigger();f.trigger();
  assert.equal(f.counts().hydrated,1);
  assert.equal(f.frames.length,0);
 }finally{f.dom.window.close()}
});

test('a heavy immediate builder blocks the click before first paint (risk measurement)',()=>{
 const f=fixture({ready:true,buildMs:15});
 try{
  const start=performance.now();f.trigger();const elapsed=performance.now()-start;
  assert.ok(elapsed>=15,'synchronous expensive work necessarily delays click');
  assert.equal(f.frames.length,0);
  assert.equal(f.counts().hydrated,1);
 }finally{f.dom.window.close()}
});
