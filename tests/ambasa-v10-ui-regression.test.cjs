const {test}=require('node:test');
const assert=require('node:assert/strict');
const {readFileSync}=require('node:fs');
const {join}=require('node:path');
const source=readFileSync(join(__dirname,'../index.js'),'utf8');
const css=readFileSync(join(__dirname,'../style.css'),'utf8');

test('STLO-style translation popup uses native checkbox/checkmark and native popup',()=>{
    assert.match(source,/new Popup\(form, POPUP_TYPE\.CONFIRM/);
    assert.match(source,/createElement\('span', 'checkmark'\)/);
    assert.match(source,/showAll\.disabled = linkedBooks === null/);
    assert.match(source,/showAll\.checked = linkedBooks === null/);
    assert.match(source,/result === 2 \? 'missing' : 'all'/);
    assert.match(css,/\.popup:has\(\.slb-translation-picker\) \.popup-controls/);
    assert.doesNotMatch(source,/id="slb-translate-missing-book"/);
});

test('mobile search is fluid rather than forced to 82px or 100% width',()=>{
    assert.match(css,/#WorldInfo\.slb-active #slb-search-sort\s*\{[^}]*flex:\s*1 1 170px/s);
    assert.match(css,/#WorldInfo\.slb-active #world_info_pagination\s*\{[^}]*flex:\s*0 0 auto/s);
    assert.doesNotMatch(css,/flex:\s*0 1 82px/);
    assert.doesNotMatch(css,/min-width:\s*45px/);
});

test('plain keyword recommendation and native rounded lorebook cards remain intact',()=>{
    assert.match(source,/createMenuButton\('fa-solid fa-key', 'AI 키워드 추천'/);
    assert.doesNotMatch(source,/keywordTitle\.innerHTML/);
    assert.doesNotMatch(source,/keywordHelp = createElement/);
    assert.match(css,/#WorldInfo\.slb-active \.slb-keyword-assistant\s*\{[^}]*border:\s*0/s);
    assert.match(css,/#WorldInfo\.slb-active \.slb-keyword-head > \.slb-keyword-recommend-button/);
    assert.doesNotMatch(css,/#WorldInfo\.slb-active \.world_entry_form\s*\{[^}]*border-radius:\s*0/s);
});

test('source field names preserved and title labels are native, hints require hover/focus',()=>{
    assert.match(source,/function attachLoreEntryHelp\(panels\)/);
    assert.doesNotMatch(source,/function localizeLoreEntryControls\(/);
    assert.doesNotMatch(source,/function addLoreEntryHelp\(/);
    assert.match(css,/\.slb-lore-tooltip\s*\{/);
    assert.match(css,/\.slb-lore-info-icon/);
    assert.match(css,/grid-template-columns:\s*auto minmax\(0, 1fr\) 18px max-content/);
    assert.match(css,/\.slb-mobile-entry-state-badge\s*\{[^}]*width:\s*18px/s);
});
