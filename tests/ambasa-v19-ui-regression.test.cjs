const {test}=require('node:test');
const assert=require('node:assert/strict');
const {readFileSync}=require('node:fs');
const {join}=require('node:path');
const {JSDOM}=require('jsdom');
const js=readFileSync(join(__dirname,'../index.js'),'utf8');
const css=readFileSync(join(__dirname,'../style.css'),'utf8');
function fn(name){
 const m=js.match(new RegExp('^function '+name+'\\([^]*?^}', 'm'));
 assert.ok(m,'missing function '+name);
 return m[0];
}

test('token row and bulk-edit row separate controls while keeping both display settings',()=>{
 const w=new JSDOM('<div id="WorldInfo"><div id="world_popup"></div></div>',{runScripts:'outside-only'}).window;
 const stub='const createElement=(tag,cls,txt)=>{const e=document.createElement(tag);e.className=cls||"";if(txt)e.textContent=txt;return e};';
 w.eval(stub+'\n'+fn('createTokenStrip')+'\n'+fn('createEntryFilters')+'\n'+fn('createSummarySection')+
 '\nwindow.api={createTokenStrip,createEntryFilters,createSummarySection};');
 try{
  const wrap=w.document.createElement('div');wrap.id='slb-summary-toolbar';
  const bulk=w.document.createElement('div');bulk.id='slb-entry-selection-toolbar';
  wrap.append(w.api.createSummarySection('slb-token-summary-section','토큰',w.api.createTokenStrip()));
  bulk.append(w.api.createSummarySection('slb-entry-filters-section','',w.api.createEntryFilters()));
  w.document.getElementById('world_popup').append(wrap,bulk);
  assert.equal(wrap.children.length,1);
  assert.equal(bulk.children.length,1);
  assert.equal(wrap.querySelector('.slb-summary-label').textContent,'토큰');
  assert.equal(bulk.querySelectorAll('.slb-summary-label').length,0);
  assert.equal(wrap.querySelectorAll('.slb-stat-icon').length,5);
  assert.equal(bulk.querySelector('summary .fa-filter')!==null,true);
  assert.equal(bulk.querySelectorAll('#slb-entry-filters button').length,4);
  assert.match(js,/if \(tokenSection\.parentElement !== summaryBar\) summaryBar\.append\(tokenSection\)/);
  assert.match(js,/if \(filterSection\.parentElement !== selectionToolbar\) selectionToolbar\.append\(filterSection\)/);
  assert.equal(w.document.getElementById('slb-entry-filters-section').parentElement.id,'slb-entry-selection-toolbar');
  assert.match(css,/#WorldInfo\.slb-active #slb-summary-toolbar\s*\{[^}]*flex-flow:\s*row nowrap/s);
  assert.match(css,/\.slb-summary-label\s*\{[^}]*font-weight:\s*400/s);
  assert.match(css,/\.slb-token-strip strong\s*\{[^}]*font-weight:\s*400/s);
  assert.match(css,/\.slb-mobile-token-summary-hidden #slb-token-summary-section/);
  assert.match(css,/\.slb-mobile-entry-filters-hidden #slb-entry-filters-section/);
  assert.match(css,/#WorldInfo\.slb-active\.slb-mobile-token-summary-hidden #slb-summary-toolbar/);
  assert.match(css,/#WorldInfo\.slb-active #slb-entry-selection-toolbar > #slb-entry-filters-section\s*\{[^}]*margin:\s*0 0 0 auto/s);
 }finally{w.close();}
});

test('the compact Font Awesome funnel menu filters without changing native saved values or duplicating handlers',async()=>{
 const dom=new JSDOM('<div id="WorldInfo"></div>',{runScripts:'outside-only',pretendToBeVisual:true});
 const w=dom.window;
 const stubs=[
  'const state={};',
  'const settings={entryFilter:"all"};let saves=0;const changes=[];',
  'const getSettings=()=>settings;',
  'const saveSettingsDebounced=()=>{saves++};',
  "const ENTRY_STATE_FILTER='slb-entry-state';",
  'const worldInfoFilter={setFilterData:(name,value)=>changes.push(value)};',
  'const createElement=(tag,cls,txt)=>{const e=document.createElement(tag);e.className=cls||"";if(txt)e.textContent=txt;return e};'
 ].join('\n');
 w.eval(stubs+'\n'+fn('createEntryFilters')+'\n'+fn('syncFilterButtons')+
    '\n'+fn('handleEntryFilterChange')+'\n'+fn('bindEntryFilterControls')+
    '\nwindow.api={createEntryFilters,syncFilterButtons,bindEntryFilterControls,settings,observe:()=>({saves,changes})};');
 try{
  const details=w.api.createEntryFilters();
  w.document.getElementById('WorldInfo').append(details);
  w.api.bindEntryFilterControls(details);
  w.api.bindEntryFilterControls(details);
  w.api.syncFilterButtons();
  const trigger=details.querySelector('summary');
  assert.equal(trigger.getAttribute('aria-label'),'항목 표시: 전체 보기');
  assert.deepEqual([...details.querySelectorAll('button')].map(b=>b.dataset.filter),
     ['all','constant','normal','vectorized']);
  for(const name of ['constant','normal','vectorized','all']){
   details.open=true;
   details.querySelector('button[data-filter="'+name+'"]').click();
   assert.equal(details.open,false);
   assert.equal(w.api.settings.entryFilter,name);
   assert.equal(details.querySelectorAll('button[aria-pressed="true"]').length,1);
  }
  assert.equal(w.api.observe().saves,4);
  assert.deepEqual([...w.api.observe().changes],['constant','normal','vectorized','all']);
  // Native menu must be operable with keyboard and close on an outside click.
  details.open=true;
  details.dispatchEvent(new w.Event('toggle'));
  assert.equal(trigger.getAttribute('aria-expanded'),'true');
  w.document.body.dispatchEvent(new w.Event('pointerdown',{bubbles:true}));
  assert.equal(details.open,false);
  details.dispatchEvent(new w.Event('toggle'));
  assert.equal(trigger.getAttribute('aria-expanded'),'false');
  await new Promise(resolve=>setTimeout(resolve,30)); // drain queued native toggle events before closing jsdom
 }finally{w.close();}
});

test('bulk translation has one persistent progress area, explicit cancel label and profile messages remain independent',()=>{
 const dom=new JSDOM('<div id="slb-ai-tools"><div id="slb-ai-status">AI 프로필 연결됨</div>'+
 '<button id="slb-translate-book"><span>로어북 일괄 번역</span></button>'+
 '<div id="slb-bulk-status" role="status"></div></div>',{runScripts:'outside-only'});
 const w=dom.window;
 w.eval("const state={bulkTranslation:null};const toaster=[];"+
   "const toastr={error:x=>toaster.push(['error',x]),success:x=>toaster.push(['success',x]),warning:x=>toaster.push(['warning',x])};"+
   fn('notify')+'\n'+fn('updateBulkTranslationStatus')+
   '\nwindow.api={state,notify,updateBulkTranslationStatus,getToasts:()=>toaster};');
 try{
  const button=w.document.querySelector('#slb-translate-book');
  const label=button.querySelector('span');
  const profile=w.document.getElementById('slb-ai-status');
  const bulk=w.document.getElementById('slb-bulk-status');
  w.api.state.bulkTranslation={book:'test',cancelled:false};
  w.api.updateBulkTranslationStatus('Remus · 전체 번역 4/12 (완료 4, 실패 0, 건너뜀 0)');
  assert.equal(label.textContent,'번역 중…');
  assert.equal(button.disabled,false);
  assert.match(button.getAttribute('aria-label'),/현재 진행 중인 번역을 취소/);
  assert.match(bulk.textContent,/4\/12/);
  assert.equal(profile.textContent,'AI 프로필 연결됨');
  w.api.state.bulkTranslation.cancelled=true;
  w.api.state.bulkTranslation=null;
  w.api.updateBulkTranslationStatus();
  assert.equal(label.textContent,'로어북 일괄 번역');
  assert.equal(button.disabled,false);
  w.api.updateBulkTranslationStatus('전체 번역 완료 · 성공 12개');
  w.api.notify('전체 번역 완료 · 성공 12개','success',true);
  assert.equal(profile.textContent,'AI 프로필 연결됨','no duplicate summary in connection status above');
  assert.equal(bulk.textContent,'전체 번역 완료 · 성공 12개');
  assert.equal(w.api.getToasts().length,1);
  assert.equal(label.textContent,'로어북 일괄 번역');
  assert.equal(button.disabled,false);
  w.api.notify('연결 테스트 성공','success');
  assert.equal(profile.textContent,'연결 테스트 성공','other status notifications keep original behavior');
 }finally{w.close();}
});

test('left header controls keep native gap5px and intrinsic sizes without title overlap',()=>{
 assert.match(js,/createElement\('div', 'slb-header-toggles gap5px alignitemscenter'\)/);
 const rule=css.match(/#WorldInfo\.slb-active \.world_entry\.slb-compact-entry \.slb-header-toggles\s*\{([^}]+)\}/s);
 assert.ok(rule);
 assert.match(rule[1],/width:\s*max-content/);
 assert.match(rule[1],/align-items:\s*center/);
 assert.doesNotMatch(rule[1],/gap:\s*2px|margin-left:\s*-/);
 assert.doesNotMatch(css,/\.slb-compact-entry \.slb-header-toggles\s*>\s*:is\(/);
 assert.doesNotMatch(css,/\.slb-header-toggles\s*>\s*\*\s*\{[^}]*height:\s*32px/s);
 assert.match(css,/#WorldInfo\.slb-active \.world_entry\.slb-compact-entry \.slb-entry-header-shell\s*\{[^}]*grid-template-columns:\s*max-content minmax\(0, 1fr\) max-content/s);
});
