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
test('token and filter summaries are inline, cannot collapse, retain visibility-setting classes',()=>{
    const dom=new JSDOM('<div id="WorldInfo" class="slb-active"><div id="world_popup"></div></div>',{runScripts:'outside-only'});
    const w=dom.window;
    const stubs='const createElement=(tag,cls,txt)=>{const e=document.createElement(tag);e.className=cls||"";if(txt)e.textContent=txt;return e;};';
    w.eval(stubs+'\n'+extract('createSummarySection')+'\n'+extract('createTokenStrip')+
        '\n'+extract('createEntryFilters')+'\n'+extract('ensureWorkspaceSummarySection')+
        '\nwindow.f={createSummarySection,createTokenStrip,createEntryFilters,ensureWorkspaceSummarySection};');
    try{
      const popup=w.document.getElementById('world_popup');
      const stats=w.f.createSummarySection('slb-token-summary-section','토큰 통계',w.f.createTokenStrip());
      const filters=w.f.createSummarySection('slb-entry-filters-section','항목 필터',w.f.createEntryFilters());
      popup.append(stats,filters);
      for(const [row,name] of [[stats,'토큰 통계'],[filters,'항목 필터']]){
        assert.equal(row.querySelector('.slb-summary-label').textContent,name);
        assert.equal(row.querySelectorAll('button.slb-summary-toggle').length,0);
        assert.equal(row.querySelectorAll('.slb-summary-body[hidden]').length,0);
        assert.equal(row.children.length,2);
        assert.equal(row.classList.contains('slb-summary-row'),true);
      }
      const previous=filters.querySelector('#slb-entry-filters');
      const again=w.f.ensureWorkspaceSummarySection({
        id: 'slb-entry-filters-section',bodyId:'slb-entry-filters',title:'항목 필터',createBody:w.f.createEntryFilters
      });
      assert.equal(again.section,filters);
      assert.equal(again.body,previous);
      assert.match(css,/#WorldInfo\.slb-active \.slb-summary-row\s*\{[^}]*grid-template-columns:\s*max-content minmax\(0,\s*1fr\)/s);
      assert.match(css,/#WorldInfo\.slb-active \.slb-summary-section \.slb-entry-filters\s*\{[^}]*grid-template-columns:\s*repeat\(4,\s*minmax\(0,\s*1fr\)\)/s);
      assert.match(css,/#WorldInfo\.slb-active \.slb-summary-section \.slb-token-strip\s*\{[^}]*flex-flow:\s*row nowrap/s);
      assert.doesNotMatch(src,/function setSummarySectionCollapsed\(/);
      assert.match(css,/\.slb-mobile-token-summary-hidden #slb-token-summary-section/);
      assert.match(css,/\.slb-mobile-entry-filters-hidden #slb-entry-filters-section/);
    }finally{dom.window.close();}
});

test('entry filters are exactly 4 icon-only/equal-width actions, retaining data-filter values',()=>{
    const dom=new JSDOM('',{runScripts:'outside-only'});
    const w=dom.window;
    const stub='const createElement=(tag,cls,txt)=>{const e=document.createElement(tag);e.className=cls||"";if(txt)e.textContent=txt;return e;};';
    w.eval(stub+'\n'+extract('createEntryFilters')+'\nwindow.f=createEntryFilters');
    try{
      const row=w.f();
      const buttons=[...row.querySelectorAll('button')];
      assert.equal(buttons.length,4);
      assert.deepEqual(buttons.map(b=>b.dataset.filter),['all','constant','normal','vectorized']);
      assert.deepEqual(buttons.map(b=>b.textContent.trim()),['전체','','','']);
      assert.deepEqual(buttons.map(b=>b.querySelectorAll('i').length),[0,1,1,1]);
      for(const btn of buttons) assert.ok(btn.getAttribute('aria-label')&&btn.title);
    }finally{w.close();}
});

test('group captions use one-line info icons while preserving native values and listeners',()=>{
    const dom=new JSDOM('<div id="WorldInfo"><div class="slb-group-grid">'+
      '<div class="slb-group-field"><small for="group"><span data-i18n="Inclusion Group">Inclusion Group</span><a href="#native" class="notes-link"><i class="fa-circle-question"></i></a></small><input name="group" value="weather"></div>'+
      '<div class="slb-group-field"><small for="sticky" class="flex-container"><span data-i18n="Sticky">Sticky</span><i class="fa-solid fa-comments"></i></small><input name="sticky" type="number" value="3"></div>'+
      '</div></div>',{runScripts:'outside-only'});
    const w=dom.window;
    w.eval(extract('addLoreInfoIcon')+'\nwindow.add=addLoreInfoIcon');
    try{
      const group=w.document.querySelector('[for=group]'),sticky=w.document.querySelector('[for=sticky]');
      const input=w.document.querySelector('[name=group]');
      let fired=0;input.addEventListener('input',()=>fired++);
      w.add(group,'같은 이름의 그룹 중 하나가 등장해.','그룹 이름');
      w.add(sticky,'등장한 뒤 몇 개 메시지 동안 유지해.','등장 유지');
      assert.equal(group.querySelector('[data-i18n]'),null);
      assert.match(group.textContent,/그룹 이름/);
      assert.match(sticky.textContent,/등장 유지/);
      assert.equal(group.querySelector('.notes-link').href.includes('#native'),true,'native documentation link survives');
      assert.equal(w.document.querySelectorAll('.slb-lore-info-icon').length,2);
      assert.equal(group.classList.contains('slb-lore-field-caption'),true);
      assert.equal(sticky.classList.contains('slb-lore-field-caption'),true);
      assert.equal(input.value,'weather');
      input.dispatchEvent(new w.Event('input',{bubbles:true}));
      assert.equal(fired,1);
      w.add(group,'같은 이름의 그룹 중 하나가 등장해.','그룹 이름');
      assert.equal(group.querySelectorAll('.slb-lore-info-icon').length,1);
      assert.match(css,/\.slb-group-grid \.slb-lore-field-caption,[\s\S]*?white-space:\s*nowrap/s);
    }finally{w.close();}
});

test('bulk-selection UI is named and shows single select-all/clear toggle, not a misleading menu',()=>{
    assert.match(bulk,/class="slb-bulk-mode-text">일괄 편집/);
    assert.match(bulk,/selected\.size \? '선택 비우기' : '전체 선택'/);
    assert.doesNotMatch(bulk,/class="menu_button slb-bulk-clear"/);
    assert.match(bulk,/selected\.clear\(\);\s*syncRows\(\)/);
    assert.match(bulk,/class="slb-bulk-selection-count" aria-live="polite"/);
});

test('translation bulk picker is clearly differentiated from per-entry translate buttons',()=>{
    assert.match(src,/id="slb-translate-book"[^>]*>[\s\S]*?로어북 일괄 번역…/);
    assert.match(src,/번역할 로어북을 선택한 뒤, 미번역 항목만 번역하거나 전체 재번역/);
    assert.match(src,/자동 번역 · 원문 반영 설정/);
});

test('native ST logic and global option values survive readable Korean captions',()=>{
    const html='<div id="activation"><select name="entryLogicType">'+
       '<option value="0">AND ANY</option><option value="3">AND ALL</option>'+
       '<option value="1">NOT ALL</option><option value="2">NOT ANY</option>'+
       '</select><select name="caseSensitive">'+
       '<option value="null">Use global</option><option value="true">Yes</option><option value="false">No</option>'+
       '</select><select name="matchWholeWords">'+
       '<option value="null">Use global</option><option value="true">Yes</option><option value="false">No</option>'+
       '</select><select name="useGroupScoring">'+
       '<option value="null">Use global</option><option value="true">Yes</option><option value="false">No</option>'+
       '</select></div>';
    const dom=new JSDOM(html,{runScripts:'outside-only'}),w=dom.window;
    w.eval(extract('localizeLoreOptionCaptions')+'\nwindow.localize=localizeLoreOptionCaptions');
    try{
       const root=w.document.getElementById('activation');
       let changeCount=0;
       root.querySelectorAll('select').forEach(select=>select.addEventListener('input',()=>changeCount++));
       const saved=[...root.querySelectorAll('select')].map(select=>select.value);
       w.localize(root);
       assert.deepEqual([...root.querySelectorAll('select')].map(select=>select.value),saved);
       const logic=root.querySelector('select[name="entryLogicType"]');
       assert.deepEqual([...logic.options].map(x=>x.textContent),['하나 이상','전부','전부 아님','모두 제외']);
       for(const select of root.querySelectorAll('select:not([name="entryLogicType"])')){
          assert.deepEqual([...select.options].map(x=>x.textContent),['전체 설정','켜기','끄기']);
       }
       logic.value='3';logic.dispatchEvent(new w.Event('input',{bubbles:true}));
       assert.equal(logic.value,'3');
       assert.equal(changeCount,1,'original input listeners remain attached');
       w.localize(root);
       assert.equal(changeCount,1,'repeated UI enhancement does not emit another save event');
    }finally{w.close();}
});

test('equal-width icon filters retain native state switching and accessible pressed state',()=>{
    const dom=new JSDOM('<div id="WorldInfo"></div>',{runScripts:'outside-only'});
    const w=dom.window;
    const setup=[
      'const settings={entryFilter:"all"};let saves=0;const calls=[];',
      'const getSettings=()=>settings;',
      'const saveSettingsDebounced=()=>{saves++};',
      'const ENTRY_STATE_FILTER="slb-entry-state";',
      'const worldInfoFilter={setFilterData:(name,value)=>calls.push({name,value})};',
      'const createElement=(tag,cls,txt)=>{const x=document.createElement(tag);x.className=cls||"";if(txt)x.textContent=txt;return x;};'
    ].join('\n');
    w.eval(setup+'\n'+extract('createEntryFilters')+'\n'+extract('syncFilterButtons')+
       '\n'+extract('handleEntryFilterClick')+'\n'+extract('bindEntryFilterControls')+
       '\nwindow.api={createEntryFilters,syncFilterButtons,bindEntryFilterControls,settings,getResult:()=>({saves,calls})};');
    try{
       const bar=w.api.createEntryFilters();
       w.document.getElementById('WorldInfo').append(bar);
       w.api.bindEntryFilterControls(bar);
       w.api.bindEntryFilterControls(bar);
       w.api.syncFilterButtons();
       assert.equal(bar.querySelector('[data-filter="all"]').getAttribute('aria-pressed'),'true');
       for(const [value,selected] of [['constant','constant'],['normal','normal'],['vectorized','vectorized'],['all','all']]){
           const button=bar.querySelector('[data-filter="'+value+'"]');
           button.click();
           assert.equal(w.api.settings.entryFilter,selected);
           assert.equal(button.classList.contains('is-active'),true);
           assert.equal(button.getAttribute('aria-pressed'),'true');
           assert.equal([...bar.querySelectorAll('[aria-pressed="true"]')].length,1);
       }
       const result=w.api.getResult();
       assert.equal(result.saves,4);
       assert.deepEqual(Array.from(result.calls,x=>x.value),['constant','normal','vectorized','all']);
    }finally{dom.window.close();}
});
