const {test}=require('node:test');
const assert=require('node:assert/strict');
const {readFileSync}=require('node:fs');
const {join}=require('node:path');
const {JSDOM}=require('jsdom');
const src=readFileSync(join(__dirname,'../index.js'),'utf8');
const css=readFileSync(join(__dirname,'../style.css'),'utf8');
const fn=name=>{
 const match=src.match(new RegExp('^function '+name+'\\([^]*?^}', 'm'));
 assert.ok(match,name+' missing');return match[0];
};
test('old lorebook-location setting is removed without affecting translation or backups',()=>{
 const dom=new JSDOM('',{runScripts:'outside-only'}),w=dom.window;
 const record={quickOptionsLocation:'lorebook',translationPrompt:'My prompt',
   translations:{A:{text:'한국어 번역'}},autoBackupEnabled:true,managerMode:'standard'};
 const stubs=[
  "const EXTENSION_NAME='simple-lorebook';",
  "const MANAGER_MODE_STANDARD='standard', MANAGER_MODE_FOLDY='foldy';",
  "const extension_settings={'simple-lorebook':"+JSON.stringify(record)+"};",
  "const DEFAULT_SETTINGS={profileId:'',translationPrompt:'',managerMode:'standard',autoBackupEnabled:false};",
  "const state={settingsMigrationNeeded:false};",
  "const normalizeAIOutputTokens=n=>n||8192;",
  "const structuredClone=v=>JSON.parse(JSON.stringify(v));"
 ].join('\n');
 w.eval(stubs+'\n'+fn('getSettings')+'\nwindow.read=getSettings;window.st=state;');
 try{
  const value=w.read();
  assert.equal(Object.hasOwn(value,'quickOptionsLocation'),false);
  assert.equal(value.translationPrompt,'My prompt');
  assert.equal(value.translations.A.text,'한국어 번역');
  assert.equal(value.autoBackupEnabled,true);
  assert.equal(w.st.settingsMigrationNeeded,true);
  w.st.settingsMigrationNeeded=false;
  w.read();
  assert.equal(w.st.settingsMigrationNeeded,false);
 }finally{dom.window.close();}
});

