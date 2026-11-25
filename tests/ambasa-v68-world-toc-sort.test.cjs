const {test}=require('node:test');
const assert=require('node:assert/strict');
const {JSDOM}=require('jsdom');
const {readFileSync}=require('node:fs');
const {join}=require('node:path');
const {pathToFileURL}=require('node:url');
const root=join(__dirname,'..');
const css=readFileSync(join(root,'library-shelf.css'),'utf8');
const js=readFileSync(join(root,'library-shelf.js'),'utf8');
const uri=pathToFileURL(join(root,'library-shelf.js')).href;
const tick=()=>new Promise(resolve=>setImmediate(resolve));
async function fixture({theme='mac',type='world',n=38}={}){
  const {createStandaloneLibrary}=await import(uri);
  const dom=new JSDOM('<!doctype html><html><body></body></html>',{pretendToBeVisual:true});
  const win=dom.window;win.confirm=()=>true;
  const saved={type};let loads=0,writes=0;
  const entries=Object.fromEntries(Array.from({length:n},(_,i)=>[i,{
    uid:i,order:i,displayIndex:n-i,comment:'Title '+i,content:'Original '+i,key:['topic'],
  }]));
  const snapshot=JSON.stringify(entries);
  const lib=createStandaloneLibrary({
    document:win.document,listBooks:()=>['Book A','Book B'],
    linkedBooks:()=>new Set(['Book A','Book B']),
    loadBook:async()=>{loads++;return {entries}},
    loadTranslations:async()=>{},translationFor:()=>({text:''}),
    saveContent:async()=>{writes++},saveTranslation:async()=>{writes++},
    translateOne:async()=>{writes++},openAdvanced:()=>{},
    getType:()=>saved.type,setType:(_book,value)=>{saved.type=value},
    getTypeMap:()=>({'Book A':type,'Book B':type}),
    getTheme:()=>theme,setTheme:async()=>{},
    getListPageSize:()=>5,setListPageSize:async()=>{},
    getListOrder:()=> 'normal',setListOrder:async()=>{},
    getTags:()=>[],getTagMap:()=>({}),setTags:async()=>{},
    getLinkedOnly:()=>true,setLinkedOnly:async()=>{},notify:()=>{}
  });
  const q=sel=>win.document.querySelector(sel);
  const click=sel=>{const el=q(sel);assert.ok(el,'missing '+sel);el.click()};
  const open=async()=>{lib.open();click('[data-action="select-book"]');await tick()};
  return {dom,win,lib,q,click,open,saved,stats:()=>({loads,writes}),entries,snapshot};
}
test('encyclopedia TOC collapses/expands in all 4 themes without recreating the article',async()=>{
  for(const theme of ['mac','blackberry','ebook','antique']){
    const f=await fixture({theme});
    try{
      await f.open();
      const toggle=f.q('[data-action="world-toc-toggle"]');
      const toc=f.q('#slb-library-world-contents');
      const layout=f.q('.slb-library-index-layout');
      const detail=f.q('.slb-library-detail-world');
      assert.ok(toggle&&toc&&detail,theme);
      assert.equal(toggle.getAttribute('aria-controls'),toc.id);
      assert.equal(toggle.getAttribute('aria-expanded'),'true');
      assert.equal(layout.classList.contains('is-index-open'),true);
      toggle.click();
      assert.equal(toggle.querySelector('.slb-library-toc-chevron').textContent,'▾');
      assert.equal(toggle.getAttribute('aria-expanded'),'false');
      assert.equal(layout.classList.contains('is-index-open'),false);
      assert.equal(f.q('.slb-library-detail-world'),detail,'must preserve live detail and draft nodes');
      toggle.click();
      assert.equal(toggle.querySelector('.slb-library-toc-chevron').textContent,'▴');
      assert.equal(layout.classList.contains('is-index-open'),true);
      assert.equal(f.q('.slb-library-detail-world'),detail);
      assert.deepEqual(f.stats(),{loads:1,writes:0});
      assert.equal(JSON.stringify(f.entries),f.snapshot);
    }finally{f.dom.window.close()}
  }
});
test('collapsed encyclopedia TOC survives page changes, and a new book opens with expanded TOC',async()=>{
  const f=await fixture({theme:'ebook',n:240});
  try{
    await f.open();
    f.click('[data-action="world-toc-toggle"]');
    f.click('[data-action="world-next"]');
    assert.equal(f.q('.slb-library-index-layout').classList.contains('is-index-open'),false);
    assert.equal(f.q('[data-action="world-toc-toggle"]').getAttribute('aria-expanded'),'false');
    f.click('[data-action="books"]');
    const items=f.win.document.querySelectorAll('[data-action="select-book"]');
    assert.ok(items.length>1);
    items[1].click();await tick();
    assert.equal(f.q('.slb-library-index-layout').classList.contains('is-index-open'),true);
    assert.equal(f.stats().writes,0);
  }finally{f.dom.window.close()}
});
test('memory retains its toggle and other reader types do not acquire an encyclopedia toggle',async()=>{
  for(const type of ['general','memory','people']){
    const f=await fixture({type});
    try{
      await f.open();
      assert.equal(Boolean(f.q('[data-action="world-toc-toggle"]')),false);
      assert.equal(Boolean(f.q('[data-action="memory-toc-toggle"]')),type==='memory');
    }finally{f.dom.window.close()}
  }
});
test('sort controls keep all 4 values, use short readable labels, and CSS is 62px',async()=>{
  const f=await fixture();
  try{
    await f.open();
    const selector=f.q('.slb-library-order-select');
    assert.ok(selector);
    assert.deepEqual([...selector.options].map(x=>x.value),['normal','reverse','title-asc','title-desc']);
    assert.deepEqual([...selector.options].map(x=>x.textContent),['Order↑','Order↓','제목↑','제목↓']);
    assert.equal(f.stats().writes,0);
  }finally{f.dom.window.close()}
  const last=css.slice(css.lastIndexOf('/* ambasa.68'));
  assert.match(last,/select\.slb-library-order-select\s*\{[^}]*width: 62px !important;/s);
  assert.match(last,/slb-library-index-layout:not\(\.is-index-open\)[\s\S]*grid-template-columns: minmax\(0, 1fr\) !important/);
  assert.match(last,/> #slb-library-world-contents\s*\{[^}]*display: none !important;/s);
  assert.doesNotMatch(last,/MutationObserver|ResizeObserver|setInterval|setTimeout|font-family/);
  assert.doesNotMatch(js,/setInterval\(/);
  assert.equal(JSON.parse(readFileSync(join(root,'manifest.json'),'utf8')).version,'1.4.85-ambasa.76');
});
