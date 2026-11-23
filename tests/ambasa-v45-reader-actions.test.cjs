const {test}=require('node:test');
const assert=require('node:assert/strict');
const {JSDOM}=require('jsdom');
const {readFileSync}=require('node:fs');
const {join}=require('node:path');
const {pathToFileURL}=require('node:url');
const root=join(__dirname,'..');
const uri=pathToFileURL(join(root,'library-shelf.js')).href;
const css=readFileSync(join(root,'library-shelf.css'),'utf8');
const src=readFileSync(join(root,'library-shelf.js'),'utf8');
const tick=()=>new Promise(resolve=>setImmediate(resolve));

async function setup({theme='antique',type='general',count=4}={}) {
    const {createStandaloneLibrary}=await import(uri);
    const dom=new JSDOM('<!doctype html><html><head></head><body></body></html>',
        {runScripts:'outside-only',pretendToBeVisual:true});
    const w=dom.window;w.confirm=()=>true;
    const names=['세계관','기억 일기','인물 연락처','기록 카드',...Array.from({length:count-4},(_,i)=>'Extra '+i)];
    const types={'세계관':'world','기억 일기':'memory','인물 연락처':'people','기록 카드':'general'};
    const entry={uid:17,displayIndex:0,comment:'실제 원문 제목',content:'Original source content',key:['person']};
    const coverMap={'세계관':'/user/images/custom-cover.png'};
    const imageMap={};
    const stats={loads:0,translations:0,uploads:[],unlinks:[],ai:[],sourceSaves:0,translatedSaves:0,advanced:[],promptConfirm:0};
    const lib=createStandaloneLibrary({
        document:w.document,listBooks:()=>names,linkedBooks:()=>new Set(names),
        loadBook:async()=>{stats.loads++;return {entries:{17:{...entry}}}},
        loadTranslations:async()=>{stats.translations++},
        translationFor:()=>({text:'Saved translation',pair:{sourceLanguage:'English',translationLanguage:'Korean'}}),
        saveContent:async()=>{stats.sourceSaves++},saveTranslation:async()=>{stats.translatedSaves++},
        translateOne:async(...args)=>{stats.ai.push(args)},
        openAdvanced:(...args)=>{stats.advanced.push(args)},
        getType:name=>types[name]||type,
        getTypeMap:()=>types,setType:(name,t)=>{types[name]=t},
        getTags:()=>[],getTagMap:()=>({}),setTags:async()=>{},
        getBookCover:name=>coverMap[name]||'',getBookCoverMap:()=>coverMap,
        getEntryImage:(name,e)=>imageMap[name+':'+e.uid]||'',
        uploadEntryImage:async(name,e,file)=>{
            stats.uploads.push({name,uid:e.uid,file:file.name});
            imageMap[name+':'+e.uid]='/user/images/entry-image.png';
        },
        removeEntryImage:async(name,e)=>{stats.unlinks.push([name,e.uid]);delete imageMap[name+':'+e.uid]},
        getTheme:()=>theme,getCleanVariant:()=> 'mac',getLinkedOnly:()=>true,notify:()=>{}
    });
    lib.open();
    const q=s=>w.document.querySelector(s);
    const qa=s=>[...w.document.querySelectorAll(s)];
    const click=s=>{const el=q(s);assert.ok(el,'missing '+s);el.click()};
    const load=async book=>{click('[data-action="select-book"][data-book="'+book+'"]');await tick()};
    return {dom,w,q,qa,click,load,stats,coverMap,imageMap,names};
}

