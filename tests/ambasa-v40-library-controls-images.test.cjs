const { test } = require('node:test');
const assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');
const { join } = require('node:path');
const { readFileSync } = require('node:fs');
const { pathToFileURL } = require('node:url');
const root=join(__dirname,'..');
const libUrl=pathToFileURL(join(root,'library-shelf.js')).href;
const css=readFileSync(join(root,'library-shelf.css'),'utf8');
const index=readFileSync(join(root,'index.js'),'utf8');

async function mock(linked) {
 const {createStandaloneLibrary}=await import(libUrl);
 const dom=new JSDOM('<!doctype html><html><head></head><body></body></html>',
     {runScripts:'outside-only',pretendToBeVisual:true});
 const w=dom.window;
 w.confirm=()=>true;
 const books=['기억','세계관','일반'];
 let reads=0,translations=0,metadataSaves=0,uploads=0,removes=0;
 const imageMap={};
 const lib=createStandaloneLibrary({
   document:w.document,listBooks:()=>books,linkedBooks:()=>linked,
   loadBook:async()=>{reads++;return {entries:{10:{uid:10,comment:'첫 기록',content:'원문',displayIndex:0}}};},
   loadTranslations:async()=>{translations++;},translationFor:()=>({text:'번역'}),
   saveContent:async()=>{throw Error('No WorldInfo save')},
   saveTranslation:async()=>{throw Error('No translation save')},
   translateOne:async()=>{throw Error('No AI')},openAdvanced:()=>{},
   getType:()=> 'general',setType:()=>{},
   getTags:()=>[],getTagMap:()=>({}),setTags:async()=>{metadataSaves++},
   getEntryImage:(book,entry)=>imageMap[book+':'+entry.uid]||'',
   uploadEntryImage:async(book,entry,file)=>{
     uploads++;
     assert.equal(file.name,'painting.png');
     imageMap[book+':'+entry.uid]='/user/images/my-picture.png';
   },
   removeEntryImage:async(book,entry)=>{removes++;delete imageMap[book+':'+entry.uid]},
   getTheme:()=> 'antique',notify:()=>{},
 });
 lib.open();
 const click=selector=>{let target=w.document.querySelector(selector);assert.ok(target,selector);target.click()};
 const load=async book=>{click('[data-action="select-book"][data-book="'+book+'"]');await new Promise(r=>setImmediate(r))};
 return {dom,w,click,load,lib,imageMap,
   stats:()=>({reads,translations,metadataSaves,uploads,removes})};
}

test('current-character checkbox with requested hint, fallback to all books for no linked worlds',async()=>{
 for(const linked of [new Set(),null]){
   const f=await mock(linked);
   try{
     const checkbox=f.w.document.querySelector('#slb-library-linked-only');
     assert.ok(checkbox?.checked);
     assert.equal(f.w.document.querySelector('.slb-library-linked-control').textContent.trim(),'현재 캐릭터에 연결된 책만 보기');
     assert.equal(f.w.document.querySelector('.slb-library-linked-hint').textContent.trim(),'연동된 로어북이 없으면 모든 책이 보여집니다');
     assert.equal(f.w.document.querySelectorAll('.slb-library-book-spine').length,3);
     assert.deepEqual(f.stats(),{reads:0,translations:0,metadataSaves:0,uploads:0,removes:0});
   }finally{f.dom.window.close()}
 }
});

test('shelf tag tabs and more books have styled, accessible and functional UI',async()=>{
 const f=await mock(new Set(['기억']));
 try{
   const tabs=[...f.w.document.querySelectorAll('.slb-library-tag-tab')];
   assert.equal(tabs.length,2);
   assert.equal(tabs[0].textContent,'전체');
   assert.equal(tabs[1].textContent,'미분류');
   assert.equal(tabs[0].getAttribute('aria-pressed'),'true');
   assert.equal(f.w.document.querySelectorAll('.slb-library-book-spine').length,1);
   const checkbox=f.w.document.querySelector('#slb-library-linked-only');
   checkbox.checked=false;
   checkbox.dispatchEvent(new f.w.Event('change',{bubbles:true}));
   assert.equal(f.w.document.querySelectorAll('.slb-library-book-spine').length,3);
 }finally{f.dom.window.close()}
 assert.match(css,/\.slb-library-tagbar button\s*\{[^}]*border-top: 3px solid var\(--ll-brass\)/s);
 assert.match(css,/button\.slb-library-shelf-more/);
});

