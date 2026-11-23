const {test}=require('node:test');
const assert=require('node:assert/strict');
const {JSDOM}=require('jsdom');
const {readFileSync}=require('node:fs');
const {join}=require('node:path');
const {pathToFileURL}=require('node:url');
const folder=join(__dirname,'..');
const source=readFileSync(join(folder,'library-shelf.js'),'utf8');
const css=readFileSync(join(folder,'library-shelf.css'),'utf8');
const url=pathToFileURL(join(folder,'library-shelf.js')).href;
function data(n){
 const entries={};for(let i=0;i<n;i++)entries[i]={uid:i,displayIndex:i,comment:'Record '+i,content:'Source '+i,key:['keyword'+i]};
 return {entries};
}
async function fixture({n=4,translations={0:'번역본 0'}}={}){
 const {createStandaloneLibrary}=await import(url);
 const dom=new JSDOM('<html><body></body></html>',{runScripts:'outside-only',pretendToBeVisual:true});
 const win=dom.window;win.confirm=()=>true;
 const loaded=data(n);
 const actions={loads:0,saves:[],translates:[],ai:0,advanced:[],imageGets:0};
 const library=createStandaloneLibrary({
  document:win.document,listBooks:()=>['Records'],linkedBooks:()=>new Set(['Records']),
  loadBook:async()=>{actions.loads++;return loaded},loadTranslations:async()=>{},
  translationFor:(book,e)=>({text:translations[e.uid]||''}),
  saveContent:async(book,uid,previous,next)=>{actions.saves.push(['source',uid,previous,next]);loaded.entries[uid].content=next;return loaded;},
  saveTranslation:async(book,e,next,prev)=>{actions.saves.push(['translated',e.uid,prev,next]);translations[e.uid]=next;},
  translateOne:async()=>{actions.ai++;},openAdvanced:(b,u)=>actions.advanced.push([b,u]),
  getType:()=> 'general',setType:()=>{},getTags:()=>[],setTags:async()=>{},
  getEntryImage:()=>{actions.imageGets++;return ''},getTheme:()=> 'antique',notify:()=>{}
 });
 library.open();
 win.document.querySelector('[data-action="select-book"]').click();
 await new Promise(resolve=>setImmediate(resolve));
 const click=s=>{const el=win.document.querySelector(s);assert.ok(el,'missing '+s);el.click()};
 return {library,dom,win,actions,click,translations};
}
test('new catalog shows title-only stacked records without a redundant type heading or duplicated detail',async()=>{
 const f=await fixture({n:240});
 try{
   const d=f.win.document;
   assert.equal(d.querySelectorAll('.slb-library-catalog-card').length,5);
   assert.equal(d.querySelector('.slb-library-catalog-card').childElementCount,1);
   assert.equal(d.querySelector('.slb-library-catalog-card p'),null);
   assert.equal(d.querySelector('.slb-library-contents-count').textContent,'240개 항목');
   assert.equal(d.querySelectorAll('.slb-library-detail').length,0);
   assert.equal(f.actions.imageGets,0,'card titles do not load 240 optional images');
   f.click('[data-action="entry"][data-uid="0"]');
   assert.equal(d.querySelectorAll('.slb-library-catalog-card').length,0);
   assert.equal(d.querySelectorAll('.slb-library-detail').length,1);
   assert.equal(d.querySelector('.slb-library-catalog-position').textContent,'01 / 240');
   assert.equal(d.querySelector('.slb-library-section-head'),null);
   assert.equal(d.querySelectorAll('[data-action="edit"]').length,1);
   assert.equal(d.querySelectorAll('[data-action="both"]').length,0);
   assert.equal(d.querySelectorAll('[data-action="edit-source"]').length,0);
   assert.equal(d.querySelectorAll('[data-action="edit-translated"]').length,0);
   assert.equal(d.querySelector('[data-action="advanced"]').textContent,'로어북 바로가기');
   assert.equal(f.actions.imageGets,1,'only the selected record loads its image metadata');
   f.click('[data-action="catalog-back"]');
   assert.equal(d.querySelectorAll('.slb-library-catalog-card').length,5);
 }finally{f.dom.window.close()}
});
test('one Edit action follows the visible source or saved translation, without ever calling AI',async()=>{
 const f=await fixture();
 try{
   const d=f.win.document;
   f.click('[data-action="entry"][data-uid="0"]');
   assert.equal(d.querySelector('.slb-library-reading').dataset.readView,'translated');
   f.click('[data-action="edit"]');
   let area=d.querySelector('.slb-library-editor-text');
   assert.equal(area.value,'번역본 0');
   area.value='번역본 새로 고침';
   f.click('[data-action="save-edit"]');
   await new Promise(resolve=>setImmediate(resolve));
   f.click('[data-action="toggle-view"]');
   assert.equal(d.querySelector('.slb-library-reading').dataset.readView,'source');
   f.click('[data-action="edit"]');
   area=d.querySelector('.slb-library-editor-text');
   assert.equal(area.value,'Source 0');
   area.value='Updated source';
   f.click('[data-action="save-edit"]');
   await new Promise(resolve=>setImmediate(resolve));
   assert.deepEqual(f.actions.saves,[['translated',0,'번역본 0','번역본 새로 고침'],['source','0','Source 0','Updated source']]);
   assert.equal(f.actions.ai,0);
 }finally{f.dom.window.close()}
});
test('missing translation starts on source, yet still permits manually writing a translation with one Edit button',async()=>{
 const f=await fixture({translations:{}});
 try{
   f.click('[data-action="entry"][data-uid="1"]');
   const d=f.win.document;
   assert.equal(d.querySelector('.slb-library-reading').dataset.readView,'source');
   assert.match(d.querySelector('.slb-library-prose').textContent,/Source 1/);
   f.click('[data-action="toggle-view"]');
   assert.equal(d.querySelector('.slb-library-reading').dataset.readView,'translated');
   assert.match(d.querySelector('.slb-library-prose').textContent,/번역본이 없습니다/);
   f.click('[data-action="edit"]');
   const area=d.querySelector('.slb-library-editor-text');
   assert.equal(area.value,'');
   area.value='수동 입력 번역';
   f.click('[data-action="save-edit"]');
   await new Promise(resolve=>setImmediate(resolve));
   assert.deepEqual(f.actions.saves,[['translated',1,'','수동 입력 번역']]);
   assert.equal(f.actions.ai,0);
 }finally{f.dom.window.close()}
});
test('previous/next uses original UID order and does not silently discard unsaved edits',async()=>{
 const f=await fixture({n:5});
 try{
   const d=f.win.document;
   f.click('[data-action="entry"][data-uid="0"]');
   f.click('[data-action="catalog-next"]');
   assert.equal(d.querySelector('.slb-library-catalog-position').textContent,'02 / 05');
   f.click('[data-action="edit"]');
   const area=d.querySelector('.slb-library-editor-text');
   area.value='Unsaved';
   f.win.confirm=()=>false;
   f.click('[data-action="catalog-next"]');
   assert.equal(d.querySelector('.slb-library-catalog-position').textContent,'02 / 05');
   assert.equal(d.querySelector('.slb-library-editor-text').value,'Unsaved');
   f.win.confirm=()=>true;
   f.click('[data-action="catalog-next"]');
   assert.equal(d.querySelector('.slb-library-catalog-position').textContent,'03 / 05');
   f.click('[data-action="catalog-prev"]');
   assert.equal(d.querySelector('.slb-library-catalog-position').textContent,'02 / 05');
   assert.equal(f.actions.saves.length,0);
 }finally{f.dom.window.close()}
});
test('neutral palette and stacked cards stay inside scoped library styles; no font forcing or observers',()=>{
 assert.match(css,/--ll-paper:\s*#f7f7f4;/);
 assert.match(css,/--ll-paper-light:\s*#fffefd;/);
 assert.match(css,/--ll-leather:\s*#403832;/);
 assert.match(css,/--ll-brass:\s*#99846a;/);
 assert.match(css,/\.slb-library-catalog-card \+ button\s*\{\s*margin-top:\s*-12px;/);
 assert.match(css,/transform:\s*rotate\(-1deg\)/);
 assert.match(css,/\.slb-library-catalog-pager\s*\{/);
 assert.doesNotMatch(css,/(?:font-family\s*:|@font-face|Georgia|Noto Serif KR|sans-serif)/i);
 assert.doesNotMatch(source,/new (MutationObserver|ResizeObserver)\s*\(|setInterval\s*\(/);
 assert.doesNotMatch(source,/function toggleBoth\(/);
 assert.doesNotMatch(source,/data-action="both"/);
});
