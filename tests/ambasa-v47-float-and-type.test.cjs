const {test}=require('node:test');
const assert=require('node:assert/strict');
const {JSDOM}=require('jsdom');
const {join}=require('node:path');
const {readFileSync}=require('node:fs');
const {pathToFileURL}=require('node:url');
const root=join(__dirname,'..');
const css=readFileSync(join(root,'library-shelf.css'),'utf8');
const uri=pathToFileURL(join(root,'library-shelf.js')).href;
const tick=()=>new Promise(resolve=>setImmediate(resolve));
async function fixture({theme='antique',vw=900,vh=690,vl=12,vt=24}={}){
 const {createStandaloneLibrary}=await import(uri);
 const dom=new JSDOM('<!doctype html><html><body></body></html>',{pretendToBeVisual:true});
 const w=dom.window;w.confirm=()=>true;
 Object.defineProperty(w,'innerWidth',{configurable:true,value:960});
 Object.defineProperty(w,'innerHeight',{configurable:true,value:850});
 const vv=new w.EventTarget();
 Object.assign(vv,{width:vw,height:vh,offsetLeft:vl,offsetTop:vt});
 Object.defineProperty(w,'visualViewport',{configurable:true,value:vv});
 const names=['General title named World','General title named People','My world guide','Remembered notes','Contacts volume',
  ...Array.from({length:15},(_,i)=>'Book '+i)];
 const types=Object.assign(Object.create(null),{
  'General title named World':'general','General title named People':'general',
  'My world guide':'world','Remembered notes':'memory','Contacts volume':'people'});
 const covers={'Contacts volume':'/user/images/custom-person.png'};
 const stats={loads:0,ai:0,saves:0};
 const lib=createStandaloneLibrary({
  document:w.document,listBooks:()=>names,linkedBooks:()=>new Set(names),
  loadBook:async()=>{stats.loads++;return {entries:{1:{uid:1,content:'Original lore',comment:'Title',displayIndex:0}}}},
  loadTranslations:async()=>{},translationFor:()=>({text:'translation'}),
  saveContent:async()=>{stats.saves++},saveTranslation:async()=>{stats.saves++},
  translateOne:async()=>{stats.ai++},openAdvanced:()=>{},
  getType:name=>types[name]||'general',getTypeMap:()=>types,setType:(name,type)=>{types[name]=type},
  getTags:()=>[],getTagMap:()=>({}),setTags:async()=>{},
  getBookCover:name=>covers[name]||'',getBookCoverMap:()=>covers,
  getTheme:()=>theme,getCleanVariant:()=> 'mac',getLinkedOnly:()=>true,notify:()=>{}
 });
 lib.open();
 const q=s=>w.document.querySelector(s),all=s=>[...w.document.querySelectorAll(s)];
 const shell=q('.slb-library-shell'),grip=q('.slb-library-resize-grip');
 const rect=()=>({left:parseFloat(shell.style.left),top:parseFloat(shell.style.top),
  width:parseFloat(shell.style.width),height:parseFloat(shell.style.height)});
 shell.getBoundingClientRect=()=>rect();
 const mouse=(type,x,y,id=123)=>{
   const e=new w.MouseEvent(type,{bubbles:true,button:0,clientX:x,clientY:y});
   Object.defineProperty(e,'pointerId',{value:id});return e;
 };
 return {dom,w,vv,lib,types,covers,stats,q,all,shell,grip,rect,
  start:(x,y)=>grip.dispatchEvent(mouse('pointerdown',x,y)),
  move:(x,y)=>w.dispatchEvent(mouse('pointermove',x,y)),
  stop:(x,y)=>w.dispatchEvent(mouse('pointerup',x,y))};
}
const cx=r=>r.left+r.width/2,cy=r=>r.top+r.height/2;
const near=(a,b)=>assert.ok(Math.abs(a-b)<1,'positions differ: '+a+' vs '+b);

test('Phrase Desk-style viewport-fixed pixel placement is active on open',async()=>{
 const f=await fixture();
 try{
  const r=f.rect();assert.equal(f.shell.style.position,'fixed');
  assert.equal(f.shell.style.transform,'none');
  assert.equal(f.shell.style.getPropertyPriority('left'),'important');
  assert.equal(f.shell.style.getPropertyPriority('position'),'important');
  near(cx(r),12+900/2);near(cy(r),24+690/2);
  assert.ok(r.left>=28&&r.top>=40);
 }finally{f.dom.window.close()}
});

test('first pointerdown does not move window and symmetric shrink preserves center',async()=>{
 const f=await fixture();
 try{
  const r=f.rect();f.start(760,620);
  assert.deepEqual(f.rect(),r,'pointerdown must not jump');
  f.move(685,550);
  const next=f.rect();
  assert.equal(next.width,r.width-150);assert.equal(next.height,r.height-140);
  near(cx(next),cx(r));near(cy(next),cy(r));
  f.stop(685,550);
  const stable=f.rect();f.move(300,100);
  assert.deepEqual(f.rect(),stable,'pointer listeners removed');
 }finally{f.dom.window.close()}
});

