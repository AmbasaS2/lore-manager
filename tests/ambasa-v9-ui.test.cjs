const { test }=require('node:test');
const assert=require('node:assert/strict');
const { readFileSync }=require('node:fs');
const { join }=require('node:path');
const { JSDOM }=require('jsdom');
const source=readFileSync(join(__dirname,'../index.js'),'utf8');
const css=readFileSync(join(__dirname,'../style.css'),'utf8');
function extract(name) {
    const m=source.match(new RegExp('^function '+name+'\\([^]*?^}', 'm'));
    assert.ok(m,'production function '+name);
    return m[0];
}
const elementStub='const createElement=(tag,cls,text)=>{const e=document.createElement(tag);'+
    'if(cls)e.className=cls;if(text)e.textContent=text;return e;};';

test('one button invokes native expand/collapse handlers and retains native buttons',()=>{
    const html='<div id="WorldInfo"><div id="world_popup">'+
        '<button id="OpenAllWIEntries" class="menu_button">Native open</button>'+
        '<button id="CloseAllWIEntries" class="menu_button">Native close</button>'+
        '<div id="world_info_pagination"></div><select id="world_editor_select"></select>'+
        '<button id="world_refresh">Refresh</button></div></div>';
    const dom=new JSDOM(html,{runScripts:'outside-only'});
    const w=dom.window;
    w.eval(elementStub+'\n'+extract('bindCombinedEntryToggle')+'\nwindow.bind=bindCombinedEntryToggle;');
    let expand=0,collapse=0;
    const nativeOpen=w.document.getElementById('OpenAllWIEntries');
    const nativeClose=w.document.getElementById('CloseAllWIEntries');
    nativeOpen.addEventListener('click',()=>expand++);
    nativeClose.addEventListener('click',()=>collapse++);
    try {
        w.bind();w.bind();
        const btn=w.document.getElementById('slb-toggle-all-entries');
        assert.ok(btn);
        assert.equal(w.document.querySelectorAll('#slb-toggle-all-entries').length,1);
        assert.equal(btn.dataset.slbAction,'close');
        btn.click();
        assert.equal(collapse,1);
        assert.equal(btn.dataset.slbAction,'open');
        btn.click();
        assert.equal(expand,1);
        assert.equal(btn.dataset.slbAction,'close');
        w.document.getElementById('world_info_pagination').click();
        assert.equal(btn.dataset.slbAction,'close');
        assert.equal(w.document.getElementById('OpenAllWIEntries'),nativeOpen);
        assert.equal(w.document.getElementById('CloseAllWIEntries'),nativeClose);
        assert.match(css,/slb-combined-entry-toggle #OpenAllWIEntries/);
    } finally {w.close();}
});

test('on-demand examples explain controls without overwriting native field values',()=>{
    const html='<div id="WorldInfo"><section id="act">'+
        '<label><input type="checkbox" name="excludeRecursion"><span data-i18n="Non-recursable">Non-recursable</span></label>'+
        '</section><section id="group">'+
        '<div class="slb-group-field"><small for="group"><span data-i18n="Inclusion Group">Inclusion Group</span></small>'+
        '<label><input type="checkbox" name="groupOverride"><span data-i18n="Prioritize">Prioritize</span></label>'+
        '<input name="group" value="weather"></div>'+
        '<div class="slb-group-field"><small for="groupWeight" data-i18n="Group Weight">Group Weight</small><input name="groupWeight" value="75"></div>'+
        '<div class="slb-group-field"><small for="sticky" data-i18n="Sticky">Sticky</small><input name="sticky" value="3"></div>'+
        '</section><section id="filter">'+
        '<div class="slb-filter-title-slot-1"><small data-i18n="Filter to Characters or Tags">Filter to Characters or Tags</small></div>'+
        '<div class="slb-filter-title-slot-2"><small data-i18n="Filter to Generation Triggers">Filter to Generation Triggers</small></div>'+
        '<label><input type="checkbox" name="character_exclusion"><span data-i18n="Exclude">Exclude</span></label>'+
        '<select name="triggers"><option value="normal" selected data-i18n="Normal">Normal</option>'+
        '<option value="regenerate" data-i18n="Regenerate">Regenerate</option></select></section></div>';
    const dom=new JSDOM(html,{runScripts:'outside-only'});
    const w=dom.window;
    w.eval(elementStub+'\n'+extract('setLoreCaption')+'\n'+extract('addLoreEntryHelp')+
        '\n'+extract('localizeLoreEntryControls')+'\nwindow.run=localizeLoreEntryControls;');
    const panels={activation:w.document.getElementById('act'),
        group:w.document.getElementById('group'),filter:w.document.getElementById('filter')};
    let changed=0;
    const input=panels.group.querySelector('[name="group"]');
    input.addEventListener('input',()=>changed++);
    try {
        w.run(panels);
        assert.equal(input.value,'weather');
        assert.equal(panels.group.querySelector('[name="groupWeight"]').value,'75');
        assert.equal(panels.group.querySelector('[name="sticky"]').value,'3');
        assert.equal(panels.group.querySelector('[for="group"]').textContent,'같은 묶음 이름');
        assert.equal(panels.filter.querySelector('.slb-filter-title-slot-1').textContent,'사용할 캐릭터·태그');
        assert.equal(panels.filter.querySelector('select[name="triggers"]').value,'normal');
        assert.equal(panels.filter.querySelector('select[name="triggers"] option').textContent,'일반 답변');
        input.dispatchEvent(new w.Event('input',{bubbles:true}));
        assert.equal(changed,1);
        const help=[panels.activation,panels.group,panels.filter].map(p=>p.querySelector(':scope > details.slb-entry-help'));
        assert.ok(help.every(x=>x&&!x.open),'all help stays collapsed');
        assert.match(help[0].textContent,/파랑 · 항상 사용/);
        assert.match(help[1].textContent,/같은 묶음에서 하나 선택/);
        assert.match(help[1].textContent,/3개 메시지/);
        assert.match(help[2].textContent,/선택 대상 제외/);
        assert.equal(w.document.querySelectorAll('.slb-entry-help').length,3);
    } finally {w.close();}
});

test('state buttons use ST blue green link and small EN KO controls',()=>{
    assert.match(source,/상시 주입 \(파랑\)/);
    assert.doesNotMatch(source,/상시 주입 \(빨강\)/);
    assert.match(source,/키워드가 맞을 때 사용 \(초록\)/);
    assert.match(source,/비슷한 내용 찾기로 사용 \(링크\)/);
    assert.match(css,/data-state="constant"[\s\S]*?color: #428bfa/);
    assert.match(css,/data-state="normal"[\s\S]*?color: #29b765/);
    assert.match(css,/#WorldInfo\.slb-active button\.slb-lang-badge\s*\{[^}]*font-size:\s*0\.75em/s);
    assert.match(css,/slb-translation-settings \.slb-settings-card-body\s*\{[^}]*gap:\s*7px/s);
});
