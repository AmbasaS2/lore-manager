const {test}=require('node:test');
const assert=require('node:assert/strict');
const {JSDOM}=require('jsdom');
const {join}=require('node:path');
const {pathToFileURL}=require('node:url');
const {readFileSync}=require('node:fs');
const root=join(__dirname,'..');
const moduleUrl=pathToFileURL(join(root,'library-shelf.js')).href;
const css=readFileSync(join(root,'library-shelf.css'),'utf8');
const index=readFileSync(join(root,'index.js'),'utf8');
const tick=()=>new Promise(r=>setImmediate(r));
const names=['World Book','Memory Book','People Book','General Book',
 ...Array.from({length:36},(_,i)=>'Volume '+i)];
const types=Object.fromEntries(names.map((name,i)=>[name,['world','memory','people','general'][i%4]]));
async function fixture({theme='antique',variant='mac',books=names,viewport=800,
  covers={'World Book':'/user/images/personal-world.png'}}={}){
 const {createStandaloneLibrary}=await import(moduleUrl);
 const dom=new JSDOM('<!doctype html><html><body></body></html>',{pretendToBeVisual:true,runScripts:'outside-only'});
 const w=dom.window;w.confirm=()=>true;
 const state={theme,variant},stats={loads:0,ai:0,translationReads:0,originalWrites:0,
  translationWrites:0,themeSaves:0,typeSaves:0,coverReads:0,tagReads:0};
 let failTheme=false;
 const lib=createStandaloneLibrary({
  document:w.document,listBooks:()=>books,linkedBooks:()=>new Set(books),
  loadBook:async()=>{stats.loads++;return {entries:{1:{uid:1,displayIndex:0,comment:'Actual saved title',
    content:'Original record text',key:['world']}}}},
  loadTranslations:async()=>{stats.translationReads++},
  translationFor:()=>({text:'Recorded translation'}),
  translateOne:async()=>{stats.ai++},
  saveContent:async()=>{stats.originalWrites++},
  saveTranslation:async()=>{stats.translationWrites++},
  openAdvanced:()=>{},
  getType:name=>types[name]||'general',
  getTypeMap:()=>types,
  setType:()=>{stats.typeSaves++},
  getTags:()=>[],getTagMap:()=>{stats.tagReads++;return {}},
  setTags:async()=>{},
  getBookCover:name=>covers[name]||'',getBookCoverMap:()=>{stats.coverReads++;return covers},
  uploadBookCover:async()=>{},removeBookCover:async()=>{},
  getTheme:()=>state.theme,setTheme:async value=>{
   if(failTheme)throw Error('settings write denied');
   state.theme=value;stats.themeSaves++;
  },
  getCleanVariant:()=>state.variant,setCleanVariant:async value=>{state.variant=value},
  getLinkedOnly:()=>true,setLinkedOnly:async()=>{},notify:()=>{}
 });
 lib.open();
 const q=s=>w.document.querySelector(s);
 const qa=s=>[...w.document.querySelectorAll(s)];
 const click=s=>{const n=q(s);assert.ok(n,'missing '+s);n.click()};
 const change=(selector,value)=>{const n=q(selector);assert.ok(n);n.value=value;
  n.dispatchEvent(new w.Event('change',{bubbles:true}))};
 const resizeTo=value=>{
  const shell=q('.slb-library-shell'),body=q('.slb-library-body');
  Object.defineProperty(shell,'clientWidth',{configurable:true,value});
  Object.defineProperty(body,'clientWidth',{configurable:true,value:value-30});
  click('[data-action="shelf-tag"][data-filter="all"]');
 };
 resizeTo(viewport);
 return {dom,w,lib,q,qa,click,change,resizeTo,state,stats,covers,books,
  failTheme:value=>{failTheme=value;}};
}

test('the settings dropdown exposes exactly four independent themes and no extra clean variant',async()=>{
 const f=await fixture();
 try{
  const sel=f.q('#slb-library-theme-mode');
  assert.deepEqual([...sel.options].map(o=>[o.value,o.textContent]),[
   ['antique','클래식 아카이브'],['mac','맥북'],['blackberry','블랙베리'],['ebook','E북 서재']
  ]);
  assert.equal(f.q('#slb-library-clean-variant'),null);
  assert.equal(f.q('.slb-library-variant-wrap'),null);
  assert.equal(f.q('.slb-library-bookshelf').classList.contains('slb-library-digital-bookshelf'),false);
 }finally{f.dom.window.close()}
});

