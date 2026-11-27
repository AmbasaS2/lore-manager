const {test}=require('node:test');
const assert=require('node:assert/strict');
const {readFileSync}=require('node:fs');
const {join}=require('node:path');
const {JSDOM}=require('./fixture-ui-language.cjs');
const source=readFileSync(join(__dirname,'../index.js'),'utf8');
const css=readFileSync(join(__dirname,'../style.css'),'utf8');
function production(name){
 const m=source.match(new RegExp('^function '+name+'\\([^]*?^}', 'm'));
 assert.ok(m,'missing '+name);
 return m[0];
}

test('old select or four buttons are replaced with one FA funnel menu on refresh',()=>{
 const dom=new JSDOM('<section id="slb-entry-filters-section" class="slb-summary-row">'+
 '<strong class="slb-summary-label">항목 필터</strong>'+
 '<div id="slb-entry-filters" class="slb-entry-filters slb-summary-body"><button class="slb-filter-button">전체</button></div>'+
 '</section>',{runScripts:'outside-only'});
 const w=dom.window;
 const make='const createElement=(tag,cls,txt)=>{const e=document.createElement(tag);e.className=cls||"";if(txt)e.textContent=txt;return e;};';
 w.eval(make+'\n'+production('createSummarySection')+'\n'+production('createEntryFilters')+'\n'+
    production('ensureWorkspaceSummarySection')+'\nwindow.create=ensureWorkspaceSummarySection;window.make=createEntryFilters;');
 try{
  const old=w.document.getElementById('slb-entry-filters');
  const item=w.create({id:'slb-entry-filters-section',bodyId:'slb-entry-filters',title:'',createBody:w.make});
  assert.equal(old.isConnected,false,'old buttons removed, not reused');
  assert.equal(item.body.tagName,'DETAILS');
  assert.equal(item.section.querySelectorAll('.slb-summary-label').length,0);
  assert.deepEqual([...item.body.querySelectorAll('button')].map(x=>x.dataset.filter),['all','constant','normal','vectorized']);
  assert.equal(item.body.querySelector('summary i').classList.contains('fa-filter'),true);
  assert.match(css,/\.slb-summary-row\s*\{[^}]*min-height:\s*29px/s);
  assert.match(css,/\.slb-summary-filter-select\s*\{[^}]*min-height:\s*24px/s);
 }finally{dom.window.close();}
});

test('original native names, i18n markers and option labels survive on repeated help attachment',()=>{
 const dom=new JSDOM('<section id="WorldInfo">'+
 '<small class="label" title="Original ST tooltip">'+
 '<span data-i18n="Group Scoring">Group Scoring</span>'+
 '<i class="fa-solid fa-circle-info" title="ST info"></i></small>'+
 '<select name="useGroupScoring"><option value="null" data-i18n="Use global">Use global</option></select>'+
 '</section>',{runScripts:'outside-only'});
 const w=dom.window;
 w.eval(production('addLoreInfoIcon')+'\nwindow.add=addLoreInfoIcon;');
 try{
  const label=w.document.querySelector('small');
  const originalIcon=label.querySelector('.fa-circle-info'),select=w.document.querySelector('select');
  w.add(label,'같은 그룹에서 키워드를 더 많이 맞힌 항목을 선택합니다.');
  w.add(label,'같은 그룹에서 키워드를 더 많이 맞힌 항목을 선택합니다.');
  assert.equal(label.textContent,'Group Scoring');
  assert.equal(label.title,'Original ST tooltip');
  assert.equal(label.querySelector('span').dataset.i18n,'Group Scoring');
  assert.equal(label.querySelector('.slb-lore-info-icon'),originalIcon);
  assert.equal(label.querySelectorAll('.slb-lore-info-icon').length,1);
  assert.equal(originalIcon.dataset.slbHelp.startsWith('같은 그룹'),true);
  assert.equal(select.value,'null');
  assert.equal(select.options[0].textContent,'Use global');
  assert.equal(select.options[0].getAttribute('data-i18n'),'Use global');
  assert.doesNotMatch(source,/function localizeLoreOptionCaptions\(/);
  assert.doesNotMatch(source,/textSpan\.textContent\s*=\s*readableLabel/);
 }finally{dom.window.close();}
});

test('backup list is natural height with expandable book rows and action buttons that never rely on inner scrollers',()=>{
 const row=css.match(/#slb-ai-tools \.slb-backup-row\s*\{([^}]+)\}/);
 const list=css.match(/#slb-ai-tools \.slb-backup-list\s*\{([^}]+)\}/);
 const body=css.match(/#slb-ai-tools \.slb-backup-group-body\s*\{([^}]+)\}/);
 assert.ok(row&&list&&body);
 assert.match(list[1],/overflow:\s*visible/);
 assert.doesNotMatch(list[1],/max-height|overflow-y:\s*auto/);
 assert.match(row[1],/grid-template-columns:\s*minmax\(0,\s*1fr\)/);
 assert.doesNotMatch(row[1],/height:\s*\d+px|flex-wrap:\s*wrap/);
 assert.match(body[1],/flex-direction:\s*column/);
 assert.match(source,/const currentButton = createElement\('button', 'menu_button', uiText\("현재 로어북 복원"\)\)/);
 assert.match(source,/const copyButton = createElement\('button', 'menu_button', uiText\("새 로어북으로 복원"\)\)/);
 assert.match(source,/const exportButton = createElement\('button', 'menu_button', uiText\("JSON 내보내기"\)\)/);
 assert.match(source,/deleteLorebookBackup\(record\.id\)/);
 assert.match(source,/restoreLorebookBackup\(record\.id, 'copy'\)/);
});

test('compact bulk-edit control stays smaller than translation action without truncating its text',()=>{
 assert.match(css,/#WorldInfo\.slb-active #slb-entry-selection-toolbar \.slb-bulk-mode-label\s*\{[^}]*min-height:\s*24px/s);
 assert.match(css,/#WorldInfo\.slb-active #slb-entry-selection-toolbar \.slb-bulk-mode-label\s*\{[^}]*font-size:\s*0\.88em/s);
 assert.match(css,/#WorldInfo\.slb-active \.slb-bulk-selection-tools \.menu_button\s*\{[^}]*min-height:\s*24px/s);
 assert.match(css,/#slb-ai-tools \.slb-quick-options \.slb-translate-book\s*\{[^}]*min-width:\s*min\(180px,\s*100%\)/s);
 assert.match(source,/id="slb-translate-book"[\s\S]*?>[\s\S]*?<span>\$\{uiHtml\("로어북 일괄 번역"\)\}<\/span>/);
 assert.doesNotMatch(source,/로어북 일괄 번역…/);
 assert.match(source,/번역본이 있으면 원문 대신 번역본 표시/);
 assert.match(source,/hideSource\.checked = settings\.hideOriginalWhenTranslated/);
});
