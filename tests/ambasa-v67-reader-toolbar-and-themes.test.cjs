const { test } = require('node:test');
const assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { pathToFileURL } = require('node:url');

const root = join(__dirname, '..');
const js = readFileSync(join(root, 'library-shelf.js'), 'utf8');
const css = readFileSync(join(root, 'library-shelf.css'), 'utf8');
const index = readFileSync(join(root, 'index.js'), 'utf8');
const tick = () => new Promise(resolve => setImmediate(resolve));
const url = pathToFileURL(join(root, 'library-shelf.js')).href;

async function fixture({theme='mac',type='memory',count=42}={}) {
    const { createStandaloneLibrary } = await import(url);
    const dom = new JSDOM('<!doctype html><html><body></body></html>', {pretendToBeVisual:true});
    const w=dom.window; w.confirm=()=>true;
    const stored={theme}; const stats={reads:0,writes:0,themeSaves:0};
    const entries=Object.fromEntries(Array.from({length:count},(_,i)=>[i,{
        uid:i,displayIndex:i,comment:'기록 '+i,content:'Lore content '+i,key:['trigger'],
    }]));
    const initial=JSON.stringify(entries);
    const lib=createStandaloneLibrary({
        document:w.document,listBooks:()=>['Book'],linkedBooks:()=>new Set(['Book']),
        loadBook:async()=>{stats.reads++;return {entries}},
        loadTranslations:async()=>{},translationFor:()=>({text:''}),
        saveContent:async()=>{stats.writes++},saveTranslation:async()=>{stats.writes++},
        translateOne:async()=>{stats.writes++},openAdvanced:()=>{},
        getType:()=>type,setType:()=>{},
        getTypeMap:()=>({'Book':type}),
        getTheme:()=>stored.theme,
        setTheme:async value=>{stored.theme=value;stats.themeSaves++},
        getListPageSize:()=>5,setListPageSize:async()=>{},
        getListOrder:()=> 'normal',setListOrder:async()=>{},
        getLinkedOnly:()=>true,setLinkedOnly:async()=>{},
        getTags:()=>[],getTagMap:()=>({}),setTags:async()=>{},
        notify:()=>{},
    });
    const q=sel=>w.document.querySelector(sel);
    const click=sel=>{const el=q(sel);assert.ok(el,'not found '+sel);el.click()};
    const change=(sel,value)=>{const el=q(sel);assert.ok(el);el.value=value;el.dispatchEvent(new w.Event('change',{bubbles:true}))};
    const openBook=async()=>{lib.open();click('[data-action="select-book"]');await tick()};
    return {lib,dom,w,stored,stats,entries,initial,q,click,change,openBook};
}

test('memory has an accessible single-row TOC toggle in all four themes',async()=>{
    for (const theme of ['mac','blackberry','ebook','antique']) {
        const f=await fixture({theme});
        try{
            await f.openBook();
            const toggle=f.q('[data-action="memory-toc-toggle"]');
            const toc=f.q('#slb-library-memory-contents');
            assert.ok(toggle && toc,theme);
            assert.equal(toggle.getAttribute('aria-expanded'),'true');
            assert.equal(toggle.getAttribute('aria-controls'),toc.id);
            const firstDetail=f.q('.slb-library-detail-memory');
            assert.ok(firstDetail,'memory content visible');
            toggle.click();
            assert.equal(toc.hidden,true);
            assert.equal(toggle.querySelector('.slb-library-toc-chevron').textContent,'▾');
            assert.equal(toggle.getAttribute('aria-expanded'),'false');
            assert.equal(f.q('.slb-library-detail-memory'),firstDetail,'toggle must not rerender the actual diary or lose unsaved text');
            assert.equal(f.stats.reads,1);
            toggle.click();
            assert.equal(toc.hidden,false);
            assert.equal(toggle.querySelector('.slb-library-toc-chevron').textContent,'▴');
            f.click('[data-action="memory-list-next"]');
            assert.equal(f.q('#slb-library-memory-contents').hidden,false,'TOC stays expanded through pagination');
            assert.equal(f.stats.writes,0);
            assert.equal(JSON.stringify(f.entries),f.initial);
        }finally{f.dom.window.close()}
    }
});

test('a collapsed memory TOC stays collapsed while selecting a different page, but resets for a fresh book visit',async()=>{
    const f=await fixture({count:34});
    try{
        await f.openBook();
        f.click('[data-action="memory-toc-toggle"]');
        f.click('[data-action="diary-next"]');
        assert.equal(f.q('#slb-library-memory-toc').hidden,true);
        assert.equal(f.q('[data-action="memory-toc-toggle"]').getAttribute('aria-expanded'),'false');
        f.click('[data-action="memory-toc-toggle"]');
        assert.equal(f.q('#slb-library-memory-contents').hidden,false);
        f.click('[data-action="books"]');
        f.click('[data-action="select-book"]');await tick();
        assert.equal(f.q('#slb-library-memory-contents').hidden,false);
    }finally{f.dom.window.close()}
});

