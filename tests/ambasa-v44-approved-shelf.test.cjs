const {test}=require('node:test');
const assert=require('node:assert/strict');
const {JSDOM}=require('jsdom');
const {readFileSync}=require('node:fs');
const {join}=require('node:path');
const {pathToFileURL}=require('node:url');
const root=join(__dirname,'..');
const url=pathToFileURL(join(root,'library-shelf.js')).href;
const css=readFileSync(join(root,'library-shelf.css'),'utf8');
const index=readFileSync(join(root,'index.js'),'utf8');

async function fixture({theme='clean',count=36}={}){
    const {createStandaloneLibrary}=await import(url);
    const dom=new JSDOM('<!doctype html><html><body></body></html>',{runScripts:'outside-only',pretendToBeVisual:true});
    const w=dom.window;w.confirm=()=>true;
    const names=Array.from({length:count},(_,i)=>'Book '+(i+1));
    const tags={'Book 1':['기억','중요'],'Book 2':['중요'],'Book 3':['설정']};
    const covers={'Book 1':'/user/images/personal-cover.png'};
    const stats={loads:0,translateReads:0,ai:0,settingsSaves:0,coverMapReads:0};
    const state={theme,variant:'mac'};
    const lib=createStandaloneLibrary({
        document:w.document,listBooks:()=>names,linkedBooks:()=>new Set(names),
        loadBook:async()=>{stats.loads++;return {entries:{1:{uid:1,comment:'첫 번째 기록',content:'원문',displayIndex:0}}}},
        loadTranslations:async()=>{stats.translateReads++},
        translationFor:()=>({text:''}),saveContent:async()=>{},saveTranslation:async()=>{},
        translateOne:async()=>{stats.ai++},openAdvanced:()=>{},
        getType:()=> 'general',getTypeMap:()=>({}),
        setType:()=>{},getTags:name=>tags[name]??[],getTagMap:()=>tags,setTags:async()=>{},
        getTheme:()=>state.theme,setTheme:async v=>{state.theme=v;stats.settingsSaves++},
        getCleanVariant:()=>state.variant,setCleanVariant:async v=>{state.variant=v;stats.settingsSaves++},
        getBookCover:name=>covers[name]||'',getBookCoverMap:()=>{stats.coverMapReads++;return covers},
        getLinkedOnly:()=>false,setLinkedOnly:async()=>{},notify:()=>{}
    });
    lib.open();
    const q=s=>w.document.querySelector(s);
    const qa=s=>[...w.document.querySelectorAll(s)];
    const resizeTo=(shellWidth,bodyWidth)=>{
        Object.defineProperty(q('.slb-library-shell'),'clientWidth',{configurable:true,value:shellWidth});
        Object.defineProperty(q('.slb-library-body'),'clientWidth',{configurable:true,value:bodyWidth});
        q('[data-action="shelf-tag"][data-filter="all"]').click();
    };
    return {dom,w,lib,q,qa,stats,tags,covers,state,resizeTo};
}

test('360px clean modal shows 3 covers per row, 440px shows 4, with three rows initially',async()=>{
    const f=await fixture();
    try{
        f.resizeTo(360,320);
        assert.equal(f.qa('.slb-library-cover-item').length,9);
        assert.equal(f.q('.slb-library-cover-grid').style.getPropertyValue('--slb-shelf-columns'),'3');
        assert.equal(f.qa('.slb-library-cover-face').length,0);
        assert.equal(f.q('.slb-library-cover-image').getAttribute('src'),'/user/images/personal-cover.png');
        assert.equal(f.qa('.slb-library-cover-overline').every(x=>!x.textContent.includes('LORE LIBRARY')),true);
        const prior=f.qa('.slb-library-cover-item').map(x=>x.querySelector('[data-action="select-book"]').dataset.book);
        f.resizeTo(440,396);
        assert.equal(f.q('.slb-library-cover-grid').style.getPropertyValue('--slb-shelf-columns'),'4');
        assert.equal(f.qa('.slb-library-cover-item').length,12);
        assert.deepEqual(f.qa('.slb-library-cover-item').slice(0,9).map(x=>x.querySelector('[data-action="select-book"]').dataset.book),prior);
        f.q('[data-action="shelf-more"]').click();
        assert.equal(f.qa('.slb-library-cover-item').length,20,'more displays two additional rows only');
        assert.deepEqual([f.stats.loads,f.stats.translateReads,f.stats.ai],[0,0,0]);
    }finally{f.dom.window.close();}
});