test('opened book tags are collapsed to saved names or 미분류; expanded input keeps draft',async()=>{
 const f=await mock(new Set(['기억']));
 try{
   await f.load('기억');
   const details=f.w.document.querySelector('details.slb-library-book-meta');
   assert.ok(details);
   assert.equal(details.open,false);
   const summary=details.querySelector('summary');
   assert.equal(summary.textContent,'미분류');
   assert.equal(f.w.document.querySelector('.slb-library-meta-label'),null);
   details.open=true;
   details.dispatchEvent(new f.w.Event('toggle'));
   const field=f.w.document.querySelector('#slb-library-book-tag-input');
   assert.equal(field.placeholder,'쉼표로 구분 · 최대 8개');
   field.value='기억, 우정';
   field.dispatchEvent(new f.w.Event('input',{bubbles:true}));
   assert.equal(f.w.document.querySelector('[data-action="book-tag-save"]').disabled,false);
   f.click('[data-action="entry"][data-uid="10"]');
   assert.equal(f.w.document.querySelector('#slb-library-book-tag-input').value,'기억, 우정');
   assert.equal(f.w.document.querySelector('details.slb-library-book-meta').open,true);
   assert.equal(f.stats().metadataSaves,0);
 }finally{f.dom.window.close()}
});

test('single lore image is opt-in, lazy, local and independent of source/translation JSON',async()=>{
 const f=await mock(new Set(['기억']));
 try{
   await f.load('기억');
   f.click('[data-action="entry"][data-uid="10"]');
   assert.ok(f.w.document.querySelector('[data-action="image-pick"]'));
   assert.equal(f.w.document.querySelector('.slb-library-entry-image'),null);
   const input=f.w.document.querySelector('.slb-library-image-file');
   const file={name:'painting.png',size:4000,type:'image/png'};
   Object.defineProperty(input,'files',{value:[file],configurable:true});
   input.dispatchEvent(new f.w.Event('change',{bubbles:true}));
   assert.equal(f.stats().uploads,0,'selecting a file alone must not upload it');
   assert.equal(f.w.document.querySelector('.slb-library-image-file-name').textContent,'painting.png');
   f.click('[data-action="image-save"][data-uid="10"]');
   await new Promise(r=>setImmediate(r));
   assert.equal(f.stats().uploads,1);
   const img=f.w.document.querySelector('.slb-library-entry-image img');
   assert.ok(img);
   assert.equal(img.getAttribute('src'),'/user/images/my-picture.png');
   assert.equal(img.getAttribute('loading'),'lazy');
   assert.equal(f.stats().metadataSaves,0);
   f.click('[data-action="image-remove"][data-uid="10"]');
   await new Promise(r=>setImmediate(r));
   assert.equal(f.stats().removes,1);
   assert.equal(f.w.document.querySelector('.slb-library-entry-image'),null);
   assert.equal(f.stats().reads,1);
   assert.equal(f.stats().translations,1);
 }finally{f.dom.window.close()}
});

test('image path safety and invalid file rejection',async()=>{
 const {safeLibraryImagePath}=await import(libUrl);
 assert.equal(safeLibraryImagePath('/user/images/my.png'),'/user/images/my.png');
 assert.equal(safeLibraryImagePath('user/images/my.png'),'/user/images/my.png');
 for(const evil of ['javascript:alert(1)','https://evil.example/a.png','//evil.example/a.png',
    '/user/images/../secret.png','/user/images/a.png?x=1','data:image/png;base64,...']) {
   assert.equal(safeLibraryImagePath(evil),'',evil);
 }
 const f=await mock(new Set(['기억']));
 try{
  await f.load('기억');f.click('[data-action="entry"][data-uid="10"]');
  const input=f.w.document.querySelector('.slb-library-image-file');
  Object.defineProperty(input,'files',{value:[{name:'bad.svg',size:500,type:'image/svg+xml'}],configurable:true});
  input.dispatchEvent(new f.w.Event('change',{bubbles:true}));
  assert.equal(f.w.document.querySelector('[data-action="image-save"]'),null);
  assert.equal(f.stats().uploads,0);
 }finally{f.dom.window.close()}
});

test('navigation inputs share dedicated second row with no form font override',()=>{
 assert.match(css,/\.slb-library-nav-tools\s*\{[^}]*display:\s*grid;/s);
 assert.match(css,/grid-template-columns:\s*minmax\(0,\s*1fr\)\s+minmax\(0,\s*1fr\)/);
 assert.match(css,/\.slb-library-book-meta-summary/);
 assert.doesNotMatch(css,/(?:font-family\s*:|@font-face|Georgia|Noto Serif KR|sans-serif)/i);
 assert.match(index,/\/api\/images\/upload/);
 assert.match(index,/libraryEntryImages/);
 assert.match(index,/saveLibraryEntryImagePath/);
 assert.match(index,/getEntryImage: \(book, entry\) => libraryImagePath/);
});
