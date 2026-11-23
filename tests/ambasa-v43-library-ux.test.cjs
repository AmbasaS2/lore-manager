const {test}=require('node:test');
const assert=require('node:assert/strict');
const {JSDOM}=require('jsdom');
const {join}=require('node:path');
const {readFileSync}=require('node:fs');
const {pathToFileURL}=require('node:url');
const root=join(__dirname,'..');
const url=pathToFileURL(join(root,'library-shelf.js')).href;
const css=readFileSync(join(root,'library-shelf.css'),'utf8');
const index=readFileSync(join(root,'index.js'),'utf8');
const tick=()=>new Promise(r=>setImmediate(r));
const entries=n=>({entries:Object.fromEntries(Array.from({length:n},(_,i)=>[i,{
  uid:i,displayIndex:i,comment:(i===0?'2024/06/10 · ':'')+'Entry '+i,
  content:'Original content '+i,key:['Keyword '+i]
}]))});

async function setup({nBooks=36,nEntries=30,theme='antique',variant='mac',
  linkedOnly=true,type='general',linkedNames=null}={}) {
 const {createStandaloneLibrary}=await import(url);
 const dom=new JSDOM('<!doctype html><html><body></body></html>',
   {runScripts:'outside-only',pretendToBeVisual:true});
 const w=dom.window;w.confirm=()=>true;
 const books=Array.from({length:nBooks},(_,i)=>'Book '+(i+1));
 const state={theme,variant,linkedOnly,type};
 const stats={bookReads:0,translations:0,sourceWrites:0,translatedWrites:0,ai:0,linkedSaves:0,themeSaves:0};
 const library=createStandaloneLibrary({
  document:w.document,listBooks:()=>books,
  linkedBooks:()=>linkedNames??new Set(books.slice(0,3)),
  loadBook:async()=>{stats.bookReads++;return entries(nEntries)},
  loadTranslations:async()=>{stats.translations++},
  translationFor:()=>({text:''}),
  saveContent:async()=>{stats.sourceWrites++},saveTranslation:async()=>{stats.translatedWrites++},
  translateOne:async()=>{stats.ai++},openAdvanced:()=>{},
  getType:()=>state.type,setType:(b,t)=>{state.type=t},
  getTypeMap:()=>({}),getTags:()=>[],getTagMap:()=>({}),setTags:async()=>{},
  getTheme:()=>state.theme,setTheme:async v=>{state.theme=v;stats.themeSaves++},
  getCleanVariant:()=>state.variant,setCleanVariant:async v=>{state.variant=v;stats.themeSaves++},
  getLinkedOnly:()=>state.linkedOnly,setLinkedOnly:async v=>{state.linkedOnly=v;stats.linkedSaves++},
  notify:()=>{}
 });
 library.open();
 const q=selector=>w.document.querySelector(selector);
 const all=selector=>[...w.document.querySelectorAll(selector)];
 const click=selector=>{const node=q(selector);assert.ok(node,'not found '+selector);node.click()};
 const change=(selector,value)=>{const node=q(selector);assert.ok(node,'not found '+selector);if(node.type==='checkbox')node.checked=Boolean(value);else node.value=value;
   node.dispatchEvent(new w.Event('change',{bubbles:true}));};
 const input=(selector,value)=>{const node=q(selector);assert.ok(node,'not found '+selector);node.value=value;
   node.dispatchEvent(new w.Event('input',{bubbles:true}));};
 const load=async()=>{click('[data-action="select-book"]');await tick();await tick()};
 return {dom,w,books,state,stats,library,q,all,click,change,input,load};
}

test('settings gear sits before close button and panels stay closed until explicitly opened',async()=>{
 const f=await setup();
 try{
   const header=f.q('.slb-library-header-actions');
   assert.deepEqual([...header.querySelectorAll('[data-action]')].map(x=>x.dataset.action),['settings','minimize','close']);
   assert.equal(f.q('.slb-library-settings-panel').hidden,true);
   assert.equal(f.q('.slb-library-appearance').closest('.slb-library-navigation'),null);
   f.click('[data-action="settings"]');
   assert.equal(f.q('.slb-library-settings-panel').hidden,false);
   assert.equal(f.q('#slb-library-theme-mode').value,'antique');
   assert.equal(f.q('#slb-library-linked-only').checked,true);
   f.click('[data-action="settings"]');
   assert.equal(f.q('.slb-library-settings-panel').hidden,true);
 }finally{f.dom.window.close()}
});