test('classic binding material/palette follows book identity, not book type or active filter',async()=>{
    const f=await fixture({theme:'antique',count:120});
    try{
        f.resizeTo(360,320);
        assert.equal(f.q('.slb-library-book-spines').style.getPropertyValue('--slb-shelf-columns'),'6');
        assert.equal(f.qa('.slb-library-book-spine').length,18);
        const book=f.q('.slb-library-book-spine');
        assert.ok(/slb-library-binding-(leather|linen|cloth)/.test(book.className));
        assert.ok(f.q('[data-action="select-book"][data-book="Book 3"]').classList.contains('slb-library-spine-type-general'),
            'general book must use FILE binding, regardless of shelf color order');
        const originalClass=book.className;
        f.q('#slb-library-shelf-search').value='Book 1';
        f.q('#slb-library-shelf-search').dispatchEvent(new f.w.Event('input',{bubbles:true}));
        assert.equal(f.q('.slb-library-book-spine').dataset.book,'Book 1');
        assert.equal(f.q('.slb-library-book-spine').className,originalClass);
        assert.match(css,/#59636b/i,'approved slate replaces rejected ochre');
        assert.doesNotMatch(css,/#A66C3F/i);
        assert.equal(f.stats.loads,0);
    }finally{f.dom.window.close();}
});

test('custom saved tags live in compact dropdown; filters change only metadata, not lore entries',async()=>{
    const f=await fixture({theme:'antique'});
    try{
        const selects=f.qa('#slb-library-shelf-tag-select option').map(x=>({value:x.value,text:x.textContent}));
        assert.deepEqual(selects.slice(1),[
            {value:'tag:기억',text:'기억'},
            {value:'tag:중요',text:'중요'},
            {value:'tag:설정',text:'설정'}
        ]);
        assert.equal(f.qa('[data-action="shelf-tag"]').length,2);
        const control=f.q('#slb-library-shelf-tag-select');
        control.value='tag:중요';
        control.dispatchEvent(new f.w.Event('change',{bubbles:true}));
        assert.deepEqual(f.qa('.slb-library-book-spine').map(b=>b.dataset.book),['Book 1','Book 2']);
        f.q('[data-action="shelf-tag"][data-filter="untagged"]').click();
        assert.ok(f.qa('.slb-library-book-spine').every(e=>!['Book 1','Book 2','Book 3'].includes(e.dataset.book)));
        assert.deepEqual([f.stats.loads,f.stats.translateReads,f.stats.ai],[0,0,0]);
    }finally{f.dom.window.close();}
});

test('uploaded cover and editor remain available while default art is unique and compact',async()=>{
    const f=await fixture({theme:'clean',count:24});
    try{
        assert.ok(f.q('.slb-library-cover-image'),'preexisting user cover remains visible');
        assert.equal(f.q('.slb-library-cover-image').loading,'lazy');
        assert.ok(f.q('[data-action="cover-config"][data-book="Book 1"]'));
        assert.equal(f.qa('.slb-library-cover-type-general').length,18,
            'stored general book type owns the cover template');
        assert.equal(f.qa('.slb-library-type-variant-0, .slb-library-type-variant-1, .slb-library-type-variant-2').length,18);
        assert.match(css,/width:\s*min\(100%,\s*110px\)/);
        assert.match(css,/repeat\(var\(--slb-shelf-columns,\s*6\),\s*minmax\(0,\s*1fr\)\)/);
        assert.equal(f.stats.loads,0);
    }finally{f.dom.window.close();}
});

test('center resize and gear are actual separate controls; no redundant header/footer copy',async()=>{
    const f=await fixture();
    try{
        const toolbar=f.q('.slb-library-header-actions');
        assert.deepEqual([...toolbar.querySelectorAll('[data-action]')].map(x=>x.dataset.action),['minimize','settings','close']);
        assert.equal(f.q('.slb-library-heading small'),null);
        assert.ok(f.q('.slb-library-settings-button .fa-solid.fa-gear'),'Font Awesome solid gear icon');
        assert.ok(f.q('.slb-library-minimize-button .fa-solid.fa-minus'),'Font Awesome minimize icon');
        assert.ok(f.q('.slb-library-close .fa-solid.fa-xmark'),'Font Awesome solid close icon');
        assert.ok(f.q('.slb-library-resize-grip svg path'),'three slash resize SVG');
        assert.equal(f.q('.slb-library-footer small'),null);
        assert.doesNotMatch(f.q('.slb-library-footer').textContent,/AI 자동 실행 없음/);
        assert.match(css,/\.slb-library-body\[data-type="books"\] \+ \.slb-library-footer/);
        assert.doesNotMatch(index,/libraryBookCovers:\s*null/);
    }finally{f.dom.window.close();}
});
