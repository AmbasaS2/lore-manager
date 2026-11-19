const { test }=require('node:test');
const assert=require('node:assert/strict');
const { readFileSync }=require('node:fs');
const { join }=require('node:path');
const { JSDOM }=require('jsdom');
const js=readFileSync(join(__dirname,'../index.js'),'utf8');
const css=readFileSync(join(__dirname,'../style.css'),'utf8');

test('the original global lorebook multiselect is never replaced on mobile',()=>{
    assert.doesNotMatch(js,/function initGlobalLorebookSelection\s*\(/);
    assert.doesNotMatch(js,/initGlobalLorebookSelection\s*\(\s*\)/);
    assert.doesNotMatch(js,/slb-global-lorebooks|slb-global-lorebook|slb-global-world-select/);
    assert.doesNotMatch(css,/slb-global-lorebooks|slb-global-lorebook|slb-global-world-select/);
    assert.doesNotMatch(css,/#WorldInfo[^{]*#world_info\s*{[^}]*display:\s*none/s);
    assert.doesNotMatch(js,/world_info\.globalSelect\s*=/);
    assert.doesNotMatch(js,/\bjQuery\(select\)\.on\('change\.slbGlobalLorebooks'/);
});

test('SillyTavern native global select retains original selection and change handling',()=>{
    const html='<section id="WorldInfo" class="slb-active"><div id="WIMultiSelector">'+
      '<select id="world_info" multiple>'+
      '<option value="0">About 나이트폴</option>'+
      '<option value="1">About 몬스터</option>'+
      '<option value="2">About 인어</option>'+
      '</select></div></section>';
    const dom=new JSDOM(html,{pretendToBeVisual:true});
    const select=dom.window.document.getElementById('world_info');
    try{
        assert.equal(select.multiple,true);
        assert.equal(select.options.length,3);
        assert.deepEqual([...select.selectedOptions].map(x=>x.textContent),[]);
        let events=0;
        let saved=[];
        select.addEventListener('change',()=>{
            events++;
            saved=[...select.selectedOptions].map(option=>option.textContent);
        });
        select.options[1].selected=true;
        select.dispatchEvent(new dom.window.Event('change',{bubbles:true}));
        assert.equal(events,1);
        assert.deepEqual(saved,['About 몬스터']);
        assert.deepEqual([...select.options].map(option=>option.textContent),
          ['About 나이트폴','About 몬스터','About 인어']);
        assert.equal(select.ownerDocument.getElementById('slb-global-lorebooks'),null);
        assert.equal(select.classList.contains('slb-global-world-select'),false);
        select.options[1].selected=false;
        select.dispatchEvent(new dom.window.Event('change',{bubbles:true}));
        assert.equal(events,2);
        assert.deepEqual(saved,[]);
    }finally{dom.window.close();}
});

test('removing global selector customization does not remove per-entry character and tag filters',()=>{
    assert.match(css,/#WorldInfo\.slb-active \.slb-themed-filter-list\s*{/);
    assert.match(css,/#WorldInfo\.slb-active \.slb-themed-filter-row\s*{/);
    assert.match(css,/#WorldInfo\.slb-active \.slb-themed-filter-row:has\(input:checked\)/);
    assert.match(css,/#WorldInfo\.slb-active \.slb-filter-grid\[data-slb-filter-layout="slots-v1"\] > \.slb-filter-control-slot select\.slb-themed-filter-source\s*{\s*display:\s*none !important;/);
    assert.match(js,/function useNativeConnectionFilterLists\s*\(/);
    assert.match(js,/function createWorkspace\s*\(/);
});
