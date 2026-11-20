const {test}=require('node:test');
const assert=require('node:assert/strict');
const {readFileSync}=require('node:fs');
const {join}=require('node:path');
const {JSDOM}=require('jsdom');
const js=readFileSync(join(__dirname,'../index.js'),'utf8');
const css=readFileSync(join(__dirname,'../style.css'),'utf8');
function fn(name){
 const m=js.match(new RegExp('^function '+name+'\\([^]*?^}','m'));
 assert.ok(m,'missing '+name);return m[0];
}

test('the native divider is unchanged and token, filter and bulk controls share one row',()=>{
 const dom=new JSDOM('<div id="WorldInfo" class="slb-active"><div id="world_popup">'+
 '<hr id="original-native-divider"><select id="world_editor_select"><option value="">--- Pick to Edit ---</option><option value="Book">Book</option></select><div id="world_popup_entries_list"></div>'+
 '</div></div>',{runScripts:'outside-only',pretendToBeVisual:true});
 const w=dom.window;
 const stubs=[
  'const createElement=(tag,cls,txt)=>{const el=document.createElement(tag);if(cls)el.className=cls;if(txt)el.textContent=txt;return el;};',
  'const state={workspace:null};',
  'const compactNativeSort=()=>{};',
  'const jQuery=()=>{};',
  'const enableNativeEntryDrag=()=>{};',
  'const isFoldyLinkedMode=()=>false;',
  'const currentBookName=()=>null;',
  'const notify=()=>{};',
  'const worldInfoFilter={setFilterData:()=>{},getFilterData:()=>\"all\"};',
  'const saveSettingsDebounced=()=>{};',
  'const getSettings=()=>({entryFilter:\"all\"});',
  'const ENTRY_STATE_FILTER=\"slb-entry-state\";',
  'const bindWorkspaceEntries=entries=>{state.workspace={entries}};',
  'const bindWorkspacePopupObserver=()=>{};',
  'const applyMobileDisplaySettings=()=>{};',
  'const entryBulkEditor={ensureToolbar:(popup,entries)=>{',
  ' let toolbar=document.getElementById(\"slb-entry-selection-toolbar\");',
  ' if(!toolbar){toolbar=document.createElement(\"div\");toolbar.id=\"slb-entry-selection-toolbar\";',
  ' toolbar.innerHTML=\"<label class=slb-bulk-mode-label><input type=checkbox class=slb-bulk-mode disabled><span>일괄 편집</span></label><div class=slb-bulk-selection-tools hidden></div>\";}',
  ' if(toolbar.nextElementSibling!==entries)popup.insertBefore(toolbar,entries);',
  ' return toolbar;}};',
 ].join('\n');
 w.eval(stubs+'\n'+['createSummarySection','createTokenStrip','createEntryFilters',
  'ensureWorkspaceSummarySection','syncFilterButtons','handleEntryFilterChange','bindEntryFilterControls','createWorkspace'].map(fn).join('\n')+
  '\nwindow.api={createWorkspace,getState:()=>state};');
 try{
  w.api.createWorkspace();
  const popup=w.document.getElementById('world_popup');
  const stats=w.document.getElementById('slb-token-summary-section');
  const bulk=w.document.getElementById('slb-entry-selection-toolbar');
  const filter=w.document.getElementById('slb-entry-filters-section');
  const original=w.document.getElementById('original-native-divider');
  assert.equal(original.parentElement,popup,'original divider is left untouched');
  assert.equal(popup.firstElementChild,original);
  assert.equal(popup.classList.contains('slb-no-book-selected'),true);
  assert.equal(bulk.firstElementChild,stats,'token statistics occupy the first part of the row');
  assert.equal(stats.querySelector('.slb-summary-label').textContent,'토큰');
  assert.equal(stats.nextElementSibling,filter,'filter follows optional stats');
  assert.equal(filter.nextElementSibling.className,'slb-bulk-mode-label','bulk editor is immediately right of filter');
  assert.equal(filter.querySelector('summary').textContent.trim(),'항목 필터');
  assert.equal(filter.parentElement,bulk);
  assert.equal(bulk.nextElementSibling.id,'world_popup_entries_list');
  assert.equal(filter.querySelectorAll('summary .fa-filter').length,1);
  assert.equal(filter.querySelectorAll('button[data-filter]').length,4);
  assert.equal(w.document.querySelector('.slb-bulk-mode').disabled,true,'no lorebook selected');
  w.api.createWorkspace();
  assert.equal(popup.querySelectorAll('#slb-entry-selection-toolbar').length,1);
  assert.equal(popup.querySelectorAll('#slb-entry-filters-section').length,1);
  assert.equal(popup.querySelectorAll('#slb-summary-toolbar').length,0);
  assert.match(js,/filterSection\.parentElement !== selectionToolbar/);
  assert.match(js,/filterSection\.parentElement !== selectionToolbar\s*\|\|/);
  assert.doesNotMatch(css,/#WorldInfo\.slb-active #world_popup > hr\s*\{/);
  assert.doesNotMatch(css,/#world_popup:has\([^{]+> hr/);
  assert.match(css,/#WorldInfo\.slb-active #world_popup:has\(#world_editor_select > option\[value=""\]:checked\)/);
  assert.match(js,/selectionToolbar\.insertBefore\(filterSection, bulkButton\)/);
 }finally{w.close();}
});

test('compact bulk edit control and FA filter have equal 24px height, small text and no extra row',()=>{
 assert.match(css,/#WorldInfo\.slb-active #slb-entry-selection-toolbar\s*\{[^}]*flex-flow:\s*row nowrap/s);
 assert.match(css,/#WorldInfo\.slb-active #slb-entry-selection-toolbar\s*\{[^}]*min-height:\s*24px/s);
 assert.match(css,/#WorldInfo\.slb-active #slb-entry-selection-toolbar \.slb-bulk-mode-label\s*\{[^}]*height:\s*24px/s);
 assert.match(css,/#WorldInfo\.slb-active #slb-entry-selection-toolbar \.slb-bulk-mode-label\s*\{[^}]*font-size:\s*0\.88em/s);
 assert.match(css,/#WorldInfo\.slb-active \.slb-bulk-selection-tools \.menu_button\s*\{[^}]*height:\s*24px/s);
 assert.match(css,/#WorldInfo\.slb-active #slb-entry-selection-toolbar > #slb-entry-filters-section\s*\{[^}]*margin:\s*0 0 0 auto/s);
 assert.match(css,/#WorldInfo\.slb-active \.slb-filter-trigger\s*\{[^}]*height:\s*24px/s);
 assert.match(css,/#WorldInfo\.slb-active \.slb-filter-details\s*\{[^}]*height:\s*24px/s);
 assert.match(css,/#WorldInfo\.slb-active\.slb-bulk-edit-hidden\.slb-mobile-entry-filters-hidden\.slb-mobile-token-summary-hidden #slb-entry-selection-toolbar\s*\{[^}]*display:\s*none !important/s);
 assert.match(css,/#WorldInfo\.slb-active\.slb-mobile-entry-filters-hidden #slb-entry-filters-section\s*\{[^}]*display:\s*none !important/s);
});