test('16 combinations retain one shared pager and compact page/order options without memory toggle in other kinds',async()=>{
    for(const theme of ['mac','blackberry','ebook','antique'])
      for(const type of ['general','memory','world','people']){
        const f=await fixture({theme,type});
        try{
            await f.openBook();
            const pager=f.q(type==='world'?'.slb-library-world-pages':
                type==='people'?'.slb-library-people-pages':'.slb-library-list-pages');
            assert.ok(pager,theme+' / '+type);
            const arrows=pager.querySelector('.slb-library-page-navigation');
            const fields=pager.querySelector('.slb-library-page-options');
            assert.ok(arrows && fields);
            assert.deepEqual([...pager.children].slice(0,2),[arrows,fields],'options follow the arrows');
            assert.deepEqual([...pager.querySelectorAll('.slb-library-page-size-select option')]
                .map(node=>node.textContent),['5개','10개','20개']);
            assert.equal(pager.querySelector('.slb-library-order-select').value,'normal');
            assert.equal(Boolean(f.q('[data-action="memory-toc-toggle"]')),type==='memory');
            assert.ok(f.q('.slb-library-type-arrows.fa-sort'),'type switch has arrows');
            assert.equal(f.stats.reads,1);
        }finally{f.dom.window.close()}
    }
});

test('titlebar controls are minimize-settings-close and anchored popover is not a drag surface',async()=>{
    const f=await fixture();
    try{
        f.lib.open();
        const top=f.q('.slb-library-top');
        assert.deepEqual([...f.w.document.querySelectorAll('.slb-library-header-actions > button')]
          .map(x=>x.dataset.action),['minimize','settings','close']);
        const settings=f.q('#slb-library-settings-panel');
        assert.equal(settings.parentElement,top);
        assert.ok(settings.hasAttribute('data-no-drag'));
        f.click('[data-action="settings"]');
        assert.equal(settings.hidden,false);
        assert.equal(f.q('[data-action="settings"]').getAttribute('aria-expanded'),'true');
        f.click('[data-action="settings"]');
        assert.equal(settings.hidden,true);
        assert.equal(f.stats.writes,0);
    }finally{f.dom.window.close()}
});

test('four theme options have requested order, default Mac fallback, and user-changed choice survives reopening',async()=>{
    const f=await fixture({theme:undefined});
    try{
        f.lib.open();
        const select=f.q('#slb-library-theme-mode');
        assert.deepEqual([...select.options].map(o=>o.value),['mac','blackberry','ebook','antique']);
        assert.equal(select.value,'mac');
        f.change('#slb-library-theme-mode','blackberry');
        await tick();
        assert.equal(f.stored.theme,'blackberry');
        assert.equal(f.stats.themeSaves,1);
        f.lib.close();f.lib.open();
        assert.equal(f.q('#slb-library-theme-mode').value,'blackberry');
        assert.equal(f.w.document.querySelector('#slb-library-overlay').dataset.libraryTheme,'blackberry');
    }finally{f.dom.window.close()}
});

test('CSS enforces narrow single-row pager, 330px fallback and shadowless theme-variable mini launcher',()=>{
    const part=css.slice(css.lastIndexOf('/* ambasa.67'));
    assert.ok(part.length>3000,'v67 scoped CSS exists');
    assert.match(part, /@container \(max-width: 330px\)/);
    assert.match(part, /slb-library-page-options[\s\S]*flex: 0 0 auto !important/);
    assert.match(part, /select\.slb-library-order-select\s*\{[^}]*width: 81px !important/s);
    assert.match(part, /select\.slb-library-page-size-select\s*\{[^}]*width: 50px !important/s);
    assert.match(part, /slb-library-diary-toc\[hidden\]\s*\{[^}]*display: none !important/s);
    assert.match(part, /button\.slb-library-minimized-launcher\s*\{[^}]*background: var\(--ll-paper-light\) !important;[^}]*border: 1px solid var\(--ll-line\) !important;[^}]*color: var\(--ll-ink\) !important;[^}]*box-shadow: none !important/s);
    assert.match(part, /slb-library-top > \.slb-library-settings-panel\s*\{[^}]*z-index: 60 !important/s);
    assert.match(part, /#slb-library-book-type\s*\{[^}]*width: 82px !important/s);
    assert.doesNotMatch(part, /font-family|MutationObserver|ResizeObserver|setInterval|setTimeout/);
    assert.doesNotMatch(js, /setInterval\(/);
    assert.match(index, /libraryTheme: 'mac'/);
    assert.equal(JSON.parse(readFileSync(join(root,'manifest.json'),'utf8')).version,'1.4.85-ambasa.70');
});
