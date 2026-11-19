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

test('original ST labels remain intact and help icons explain on hover or focus', () => {
    const html = '<div id="WorldInfo"><section id="act">' +
        '<label><input type="checkbox" name="excludeRecursion"><span>Non-recursable</span></label>' +
        '</section><section id="group">' +
        '<div class="slb-group-field"><small for="group">Inclusion Group</small><input name="group" value="weather"></div>' +
        '<div class="slb-group-field"><small for="groupWeight">Group Weight</small><input name="groupWeight" value="100"></div>' +
        '<div class="slb-group-field"><small for="sticky">Sticky</small><input name="sticky" value="3"></div>' +
        '</section><section id="filter">' +
        '<div class="slb-filter-title-slot-1"><small class="slb-filter-title">Filter to Characters or Tags</small></div>' +
        '<div class="slb-filter-title-slot-2"><small class="slb-filter-title">Filter to Generation Triggers</small></div>' +
        '<label><input type="checkbox" name="character_exclusion">Exclude</label>' +
        '<select name="triggers"><option value="normal" selected>Normal</option></select></section></div>';
    const dom=new JSDOM(html,{runScripts:'outside-only'});
    const w=dom.window;
    w.eval(elementStub+'\n'+extract('addLoreInfoIcon')+'\n'+extract('attachLoreEntryHelp')+'\nwindow.run=attachLoreEntryHelp;');
    const panels={activation:w.document.getElementById('act'),group:w.document.getElementById('group'),filter:w.document.getElementById('filter')};
    const groupInput=panels.group.querySelector('[name="group"]');
    let events=0;groupInput.addEventListener('input',()=>events++);
    try{
        w.run(panels);
        assert.equal(groupInput.value,'weather');
        assert.equal(panels.group.querySelector('[for="group"]').textContent.includes('Inclusion Group'),true);
        assert.equal(panels.group.querySelector('[for="groupWeight"]').textContent.includes('Group Weight'),true);
        assert.equal(panels.filter.querySelector('.slb-filter-title').textContent.includes('Filter to Characters or Tags'),true);
        const info=panels.group.querySelector('[for="group"] .slb-lore-info-icon');
        assert.ok(info);
        assert.match(info.title,/같은 그룹/);
        assert.equal(info.tabIndex,0);
        assert.equal(w.document.querySelectorAll('.slb-entry-help').length,0);
        const excluded=panels.filter.querySelector('[name="character_exclusion"]');
        const helpIcon=excluded.closest('label').querySelector('.slb-lore-info-icon');
        assert.ok(helpIcon,'the exclusion checkbox has a help icon');
        helpIcon.click();
        assert.equal(excluded.checked,false,'clicking help must not toggle the actual checkbox');
        w.run(panels);
        assert.equal(panels.group.querySelectorAll('[for="group"] .slb-lore-info-icon').length,1);
        groupInput.dispatchEvent(new w.Event('input',{bubbles:true}));
        assert.equal(events,1);
    }finally{w.close();}
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
