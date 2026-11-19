const {test}=require('node:test');
const assert=require('node:assert/strict');
const {readFileSync}=require('node:fs');
const {join}=require('node:path');
const {JSDOM}=require('jsdom');
const source=readFileSync(join(__dirname,'../index.js'),'utf8');
const css=readFileSync(join(__dirname,'../style.css'),'utf8');
function prod(name){
 const m=source.match(new RegExp('^function '+name+'\\([^]*?^}','m'));
 assert.ok(m,'production function missing: '+name);return m[0];
}

test('bulk translation action is separate from automatic on-open/retranslate/original-sync choices',()=>{
 const dom=new JSDOM('<div id="slb-ai-tools"></div>',{runScripts:'outside-only'});
 const w=dom.window;
 const stubs=[
   'const VERSION="test";const state={bulkTranslation:null};',
   'const settings={translateMissingOnOpen:true,autoTranslateSource:false,autoSyncToSource:false};',
   'const getSettings=()=>settings;',
   'const createElement=(tag,cls,txt)=>{const node=document.createElement(tag);if(cls)node.className=cls;if(txt)node.textContent=txt;return node;};',
   'let saved=0,autoSyncCalls=0,opened=0;',
   'const saveSettingsDebounced=()=>{saved++};',
   'const syncAutoControls=()=>{autoSyncCalls++};',
   'const updateBulkTranslationStatus=()=>{};',
   'const showLorebookTranslationPicker=()=>{opened++};',
 ].join('\n');
 w.eval(stubs+'\n'+prod('createQuickTranslationOptions')+
   '\nwindow.make=createQuickTranslationOptions;window.inspect=()=>({settings,saved,autoSyncCalls,opened});');
 try{
  const root=w.make();w.document.getElementById('slb-ai-tools').append(root);
  assert.equal(w.make(),root,'existing controls reused without duplication');
  const action=root.querySelector('.slb-bulk-action');
  const automatic=root.querySelector('.slb-auto-options');
  assert.equal(action.querySelectorAll('button#slb-translate-book').length,1);
  assert.equal(action.querySelectorAll('input[type=checkbox]').length,0);
  assert.equal(automatic.querySelector('.slb-auto-options-title').textContent,'자동 번역 · 원문 반영 설정');
  assert.equal(automatic.querySelectorAll('.slb-auto-option-grid > label > input').length,3);
  assert.equal(root.querySelector('#slb-translate-missing').checked,true);
  assert.equal(root.querySelector('#slb-auto-translate').checked,false);
  const input=automatic.querySelector('#slb-translate-missing');input.checked=false;input.dispatchEvent(new w.Event('change',{bubbles:true}));
  const retranslate=automatic.querySelector('#slb-auto-translate');retranslate.checked=true;retranslate.dispatchEvent(new w.Event('change',{bubbles:true}));
  const reflection=automatic.querySelector('#slb-auto-sync');reflection.checked=true;reflection.dispatchEvent(new w.Event('change',{bubbles:true}));
  const result=w.inspect();
  assert.equal(result.settings.translateMissingOnOpen,false);
  assert.equal(result.settings.autoTranslateSource,true);
  assert.equal(result.settings.autoSyncToSource,true);
  assert.equal(result.saved,3);assert.equal(result.autoSyncCalls,1);
  action.querySelector('button').click();
  assert.equal(w.inspect().opened,1,'button still opens the original picker');
 }finally{w.close();}
});

test('compact editor uses native controls, labels have readable scale without mobile shrinking',()=>{
 assert.match(css,/#WorldInfo\.slb-active \.slb-entry-meta :is\(label, small, span, \.checkbox, \.checkbox_label\)\s*\{[^}]*font-size:\s*inherit/s);
 const nativeCheckboxRule=css.match(/#WorldInfo\.slb-active \.slb-entry-meta,[^}]+\}/s);
 assert.ok(nativeCheckboxRule);
 assert.doesNotMatch(nativeCheckboxRule[0],/font-size:\s*0\.8em/);
 assert.match(css,/#WorldInfo\.slb-active \.slb-panel\s*\{[^}]*font-size:\s*max\(14px, 0\.95em\)/s);
 assert.match(css,/#WorldInfo\.slb-active \.slb-overrides-grid > \.slb-override-field\s*\{[^}]*grid-template-rows:\s*minmax\(20px, auto\) minmax\(32px, auto\)/s);
 assert.match(css,/#WorldInfo\.slb-active \.slb-group-grid > \.slb-group-field\s*\{[^}]*grid-template-rows:\s*minmax\(20px, auto\) auto/s);
});

test('quick options have one real label group and no legacy two-column shrinking',()=>{
 assert.match(css,/#slb-ai-tools \.slb-auto-options\s*\{[^}]*border-top:\s*1px solid var\(--slb-border\)/);
 assert.match(css,/#slb-ai-tools \.slb-auto-option-grid\s*\{[^}]*grid-template-columns:\s*repeat\(auto-fit/);
 assert.doesNotMatch(css,/#slb-ai-tools #slb-quick-options-host > \.slb-quick-options\s*\{[^}]*font-size:\s*0\.88em/s);
 assert.match(css,/#slb-ai-tools \.slb-settings-card-body,[\s\S]*?gap:\s*6px/s);
 assert.match(css,/#slb-ai-tools \.slb-settings-card-body,[\s\S]*?gap:\s*6px/s);
 assert.match(css,/#WorldInfo\.slb-active \.slb-entry-editor-head\s*\{[^}]*min-height:\s*27px/s);
});
