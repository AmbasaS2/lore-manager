const {test} = require('node:test');
const assert = require('node:assert/strict');
const {JSDOM} = require('jsdom');
const {join} = require('node:path');
const {pathToFileURL} = require('node:url');
const tick = () => new Promise(resolve => setImmediate(resolve));
async function fixture(type='world'){
    const {createStandaloneLibrary}=await import(pathToFileURL(join(__dirname,'../library-shelf.js')).href);
    const dom=new JSDOM('<body></body>',{pretendToBeVisual:true});
    const w=dom.window,doc=w.document;
    const books=['Origin','Second'];
    const data=Object.fromEntries(books.map((name,b)=>[name,{entries:{
        0:{uid:0,order:0,comment:'Original heading '+b,content:'Original body '+b,key:['original-key-'+b],keysecondary:['original-secondary-'+b]},
        1:{uid:1,order:1,comment:'Other entry',content:'Unrelated',key:[],keysecondary:[]}
    }}]));
    const records={
        Origin:{0:{text:'원문에 없는 번역본문',fields:{comment:{text:'번역제목'},key:{text:'번역호출키'},keysecondary:{text:'번역보조키'}}}},
        Second:{0:{text:'translated phrase',fields:{comment:{text:'translated heading'},key:{text:'translated-key'},keysecondary:{text:'translated-secondary'}}}}
    };
    let reads=0,translationReads=0,lookups=0,ai=0;
    const loaded=new Set();
    const lib=createStandaloneLibrary({
        document:doc,listBooks:()=>books,linkedBooks:()=>new Set(books),
        loadBook:async name=>{reads++;return data[name];},
        loadTranslations:async name=>{translationReads++;loaded.add(name);return true;},
        // Simulate a hidden/opposite-language display translation. Searching
        // must still use saved records independently of the display state.
        translationFor:()=>({text:'',title:''}),
        searchTranslationFor:(book,entry)=>{lookups++;return loaded.has(book)?records[book]?.[entry.uid]:undefined;},
        translateOne:async()=>{ai++;},getType:()=>type,getTheme:()=> 'mac',
        getLinkedOnly:()=>true,notify:()=>{},
    });
    const q=s=>doc.querySelector(s), all=s=>[...doc.querySelectorAll(s)];
    const click=s=>{const n=q(s);assert.ok(n,s);n.click();};
    const input=(selector,value)=>{const el=q(selector);el.value=value;el.focus();el.dispatchEvent(new w.InputEvent('input',{bubbles:true}));return el;};
    const enter=(el,composing=false)=>el.dispatchEvent(new w.KeyboardEvent('keydown',{key:'Enter',isComposing:composing,bubbles:true,cancelable:true}));
    return {w,lib,data,records,q,all,click,input,enter,stats:()=>({reads,translationReads,lookups,ai}),close(){lib.close();w.close();}};
}
test('shelf waits for submit, searches both languages and all six metadata/content fields',async()=>{
    const f=await fixture();
    try{
        f.lib.open();
        const shelf=f.q('.slb-library-bookshelf');
        f.click('[data-action="shelf-search-toggle"]');
        const field=f.q('#slb-library-shelf-search');
        assert.equal(field.parentElement.querySelector('button').dataset.action,'submit-shelf-search');
        for(const word of ['원','원문','번역본문']) f.input('#slb-library-shelf-search',word);
        f.enter(field,true);
        assert.equal(f.q('.slb-library-bookshelf'),shelf);
        assert.equal(f.q('.slb-library-global-panel'),null);
        assert.deepEqual(f.stats(),{reads:0,translationReads:0,lookups:0,ai:0});
        const terms=['번역본문','번역제목','번역호출키','번역보조키','Original body 0','Original heading 0','original-key-0','original-secondary-0','translated phrase','translated heading','translated-key','translated-secondary'];
        for(const [i,term] of terms.entries()){
            if(f.q('[data-action="shelf-search-toggle"]').getAttribute('aria-expanded')!=='true') f.click('[data-action="shelf-search-toggle"]');
            f.input('#slb-library-shelf-search',term);
            if(i%2) f.enter(field); else f.click('[data-action="submit-shelf-search"]');
            await tick();await tick();
            const hits=f.all('[data-action="global-result"]');
            assert.equal(hits.length,1,term);
            assert.equal(hits[0].dataset.book,i<8?'Origin':'Second',term);
            assert.equal(hits[0].dataset.uid,'0',term);
            assert.equal(f.q('#slb-library-shelf-search'),field);
        }
        f.click('[data-action="return-to-shelf"]');
        assert.equal(f.q('.slb-library-bookshelf'),shelf);
        assert.equal(f.stats().ai,0);
        assert.equal(f.q('.slb-library-global-panel'),null);
        f.click('[data-action="shelf-search-toggle"]');
        f.input('#slb-library-shelf-search','Second');
        f.enter(field);await tick();await tick();
        assert.equal(f.q('.slb-library-global-result[data-action="select-book"]').dataset.book,'Second');
    }finally{f.close();}
});
for(const type of ['general','memory','world','people']) test(type+' reader uses submit-only bilingual search and invalidates changed translations',async()=>{
    const f=await fixture(type);
    try{
        f.lib.open();
        f.click('[data-action="select-book"][data-book="Origin"]');await tick();await tick();
        const frame=f.q('.slb-library-reader-frame'), initial=f.stats();
        assert.equal(initial.lookups,0);
        f.click('[data-action="reader-search-toggle"]');
        const field=f.input('#slb-library-search','번역호출키');
        f.enter(field,true);
        assert.equal(f.q('.slb-library-reader-frame'),frame);
        assert.deepEqual(f.stats(),initial);
        f.click('[data-action="submit-reader-search"]');
        assert.notEqual(f.q('.slb-library-reader-frame'),frame);
        const selectors={general:'.slb-library-clean-list-row',memory:'.slb-library-diary-page',world:'.slb-library-index-item',people:'.slb-library-person-row'};
        assert.equal(f.all(selectors[type]).length,1);
        assert.equal(f.q(selectors[type]).dataset.uid,'0');
        const lookups=f.stats().lookups;
        for(const term of ['번역본문','번역제목','번역보조키','original-secondary-0']){
            f.click('[data-action="reader-search-toggle"]');
            f.input('#slb-library-search',term);f.enter(field);
            assert.equal(f.all(selectors[type]).length,1,term);
            assert.equal(f.q(selectors[type]).dataset.uid,'0',term);
        }
        assert.equal(f.stats().lookups,lookups,'reuse one book search index');
        f.records.Origin[0].fields.key.text='새 번역 호출어';
        f.lib.invalidateTranslationSearch('Origin');
        f.click('[data-action="reader-search-toggle"]');
        f.input('#slb-library-search','새 번역 호출어');f.enter(field);
        assert.equal(f.all(selectors[type]).length,1);
        assert.equal(f.q(selectors[type]).dataset.uid,'0');
        assert.equal(f.stats().reads,1);
        assert.equal(f.stats().translationReads,1);
        assert.equal(f.stats().ai,0);
    }finally{f.close();}
});
