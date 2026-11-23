const {test}=require('node:test');
const assert=require('node:assert/strict');
const {JSDOM}=require('jsdom');
const {readFileSync}=require('node:fs');
const {join}=require('node:path');
const {pathToFileURL}=require('node:url');
const root=join(__dirname,'..');
const js=readFileSync(join(root,'library-shelf.js'),'utf8');
const css=readFileSync(join(root,'library-shelf.css'),'utf8');
const url=pathToFileURL(join(root,'library-shelf.js')).href;
const tick=()=>new Promise(resolve=>setImmediate(resolve));
async function fixture({theme='antique',type='people',n=17}={}){
 const {createStandaloneLibrary}=await import(url);
 const dom=new JSDOM('<!doctype html><html><body></body></html>',{runScripts:'outside-only',pretendToBeVisual:true});
 const w=dom.window;w.confirm=()=>true;
 const books=['Lore World','Lore Diary','Lore People','Lore General'];
 const stats={reads:0,translations:0,sourceSaves:0,translationSaves:0,ai:0,images:0};
 const entries={};
 for(let i=0;i<n;i++)entries[i]={uid:i,displayIndex:i,comment:'Entry '+i,
  content:'Unique content for '+i,key:['keyword'+i]};
 const lib=createStandaloneLibrary({
  document:w.document,listBooks:()=>books,linkedBooks:()=>new Set(books),
  loadBook:async()=>{stats.reads++;return {entries}},
  loadTranslations:async()=>{stats.translations++},
  translationFor:()=>({text:''}),
  saveContent:async()=>{stats.sourceSaves++},
  saveTranslation:async()=>{stats.translationSaves++},
  translateOne:async()=>{stats.ai++},openAdvanced:()=>{},
  getType:()=>type,getTypeMap:()=>Object.fromEntries(books.map(b=>[b,type])),
  setType:()=>{},getTags:()=>[],getTagMap:()=>({}),setTags:async()=>{},
  getTheme:()=>theme,getLinkedOnly:()=>true,getBookCoverMap:()=>({}),notify:()=>{}
 });
 lib.open();
 const q=s=>w.document.querySelector(s),qa=s=>[...w.document.querySelectorAll(s)];
 const click=s=>{const node=q(s);assert.ok(node,'missing '+s);node.click();};
 const load=async()=>{click('[data-action="select-book"]');await tick();};
 const search=(value)=>{
  const input=q('#slb-library-search');
  assert.ok(input);
  input.value=value;input.dispatchEvent(new w.Event('input',{bubbles:true}));
 };
 return {dom,w,q,qa,click,load,search,stats};
}
test('every shelf has one icon-only magnifier trigger and no visible word or duplicated icon',async()=>{
 for(const theme of ['antique','mac','blackberry','ebook']){
  const f=await fixture({theme});
  try{
   const button=f.q('[data-action="shelf-search-toggle"]');
   assert.ok(button.querySelector('.fa-magnifying-glass'));
   assert.equal(button.textContent.trim(),'');
   assert.equal(button.getAttribute('aria-label'),'검색');
   assert.equal(f.qa('.slb-library-shelf-search-icon').length,0);
   assert.equal(f.qa('#slb-library-shelf-search').length,1);
   f.click('[data-action="shelf-search-toggle"]');
   assert.ok(f.q('.slb-library-shelf-toolbar.is-search-open'));
   assert.equal(f.w.document.activeElement.id,'slb-library-shelf-search');
   f.w.document.dispatchEvent(new f.w.KeyboardEvent('keydown',{key:'Escape',bubbles:true}));
   assert.ok(f.q('#slb-library-overlay'));
   assert.equal(f.q('.slb-library-shelf-toolbar.is-search-open'),null);
   assert.equal(f.stats.reads,0);
  }finally{f.dom.window.close()}
 }
});

test('all reader types in all four themes use a single icon-only and working search',async()=>{
 for(const theme of ['antique','mac','blackberry','ebook']){
  for(const type of ['general','memory','world','people']){
   const f=await fixture({theme,type});
   try{
    await f.load();
    const btn=f.q('[data-action="reader-search-toggle"]');
    assert.ok(btn);
    assert.equal(btn.textContent.trim(),'');
    assert.ok(btn.querySelector('.fa-magnifying-glass'));
    assert.equal(btn.getAttribute('aria-expanded'),'false');
    assert.equal(f.qa('#slb-library-search').length,1);
    assert.equal(f.qa('.slb-library-world-search, .slb-library-people-search').length,0);
    f.click('[data-action="reader-search-toggle"]');
    assert.ok(f.q('.slb-library-navigation.is-search-open'));
    assert.equal(f.w.document.activeElement.id,'slb-library-search');
    f.search('Entry 16');
    assert.equal(f.q('#slb-library-search').value,'Entry 16');
    assert.ok(f.q('.slb-library-navigation.is-search-open'),'search stays visible after rerender');
    assert.equal(f.w.document.activeElement.id,'slb-library-search','typing retains focus');
    f.w.document.dispatchEvent(new f.w.KeyboardEvent('keydown',{key:'Escape',bubbles:true}));
    assert.ok(f.q('#slb-library-overlay'));
    assert.equal(f.q('.slb-library-navigation.is-search-open'),null);
    assert.deepEqual([f.stats.reads,f.stats.ai,f.stats.sourceSaves,f.stats.translationSaves],[1,0,0,0]);
   }finally{f.dom.window.close()}
  }
 }
});

