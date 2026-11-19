const {test}=require('node:test');
const assert=require('node:assert/strict');
const {readFileSync}=require('node:fs');
const {join}=require('node:path');
const {JSDOM}=require('jsdom');

const source=readFileSync(join(__dirname,'../index.js'),'utf8');
const css=readFileSync(join(__dirname,'../style.css'),'utf8');
function prod(name){
    const m=source.match(new RegExp('^function '+name+'\\([^]*?^}', 'm'));
    assert.ok(m,'missing function '+name);
    return m[0];
}
const elementStub='const createElement=(name,cls,txt)=>{const el=document.createElement(name);'+
    'if(cls)el.className=cls;if(txt)el.textContent=txt;return el;};';

test('three original stored visibility preferences apply across widths',()=>{
    const dom=new JSDOM('<div id="WorldInfo"><section id="slb-token-summary-section"></section><section id="slb-entry-filters-section"></section></div>',{runScripts:'outside-only'});
    const w=dom.window;
    const stubs=[
       'const config={showMobileEntryState:true,showMobileTokenSummary:true,showMobileEntryFilters:true};',
       'const getSettings=()=>config;let walks=0;',
       'const renderedEntries=()=>{walks++;return []};',
       'const syncMobileEntryStateBadge=()=>{};',
    ].join('\n');
    w.eval(stubs+'\n'+prod('applyMobileDisplaySettings')+
       '\nwindow.change=applyMobileDisplaySettings;window.config=config;window.getWalks=()=>walks;');
    try{
        const root=w.document.getElementById('WorldInfo');
        w.change(false);
        assert.equal(root.classList.contains('slb-mobile-entry-state-enabled'),true);
        assert.equal(root.classList.contains('slb-mobile-token-summary-hidden'),false);
        assert.equal(root.classList.contains('slb-mobile-entry-filters-hidden'),false);
        assert.equal(w.getWalks(),0,'simple visibility never rerenders rows');
        w.config.showMobileEntryState=false;
        w.config.showMobileTokenSummary=false;
        w.config.showMobileEntryFilters=false;
        w.change(false);
        assert.equal(root.classList.contains('slb-mobile-entry-state-enabled'),false);
        assert.equal(root.classList.contains('slb-mobile-token-summary-hidden'),true);
        assert.equal(root.classList.contains('slb-mobile-entry-filters-hidden'),true);
        assert.equal(w.getWalks(),0);
        assert.match(css,/#WorldInfo\.slb-active\.slb-mobile-token-summary-hidden #slb-token-summary-section,/);
        assert.match(css,/#WorldInfo\.slb-active\.slb-mobile-entry-filters-hidden #slb-entry-filters-section\s*\{\s*display:\s*none !important;/s);
        assert.match(css,/#WorldInfo\.slb-active\.slb-mobile-entry-state-enabled #world_popup_entries_list \.world_entry \.slb-entry-header-shell > \.slb-mobile-entry-state-badge\s*\{\s*display:\s*inline-flex;/s);
    }finally{w.close();}
});

test('settings labels visibility as global without losing saved keys',()=>{
    assert.match(source,/class="slb-mobile-display-title">로어북 표시</);
    assert.match(source,/PC와 모바일에 동일하게 적용됩니다/);
    assert.doesNotMatch(source,/모바일 로어북 표시/);
    for(const key of ['showMobileEntryState','showMobileTokenSummary','showMobileEntryFilters']){
        assert.match(source,new RegExp(key+':'));
    }
    assert.match(source,/applyMobileDisplaySettings\(key === 'showMobileEntryState'\)/);
});

test('stats and filter native identifiers survive while Font Awesome colors unify',()=>{
    const dom=new JSDOM('<main></main>',{runScripts:'outside-only'});
    const w=dom.window;
    w.eval(elementStub+'\n'+prod('createTokenStrip')+'\n'+prod('createEntryFilters')+
        '\nwindow.buildStats=createTokenStrip;window.buildFilters=createEntryFilters');
    try {
        const stats=w.buildStats(),filters=w.buildFilters();
        assert.equal(stats.querySelectorAll('strong[id]').length,5);
        assert.equal(stats.querySelectorAll('.slb-stat-icon').length,3);
        assert.equal(filters.querySelectorAll('.slb-filter-button').length,4);
        assert.deepEqual(Array.from(filters.querySelectorAll('.slb-filter-button')).map(x=>x.dataset.filter),
            ['all','constant','normal','vectorized']);
        assert.equal(filters.querySelectorAll('i.slb-stat-icon').length,3);
        assert.match(css,/\.slb-stat-constant\s*\{\s*color: #428bfa/);
        assert.match(css,/\.slb-stat-normal\s*\{\s*color: #29b765/);
    } finally { w.close(); }
});

test('dynamic CSS no longer overrides current fonts, native popup scales consistently',()=>{
    const critical=source.slice(source.indexOf('function ensureCriticalLayoutStyles()'),source.indexOf('function getSettings()'));
    assert.ok(critical.length<2400,'does not inject old 14KB stylesheet');
    assert.doesNotMatch(critical,/13px!important|\.8em!important|42px!important/);
    assert.match(critical,/visibility: visible !important/);
    assert.match(css,/\.popup:has\(\.slb-translation-picker\)\s*\{[^}]*width:\s*min\(420px,\s*calc\(100dvw - 24px\)\)/);
    assert.match(css,/\.popup:has\(\.slb-translation-picker\) \.popup-controls > \.menu_button\s*\{[^}]*min-height:\s*36px/s);
});

test('backup actions wrap whole buttons, never individual Korean characters',()=>{
    assert.match(css,/#slb-ai-tools \.slb-backup-toolbar-actions\s*\{[^}]*flex-wrap:\s*wrap/s);
    assert.match(css,/#slb-ai-tools \.slb-backup-toolbar-actions \.menu_button,[\s\S]*?white-space:\s*nowrap/s);
    assert.match(css,/#slb-ai-tools \.slb-settings-card \.menu_button\s*\{[^}]*font:\s*inherit/s);
    assert.match(css,/\.slb-manager-mode-choice > span\s*\{[^}]*font-size:\s*inherit/s);
});