test('mac shelf renders accessible Finder folders with working sidebar type filter, no content fetch',async()=>{
 const f=await fixture({theme:'mac'});
 try{
  assert.ok(f.q('.slb-library-finder'));
  assert.ok(f.q('.slb-library-finder-titlebar'));
  assert.equal(f.qa('.slb-library-folder-card').length,15);
  assert.equal(f.qa('.slb-library-book-spine,.slb-library-cover-art,.slb-library-app-card').length,0);
  assert.deepEqual(f.qa('.slb-library-folder-card').slice(0,4).map(n=>n.querySelector('.slb-library-folder-symbol').textContent),
    ['W','J','A–Z','F']);
  f.click('[data-action="shelf-type"][data-filter="world"]');
  assert.equal(f.qa('.slb-library-folder-card').length,10,'all ten saved world books remain discoverable');
  assert.ok(f.qa('.slb-library-folder-card').every(n=>types[n.dataset.book]==='world'));
  f.click('[data-action="shelf-type"][data-filter="all"]');
  assert.equal(f.qa('.slb-library-folder-card').length,15);
  assert.deepEqual([f.stats.loads,f.stats.translationReads,f.stats.ai,f.stats.coverReads],[0,0,0,0]);
 }finally{f.dom.window.close()}
});

test('BlackBerry shelf is a distinct app grid and device keyboard, without a forced clock',async()=>{
 const f=await fixture({theme:'blackberry'});
 try{
  assert.ok(f.q('.slb-library-app-device'));
  assert.equal(f.qa('.slb-library-app-card').length,15);
  assert.ok(f.q('.slb-library-app-device .slb-library-device-keyboard'));
  assert.deepEqual(f.qa('.slb-library-app-card').slice(0,4).map(n=>n.querySelector('.slb-library-app-symbol').textContent),
    ['W','J','A–Z','F']);
  assert.equal(f.qa('.slb-library-folder-card,.slb-library-cover-art,.slb-library-book-spine').length,0);
  assert.doesNotMatch(f.q('.slb-library-app-device').textContent,/14:05/);
  assert.equal(f.stats.loads,0);
 }finally{f.dom.window.close()}
});

test('Ebook shelf alone shows cover-facing front art, upload overlays and editor buttons',async()=>{
 const f=await fixture({theme:'ebook'});
 try{
  assert.equal(f.qa('.slb-library-cover-art').length,18);
  assert.equal(f.qa('.slb-library-folder-card,.slb-library-app-card,.slb-library-book-spine').length,0);
  const image=f.q('[data-action="select-book"][data-book="World Book"] .slb-library-cover-image');
  assert.ok(image);assert.equal(image.getAttribute('src'),'/user/images/personal-world.png');
  assert.ok(f.q('[data-action="cover-config"][data-book="World Book"]'));
  assert.ok(f.stats.coverReads>=1,'cover metadata reads occur only on ebook shelf refresh');
  assert.equal(f.stats.loads,0);
 }finally{f.dom.window.close()}
});

test('old clean theme maps to ebook shelf without erasing original user cover and legacy setting',async()=>{
 const f=await fixture({theme:'clean',variant:'blackberry'});
 try{
  assert.equal(f.q('#slb-library-theme-mode').value,'ebook');
  assert.equal(f.q('#slb-library-overlay').dataset.libraryTheme,'ebook');
  assert.equal(f.q('#slb-library-overlay').dataset.variant,'ebook');
  assert.ok(f.q('.slb-library-cover-image'));
  assert.equal(f.state.theme,'clean','normalization at reader boundary does not overwrite external settings');
  assert.match(index,/settings\.libraryTheme === 'clean'\) settings\.libraryTheme = 'ebook'/);
  assert.match(index,/libraryCleanVariant: 'mac'/);
 }finally{f.dom.window.close()}
});

test('the four theme selector persists, rerenders shelf and restores failed saves',async()=>{
 const f=await fixture();
 try{
  for(const [mode,selector] of [
   ['mac','.slb-library-finder'],['blackberry','.slb-library-app-device'],
   ['ebook','.slb-library-cover-grid'],['antique','.slb-library-book-spines']
  ]){
   f.change('#slb-library-theme-mode',mode);await tick();
   assert.equal(f.state.theme,mode);
   assert.ok(f.q(selector),'missing '+selector);
   assert.equal(f.q('#slb-library-overlay').dataset.libraryTheme,mode);
  }
  assert.equal(f.stats.themeSaves,4);
  f.failTheme(true);
  f.change('#slb-library-theme-mode','mac');await tick();
  assert.equal(f.state.theme,'antique');
  assert.equal(f.q('#slb-library-theme-mode').value,'antique');
  assert.equal(f.stats.loads,0);
 }finally{f.dom.window.close()}
});