test('all encyclopedias keep the table of contents visible without a folding bar',async()=>{
 for(const theme of ['antique','mac','blackberry','ebook']){
  const f=await fixture({theme,type:'world'});
  try{
   await f.load();
   assert.ok(f.q('.slb-library-index-layout.is-index-open'));
   assert.equal(f.q('[data-action="world-menu"]'),null);
   assert.equal(f.qa('.slb-library-index-item').length,5);
   assert.equal(f.q('.slb-library-index-layout.is-index-open')!==null,true);
   assert.match(f.q('.slb-library-world-pages').getAttribute('aria-label'),/개 항목/);
   assert.equal(f.q('[data-action="world-prev"]').textContent,'‹');
   assert.equal(f.q('[data-action="world-next"]').textContent,'›');
   assert.equal(f.q('[data-action="world-prev"]').getAttribute('aria-label'),'이전 목차');
   f.click('[data-action="world-next"]');
   assert.deepEqual(f.qa('.slb-library-index-initial').map(e=>e.textContent),['06','07','08','09','10']);
   assert.equal(f.stats.reads,1);
  }finally{f.dom.window.close()}
 }
});

test('all four people readers show five names then paginated arrows, preserving page after profile back',async()=>{
 for(const theme of ['antique','mac','blackberry','ebook']){
  const f=await fixture({theme,type:'people'});
  try{
   await f.load();
   assert.equal(f.qa('.slb-library-person-row').length,5);
   assert.equal(f.q('.slb-library-people-pages small').textContent,'1 / 4');
   assert.equal(f.q('[data-action="people-prev"]').disabled,true);
   assert.equal(f.q('[data-action="people-next"]').textContent,'›');
   f.click('[data-action="people-next"]');
   assert.equal(f.q('.slb-library-people-pages small').textContent,'2 / 4');
   assert.deepEqual(f.qa('.slb-library-person-row').map(x=>x.dataset.uid),['5','6','7','8','9']);
   f.click('[data-action="entry"][data-uid="7"]');
   assert.equal(f.qa('.slb-library-person-row').length,0);
   assert.equal(f.q('.slb-library-detail-people').dataset.uid,'7');
   f.click('[data-action="people-back"]');
   assert.deepEqual(f.qa('.slb-library-person-row').map(x=>x.dataset.uid),['5','6','7','8','9']);
   f.click('[data-action="people-next"]');
   f.click('[data-action="people-next"]');
   assert.deepEqual(f.qa('.slb-library-person-row').map(x=>x.dataset.uid),['15','16']);
   assert.equal(f.q('[data-action="people-next"]').disabled,true);
   f.click('[data-action="people-prev"]');
   assert.equal(f.q('.slb-library-people-pages small').textContent,'3 / 4');
   assert.equal(f.stats.ai,0);
   assert.equal(f.stats.sourceSaves,0);
  }finally{f.dom.window.close()}
 }
});

test('search reduces contact directory and resets pagination without changing entry data',async()=>{
 const f=await fixture({theme:'ebook',type:'people'});
 try{
  await f.load();
  f.click('[data-action="people-next"]');f.click('[data-action="people-next"]');
  f.click('[data-action="reader-search-toggle"]');
  f.search('Entry 16');
  assert.deepEqual(f.qa('.slb-library-person-row').map(x=>x.dataset.uid),['16']);
  assert.equal(f.q('.slb-library-people-pages small').textContent,'1 / 1');
  assert.equal(f.stats.reads,1);
  assert.deepEqual([f.stats.sourceSaves,f.stats.translationSaves,f.stats.ai],[0,0,0]);
 }finally{f.dom.window.close()}
});

test('Mac/BlackBerry cardfile no longer includes decorative empty square before entry title',async()=>{
 for(const theme of ['mac','blackberry']){
  const f=await fixture({theme,type:'general'});
  try{
   await f.load();
   const item=f.q('.slb-library-clean-list-row');
   assert.ok(item.querySelector('strong'));
   assert.equal(item.querySelector('.slb-library-clean-list-icon'),null);
   assert.equal(item.children.length,2,'only title and opening chevron');
   assert.equal(f.stats.reads,1);
  }finally{f.dom.window.close()}
 }
});

test('CSS makes book tops straight, keeps read tools right together and prevents long contacts scrolling',()=>{
 assert.match(css,/button\.slb-library-book-spine\s*\{[^}]*border-radius:\s*2px 4px 1px 1px/s);
 assert.match(css,/\.slb-library-reader-tools > button\.slb-library-more-tools\s*\{[^}]*margin-left:\s*0 !important/s);
 assert.match(css.slice(css.lastIndexOf('/* v50:')),/\.slb-library-reader-clean \.slb-library-people-list\s*\{[^}]*overflow:\s*visible !important/s);
 assert.match(css,/\.slb-library-world-pages button,[\s\S]*\.slb-library-people-pages button\s*\{[^}]*font-size:\s*1\.25em/s);
 assert.doesNotMatch(css,/font-family\s*:/i);
});
