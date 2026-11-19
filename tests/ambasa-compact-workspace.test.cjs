const {test}=require('node:test');
const assert=require('node:assert/strict');
const {readFileSync}=require('node:fs');
const {join}=require('node:path');
const {JSDOM}=require('jsdom');
const src=readFileSync(join(__dirname,'../index.js'),'utf8');
const css=readFileSync(join(__dirname,'../style.css'),'utf8');
const bulk=readFileSync(join(__dirname,'../bulk-edit.js'),'utf8');
const extract=n=>{
    const m=src.match(new RegExp('^function '+n+'\\([^]*?^}', 'm'));
    assert.ok(m,'missing '+n);return m[0];
};
test('token totals remain inline; one compact filter select needs no separate caption',()=>{
    const dom=new JSDOM('<div id="WorldInfo" class="slb-active"><div id="world_popup"></div></div>',{runScripts:'outside-only'});
    const w=dom.window;
    const stub='const createElement=(tag,cls,txt)=>{const e=document.createElement(tag);e.className=cls||"";if(txt)e.textContent=txt;return e;};';
    w.eval(stub+'\n'+extract('createSummarySection')+'\n'+extract('createTokenStrip')+
        '\n'+extract('createEntryFilters')+'\n'+extract('ensureWorkspaceSummarySection')+
        '\nwindow.f={createSummarySection,createTokenStrip,createEntryFilters,ensureWorkspaceSummarySection};');
    try{
      const popup=w.document.getElementById('world_popup');
      const stats=w.f.createSummarySection('slb-token-summary-section','토큰 통계',w.f.createTokenStrip());
      const filters=w.f.createSummarySection('slb-entry-filters-section','',w.f.createEntryFilters());
      popup.append(stats,filters);
      assert.equal(stats.querySelector('.slb-summary-label').textContent,'토큰 통계');
      assert.equal(filters.querySelector('.slb-summary-label'),null,'no redundant filter caption');
      assert.equal(filters.children.length,1);
      assert.equal(filters.querySelectorAll('button').length,0);
      const current=filters.querySelector('#slb-entry-filters');
      assert.equal(current.tagName,'SELECT');
      const again=w.f.ensureWorkspaceSummarySection({
        id:'slb-entry-filters-section',bodyId:'slb-entry-filters',title:'',createBody:w.f.createEntryFilters
      });
      assert.equal(again.section,filters);
      assert.equal(again.body,current);
      assert.match(css,/\.slb-summary-filter-select\s*\{[^}]*min-height:\s*27px/s);
      assert.match(css,/\.slb-entry-filter-select\s*\{[^}]*width:\s*min\(195px,\s*100%\)/s);
      assert.match(css,/\.slb-summary-section \.slb-token-strip\s*\{[^}]*flex-flow:\s*row nowrap/s);
      assert.match(css,/\.slb-mobile-token-summary-hidden #slb-token-summary-section/);
      assert.match(css,/\.slb-mobile-entry-filters-hidden #slb-entry-filters-section/);
    }finally{dom.window.close();}
});

test('filter is a native select with the four original stored values',()=>{
    const dom=new JSDOM('',{runScripts:'outside-only'}),w=dom.window;
    w.eval('const createElement=(tag,cls,txt)=>{const e=document.createElement(tag);e.className=cls||"";if(txt)e.textContent=txt;return e;};\n'
        +extract('createEntryFilters')+'\nwindow.make=createEntryFilters');
    try{
      const filter=w.make();
      assert.equal(filter.tagName,'SELECT');
      assert.deepEqual([...filter.options].map(o=>o.value),['all','constant','normal','vectorized']);
      assert.deepEqual([...filter.options].map(o=>o.textContent),
        ['전체 보기','상시 주입만 보기','키워드 발동만 보기','벡터 검색만 보기']);
      assert.equal(filter.getAttribute('aria-label'),'표시할 로어북 항목');
    }finally{dom.window.close();}
});

test('original SillyTavern captions and documentation links stay untouched while hints are added',()=>{
    const dom=new JSDOM('<div id="WorldInfo"><div class="slb-group-grid">'+
      '<div class="slb-group-field"><small for="group" title="ST original"><span data-i18n="Inclusion Group">Inclusion Group</span><a href="#native" class="notes-link"><i class="fa-circle-question"></i></a></small><input name="group" value="weather"></div>'+
      '<div class="slb-group-field"><small for="sticky"><span data-i18n="Sticky">Sticky</span><i class="fa-solid fa-circle-info"></i></small><input name="sticky" value="3"></div>'+
      '</div></div>',{runScripts:'outside-only'});
    const w=dom.window;
    w.eval(extract('addLoreInfoIcon')+'\nwindow.add=addLoreInfoIcon');
    try{
      const group=w.document.querySelector('[for=group]'),sticky=w.document.querySelector('[for=sticky]');
      const input=w.document.querySelector('[name=group]');
      let calls=0;input.addEventListener('input',()=>calls++);
      w.add(group,'같은 그룹 중 하나만 선택합니다.','이 문구는 보이면 안 됨');
      w.add(sticky,'몇 개 메시지 동안 유지합니다.','또 다른 문구');
      assert.equal(group.querySelector('[data-i18n]').textContent,'Inclusion Group');
      assert.equal(group.title,'ST original');
      assert.equal(sticky.querySelector('[data-i18n]').textContent,'Sticky');
      assert.equal(group.querySelector('a.notes-link').getAttribute('href'),'#native');
      assert.equal(w.document.querySelectorAll('.slb-lore-info-icon').length,2);
      assert.equal(sticky.querySelectorAll('.fa-circle-info').length,1,'existing info icon reused');
      assert.equal(input.value,'weather');
      input.dispatchEvent(new w.Event('input',{bubbles:true}));
      assert.equal(calls,1);
      w.add(group,'같은 그룹 중 하나만 선택합니다.');
      assert.equal(group.querySelectorAll('.slb-lore-info-icon').length,1);
      assert.match(css,/\.slb-group-grid \.slb-lore-field-caption,[\s\S]*?white-space:\s*normal/s);
    }finally{dom.window.close();}
});

test('bulk-selection UI is named and shows single select-all/clear toggle, not a misleading menu',()=>{
    assert.match(bulk,/class="slb-bulk-mode-text">일괄 편집/);
    assert.match(bulk,/selected\.size \? '선택 비우기' : '전체 선택'/);
    assert.doesNotMatch(bulk,/class="menu_button slb-bulk-clear"/);
    assert.match(bulk,/selected\.clear\(\);\s*syncRows\(\)/);
    assert.match(bulk,/class="slb-bulk-selection-count" aria-live="polite"/);
});

test('translation bulk picker is clearly differentiated from per-entry translate buttons',()=>{
    assert.match(src,/id="slb-translate-book"[^>]*>[\s\S]*?로어북 일괄 번역/);
    assert.match(src,/번역할 로어북을 선택한 뒤, 미번역 항목만 번역하거나 전체 재번역/);
    assert.match(src,/자동 번역 · 원문 반영 설정/);
});

test('native ST option text and data-i18n remain untouched',()=>{
    assert.doesNotMatch(src,/function localizeLoreOptionCaptions\(/);
    assert.doesNotMatch(src,/option\.removeAttribute\('data-i18n'\)/);
    assert.doesNotMatch(extract('addLoreInfoIcon'),/textSpan\.textContent|textNode\.textContent/);
    assert.doesNotMatch(extract('addLoreInfoIcon'),/label\.removeAttribute\('title'\)/);
    const native='<select name="entryLogicType"><option value="0" data-i18n="AND ANY">AND ANY</option></select>';
    const dom=new JSDOM(native,{runScripts:'outside-only'});
    try{
        assert.equal(dom.window.document.querySelector('option').textContent,'AND ANY');
        assert.equal(dom.window.document.querySelector('option').getAttribute('data-i18n'),'AND ANY');
    }finally{dom.window.close();}
});

test('filter choice change keeps saved values, native filtering and debounce',()=>{
    const dom=new JSDOM('<div id="WorldInfo"></div>',{runScripts:'outside-only'});
    const w=dom.window;
    const stubs=[
      'const settings={entryFilter:"all"};let saves=0;const calls=[];',
      'const getSettings=()=>settings;',
      'const saveSettingsDebounced=()=>{saves++};',
      'const ENTRY_STATE_FILTER="slb-entry-state";',
      'const worldInfoFilter={setFilterData:(name,value)=>calls.push({name,value})};',
      'const createElement=(tag,cls,txt)=>{const x=document.createElement(tag);x.className=cls||"";if(txt)x.textContent=txt;return x;};'
    ].join('\n');
    w.eval(stubs+'\n'+extract('createEntryFilters')+'\n'+extract('syncFilterButtons')+
       '\n'+extract('handleEntryFilterChange')+'\n'+extract('bindEntryFilterControls')+
       '\nwindow.api={createEntryFilters,syncFilterButtons,bindEntryFilterControls,settings,getResult:()=>({saves,calls})};');
    try{
      const select=w.api.createEntryFilters();
      w.document.getElementById('WorldInfo').append(select);
      w.api.bindEntryFilterControls(select);
      w.api.bindEntryFilterControls(select);
      w.api.syncFilterButtons();
      assert.equal(select.value,'all');
      for(const option of ['constant','normal','vectorized','all']){
        select.value=option;
        select.dispatchEvent(new w.Event('change',{bubbles:true}));
        assert.equal(w.api.settings.entryFilter,option);
      }
      w.api.settings.entryFilter='constant';
      w.api.syncFilterButtons();
      assert.equal(select.value,'constant','restored selection reflected without re-saving');
      const result=w.api.getResult();
      assert.equal(result.saves,4,'handler not bound twice');
      assert.deepEqual(Array.from(result.calls,call=>call.value),['constant','normal','vectorized','all']);
    }finally{dom.window.close();}
});