test('narrow columns preserve exactly three rows and more reveals two more rows',async()=>{
 for(const [theme,sizes] of [
  ['mac',[[360,3],[440,3]]],
  ['blackberry',[[360,3],[440,4]]],
  ['ebook',[[360,3],[440,4]]]
 ]){
  const f=await fixture({theme});
  try{
   for(const [width,columns] of sizes){
    f.resizeTo(width);
    const grid=f.q(theme==='mac'?'.slb-library-folder-grid':theme==='blackberry'?'.slb-library-app-grid':'.slb-library-cover-grid');
    const selector=theme==='mac'?'.slb-library-folder-card':theme==='blackberry'?'.slb-library-app-card':'.slb-library-cover-item';
    assert.equal(grid.style.getPropertyValue('--slb-shelf-columns'),String(columns));
    assert.equal(f.qa(selector).length,columns*3);
    f.click('[data-action="shelf-more"]');
    assert.equal(f.qa(selector).length,columns*5);
   }
   assert.equal(f.stats.loads,0);
  }finally{f.dom.window.close()}
 }
});

test('reader UI is distinct in all four themes, with real saved records and no eager AI',async()=>{
 for(const [theme,selector] of [
  ['antique','.slb-library-reader-classic'],
  ['mac','.slb-library-reader-mac .slb-library-clean-workspace'],
  ['blackberry','.slb-library-reader-blackberry .slb-library-app-reading-screen'],
  ['ebook','.slb-library-reader-ebook .slb-library-ebook-paper'],
 ]){
  const f=await fixture({theme});
  try{
   f.click('[data-action="select-book"][data-book="General Book"]');await tick();
   assert.ok(f.q(selector),'missing '+selector);
   assert.ok(f.q('.slb-library-reader-inner'));
   assert.equal(f.stats.loads,1);
   assert.equal(f.stats.translationReads,1);
   assert.equal(f.stats.ai,0);
   assert.equal(f.stats.originalWrites,0);
   assert.equal(f.stats.translationWrites,0);
   if(theme==='mac'||theme==='blackberry')assert.ok(f.q('.slb-library-clean-list'));
   if(theme==='ebook'||theme==='antique')assert.ok(f.q('.slb-library-catalog'));
   if(theme==='blackberry')assert.ok(f.q('.slb-library-reader-blackberry .slb-library-device-keyboard'));
   if(theme==='ebook')assert.equal(f.qa('.slb-library-clean-sidebar').length,0);
  }finally{f.dom.window.close()}
 }
});

test('four book types retain their own actual type-based folder, app and ebook identity',async()=>{
 for(const [mode,selector,mark] of [
  ['mac','.slb-library-folder-card','.slb-library-folder-symbol'],
  ['blackberry','.slb-library-app-card','.slb-library-app-symbol'],
  ['ebook','.slb-library-cover-item','.slb-library-cover-mark']
 ]){
  const f=await fixture({theme:mode});
  try{
   assert.deepEqual(f.qa(selector).slice(0,4).map(e=>e.querySelector(mark).textContent),['W','J','A–Z','F']);
   assert.equal(f.stats.loads,0);
   assert.match(css,/slb-library-finder-workspace/);
   assert.match(css,/slb-library-app-device-screen/);
  }finally{f.dom.window.close()}
 }
});

test('narrow reader content-search toggle is functional and Escape hides it without closing library',async()=>{
 const f=await fixture({theme:'mac',viewport:390});
 try{
  f.click('[data-action="select-book"][data-book="General Book"]');await tick();
  assert.ok(f.q('.slb-library-navigation.slb-library-has-book'));
  assert.equal(f.q('[data-action="reader-search-toggle"]').getAttribute('aria-expanded'),'false');
  f.click('[data-action="reader-search-toggle"]');
  assert.ok(f.q('.slb-library-navigation.is-search-open'));
  assert.equal(f.q('[data-action="reader-search-toggle"]').getAttribute('aria-expanded'),'true');
  assert.equal(f.w.document.activeElement.id,'slb-library-search');
  f.w.document.dispatchEvent(new f.w.KeyboardEvent('keydown',{bubbles:true,key:'Escape'}));
  assert.equal(f.q('.slb-library-navigation.is-search-open'),null);
  assert.equal(f.q('#slb-library-overlay')!==null,true);
  assert.equal(f.stats.ai,0);
 }finally{f.dom.window.close()}
});
