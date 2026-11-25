const {test}=require('node:test');
const assert=require('node:assert/strict');
const {JSDOM}=require('jsdom');
const {readFileSync}=require('node:fs');
const {join}=require('node:path');
const {pathToFileURL}=require('node:url');
const root=join(__dirname,'..');
const source=readFileSync(join(root,'library-shelf.js'),'utf8');
const css=readFileSync(join(root,'library-shelf.css'),'utf8');
const uri=pathToFileURL(join(root,'library-shelf.js')).href;
const tick=()=>new Promise(resolve=>setImmediate(resolve));
async function fixture({mode='antique',kind='world',nBooks=45,nEntries=25}={}){
 const {createStandaloneLibrary}=await import(uri);
 const dom=new JSDOM('<!doctype html><html><body></body></html>',{pretendToBeVisual:true,runScripts:'outside-only'});
 const w=dom.window;w.confirm=()=>true;
 Object.defineProperty(w,'innerHeight',{configurable:true,value:1050});
 const books=Array.from({length:nBooks},(_,i)=>'Book '+i);
 const entries={};
 for(let i=0;i<nEntries;i++)entries[i]={uid:i,displayIndex:i,comment:'Article '+i,content:'Original lore content '+i,key:['tag'+i]};
 const data={loads:0,ai:0,save:0,tagSaves:0};
 const lib=createStandaloneLibrary({
  document:w.document,listBooks:()=>books,linkedBooks:()=>new Set(books),
  loadBook:async()=>{data.loads++;return {entries}},
  loadTranslations:async()=>{},translationFor:()=>({text:''}),
  saveContent:async()=>{data.save++},saveTranslation:async()=>{data.save++},translateOne:async()=>{data.ai++},
  openAdvanced:()=>{},getType:()=>kind,getTypeMap:()=>Object.fromEntries(books.map(b=>[b,kind])),
  setType:()=>{},getTags:()=>[],getTagMap:()=>({}),setTags:async()=>{data.tagSaves++},
  getBookCoverMap:()=>({}),getTheme:()=>mode,getLinkedOnly:()=>true,notify:()=>{}
 });
 lib.open();
 const q=s=>w.document.querySelector(s),qa=s=>[...w.document.querySelectorAll(s)];
 const click=s=>{const el=q(s);assert.ok(el,'missing '+s);el.click()};
 const load=async()=>{click('[data-action="select-book"]');await tick()};
 const shell=q('.slb-library-shell');
 shell.getBoundingClientRect=()=>{
  const l=Number.parseFloat(shell.style.left),t=Number.parseFloat(shell.style.top);
  const width=Number.parseFloat(shell.style.width),height=Number.parseFloat(shell.style.height);
  return {left:l,top:t,right:l+width,bottom:t+height,x:l,y:t,width,height};
 };
 const point=(type,x,y,id=35)=>{const ev=new w.MouseEvent(type,{bubbles:true,button:0,clientX:x,clientY:y});
   Object.defineProperty(ev,'pointerId',{value:id});return ev};
 return {dom,w,lib,books,kind,mode,data,q,qa,click,load,shell,point};
}
test('defaults to the approved 460px shell and three shelf rows without any lore loads',async()=>{
 for(const mode of ['antique','mac','blackberry','ebook']){
  const f=await fixture({mode});
  try{
   assert.equal(f.shell.style.width,'460px');
   assert.equal(f.shell.style.position,'fixed');
   assert.equal(f.q('#slb-library-shelf-search').placeholder,'검색');
   assert.ok(f.q('.slb-library-shelf-search-toggle .fa-magnifying-glass'));
   const grid=f.q('.slb-library-book-spines,.slb-library-cover-grid,.slb-library-app-grid,.slb-library-folder-grid');
   const count=Number(grid.style.getPropertyValue('--slb-shelf-columns'));
   assert.ok(count>=3);
   assert.equal(f.qa('[data-action="select-book"]').length,3*count);
   assert.deepEqual(f.data,{loads:0,ai:0,save:0,tagSaves:0});
  }finally{f.dom.window.close()}
 }
});
test('header drag follows pointer, keeps bounds, and excludes settings/close controls',async()=>{
 const f=await fixture();
 try{
   const header=f.q('.slb-library-top'),settings=f.q('.slb-library-settings-button');
   const old=f.shell.getBoundingClientRect();
   const x=old.left+100,y=old.top+20;
   header.dispatchEvent(f.point('pointerdown',x,y));
   assert.equal(f.shell.style.left,old.left+'px');
   assert.equal(f.shell.style.top,old.top+'px');
   f.w.dispatchEvent(f.point('pointermove',x+65,y+45));
   const moved=f.shell.getBoundingClientRect();
   assert.equal(moved.left,old.left+65);assert.equal(moved.top,old.top+45);
   f.w.dispatchEvent(f.point('pointerup',x+65,y+45));
   f.w.dispatchEvent(f.point('pointermove',x+150,y+150));
   assert.equal(f.shell.getBoundingClientRect().left,moved.left);
   settings.dispatchEvent(f.point('pointerdown',100,100,82));
   f.w.dispatchEvent(f.point('pointermove',300,300,82));
   assert.equal(f.shell.getBoundingClientRect().left,moved.left);
   assert.deepEqual(f.data,{loads:0,ai:0,save:0,tagSaves:0});
 }finally{f.dom.window.close()}
});
test('header dragging clamps on all four viewport edges, even with large move',async()=>{
 const f=await fixture();
 try{
   const rect=f.shell.getBoundingClientRect();const header=f.q('.slb-library-top');
   header.dispatchEvent(f.point('pointerdown',rect.left+40,rect.top+20));
   f.w.dispatchEvent(f.point('pointermove',-12000,-12000));
   let moved=f.shell.getBoundingClientRect();
   assert.ok(moved.left>=15&&moved.top>=15);
   f.w.dispatchEvent(f.point('pointermove',12000,12000));
   moved=f.shell.getBoundingClientRect();
   assert.ok(moved.right<=f.w.innerWidth-15&&moved.bottom<=f.w.innerHeight-15);
   f.w.dispatchEvent(f.point('pointerup',12000,12000));
 }finally{f.dom.window.close()}
});
test('narrow search button opens the real search and Escape closes it, not the modal',async()=>{
 const f=await fixture();
 try{
  const toggle=f.q('[data-action="shelf-search-toggle"]');
  assert.equal(toggle.getAttribute('aria-expanded'),'false');
  toggle.click();
  assert.ok(f.q('.slb-library-shelf-toolbar.is-search-open'));
  assert.equal(f.w.document.activeElement.id,'slb-library-shelf-search');
  const search=f.q('#slb-library-shelf-search');
  const prior = f.qa('[data-action="select-book"]').length;
  search.value='Book 44';
  search.dispatchEvent(new f.w.Event('input',{bubbles:true}));
  assert.equal(f.qa('[data-action="select-book"]').length,prior);
  f.w.document.dispatchEvent(new f.w.KeyboardEvent('keydown',{key:'Escape',bubbles:true}));
  assert.ok(f.q('#slb-library-overlay'));
  assert.equal(f.q('.slb-library-shelf-toolbar.is-search-open'),null);
  assert.equal(f.data.loads,0);
 }finally{f.dom.window.close()}
});
test('classic journal and encyclopedia keep tag beside title with independent bounded contents',async()=>{
 for(const kind of ['memory','world']){
  const f=await fixture({kind,nEntries:22});
  try{
   await f.load();
   assert.ok(f.q('.slb-library-reader-book-tags > .slb-library-book-meta'));
   assert.equal(f.q('.slb-library-reader-meta-row'),null);
   if(kind==='memory'){
    assert.equal(f.q('[data-action="memory-menu"]'),null);
    assert.equal(f.q('#slb-library-memory-contents').hidden,false);
    assert.ok(f.q('[data-action="memory-list-next"]'));
    assert.equal(f.qa('[data-action="diary-entry"]').length,5);
    assert.ok(f.q('.slb-library-diary-page'));
   }else{
    assert.equal(f.q('[data-action="world-menu"]'),null);
    assert.ok(f.q('.slb-library-reader-inner .slb-library-contents-frame .slb-library-index-layout.is-index-open'));
    assert.match(f.q('.slb-library-world-pages').getAttribute('aria-label'),/22개 항목/);
   }
   assert.equal(f.data.loads,1);
  }finally{f.dom.window.close()}
 }
});
test('world contents pages exactly five records and forwards without scrolling or inventing chapters',async()=>{
 const f=await fixture({mode:'ebook',kind:'world',nEntries:22});
 try{
  await f.load();
  assert.deepEqual(f.qa('.slb-library-index-initial').map(x=>x.textContent),['01','02','03','04','05']);
  f.click('[data-action="world-next"]');
  assert.deepEqual(f.qa('.slb-library-index-initial').map(x=>x.textContent),['06','07','08','09','10']);
  f.click('[data-action="entry"][data-uid="7"]');
  assert.equal(f.q('.slb-library-detail-world').dataset.uid,'7');
  assert.ok(f.q('.slb-library-index-layout.is-index-open'),'contents stay accessible beside detail');
  assert.equal(f.q('[data-action="world-menu"]'),null);
  assert.equal(f.data.loads,1);
  assert.equal(f.data.ai,0);
 }finally{f.dom.window.close()}
});
test('reader has exactly one shared search; encyclopedia and people no longer duplicate inputs',async()=>{
 for(const kind of ['people','world']){
  const f=await fixture({mode:'ebook',kind,nEntries:25});
  try{
   await f.load();
   assert.ok(f.q('#slb-library-search'));
   assert.equal(f.q('#slb-library-search').placeholder,'검색');
   assert.equal(f.q('.slb-library-world-search'),null);
   assert.equal(f.q('.slb-library-people-search'),null);
   const input=f.q('#slb-library-search');
   input.value='Article 19';input.dispatchEvent(new f.w.Event('input',{bubbles:true}));
   f.q('#slb-library-search').dispatchEvent(new f.w.KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true}));
   if(kind==='people'){
    assert.equal(f.qa('.slb-library-person-row').length,1);
    assert.equal(f.q('.slb-library-person-row strong').textContent,'Article 19');
   }else{
    assert.equal(f.qa('.slb-library-index-item').length,1);
    assert.equal(f.q('.slb-library-index-initial').textContent,'20');
   }
   assert.equal(f.data.loads,1);assert.equal(f.data.ai,0);
  }finally{f.dom.window.close()}
 }
});
test('no redundant PERSONAL INDEX, no fabricated status controls, only BlackBerry trackpad',async()=>{
 const f=await fixture({mode:'blackberry',kind:'people'});
 try{
  await f.load();
  assert.equal(f.q('.slb-library-person-directory > small'),null);
  assert.ok(f.q('.slb-library-reader-blackberry .slb-library-device-trackpad'));
  assert.equal(f.q('.slb-library-reader-blackberry .slb-library-device-nav-symbol'),null);
  assert.equal(f.q('.slb-library-person-back'),null);
  f.click('[data-action="entry"][data-uid="4"]');
  assert.equal(f.q('.slb-library-person-back').textContent,'‹ 인물록');
 }finally{f.dom.window.close()}
});
test('no changes to native WorldInfo, translation save, or UI font family',()=>{
 assert.doesNotMatch(css,/font-family\s*:/i);
 assert.doesNotMatch(source,/new MutationObserver|setInterval\(/);
 assert.match(css,/#slb-library-overlay \.slb-library-top\s*\{[^}]*cursor:\s*grab/s);
 assert.match(css,/#slb-library-overlay \.slb-library-shell\s*\{[^}]*border-top:\s*0 !important/s);
 assert.match(css,/@container \(max-width: 380px\)/);
});