test('drag overshoot is clamped inside visible viewport with positive margins',async()=>{
 const f=await fixture({vw:380,vh:590,vl:3,vt:7});
 try{
  f.start(360,480);f.move(9999,9000);
  let r=f.rect();
  assert.ok(r.width<=360&&r.height<=570);
  assert.ok(r.left>=13&&r.top>=17);
  assert.ok(r.left+r.width<=373.1&&r.top+r.height<=587.1);
  f.move(-9999,-9999);r=f.rect();
  assert.ok(r.width>=280&&r.height>=310);
  f.stop(-9999,-9999);
 }finally{f.dom.window.close()}
});

test('visualViewport resize and offset recenter the modal and never trigger lore work',async()=>{
 const f=await fixture({vw:900,vh:700});
 try{
  f.start(790,620);f.move(650,500);f.stop(650,500);
  const before=f.rect();
  Object.assign(f.vv,{width:480,height:490,offsetLeft:36,offsetTop:58});
  f.vv.dispatchEvent(new f.w.Event('resize'));
  const r=f.rect();assert.notEqual(r.left,before.left);
  assert.ok(r.width<=460&&r.height<=470);
  near(cx(r),276);near(cy(r),303);
  assert.deepEqual(f.stats,{loads:0,ai:0,saves:0});
 }finally{f.dom.window.close()}
});

test('keyboard grip resizing uses fixed pixels without moving the modal center',async()=>{
 const f=await fixture();
 try{
  const r=f.rect();
  f.grip.dispatchEvent(new f.w.KeyboardEvent('keydown',{key:'ArrowLeft',bubbles:true}));
  const changed=f.rect();assert.equal(changed.width,r.width-20);
  near(cx(changed),cx(r));near(cy(changed),cy(r));
  assert.equal(f.stats.loads,0);
 }finally{f.dom.window.close()}
});

test('spines use stored type templates even when names resemble another category',async()=>{
 const f=await fixture();
 try{
  for(const [name,type,binding] of [
   ['General title named World','general','linen'],
   ['General title named People','general','linen'],
   ['My world guide','world','leather'],
   ['Remembered notes','memory','cloth'],
   ['Contacts volume','people','cloth']
  ]){
   const e=f.q('.slb-library-book-spine[data-book="'+name+'"]');
   assert.ok(e);assert.equal(e.dataset.bookType,type);
   assert.ok(e.classList.contains('slb-library-spine-type-'+type));
   assert.ok(e.classList.contains('slb-library-binding-'+binding));
   assert.ok([...e.classList].some(v=>/^slb-library-type-variant-[012]$/.test(v)));
   assert.ok(![...e.classList].some(v=>v.startsWith('slb-library-spine-tone-')));
  }
  assert.equal(f.stats.loads,0);
 }finally{f.dom.window.close()}
});

test('covers use four type silhouettes and uploaded image stays above decorative art',async()=>{
 const f=await fixture({theme:'clean'});
 try{
  for(const [name,type] of [
   ['General title named World','general'],
   ['My world guide','world'],['Remembered notes','memory'],['Contacts volume','people']
  ]){
   const el=f.q('.slb-library-cover-open[data-book="'+name+'"] .slb-library-cover-art');
   assert.ok(el);assert.ok(el.classList.contains('slb-library-cover-type-'+type));
   assert.ok([...el.classList].some(v=>/^slb-library-type-variant-[012]$/.test(v)));
   assert.ok(![...el.classList].some(v=>v.startsWith('slb-library-cover-design-')));
   assert.match(css,new RegExp('slb-library-cover-art\\.slb-library-cover-type-'+type+'\\s*\\{'));
  }
  const img=f.q('.slb-library-cover-open[data-book="Contacts volume"] img');
  assert.equal(img.getAttribute('src'),'/user/images/custom-person.png');
  assert.equal(img.loading,'lazy');
  assert.deepEqual(f.stats,{loads:0,ai:0,saves:0});
 }finally{f.dom.window.close()}
});

test('changing the saved type replaces the template without changing original text or AI',async()=>{
 const f=await fixture({theme:'clean'});
 try{
  const name='General title named World';
  f.q('[data-action="select-book"][data-book="'+name+'"]').click();
  await tick();
  const select=f.q('#slb-library-book-type');select.value='world';
  select.dispatchEvent(new f.w.Event('change',{bubbles:true}));
  f.q('[data-action="books"]').click();
  const el=f.q('.slb-library-cover-open[data-book="'+name+'"] .slb-library-cover-art');
  assert.ok(el.classList.contains('slb-library-cover-type-world'));
  assert.equal(f.types[name],'world');
  assert.equal(f.stats.ai,0);assert.equal(f.stats.saves,0);
 }finally{f.dom.window.close()}
});

test('very short visual viewport overrides previous CSS min-height and stays fully visible',async()=>{
 const f=await fixture({vw:380,vh:630});
 try{
  Object.assign(f.vv,{width:280,height:235,offsetLeft:6,offsetTop:92});
  f.vv.dispatchEvent(new f.w.Event('resize'));
  const r=f.rect();
  assert.ok(r.width<=260&&r.height<=215);
  assert.equal(f.shell.style.getPropertyPriority('min-height'),'important');
  assert.equal(f.shell.style.minHeight,'215px');
  assert.ok(r.left>=16&&r.top>=102);
  assert.ok(r.left+r.width<=276.1&&r.top+r.height<=327.1);
 }finally{f.dom.window.close()}
});
