const {test}=require('node:test');
const assert=require('node:assert/strict');
const {readFileSync}=require('node:fs');
const {join}=require('node:path');
const {JSDOM}=require('jsdom');
const source=readFileSync(join(__dirname,'../index.js'),'utf8');
const pick = name => {
 const m=source.match(new RegExp('^async function '+name+'\\([^]*?^}', 'm'));
 assert.ok(m,'missing '+name);
 return m[0];
};

test('native ST popup defaults to linked character books and can show all, with two separate translation actions',async()=>{
 const dom=new JSDOM('<main></main>',{runScripts:'outside-only',pretendToBeVisual:true});
 const w=dom.window;
 const stubs=[
  'let filter=new Set(["Remus"]); let result=3; let choice="Other";',
  'let popupOptions=null,form=null;const started=[];',
  'const createElement=(tag,css,text)=>{const e=document.createElement(tag);if(css)e.className=css;if(text)e.textContent=text;return e;};',
  'const availableLorebookNames=()=>["Remus","Other","Sirius"];',
  'const currentCharacterLinkedBooks=()=>filter;',
  'const currentBookName=()=>"Other";',
  'const notify=()=>{throw Error("Unexpected notification")};',
  'const POPUP_TYPE={CONFIRM:"confirm"};',
  'const translateCurrentLorebook=async(mode,sel,book)=>{started.push({mode,sel,book})};',
  'class Popup{constructor(f,t,i,opts){form=f;popupOptions=opts;this.result=null;}',
  'async show(){const showAll=form.querySelector("#slb-translate-world-show-all");',
  'const select=form.querySelector("#slb-translate-world-select");',
  'if(choice==="Other"){showAll.checked=true;showAll.dispatchEvent(new Event("change"));}',
  'select.value=choice;',
  'this.result=result;',
  'if(popupOptions.onClosing(this)===false)return null;',
  'return this.result;}}',
 ].join('\n');
 w.eval(stubs+'\n'+pick('showLorebookTranslationPicker')+
       '\nwindow.openPicker=showLorebookTranslationPicker;'+
       '\nwindow.snapshot=()=>({form,opts:popupOptions,started});'+
       '\nwindow.setResult=x=>{result=x};window.setChoice=x=>{choice=x};');
 try{
   w.setChoice('Remus'); w.setResult(2);
   await w.openPicker();
   let data=w.snapshot();
   assert.equal(data.form.querySelector('#slb-translate-world-show-all').checked,false);
   assert.deepEqual([...data.form.querySelectorAll('select option')].map(o=>o.value),['Remus']);
   assert.equal(data.started.length,1);
   assert.equal(data.started[0].mode,'missing');
   assert.equal(data.started[0].book,'Remus');
   assert.deepEqual(Array.from(data.opts.customButtons,b=>b.result),[2,3]);
   assert.equal(data.opts.okButton,false);
   w.setChoice('Other'); w.setResult(3);
   await w.openPicker();
   data=w.snapshot();
   assert.deepEqual([...data.form.querySelectorAll('select option')].map(o=>o.value),['Remus','Other','Sirius']);
   assert.equal(data.started.length,2);
   assert.equal(data.started[1].book,'Other');
   assert.equal(data.started[1].mode,'all');
   w.setResult(null);
   await w.openPicker();
   assert.equal(w.snapshot().started.length,2,'cancel never starts a translation');
 }finally{w.close();}
});

test('without selected character all books show and all-books toggle is disabled',async()=>{
 const dom=new JSDOM('<main></main>',{runScripts:'outside-only'});
 const w=dom.window;
 w.eval([
  'const createElement=(tag,css,text)=>{const e=document.createElement(tag);if(css)e.className=css;if(text)e.textContent=text;return e;};',
  'const availableLorebookNames=()=>["A","B"];',
  'const currentCharacterLinkedBooks=()=>null;const currentBookName=()=>"B";',
  'const notify=()=>{};const POPUP_TYPE={CONFIRM:1};let popupForm=null;',
  'class Popup{constructor(f){popupForm=f;}async show(){return null;}}',
  'const translateCurrentLorebook=async()=>{throw Error("should not launch")};',
 ].join('\n')+'\n'+pick('showLorebookTranslationPicker')+
   '\nwindow.open=showLorebookTranslationPicker;window.getForm=()=>popupForm;');
 try{
  await w.open();
  const check=w.getForm().querySelector('#slb-translate-world-show-all');
  assert.equal(check.checked,true); assert.equal(check.disabled,true);
  assert.deepEqual([...w.getForm().querySelectorAll('select option')].map(o=>o.value),['A','B']);
 }finally{w.close();}
});

test('translation picker uses native theme form and single source button',()=>{
 assert.match(source,/class="menu_button slb-translate-book" id="slb-translate-book"/);
 assert.doesNotMatch(source,/id="slb-translate-missing-book"/);
 assert.match(source,/new Popup\(form, POPUP_TYPE.CONFIRM/);
 assert.match(source,/selectedBook \|\| currentBookName\(\)/);
 assert.match(source,/if \(!independent && currentBookName\(\) !== book && state\.bulkTranslation === job\)/);
});