test('linked-book choice lives in saved library setting, not native global ST filter',async()=>{
 const f=await setup({nBooks:12});
 try{
   assert.equal(f.all('.slb-library-book-spine').length,3);
   f.change('#slb-library-linked-only',false);
   await tick();
   assert.equal(f.state.linkedOnly,false);
   assert.equal(f.stats.linkedSaves,1);
   assert.equal(f.all('.slb-library-book-spine').length,12);
   assert.equal(f.stats.bookReads,0);
   f.change('#slb-library-linked-only',true);await tick();
   assert.equal(f.all('.slb-library-book-spine').length,3);
   assert.match(index,/libraryLinkedOnly:\s*true/);
   assert.doesNotMatch(index,/showOnlyLinkedLorebooks\s*=\s*settings\.libraryLinkedOnly/);
 }finally{f.dom.window.close()}
});

test('shelf title search filters metadata only and preserves input caret, without fetching books',async()=>{
 const f=await setup({nBooks:35,linkedOnly:false});
 try{
   assert.equal(f.all('.slb-library-book-spine').length,35);
   f.input('#slb-library-shelf-search','Book 34');
   assert.equal(f.all('.slb-library-book-spine').length,1);
   assert.equal(f.q('.slb-library-book-spine').dataset.book,'Book 34');
   assert.equal(f.q('#slb-library-shelf-search').value,'Book 34');
   assert.equal(f.w.document.activeElement.id,'slb-library-shelf-search');
   assert.deepEqual([f.stats.bookReads,f.stats.translations,f.stats.ai],[0,0,0]);
 }finally{f.dom.window.close()}
});

test('three-row initial shelf adapts to narrow widths and more shows two more rows',async()=>{
 const f=await setup({nBooks:40,linkedOnly:false});
 try{
   Object.defineProperty(f.w,'innerWidth',{configurable:true,value:390});
   Object.defineProperty(f.q('.slb-library-body'),'clientWidth',{configurable:true,value:380});
   f.input('#slb-library-shelf-search','Book');
   assert.equal(f.all('.slb-library-book-spine').length,21);
   f.click('[data-action="shelf-more"]');
   assert.equal(f.all('.slb-library-book-spine').length,35);
   assert.equal(f.stats.bookReads,0);
 }finally{f.dom.window.close()}
});

test('classic memory uses a bounded five-entry TOC and retains the two-page journal spread',async()=>{
 const f=await setup({type:'memory',nEntries:100});
 try{
   await f.load();
   assert.ok(f.q('.slb-library-reader-classic'));
   assert.equal(f.all('.slb-library-diary-page').length,2);
   assert.equal(f.q('#slb-library-diary-select'),null);
   assert.equal(f.all('.slb-library-diary-toc .slb-library-index-item').length,5);
   for (let i = 0; i < 5; i++) f.click('[data-action="memory-list-next"]');
   f.click('[data-action="diary-entry"][data-index="28"]');
   assert.deepEqual(f.all('.slb-library-diary-page').map(x=>x.dataset.uid),['28','29']);
   f.click('[data-action="diary-next"]');
   assert.deepEqual(f.all('.slb-library-diary-page').map(x=>x.dataset.uid),['30','31']);
   assert.deepEqual([f.stats.bookReads,f.stats.ai,f.stats.sourceWrites],[1,0,0]);
 }finally{f.dom.window.close()}
});

test('MacBook journal uses a single clean card and Blackberry adds a distinct device keyboard',async()=>{
 for(const variant of ['mac','blackberry']){
   const f=await setup({theme:variant,type:'memory'});
   try{
     await f.load();
     assert.equal(f.all('.slb-library-diary-page').length,1);
     assert.ok(f.q('.slb-library-reader-'+variant));
     assert.equal(f.all('.slb-library-device-keyboard').length,variant==='mac'?0:1);
     f.click('[data-action="diary-next"]');
     assert.equal(f.q('.slb-library-diary-page').dataset.uid,'1');
   }finally{f.dom.window.close()}
 }
});

