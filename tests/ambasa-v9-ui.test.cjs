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

test('combined button uses native ST toggleDrawer directly and preserves both original controls',async()=>{
    const html='<div id="WorldInfo"><div id="world_popup">' +
        '<button id="OpenAllWIEntries" class="menu_button">Native open</button>'+
        '<button id="CloseAllWIEntries" class="menu_button">Native close</button>'+
        '<div id="world_info_pagination"></div><select id="world_editor_select"></select>'+
        '<button id="world_refresh">Refresh</button>'+
        '<div id="world_popup_entries_list">'+
        '<div class="inline-drawer"><div class="inline-drawer-header"><i class="inline-drawer-icon down"></i></div><div class="inline-drawer-content" style="display:none"></div></div>'+
        '<div class="inline-drawer"><div class="inline-drawer-header"><i class="inline-drawer-icon down"></i></div><div class="inline-drawer-content" style="display:none"></div></div>'+
        '</div></div></div>';
    const dom=new JSDOM(html,{runScripts:'outside-only',pretendToBeVisual:true});
    const w=dom.window;
    w.eval(elementStub + '\nconst state={bulkOpeningDrawers:false,bulkEditorHydrationQueue:[],bulkEditorHydrationHead:0,bulkEditorHydrationRaf:0};\nlet calls=[]; const toggleDrawer=(drawer, expand)=>{' +
        'calls.push(expand);let icon=drawer.querySelector(".inline-drawer-icon");' +
        'icon.classList.toggle("up",expand);icon.classList.toggle("down",!expand);' +
        'drawer.querySelector(".inline-drawer-content").style.display=expand?"block":"none";' +
        'drawer.dispatchEvent(new Event("inline-drawer-toggle",{bubbles:true}));' +
        '};\n'+extract('bindCombinedEntryToggle')+
        '\nwindow.bind=bindCombinedEntryToggle;window.calls=()=>calls;');
    const nativeOpen=w.document.getElementById('OpenAllWIEntries');
    const nativeClose=w.document.getElementById('CloseAllWIEntries');
    let nativeClicks=0;
    nativeOpen.addEventListener('click',()=>nativeClicks++);
    nativeClose.addEventListener('click',()=>nativeClicks++);
    try {
        w.bind();w.bind();
        const btn=w.document.getElementById('slb-toggle-all-entries');
        assert.ok(btn);
        assert.equal(w.document.querySelectorAll('#slb-toggle-all-entries').length,1);
        assert.equal(btn.dataset.slbAction,'open');
        btn.click();
        assert.deepEqual(Array.from(w.calls()),[true,true]);
        assert.equal(btn.dataset.slbAction,'close');
        btn.click();
        assert.deepEqual(Array.from(w.calls()),[true,true,false,false]);
        assert.equal(btn.dataset.slbAction,'open');
        nativeOpen.click();
        nativeClose.click();
        assert.equal(nativeClicks,2,'unmodified native buttons remain functional');
        w.document.getElementById('world_info_pagination').click();
        await new Promise(resolve=>w.requestAnimationFrame(()=>{
            assert.equal(btn.dataset.slbAction,'open');
            assert.equal(w.document.getElementById('OpenAllWIEntries'),nativeOpen);
            assert.equal(w.document.getElementById('CloseAllWIEntries'),nativeClose);
            assert.match(css,/slb-combined-entry-toggle #OpenAllWIEntries/);
            resolve();
        }));
    }finally{w.close();}
});

test('readable Korean captions preserve ST native controls and focusable help', () => {
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
    w.eval(elementStub+'\nlet activeLoreHelpIcon=null,activeLoreHelpTooltip=null;\n'
        +extract('closeLoreInfoTooltip')+'\n'
        +extract('dismissLoreHelpOnOutside')+'\n'
        +extract('showLoreInfoTooltip')+'\n'
        +extract('bindLoreInfoEvents')+'\n'
        +extract('addLoreInfoIcon')+'\n'
        +extract('attachLoreEntryHelp')+'\nwindow.run=attachLoreEntryHelp;window.bindHelp=bindLoreInfoEvents;');
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
        assert.match(info.dataset.slbHelp,/같은 그룹 이름/);
        assert.equal(info.hasAttribute('title'),false,'only one tooltip source may exist');
        assert.equal(info.tabIndex,0);
        assert.equal(w.document.querySelectorAll('.slb-entry-help').length,0);
        const excluded=panels.filter.querySelector('[name="character_exclusion"]');
        const helpIcon=excluded.closest('label').querySelector('.slb-lore-info-icon');
        assert.ok(helpIcon,'the exclusion checkbox has a help icon');
        w.bindHelp();
        helpIcon.click();
        assert.equal(excluded.checked,false,'clicking help must not toggle the actual checkbox');
        assert.equal(w.document.querySelectorAll('.slb-lore-tooltip').length,1,'one shared help view for all icons');
        w.document.body.dispatchEvent(new w.Event('pointerdown',{bubbles:true}));
        assert.equal(w.document.querySelectorAll('.slb-lore-tooltip').length,0,'outside tap closes help');
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
    assert.match(css,/#slb-ai-tools \.slb-settings-card-body,[\s\S]*?gap:\s*6px/s);
});
