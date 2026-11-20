const {test}=require('node:test');
const assert=require('node:assert/strict');
const {readFileSync}=require('node:fs');
const {join}=require('node:path');
const {JSDOM}=require('jsdom');
const {pathToFileURL}=require('node:url');

const dir=join(__dirname,'..');
const source=readFileSync(join(dir,'index.js'),'utf8');
const css=readFileSync(join(dir,'library-shelf.css'),'utf8');
const libUrl=pathToFileURL(join(dir,'library-shelf.js')).href;

test('native select placeholder is not inserted as a fake first book',async()=>{
 const {canonicalLibraryBookNames}=await import(libUrl);
 const dom=new JSDOM('<select id="world_editor_select"><option value="">편집할 항목 선택</option><option value="0">실제 로어북 A</option><option value="1">실제 로어북 B</option></select>');
 try {
   const textOnly=[...dom.window.document.querySelectorAll('option')].map(x=>x.textContent);
   assert.deepEqual(textOnly,['편집할 항목 선택','실제 로어북 A','실제 로어북 B']);
   const names=canonicalLibraryBookNames(['실제 로어북 A','실제 로어북 B','실제 로어북 A','']);
   assert.deepEqual(names,['실제 로어북 A','실제 로어북 B']);
   assert.deepEqual(canonicalLibraryBookNames(undefined),[]);
   assert.match(source,/listBooks:\s*\(\)\s*=>\s*canonicalLibraryBookNames\(world_names\)/);
   assert.doesNotMatch(source,/listBooks:\s*\(\)\s*=>\s*\[\.\.\.new Set\(existingLorebookNames\(\)\)\]/);
 }finally{dom.window.close()}
});

test('general, diary, encyclopedia and address book have distinct physical spine classes and icons',async()=>{
 const {createStandaloneLibrary}=await import(libUrl);
 const dom=new JSDOM('<!doctype html><html><body></body></html>',{runScripts:'outside-only'});
 const w=dom.window;
 try{
  const books=['일반 설정집','기억 일기장','World Encyclopedia','등장인물 연락처'];
  const types={'일반 설정집':'general','기억 일기장':'memory','World Encyclopedia':'world','등장인물 연락처':'people'};
  let typeReads=0,loads=0,settingsWrites=0;
  const api=createStandaloneLibrary({
    document:w.document,listBooks:()=>books,linkedBooks:()=>new Set(books),
    loadBook:async()=>{loads++;return {entries:{0:{uid:0,content:'original',comment:'entry',displayIndex:0}}};},
    loadTranslations:async()=>{},translationFor:()=>({text:''}),
    saveContent:async()=>{},saveTranslation:async()=>{},translateOne:async()=>{},
    openAdvanced:()=>{},getType:book=>types[book],
    getTypeMap:()=>{typeReads++;return types;},
    setType:(book,type)=>{types[book]=type;settingsWrites++;},
    getTagMap:()=>({}),getTags:()=>[],setTags:async()=>{},getTheme:()=> 'antique',notify:()=>{},
  });
  api.open();
  assert.equal(typeReads,1,'type-map is read once, not once per book');
  const spines=[...w.document.querySelectorAll('.slb-library-book-spine')];
  assert.equal(spines.length,4);
  assert.deepEqual(spines.map(x=>x.dataset.bookType),['general','memory','world','people']);
  assert.deepEqual(spines.map(x=>x.querySelector('.slb-library-spine-ornament').textContent),['▱','❦','✣','◈']);
  assert.equal(spines[3].querySelector('.slb-library-spine-bottom').textContent,'A–Z');
  assert.equal(loads,0,'shelf does not load world data to identify book types');
  spines[0].click();
  await new Promise(resolve=>setImmediate(resolve));
  const select=w.document.querySelector('#slb-library-book-type');
  select.value='memory';
  select.dispatchEvent(new w.Event('change',{bubbles:true}));
  assert.equal(settingsWrites,1);
  w.document.querySelector('[data-action="books"]').click();
  assert.equal(w.document.querySelector('[data-book="일반 설정집"]').dataset.bookType,'memory');
  assert.equal(typeReads,2,'the shelf refresh reads type metadata once');
 }finally{dom.window.close()}
});

test('shelf no longer displays the redundant title and instructional sentence or shelf tag editor',async()=>{
 const {createStandaloneLibrary}=await import(libUrl);
 const dom=new JSDOM('<html><body></body></html>',{runScripts:'outside-only'});
 const w=dom.window;
 try{
  const lib=createStandaloneLibrary({
    document:w.document,listBooks:()=>['Book'],linkedBooks:()=>new Set(['Book']),
    loadBook:async()=>({entries:{}}),loadTranslations:async()=>{},
    translationFor:()=>({}),saveContent:async()=>{},saveTranslation:async()=>{},
    translateOne:async()=>{},openAdvanced:()=>{},getType:()=> 'general',
    setType:()=>{},getTags:()=>[],setTags:async()=>{},getTheme:()=> 'antique',notify:()=>{},
  });
  lib.open();
  const root=w.document.querySelector('.slb-library-body');
  assert.doesNotMatch(root.textContent,/나의 로어북 서가|책등을 선택하면 해당 로어북이 열립니다/);
  assert.equal(root.querySelector('[data-action="tag-mode"]'),null);
  assert.equal(root.querySelector('#slb-library-book-tag-input'),null);
  root.querySelector('[data-action="select-book"]').click();
  await new Promise(resolve=>setImmediate(resolve));
  assert.ok(w.document.querySelector('#slb-library-book-tag-input'),'book tags are directly editable inside even empty books');
 }finally{dom.window.close()}
});

test('type design uses static CSS, preserves user font and keeps title orientation',()=>{
 assert.match(css,/button\.slb-library-spine-type-general\s*\{/);
 assert.match(css,/button\.slb-library-spine-type-memory\s*\{/);
 assert.match(css,/button\.slb-library-spine-type-world\s*\{/);
 assert.match(css,/button\.slb-library-spine-type-people\s*\{/);
 assert.match(css,/\.slb-library-spine-type-people::after/);
 assert.match(css,/\.slb-library-spine-type-memory::after/);
 assert.match(css,/writing-mode:\s*vertical-rl/);
 assert.match(css,/text-orientation:\s*mixed/);
 assert.match(css,/\.slb-library-book-meta\s*\{/);
 assert.match(css,/\.slb-library-book-tag-field\s*\{/);
 assert.doesNotMatch(css,/(?:font-family\s*:|@font-face|Georgia|Noto Serif KR|sans-serif)/i);
 assert.doesNotMatch(source,/(?:new MutationObserver|setInterval)\([\s\S]{0,150}spine/);
});
