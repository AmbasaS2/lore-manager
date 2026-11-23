const {test}=require('node:test');
const assert=require('node:assert/strict');
const {JSDOM}=require('jsdom');
const {join}=require('node:path');
const {readFileSync}=require('node:fs');
const {pathToFileURL}=require('node:url');
const root=join(__dirname,'..');
const url=pathToFileURL(join(root,'library-shelf.js')).href;
const shelf=readFileSync(join(root,'library-shelf.js'),'utf8');
const css=readFileSync(join(root,'library-shelf.css'),'utf8');
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const titles=['기본 원문','연속 기록','설정 참고','인물 관계'];
async function fixture({theme='antique',variant='mac',type='general',width=0,n=12}={}){
  const {createStandaloneLibrary}=await import(url);
  const dom=new JSDOM('<!doctype html><html><body></body></html>',{pretendToBeVisual:true,runScripts:'outside-only'});
  const w=dom.window;w.confirm=()=>true;
  const state={theme,variant,type,readerWidth:width};
  const stat={load:0,translate:0,ai:0,savedSource:0,savedTranslation:0};
  if(width){
    Object.defineProperty(w.HTMLElement.prototype,'clientWidth',{configurable:true,get(){
      if(this.classList?.contains('slb-library-reader-inner'))return state.readerWidth;
      if(this.classList?.contains('slb-library-body'))return state.readerWidth+36;
      if(this.classList?.contains('slb-library-shell'))return state.readerWidth+70;
      return 0;
    }});
  }
  const list=['Book 1','Book 2','Book 3','Book 4'];
  const entries={};
  for(let i=0;i<n;i++)entries[String(i)]={uid:i,displayIndex:i,comment:titles[i]||('Entry '+i),key:['KEY'+i],content:'Original content '+i};
  const c=createStandaloneLibrary({
    document:w.document,listBooks:()=>list,linkedBooks:()=>new Set(list),
    loadBook:async()=>{stat.load++;return {entries}},
    loadTranslations:async()=>{stat.translate++},translationFor:()=>({text:''}),
    saveContent:async()=>{stat.savedSource++},saveTranslation:async()=>{stat.savedTranslation++},
    translateOne:async()=>{stat.ai++},openAdvanced:()=>{},
    getType:()=>state.type,getTypeMap:()=>Object.fromEntries(list.map(x=>[x,state.type])),
    setType:(_,t)=>state.type=t,getTags:()=>[],getTagMap:()=>({}),setTags:async()=>{},
    getEntryImage:()=>'',getBookCover:()=>'',getBookCoverMap:()=>({}),
    getTheme:()=>state.theme,getCleanVariant:()=>state.variant,getLinkedOnly:()=>true,notify:()=>{}
  });
  c.open();
  const q=s=>w.document.querySelector(s);
  const qa=s=>[...w.document.querySelectorAll(s)];
  const click=s=>{const e=q(s);assert.ok(e,'missing '+s);e.click()};
  const load=async()=>{click('[data-action="select-book"]');await tick()};
  return {dom,w,state,stat,q,qa,click,load};
}

