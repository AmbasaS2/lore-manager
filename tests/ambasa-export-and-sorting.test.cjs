const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join, resolve } = require('node:path');
const { pathToFileURL } = require('node:url');
const { JSDOM } = require('jsdom');

const source=readFileSync(join(__dirname,'../index.js'),'utf8');
const stylesheet=readFileSync(join(__dirname,'../style.css'),'utf8');
const bulk=readFileSync(join(__dirname,'../bulk-edit.js'),'utf8');
const getFunction=name=>{
    const match=source.match(new RegExp('^function '+name+'\\([^]*?^}', 'm'));
    assert.ok(match,'Missing function '+name);
    return match[0];
};

test('ZIP export buttons moved out of native lorebook editor and retain single click handler',()=>{
    const dom=new JSDOM('<div id="WorldInfo"><div id="world_popup"><button id="world_popup_export"></button></div></div><div id="extensions_settings2"><button id="slb-export-selected-lorebooks"></button><button id="slb-export-all-lorebooks"></button></div>',{runScripts:'outside-only'});
    const w=dom.window;
    w.eval('let selectedCalls=0,allCalls=0;\n'
       +'const showLorebookExportSelection=()=>{selectedCalls++};\n'
       +'const exportAllLorebooks=()=>{allCalls++};\n'
       +getFunction('createBulkLorebookExportControls')
       +'\nwindow.bindExport=createBulkLorebookExportControls;window.calls=()=>[selectedCalls,allCalls];');
    try{
       w.bindExport();w.bindExport();
       assert.equal(w.document.getElementById('world_popup').querySelectorAll('#slb-export-selected-lorebooks,#slb-export-all-lorebooks').length,0);
       w.document.getElementById('slb-export-selected-lorebooks').click();
       w.document.getElementById('slb-export-all-lorebooks').click();
       assert.deepEqual(Array.from(w.calls()),[1,1]);
    }finally{w.close();}
});

test('actual lorebook JSON exports are distinct from backup export in the extension settings',()=>{
    const start=source.indexOf('function createAIBar()');
    const bt=String.fromCharCode(96);
    const slice=source.slice(start);
    const a=slice.indexOf('bar.innerHTML = '+bt);
    const b=slice.indexOf(bt+';',a+('bar.innerHTML = '+bt).length);
    assert.ok(a>=0&&b>a);
    const markup=slice.slice(a+('bar.innerHTML = '+bt).length,b);
    const dom=new JSDOM('<div id="slb-ai-tools">'+markup+'</div>');
    try{
       const root=dom.window.document.querySelector('#slb-ai-tools');
       const selected=root.querySelector('#slb-export-selected-lorebooks');
       const all=root.querySelector('#slb-export-all-lorebooks');
       const backup=root.querySelector('#slb-backup-export-all');
       assert.ok(selected);assert.ok(all);assert.ok(backup);
       assert.ok(selected.closest('.slb-backup-settings'));
       assert.ok(all.closest('.slb-backup-settings'));
       assert.equal(selected.tagName,'BUTTON');
       assert.equal(all.tagName,'BUTTON');
       assert.match(backup.textContent,/백업/);
    }finally{dom.window.close();}
});

