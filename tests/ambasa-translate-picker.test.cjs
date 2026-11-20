const {test}=require('node:test');
const assert=require('node:assert/strict');
const {readFileSync}=require('node:fs');
const {join}=require('node:path');
const {JSDOM}=require('jsdom');
const source=readFileSync(join(__dirname,'../index.js'),'utf8');
const extract=name=>{
 const match=source.match(new RegExp('^async function '+name+'\\([^]*?^}', 'm'));
 assert.ok(match,'missing '+name);return match[0];
};
test('native popup defaults to character-linked books and supports checkbox multi-selection',async()=>{
 const dom=new JSDOM('<main></main>',{runScripts:'outside-only',pretendToBeVisual:true});
 const w=dom.window;
 w.eval([
  'let linked=new Set(["Remus"]),result=2,chosen=["Remus"],showEveryone=false;',
  'let form=null,popupOptions=null;const started=[];',
  'const createElement=(tag,css,text)=>{const e=document.createElement(tag);if(css)e.className=css;if(text)e.textContent=text;return e;};',
  'const availableLorebookNames=()=>["Remus","Other","Sirius"];',
  'const currentCharacterLinkedBooks=()=>linked;',
  'const currentBookName=()=>"Other";',
  'const notify=()=>{throw Error("Unexpected notification")};',
  'const POPUP_TYPE={CONFIRM:1};',
  'const translateCurrentLorebook=async(mode,sel,book)=>{started.push({mode,book})};',
  'const translateMultipleLorebooks=async(books,mode)=>{started.push({mode,books})};',
  'class Popup{constructor(f,t,i,opts){form=f;popupOptions=opts;this.result=null;}',
  'async show(){const showAll=form.querySelector("#slb-translate-world-show-all");',
  'if(showEveryone){showAll.checked=true;showAll.dispatchEvent(new Event("change"));}',
  'const inputs=form.querySelectorAll("#slb-translate-world-list input");',
  'for(const box of inputs){box.checked=chosen.includes(box.value);box.dispatchEvent(new Event("change"));}',
  'this.result=result;',
  'if(popupOptions.onClosing(this)===false)return null;',
  'return this.result;}}',
  extract('showLorebookTranslationPicker'),
  'window.api={open:showLorebookTranslationPicker,set:(next)=>{result=next.result;chosen=next.chosen;showEveryone=next.showEveryone},snapshot:()=>({form,popupOptions,started})};',
 ].join('\n'));
 try{
  w.api.set({result:2,chosen:['Remus'],showEveryone:false});
  await w.api.open();
  let {form,popupOptions,started}=w.api.snapshot();
  assert.equal(form.querySelector('#slb-translate-world-show-all').checked,false);
  assert.deepEqual([...form.querySelectorAll('#slb-translate-world-list input')].map(i=>i.value),['Remus']);
  assert.equal(started.length,1); assert.deepEqual(JSON.parse(JSON.stringify(started[0])),{mode:'missing',book:'Remus'});
  assert.deepEqual(Array.from(popupOptions.customButtons,b=>b.result),[2,3]);
  assert.equal(popupOptions.okButton,false);
  w.api.set({result:3,chosen:['Other','Sirius'],showEveryone:true});
  await w.api.open();
  ({form,started}=w.api.snapshot());
  assert.deepEqual([...form.querySelectorAll('#slb-translate-world-list input')].map(i=>i.value),['Remus','Other','Sirius']);
  assert.equal(form.querySelector('#slb-translate-world-selected').textContent,'2개 로어북 선택됨');
  assert.equal(started.length,2);
  assert.deepEqual(JSON.parse(JSON.stringify(started[1])),{mode:'all',books:['Other','Sirius']});
  assert.equal(form.querySelector('#slb-translate-world-select-all').textContent,'모두 선택');
  w.api.set({result:2,chosen:[],showEveryone:true});
  await w.api.open();
  assert.equal(w.api.snapshot().started.length,2,'no selection does not call the API');
  w.api.set({result:null,chosen:['Other'],showEveryone:true});
  await w.api.open();
  assert.equal(w.api.snapshot().started.length,2,'closing popup never starts a translation');
 }finally{w.close()}
});
test('without linked-character filter every lorebook is listed, with clear/select-all controls',async()=>{
 const dom=new JSDOM('<main></main>',{runScripts:'outside-only',pretendToBeVisual:true});
 const w=dom.window;
 w.eval([
  'const createElement=(tag,css,text)=>{const e=document.createElement(tag);if(css)e.className=css;if(text)e.textContent=text;return e;};',
  'const availableLorebookNames=()=>["A","B","C"];',
  'const currentCharacterLinkedBooks=()=>null;const currentBookName=()=>"B";',
  'const notify=()=>{};const POPUP_TYPE={CONFIRM:1};let form=null;',
  'class Popup{constructor(f){form=f;}async show(){return null;}}',
  'const translateCurrentLorebook=async()=>{throw Error("should not run")};',
  'const translateMultipleLorebooks=async()=>{throw Error("should not run")};',
  extract('showLorebookTranslationPicker'),
  'window.open=showLorebookTranslationPicker;window.form=()=>form;',
 ].join('\n'));
 try{
  await w.open();
  const f=w.form();
  assert.equal(f.querySelector('#slb-translate-world-show-all').checked,true);
  assert.equal(f.querySelector('#slb-translate-world-show-all').disabled,true);
  const names=()=>[...f.querySelectorAll('#slb-translate-world-list input')].map(i=>i.value);
  assert.deepEqual(names(),['A','B','C']);
  assert.deepEqual([...f.querySelectorAll('#slb-translate-world-list input')].filter(i=>i.checked).map(i=>i.value),['B']);
  f.querySelector('#slb-translate-world-select-all').click();
  assert.equal(f.querySelector('#slb-translate-world-selected').textContent,'3개 로어북 선택됨');
  assert.equal(f.querySelector('#slb-translate-world-select-all').textContent,'선택 해제');
  f.querySelector('#slb-translate-world-select-all').click();
  assert.equal(f.querySelector('#slb-translate-world-selected').textContent,'선택한 로어북 없음');
 }finally{w.close()}
});
test('popup retains native styling, bulk action and nonlinked filtering without new CSS',()=>{
 assert.match(source,/class="menu_button slb-translate-book" id="slb-translate-book"/);
 assert.doesNotMatch(source,/id="slb-translate-missing-book"/);
 assert.match(source,/new Popup\(form, POPUP_TYPE.CONFIRM/);
 assert.match(source,/showAllLabel\.append\(showAll, createElement\('span', 'checkmark'\)/);
 assert.match(source,/input\.type = 'checkbox'/);
 assert.match(source,/const selectedBooks = allowed\.filter\(name => selected\.has\(name\)\)/);
 assert.match(source,/selectedBook \|\| currentBookName\(\)/);
 assert.match(source,/if \(!independent && currentBookName\(\) !== book && state\.bulkTranslation === job\)/);
});