test('compact shelf title search is right aligned and matches saved-tag width',()=>{
 assert.match(css,/\.slb-library-body\[data-type="books"\] \.slb-library-books-head\s*\{[^}]*justify-content:\s*flex-end/s);
 assert.match(css,/\.slb-library-body\[data-type="books"\] \.slb-library-shelf-search\s*\{[^}]*width:\s*124px/s);
 assert.match(css,/\.slb-library-body\[data-type="books"\] \.slb-library-shelf-search\s*\{[^}]*height:\s*29px/s);
 assert.match(css,/\.slb-library-shelf-tag-select\s*\{/);
});

test('all reader modes use compact labels without any repeated library prefix or fabricated time',async()=>{
 for(const variant of ['mac','blackberry']){
  for(const type of ['general','memory','world','people']){
   const f=await fixture({theme:variant,type});
   try{
    await f.load();
    const h=f.q(variant==='mac' ? '.slb-library-clean-chrome strong' : '.slb-library-app-device-head strong');
    assert.equal(h.textContent,{general:'카드파일',memory:'메모리',world:'백과사전',people:'인물록'}[type]);
    assert.equal(f.q('.slb-library-clean-chrome small'),null,'no repeated LORE LIBRARY');
    assert.equal(f.q('.slb-library-device-top'),null,'no fake clock/status header');
    assert.doesNotMatch(f.q('.slb-library-reader-frame').textContent,/14:05|로어 라이브러리\s*·/);
    assert.equal(f.stat.ai,0);
   }finally{f.dom.window.close()}
  }
 }
 assert.doesNotMatch(shelf,/14:05|로어 라이브러리 ·/);
});

test('narrow antique diary really builds one full page and advances one record',async()=>{
 const f=await fixture({theme:'antique',type:'memory',width:390,n:24});
 try{
  await f.load();
  assert.deepEqual(f.qa('.slb-library-diary-page').map(e=>e.dataset.uid),['0']);
  assert.equal(f.q('.slb-library-diary-pager span').textContent,'01–01 / 24');
  f.click('[data-action="diary-next"]');
  assert.deepEqual(f.qa('.slb-library-diary-page').map(e=>e.dataset.uid),['1']);
  assert.equal(f.q('#slb-library-diary-select').value,'1');
  assert.equal(f.stat.load,1);
  assert.equal(f.stat.ai,0);
 }finally{f.dom.window.close()}
});

test('wide antique journal still displays two real facing pages and advances by two',async()=>{
 const f=await fixture({theme:'antique',type:'memory',width:910,n:24});
 try{
  await f.load();
  assert.deepEqual(f.qa('.slb-library-diary-page').map(e=>e.dataset.uid),['0','1']);
  f.click('[data-action="diary-next"]');
  assert.deepEqual(f.qa('.slb-library-diary-page').map(e=>e.dataset.uid),['2','3']);
  assert.equal(f.stat.load,1);
 }finally{f.dom.window.close()}
});

test('classic general retains distinct cards, then opens one independent detail',async()=>{
 const f=await fixture({theme:'antique',type:'general'});
 try{
  await f.load();
  assert.equal(f.qa('.slb-library-catalog-card').length,12);
  const card=f.q('.slb-library-catalog-card');
  assert.ok(card.querySelector('strong'));
  f.click('[data-action="entry"][data-uid="3"]');
  assert.equal(f.qa('.slb-library-catalog-card').length,0);
  assert.equal(f.q('.slb-library-detail-general').dataset.uid,'3');
  f.click('[data-action="catalog-back"]');
  assert.equal(f.qa('.slb-library-catalog-card').length,12);
  assert.equal(f.stat.savedSource,0);
  assert.equal(f.stat.savedTranslation,0);
 }finally{f.dom.window.close()}
});

test('cover layout uses distinct saved-type variants instead of just arbitrary color order',async()=>{
 for(const type of ['general','memory','world','people']){
  const f=await fixture({theme:'clean',type});
  try{
   const cover=f.q('.slb-library-cover-art');
   assert.ok(cover.classList.contains('slb-library-cover-type-'+type));
   assert.equal(cover.querySelector('.slb-library-cover-mark').textContent,
      {general:'F',memory:'J',world:'W',people:'A–Z'}[type]);
   assert.match(css,new RegExp('\\.slb-library-cover-art\\.slb-library-cover-type-'+type+'\\s*\\{'));
   assert.equal(f.stat.load,0);
  }finally{f.dom.window.close()}
 }
});

test('world search displays readable stable index numbers when filtered',async()=>{
 const f=await fixture({type:'world',theme:'clean'});
 try{
  await f.load();
  assert.equal(f.q('.slb-library-index-initial').textContent,'01');
  const search=f.q('#slb-library-search');
  search.value='Entry 9';
  search.dispatchEvent(new f.w.Event('input',{bubbles:true}));
  assert.deepEqual(f.qa('.slb-library-index-initial').map(e=>e.textContent),['10']);
  assert.equal(f.q('.slb-library-world-menu').getAttribute('aria-label'),'목차 접기');
  assert.match(f.q('.slb-library-world-menu').textContent,/목차 · CONTENTS/);
  assert.match(css,/\.slb-library-index-initial\s*\{[^}]*color:\s*#384655/s);
 }finally{f.dom.window.close()}
});

test('people search uses concise names and opens one profile',async()=>{
 const f=await fixture({type:'people',theme:'clean'});
 try{
  await f.load();
  assert.equal(f.q('#slb-library-search').placeholder,'검색');
  assert.equal(f.q('.slb-library-people-search'),null,'search is unified at the top');
  assert.equal(f.qa('.slb-library-person-row').length,5);
  f.click('[data-action="entry"][data-uid="1"]');
  assert.equal(f.qa('.slb-library-person-row').length,0);
  assert.equal(f.q('.slb-library-detail-people').dataset.uid,'1');
 }finally{f.dom.window.close()}
});

test('tag summaries are chip-sized, opened editing is available, reading prose is not resized',async()=>{
 const f=await fixture({type:'world',theme:'clean'});
 try{
  await f.load();
  const tag=f.q('details.slb-library-book-meta');
  assert.ok(tag&&!tag.open);
  tag.open=true;
  assert.ok(f.q('#slb-library-book-tag-input'));
  assert.match(css,/details\.slb-library-book-meta\s*\{[^}]*width:\s*fit-content/s);
  assert.match(css,/\.slb-library-book-meta-summary\s*\{[^}]*min-height:\s*27px/s);
  assert.doesNotMatch(css,/\.slb-library-prose\s*\{[^}]*font-size:/s);
  assert.equal(f.stat.savedSource,0);
 }finally{f.dom.window.close()}
});

test('resizing an opened classic journal refreshes the one/two-page layout without reloading or saving data',async()=>{
 const f=await fixture({theme:'antique',type:'memory',width:900,n:18});
 try{
  await f.load();
  assert.equal(f.qa('.slb-library-diary-page').length,2);
  const grip=f.q('.slb-library-resize-grip');
  assert.ok(grip);
  f.state.readerWidth=390;
  grip.dispatchEvent(new f.w.MouseEvent('pointerdown',{bubbles:true,button:0,clientX:360,clientY:490}));
  f.w.dispatchEvent(new f.w.MouseEvent('pointerup',{bubbles:true,button:0,clientX:360,clientY:490}));
  assert.equal(f.qa('.slb-library-diary-page').length,1);
  f.click('[data-action="diary-next"]');
  assert.equal(f.q('.slb-library-diary-page').dataset.uid,'1');
  f.state.readerWidth=900;
  grip.dispatchEvent(new f.w.MouseEvent('pointerdown',{bubbles:true,button:0,clientX:400,clientY:500}));
  f.w.dispatchEvent(new f.w.MouseEvent('pointerup',{bubbles:true,button:0,clientX:400,clientY:500}));
  assert.equal(f.qa('.slb-library-diary-page').length,2);
  assert.equal(f.stat.load,1);
  assert.deepEqual([f.stat.savedSource,f.stat.savedTranslation,f.stat.ai],[0,0,0]);
 }finally{f.dom.window.close()}
});

test('tag disclosure uses a CSS chevron rather than unsupported box text',()=>{
 assert.match(css,/\.slb-library-book-meta \.slb-library-book-meta-summary::after\s*\{[^}]*content:\s*'' !important/s);
 assert.match(css,/\.slb-library-book-meta \.slb-library-book-meta-summary::after\s*\{[^}]*border-right:\s*1px solid/s);
 assert.match(css,/\.slb-library-book-meta\[open\] > \.slb-library-book-meta-summary::after/);
});