test('bulk toolbar renders no visible count or instructions and uses native-size menu buttons',()=>{
    assert.ok(!bulk.includes('설정 변경·삭제·번역: 선택한 항목에서 실행하면 선택 목록에 함께 적용'));
    assert.match(bulk,/slb-bulk-selection-count slb-screen-reader-only/);
    assert.match(bulk,/slb-bulk-selection-status slb-screen-reader-only/);
    assert.match(stylesheet,/\.slb-screen-reader-only/);
    assert.doesNotMatch(stylesheet, /#WorldInfo\.slb-active #slb-entry-selection-toolbar[^{}]*\{[^}]*font-size:\s*clamp/);
    assert.match(stylesheet,/\.slb-bulk-selection-tools \.menu_button\s*\{[^}]*font: inherit/s);
});

test('native sort popup receives Korean captions without overwriting the ST handler or values',async()=>{
    const dom=new JSDOM('<div id="world_apply_current_sorting" title="Apply Current Sorting" data-i18n="[title]Apply current sorting as Order"></div>',{runScripts:'outside-only',pretendToBeVisual:true});
    const w=dom.window;
    const button=w.document.getElementById('world_apply_current_sorting');
    let nativeCalls=0,submitCalls=0;
    button.addEventListener('click',()=>{
        nativeCalls++;
        const popup=w.document.createElement('dialog');
        popup.className='popup';
        popup.innerHTML=[
          '<div class="popup-content"><h3>Apply Current Sorting</h3>',
          '<p>Assigns Order values to all entries based on their current sort position.</p>',
          '<p>Entries are ordered descending by default.</p><small>(21 entries total)</small></div>',
          '<div class="popup-inputs">',
          '<label for="wi_sort_start"><span data-i18n="Starting value">Starting value</span><input id="wi_sort_start" type="number" value="100"></label>',
          '<label for="wi_sort_step"><span data-i18n="Step">Step</span><input id="wi_sort_step" type="number" value="1"></label>',
          '<label for="wi_sort_ascending"><input id="wi_sort_ascending" type="checkbox"><span data-i18n="Ascending order">Ascending order</span></label>',
          '</div><button class="popup-button-ok" data-i18n="Apply">Apply</button>',
          '<button class="popup-button-cancel" data-i18n="Cancel">Cancel</button>',
        ].join('');
        w.document.body.append(popup);
        popup.querySelector('.popup-button-ok').addEventListener('click',()=>submitCalls++);
    });
    w.eval(getFunction('localizeNativeSortingPopup')+'\n'+getFunction('bindNativeSortingHelp')
        +'\nwindow.bindHelp=bindNativeSortingHelp;');
    try{
        w.bindHelp();w.bindHelp();button.click();
        await Promise.resolve();
        const popup=w.document.querySelector('.popup');
        assert.equal(nativeCalls,1);
        assert.match(button.title,/현재 정렬을 순서값에 적용/);
        assert.equal(popup.querySelector('h3').textContent,'현재 정렬을 순서값에 적용');
        assert.match(popup.querySelector('.popup-content p').textContent,/모든 항목/);
        assert.equal(popup.querySelector('label[for="wi_sort_start"] span').textContent,'시작 순서값');
        assert.equal(popup.querySelector('label[for="wi_sort_step"] span').textContent,'순서값 간격');
        assert.equal(popup.querySelector('label[for="wi_sort_ascending"] span').textContent,'오름차순으로 값 지정');
        assert.equal(popup.querySelector('.popup-content small').textContent,'(전체 21개 항목)');
        assert.equal(popup.querySelector('#wi_sort_start').value,'100');
        assert.equal(popup.querySelector('#wi_sort_step').value,'1');
        assert.equal(popup.querySelector('#wi_sort_ascending').checked,false);
        assert.equal(popup.querySelector('.popup-button-ok').textContent,'적용');
        popup.querySelector('.popup-button-ok').click();
        assert.equal(submitCalls,1);
    }finally{w.close();}
});

test('LorebookOrdering button persists with native sorting wrapper in either load order',async()=>{
    const {compactNativeSort}=await import(pathToFileURL(resolve(__dirname,'../native-controls.js')).href);
    for(const orderingFirst of [true,false]){
        const dom=new JSDOM('<div id="WorldInfo"><div id="world_popup"><div id="tools"><input type="search" id="world_info_search"><select id="world_info_sort_order"><option value="0" selected>Priority</option></select><div id="world_apply_current_sorting"></div><div id="world_refresh"></div></div></div></div>');
        const w=dom.window;
        const search=w.document.getElementById('world_info_search');
        const sorting=w.document.getElementById('world_info_sort_order');
        let clicks=0;
        const stloInsert=()=>{
            const button=w.document.createElement('div');
            button.id='stlo-test-button';
            button.className='menu_button fa-solid fa-bars-staggered';
            button.addEventListener('click',()=>clicks++);
            search.parentNode.insertBefore(button,search);
        };
        try{
            if(orderingFirst)stloInsert();
            compactNativeSort(w.document);
            if(!orderingFirst)stloInsert();
            assert.ok(w.document.getElementById('stlo-test-button'));
            assert.equal(w.document.getElementById('world_info_search'),search);
            assert.equal(w.document.getElementById('world_info_sort_order'),sorting);
            assert.equal(sorting.value,'0');
            w.document.getElementById('stlo-test-button').click();
            assert.equal(clicks,1);
            assert.ok(w.document.getElementById('world_apply_current_sorting'));
            assert.ok(w.document.getElementById('world_refresh'));
        }finally{w.close();}
    }
});