test('the real classic bookshelf remains with physical wood boards and two rows, with type-distinct bindings',async()=>{
    const f=await setup();
    try{
        const d=f.w.document;
        assert.equal(f.q('.slb-library-bookshelf').classList.contains('slb-library-digital-bookshelf'),false);
        assert.ok(f.q('.slb-library-book-spines'));
        assert.ok(f.q('.slb-library-wood-plank'),'original physical board element retained');
        assert.equal(f.qa('.slb-library-book-spine').length,4);
        assert.deepEqual(f.qa('.slb-library-book-spine').map(n=>n.dataset.bookType),['world','memory','people','general']);
        for(const el of f.qa('.slb-library-book-spine')) {
            assert.ok(el.querySelector('.slb-library-spine-ornament'));
            assert.ok(/^(ATLAS|DIARY|A–Z|FILE)$/.test(el.querySelector('.slb-library-spine-bottom').textContent));
            assert.doesNotMatch(el.textContent,/\b(?:01|02|03|04)\b/);
        }
        assert.match(css,/\.slb-library-book-spines\s*\{[^}]*repeating-linear-gradient\(to bottom/s);
        for(const t of ['world','memory','people','general'])
            assert.match(css,new RegExp('button\\.slb-library-book-spine\\.slb-library-spine-type-'+t));
        assert.deepEqual([f.stats.loads,f.stats.ai.length],[0,0]);
    }finally{f.dom.window.close()}
});

test('clean editorial covers keep uploaded cover art but do not show sequence edition numbers',async()=>{
    const f=await setup({theme:'clean'});
    try{
        assert.equal(f.q('.slb-library-cover-image').getAttribute('src'),'/user/images/custom-cover.png');
        assert.equal(f.qa('.slb-library-cover-overline').length,0);
        assert.equal(f.qa('.slb-library-cover-art').length,4);
        assert.ok(f.q('[data-action="cover-config"]'));
        assert.equal(f.stats.loads,0);
    }finally{f.dom.window.close()}
});

test('compact Font Awesome settings and close controls use solid icons',async()=>{
    const f=await setup();
    try{
        assert.ok(f.q('.slb-library-settings-button .fa-solid.fa-gear'));
        assert.ok(f.q('.slb-library-close .fa-solid.fa-xmark'));
        assert.ok(f.q('.slb-library-settings-panel select.slb-library-theme-select'));
        assert.match(css,/select\.slb-library-theme-select\s*\{[^}]*height:\s*30px !important/s);
        f.click('[data-action="settings"]');
        assert.equal(f.q('.slb-library-settings-panel').hidden,false);
        const outside=f.q('.slb-library-body');
        outside.click();
        assert.equal(f.q('.slb-library-settings-panel').hidden,true);
    }finally{f.dom.window.close()}
});

test('only source/translation toggle and ellipsis appear until record actions are opened',async()=>{
    const f=await setup();
    try{
        await f.load('기록 카드');
        f.click('[data-action="entry"][data-uid="17"]');
        const tools=f.q('.slb-library-detail .slb-library-reader-tools');
        assert.deepEqual([...tools.querySelectorAll(':scope > button')].map(n=>n.dataset.action),['toggle-view','more-tools']);
        assert.equal(f.q('.slb-library-tools-popover').hidden,true);
        f.click('[data-action="more-tools"]');
        assert.equal(f.q('.slb-library-tools-popover').hidden,false);
        assert.deepEqual(f.qa('.slb-library-tools-popover [data-action]').map(n=>n.dataset.action),
            ['edit','translate','advanced','image-pick']);
        assert.equal(f.stats.ai.length,0);
        assert.equal(f.q('[data-action="tag-edit"]'),null,'redundant per-record tag edit removed');
        assert.ok(f.q('.slb-library-reader-book-tags .slb-library-book-meta'),'book-level tags still editable');
        f.w.document.dispatchEvent(new f.w.KeyboardEvent('keydown',{key:'Escape',bubbles:true}));
        assert.equal(f.q('.slb-library-tools-popover').hidden,true);
        assert.equal(f.q('#slb-library-overlay')!==null,true,'Escape dismisses menu, not the whole modal');
    }finally{f.dom.window.close()}
});

test('image upload and remove stay explicitly available through ellipsis, without touching source or translation',async()=>{
    const f=await setup();
    try{
        await f.load('기록 카드');f.click('[data-action="entry"][data-uid="17"]');
        f.click('[data-action="more-tools"]');
        const input=f.q('.slb-library-tools-popover .slb-library-image-file');
        assert.ok(input);
        Object.defineProperty(input,'files',{configurable:true,value:[new f.w.File([new Uint8Array([7,8])],'ref.png',{type:'image/png'})]});
        input.dispatchEvent(new f.w.Event('change',{bubbles:true}));
        assert.ok(f.q('[data-action="image-save"]'),'explicit image save remains');
        f.click('[data-action="image-save"]');
        await tick();
        assert.deepEqual(f.stats.uploads,[{name:'기록 카드',uid:17,file:'ref.png'}]);
        assert.equal(f.q('.slb-library-entry-image-element').getAttribute('src'),'/user/images/entry-image.png');
        f.click('[data-action="more-tools"]');
        f.click('[data-action="image-remove"]');
        await tick();
        assert.deepEqual(f.stats.unlinks,[['기록 카드',17]]);
        assert.equal(f.q('.slb-library-entry-image-element'),null);
        assert.deepEqual([f.stats.sourceSaves,f.stats.translatedSaves,f.stats.ai.length],[0,0,0]);
    }finally{f.dom.window.close()}
});

test('the classic reader uses paper files without layered ridge picture frames and decorative boxes',()=>{
    assert.match(css,/\.slb-library-reader-classic \.slb-library-catalog-frame\s*\{[^}]*border:\s*0;/s);
    assert.match(css,/\.slb-library-reader-classic \.slb-library-catalog-card::after\s*\{[^}]*content:\s*none;/s);
    assert.match(css,/\.slb-library-reader-classic \.slb-library-journal\s*\{[^}]*border:\s*1px solid/s);
    assert.match(css,/\.slb-library-reader-classic \.slb-library-person-directory,/);
    assert.doesNotMatch(src,/new MutationObserver|setInterval/);
});