test('world reference keeps the vertical searchable index visible beside its detail',async()=>{
 const f=await setup({type:'world'});
 try{
   await f.load();
   assert.equal(f.all('.slb-library-index-item').length,5);
   assert.ok(f.q('.slb-library-index-layout.is-index-open'));
   assert.equal(f.q('.slb-library-detail-world').dataset.uid,'0');
   f.input('#slb-library-search','Entry 17');
   assert.equal(f.all('.slb-library-index-item').length,1);
   f.click('[data-action="entry"][data-uid="17"]');
   assert.equal(f.q('.slb-library-detail-world').dataset.uid,'17');
   assert.ok(f.q('.slb-library-index-layout.is-index-open'),'world TOC no longer collapses');
   assert.equal(f.q('[data-action="world-menu"]'),null);
   assert.equal(f.stats.bookReads,1);
 }finally{f.dom.window.close()}
});

test('contacts show full-width searchable names then replace list with one profile and back',async()=>{
 const f=await setup({type:'people'});
 try{
   await f.load();
   assert.equal(f.all('.slb-library-person-row').length,5);
   assert.equal(f.q('.slb-library-detail-people'),null);
   f.input('#slb-library-search','Entry 18');
   assert.equal(f.all('.slb-library-person-row').length,1);
   f.click('[data-action="entry"][data-uid="18"]');
   assert.equal(f.all('.slb-library-person-row').length,0);
   assert.equal(f.q('.slb-library-detail-people').dataset.uid,'18');
   f.click('[data-action="people-back"]');
   assert.equal(f.all('.slb-library-person-row').length,1);
   assert.equal(f.q('.slb-library-detail-people'),null);
 }finally{f.dom.window.close()}
});

test('resize grip responds to pointer deltas without using observers or reloading lore data',async()=>{
 const f=await setup({nBooks:20,linkedOnly:false});
 try{
   const shell=f.q('.slb-library-shell');
   const grip=f.q('.slb-library-resize-grip');
   assert.ok(grip);
   shell.getBoundingClientRect=()=>({left:210,top:105,width:600,height:530});
   const down=new f.w.MouseEvent('pointerdown',{bubbles:true,button:0,clientX:560,clientY:500});
   grip.dispatchEvent(down);
   const move=new f.w.MouseEvent('pointermove',{bubbles:true,clientX:650,clientY:540});
   f.w.dispatchEvent(move);
   assert.equal(shell.style.width,'780px');
   assert.equal(shell.style.height,'610px');
   assert.equal(shell.style.position,'fixed');
   assert.equal(shell.style.left,'120px');
   assert.equal(shell.style.top,'65px');
   assert.equal(shell.style.transform,'none');
   f.w.dispatchEvent(new f.w.MouseEvent('pointerup',{bubbles:true,clientX:650,clientY:540}));
   assert.equal(f.stats.bookReads,0);
 }finally{f.dom.window.close()}
});

test('independent reader inherits font family; only compact settings/pager use fixed small UI sizes',()=>{
 assert.doesNotMatch(css,/font-family\s*:/i);
 assert.doesNotMatch(css,/@font-face|@import/i);
 const compactStart = css.indexOf('/* ambasa.54 — compact');
 const minimizeStart = css.indexOf('/* ambasa.54: KongTalk-style minimization');
 assert.ok(compactStart > 0 && minimizeStart > compactStart);
 assert.doesNotMatch(css.slice(0,compactStart),/font-size\s*:\s*\d+(?:\.\d+)?px/i);
 assert.match(css.slice(compactStart,minimizeStart),/\.slb-library-settings-panel \.slb-library-linked-setting\s*\{[^}]*font-size:\s*11px !important/s);
 assert.match(css.slice(compactStart,minimizeStart),/select\.slb-library-page-size-select\s*\{[^}]*font-size:\s*11px !important/s);
 assert.match(css,/#slb-library-overlay\s*\{[^}]*font:\s*inherit/s);
 assert.match(css,/\.slb-library-tagbar button\s*\{[^}]*font-size:\s*\.83em/s);
 assert.match(css,/\.slb-library-resize-grip/);
 assert.doesNotMatch(css,/#WorldInfo[^{]*font-size:/);
});