test('translation settings can no longer move to the lorebook page',()=>{
 assert.doesNotMatch(src,/function syncQuickTranslationOptionsPlacement\(/);
 assert.doesNotMatch(src,/slb-options-location/);
 assert.doesNotMatch(css,/slb-options-location/);
 assert.doesNotMatch(css,/#WorldInfo\.slb-active \.slb-quick-options/);
 assert.match(src,/bar\.querySelector\('#slb-quick-options-host'\)\?\.append\(createQuickTranslationOptions\(\)\)/);
 assert.match(src,/id="slb-translate-book"/);
 assert.match(src,/id="slb-translate-missing"/);
 assert.match(src,/id="slb-auto-translate"/);
 assert.match(src,/id="slb-auto-sync"/);
 assert.match(src,/미번역 항목만 번역하거나 전체 재번역을 진행합니다/);
});

test('wide and mobile headers contain only the original title; five controls remain in activation tab',()=>{
 const parts=[
  '<div id="WorldInfo" class="slb-active"><div class="world_entry">',
  '<div class="slb-entry-header-shell"><div class="slb-header-grid"><div class="slb-header-field slb-title-field"><textarea name="comment">A title</textarea></div></div>',
  '<div class="slb-deferred-header-fields">',
  '<div class="slb-strategy-field"><select name="entryStateSelector"><option value="normal">normal</option></select></div>',
  '<div class="slb-position-field"><select name="position"><option>after</option></select></div>',
  '<div class="slb-depth-field"><input name="depth"></div><div class="slb-order-field"><input name="order"></div>',
  '<div class="slb-trigger-field"><input name="probability"></div></div></div>',
  '<section class="slb-panel" data-panel="activation"><div class="slb-activation-overview"></div></section></div></div>'
 ];
 const dom=new JSDOM(parts.join(''),{runScripts:'outside-only',pretendToBeVisual:true}),w=dom.window;
 const entry=w.document.querySelector('.world_entry');
 const grid=entry.querySelector('.slb-header-grid'),stash=entry.querySelector('.slb-deferred-header-fields');
 const panel=entry.querySelector('.slb-panel'),overview=panel.querySelector('.slb-activation-overview');
 const nativeSelect=stash.querySelector('select[name="entryStateSelector"]');
 let nativeEvents=0;nativeSelect.addEventListener('input',()=>nativeEvents++);
 const stubs=[
  'const state={closingEntryDrawers:new WeakSet()};',
  'const isEntryDrawerStablyOpen=()=>true;',
  "const scheduleNativeHeaderRecovery=()=>{throw Error('native field missing')};",
 ].join('\n');
 w.eval(stubs+'\n'+fn('shouldUseCompactHeader')+'\n'+fn('getResponsiveHeaderFields')+'\n'
    +fn('placeResponsiveHeaderFields')+'\n'+fn('placeInitialHeaderFields')
    +'\nwindow.api={shouldUseCompactHeader,placeInitialHeaderFields,placeResponsiveHeaderFields};');
 try{
  for(const width of [320,390,488,1024,1920]){
    w.innerWidth=width;
    assert.equal(w.api.shouldUseCompactHeader(entry),true);
    w.api.placeInitialHeaderFields(entry,false);
    assert.equal(grid.children.length,1);
    assert.equal(stash.children.length,5);
    assert.equal(grid.classList.contains('slb-header-title-only'),true);
    assert.equal(entry.classList.contains('slb-compact-entry'),true);
    panel.classList.add('is-active');entry.dataset.slbActiveTab='activation';
    w.api.placeResponsiveHeaderFields(entry);
    assert.equal(overview.children.length,5);
    assert.equal(overview.querySelector('[name="entryStateSelector"]'),nativeSelect);
    assert.equal(overview.hidden,false);
    panel.classList.remove('is-active');entry.dataset.slbActiveTab='content';
    w.api.placeResponsiveHeaderFields(entry);
    assert.equal(stash.children.length,5);
    assert.equal(overview.hidden,true);
    assert.equal(grid.children.length,1);
  }
  nativeSelect.dispatchEvent(new w.Event('input',{bubbles:true}));
  assert.equal(nativeEvents,1);
  assert.doesNotMatch(src,/titleField\.prepend\(createElement\('small', 'slb-header-label', '제목'\)\)/);
  assert.doesNotMatch(css,/grid-template-columns:\s*minmax\(180px,\s*1fr\) minmax\(56px,\s*82px\)/);
 }finally{dom.window.close();}
});

test('native recursion checkboxes keep handlers while captions become Korean',()=>{
 const dom=new JSDOM('<label class="checkbox flexNoGap"><input type="checkbox" name="excludeRecursion"><span data-i18n="Non-recursable">Non-recursable</span></label>',{runScripts:'outside-only'});
 const w=dom.window;
 w.eval(fn('addLoreInfoIcon')+'\nwindow.add=addLoreInfoIcon;');
 try{
  const label=w.document.querySelector('label'),input=label.querySelector('input');
  let changes=0;input.addEventListener('change',()=>changes++);
  w.add(label,'추가 검색에 포함하지 않습니다.','연쇄 발동 제외');
  assert.match(label.textContent,/연쇄 발동 제외/);
  assert.equal(label.querySelector('span').hasAttribute('data-i18n'),false);
  assert.equal(label.querySelectorAll('.slb-lore-info-icon').length,1);
  input.click();
  assert.equal(changes,1);
  assert.equal(input.checked,true);
  assert.match(css,/\.slb-entry-meta \.checkbox input\[type="checkbox"\]\s*\{[^}]*margin:\s*0 9px 0 0 !important/s);
 }finally{dom.window.close();}
});
