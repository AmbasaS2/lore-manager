const {test}=require('node:test');
const assert=require('node:assert/strict');
const {JSDOM}=require('jsdom');
const {readFileSync}=require('node:fs');
const {join}=require('node:path');
const {pathToFileURL}=require('node:url');

const root=join(__dirname,'..');
const libraryUrl=pathToFileURL(join(root,'library-shelf.js')).href;
const css=readFileSync(join(root,'library-shelf.css'),'utf8');
const index=readFileSync(join(root,'index.js'),'utf8');
const tick=()=>new Promise(resolve=>setImmediate(resolve));

async function fixture({count=4,theme='antique',variant='mac',coverPaths={}}={}) {
  const {createStandaloneLibrary}=await import(libraryUrl);
  const dom=new JSDOM('<!doctype html><html><body></body></html>',{
    runScripts:'outside-only',pretendToBeVisual:true,
  });
  const w=dom.window;
  w.confirm=()=>true;
  const books=Array.from({length:count},(_,i)=>'Book '+String(i+1));
  const settings={theme,variant};
  const covers=Object.assign(Object.create(null),coverPaths);
  const stats={loads:0,translationReads:0,uploads:[],removes:[],saves:0,coverMapReads:0,
    typeMapReads:0,tagMapReads:0,ai:0,entryImages:0,sourceSaves:0,translationSaves:0};
  let failTheme=false,failUpload=false,failRemove=false;
  const library=createStandaloneLibrary({
    document:w.document,
    listBooks:()=>books,linkedBooks:()=>new Set(books),
    loadBook:async()=>{stats.loads++;return {entries:{1:{uid:1,content:'Unchanged original',comment:'Note',displayIndex:0}}};},
    loadTranslations:async()=>{stats.translationReads++;},
    translationFor:()=>({text:'번역 기록'}),
    saveContent:async()=>{stats.sourceSaves++;throw Error('Unexpected source save');},
    saveTranslation:async()=>{stats.translationSaves++;throw Error('Unexpected translation save');},
    translateOne:async()=>{stats.ai++;throw Error('Unexpected AI');},
    openAdvanced:()=>{},
    getType:()=> 'general',
    getTypeMap:()=>{stats.typeMapReads++;return Object.create(null);},
    setType:()=>{},
    getTags:()=>[],getTagMap:()=>{stats.tagMapReads++;return Object.create(null);},
    setTags:async()=>{},
    getEntryImage:()=>{stats.entryImages++;return '/user/images/unchanged-entry.png';},
    getBookCover:book=>covers[book]||'',
    getBookCoverMap:()=>{stats.coverMapReads++;return covers;},
    uploadBookCover:async(book,file)=>{
      stats.uploads.push({book,name:file.name,type:file.type,size:file.size});
      if(failUpload)throw Error('업로드 실패');
      covers[book]='/user/images/cover-uploaded.png';
      return covers[book];
    },
    removeBookCover:async book=>{
      stats.removes.push(book);
      if(failRemove)throw Error('저장 실패');
      delete covers[book];
    },
    getTheme:()=>settings.theme,
    setTheme:async themeValue=>{
      if(failTheme)throw Error('설정 저장 실패');
      settings.theme=themeValue;stats.saves++;
    },
    getCleanVariant:()=>settings.variant,
    setCleanVariant:async name=>{settings.variant=name;stats.saves++;},
    notify:()=>{},
  });
  library.open();
  const click=selector=>{
    const el=w.document.querySelector(selector);
    assert.ok(el,'Missing '+selector);
    el.click();
  };
  const change=(selector,value)=>{
    const el=w.document.querySelector(selector);
    assert.ok(el,'Missing '+selector);
    el.value=value;el.dispatchEvent(new w.Event('change',{bubbles:true}));
  };
  return {library,dom,w,books,covers,settings,stats,click,change,tick,
    setFailTheme:value=>{failTheme=value;},
    setFailUpload:value=>{failUpload=value;},
    setFailRemove:value=>{failRemove=value;}};
}

test('classic remains the original book-spine shelf and never reads cover metadata',async()=>{
 const f=await fixture();
 try{
   const d=f.w.document;
   assert.equal(d.querySelectorAll('.slb-library-book-spine').length,4);
   assert.equal(d.querySelectorAll('.slb-library-cover-art').length,0);
   assert.equal(f.stats.coverMapReads,0);
   assert.equal(d.querySelector('#slb-library-clean-variant'),null);
   assert.equal(d.querySelector('#slb-library-theme-mode').options.length,4);
   assert.equal(d.querySelector('#slb-library-overlay').dataset.theme,'antique');
   assert.deepEqual([f.stats.loads,f.stats.translationReads,f.stats.ai,f.stats.entryImages],[0,0,0,0]);
 }finally{f.dom.window.close();}
});

test('ebook keeps cover shelf; Mac and Blackberry render different independent shelves',async()=>{
 const f=await fixture({count:31});
 try{
   const d=f.w.document;
   f.change('#slb-library-theme-mode','ebook');await tick();
   assert.equal(f.settings.theme,'ebook');
   assert.equal(d.querySelector('#slb-library-overlay').dataset.libraryTheme,'ebook');
   assert.equal(d.querySelectorAll('.slb-library-cover-item').length,18);
   assert.equal(d.querySelectorAll('.slb-library-book-spine').length,0);
   assert.equal(d.querySelectorAll('[data-action="select-book"]').length,18);
   assert.equal(d.querySelectorAll('[data-action="cover-config"]').length,18);
   assert.equal(d.querySelector('.slb-library-books-scroll').getAttribute('aria-label'),'전자책 표지 목록');
   assert.equal(f.stats.loads,0);
   assert.ok(f.stats.coverMapReads>=1);
   assert.equal(d.querySelector('#slb-library-clean-variant'),null);
   f.click('[data-action="shelf-more"]');
   assert.equal(d.querySelectorAll('.slb-library-cover-item').length,30);
   f.click('[data-action="shelf-more"]');
   assert.equal(d.querySelectorAll('.slb-library-cover-item').length,31);
   f.change('#slb-library-theme-mode','mac');await tick();
   assert.ok(d.querySelector('.slb-library-finder'));
   assert.equal(d.querySelectorAll('.slb-library-cover-item').length,0);
   f.change('#slb-library-theme-mode','blackberry');await tick();
   assert.ok(d.querySelector('.slb-library-app-device'));
   assert.ok(d.querySelector('.slb-library-app-device .slb-library-device-keyboard'));
   assert.equal(d.querySelectorAll('.slb-library-cover-item').length,0);
   assert.equal(f.stats.loads,0);
 }finally{f.dom.window.close();}
});

test('per-book cover upload uses explicit save and does not read/alter lorebook or entry images',async()=>{
 const f=await fixture({theme:'clean'});
 try{
   const d=f.w.document;
   f.click('[data-action="cover-config"][data-book="Book 1"]');
   assert.ok(d.querySelector('.slb-library-cover-dialog'));
   const save=d.querySelector('[data-action="cover-save"]');
   assert.equal(save.disabled,true);
   assert.equal(f.stats.uploads.length,0);
   const input=d.querySelector('#slb-library-cover-file');
   const file=new f.w.File([new Uint8Array([1,2,3])],'cover.png',{type:'image/png'});
   Object.defineProperty(input,'files',{configurable:true,value:[file]});
   input.dispatchEvent(new f.w.Event('change',{bubbles:true}));
   assert.equal(save.disabled,false);
   assert.equal(f.stats.uploads.length,0);
   f.click('[data-action="cover-save"]');await tick();
   assert.equal(f.stats.uploads.length,1);
   assert.equal(f.stats.uploads[0].book,'Book 1');
   assert.equal(f.covers['Book 1'],'/user/images/cover-uploaded.png');
   assert.equal(d.querySelector('.slb-library-cover-dialog'),null);
   const first=d.querySelector('[data-action="select-book"][data-book="Book 1"] .slb-library-cover-image');
   assert.equal(first.getAttribute('src'),'/user/images/cover-uploaded.png');
   assert.equal(first.loading,'lazy');
   assert.equal(d.querySelectorAll('.slb-library-cover-image').length,1);
   assert.deepEqual([f.stats.loads,f.stats.translationReads,f.stats.ai,f.stats.sourceSaves,f.stats.translationSaves,f.stats.entryImages],[0,0,0,0,0,0]);
 }finally{f.dom.window.close();}
});

test('image unlink returns to generated cover, without touching other books',async()=>{
 const f=await fixture({theme:'clean',coverPaths:{'Book 1':'/user/images/existing.png','Book 2':'/user/images/other.png'}});
 try{
   const d=f.w.document;
   f.click('[data-action="cover-config"][data-book="Book 1"]');
   assert.equal(d.querySelector('[data-action="cover-reset"]').disabled,false);
   f.click('[data-action="cover-reset"]');await tick();
   assert.equal(f.covers['Book 1'],undefined);
   assert.equal(f.covers['Book 2'],'/user/images/other.png');
   assert.equal(d.querySelector('[data-action="select-book"][data-book="Book 1"] .slb-library-cover-image'),null);
   assert.ok(d.querySelector('[data-action="select-book"][data-book="Book 1"] .slb-library-cover-title'));
   assert.deepEqual(f.stats.removes,['Book 1']);
   assert.equal(f.stats.loads,0);
 }finally{f.dom.window.close();}
});

test('invalid file, upload failure, and cancel leave existing settings unchanged',async()=>{
 const f=await fixture({theme:'clean',coverPaths:{'Book 1':'/user/images/original.png'}});
 try{
   const d=f.w.document;
   f.click('[data-action="cover-config"][data-book="Book 1"]');
   const input=d.querySelector('#slb-library-cover-file');
   const invalid=new f.w.File([new Uint8Array([1])],'evil.svg',{type:'image/svg+xml'});
   Object.defineProperty(input,'files',{configurable:true,value:[invalid]});
   input.dispatchEvent(new f.w.Event('change',{bubbles:true}));
   assert.equal(d.querySelector('[data-action="cover-save"]').disabled,true);
   assert.equal(f.stats.uploads.length,0);
   const good=new f.w.File([new Uint8Array([1])],'good.webp',{type:'image/webp'});
   Object.defineProperty(input,'files',{configurable:true,value:[good]});
   input.dispatchEvent(new f.w.Event('change',{bubbles:true}));
   f.w.confirm=()=>false;
   f.click('[data-action="cover-cancel"]');
   assert.ok(d.querySelector('.slb-library-cover-dialog'));
   f.setFailUpload(true);
   f.click('[data-action="cover-save"]');await tick();
   assert.ok(d.querySelector('.slb-library-cover-dialog'));
   assert.equal(f.covers['Book 1'],'/user/images/original.png');
   assert.match(d.querySelector('.slb-library-cover-file-status').textContent,/실패/);
   f.w.confirm=()=>true;
   f.click('[data-action="cover-cancel"]');
   assert.equal(d.querySelector('.slb-library-cover-dialog'),null);
 }finally{f.dom.window.close();}
});

test('settings save failure restores saved appearance, and invalid external cover URLs are not rendered',async()=>{
 const f=await fixture({coverPaths:{'Book 1':'https://attacker.example/cover.png', 'Book 2':'javascript:evil'}});
 try{
   const d=f.w.document;
   f.setFailTheme(true);
   f.change('#slb-library-theme-mode','clean');await tick();
   assert.equal(f.settings.theme,'antique');
   assert.equal(d.querySelector('#slb-library-theme-mode').value,'antique');
   f.setFailTheme(false);
   f.change('#slb-library-theme-mode','ebook');await tick();
   assert.equal(d.querySelectorAll('.slb-library-cover-image').length,0);
   assert.equal(f.stats.loads,0);
 }finally{f.dom.window.close();}
});

test('clean reader structure and upload contract remain segregated',()=>{
 assert.match(index,/libraryBookCovers: \{\}/);
 assert.match(index,/uploadLibraryImageFile\(file, \{ cover: true \}\)/);
 assert.match(index,/saveLibraryBookCoverPath/);
 assert.match(index,/getTheme: \(\) => \['antique', 'mac', 'blackberry', 'ebook'\]/);
 assert.match(css,/\.slb-library-cover-grid\s*\{/);
 assert.match(css,/data-theme="clean"/);
 assert.match(css,/data-variant="blackberry"/);
 assert.match(css,/@media \(max-width: 500px\)/);
 assert.doesNotMatch(css,/font-family\s*:/);
 assert.doesNotMatch(css,/@import/);
});

function coverStorageFixture({responsePath='user/images/custom-cover.png',failSave=false}={}) {
 const a=index.indexOf('function libraryImagePath(');
 const b=index.indexOf('function initStandaloneLibrary()',a);
 assert.ok(a>0&&b>a);
 const source=index.slice(a,b);
 const settings={
   libraryBookCovers:Object.create(null),
   libraryEntryImages:{'Book 1':{'12':'/user/images/original-entry.jpg'}},
   translations:{},libraryBookTags:{},
 };
 const calls={fetch:[],saved:0};
 class Reader{readAsDataURL(file){this.result='data:'+file.type+';base64,YWJj';this.onload?.()}}
 const api=new Function('FileReader','fetch','getRequestHeaders','getSettings','saveSettings',
   source+'return {libraryBookCoverPath,saveLibraryBookCoverPath,uploadLibraryBookCover};')(
   Reader,async(url,args)=>{calls.fetch.push({url,args});return {ok:true,json:async()=>({path:responsePath})};},
   ()=>({'Content-Type':'application/json','X-CSRF-Token':'test'}),
   ()=>settings,async()=>{calls.saved++;if(failSave)throw Error('settings failed')}
 );
 return {settings,calls,...api};
}

test('book-cover upload reuses ST image endpoint and persists only a per-book cover path',async()=>{
 const f=coverStorageFixture();
 const image={name:'cover.webp',type:'image/webp',size:250};
 const result=await f.uploadLibraryBookCover('Book 1',image);
 assert.equal(result,'/user/images/custom-cover.png');
 assert.equal(f.libraryBookCoverPath('Book 1'),result);
 assert.equal(f.calls.fetch.length,1);
 const request=f.calls.fetch[0];
 assert.equal(request.url,'/api/images/upload');
 const body=JSON.parse(request.args.body);
 assert.equal(body.image,'YWJj');
 assert.equal(body.format,'webp');
 assert.match(body.filename,/^slb-cover-\d+-[0-9a-z]+$/);
 assert.equal(f.calls.saved,1);
 assert.equal(f.settings.libraryEntryImages['Book 1']['12'],'/user/images/original-entry.jpg');
 assert.deepEqual(f.settings.translations,{});
 assert.equal(JSON.stringify(f.settings).includes('YWJj'),false);
 await f.saveLibraryBookCoverPath('Book 1','');
 assert.equal(f.libraryBookCoverPath('Book 1'),'');
 assert.equal(f.calls.fetch.length,1,'reset only unlinks metadata, never issues image DELETE');
});

test('cover path rolls back after failed settings save; malicious keys cannot pollute prototypes',async()=>{
 const f=coverStorageFixture({failSave:true});
 f.settings.libraryBookCovers['Book 1']='/user/images/old-cover.jpg';
 await assert.rejects(
   f.uploadLibraryBookCover('Book 1',{name:'replacement.png',type:'image/png',size:10}),
   /settings failed/
 );
 assert.equal(f.libraryBookCoverPath('Book 1'),'/user/images/old-cover.jpg');
 assert.equal(f.settings.libraryEntryImages['Book 1']['12'],'/user/images/original-entry.jpg');
 const good=coverStorageFixture();
 await good.saveLibraryBookCoverPath('__proto__','/user/images/special.png');
 assert.equal(good.libraryBookCoverPath('__proto__'),'/user/images/special.png');
 assert.equal(Object.getPrototypeOf(good.settings.libraryBookCovers),null);
 assert.equal(Object.prototype.polluted,undefined);
});

test('invalid covers reject before HTTP upload, and nonlocal image paths are refused',async()=>{
 for(const bad of [
   {name:'untrusted.svg',type:'image/svg+xml',size:100},
   {name:'animation.gif',type:'image/gif',size:100},
   {name:'huge.png',type:'image/png',size:6*1024*1024},
 ]) {
   const f=coverStorageFixture();
   await assert.rejects(f.uploadLibraryBookCover('Book 1',bad),/5MB 이하/);
   assert.equal(f.calls.fetch.length,0);
 }
 for(const path of ['https://example.com/a.png','/user/images/../private.png','/user/images/a.png?x=1']) {
   const f=coverStorageFixture({responsePath:path});
   await assert.rejects(f.uploadLibraryBookCover('Book 1',{name:'a.png',type:'image/png',size:10}),/저장 경로/);
   assert.equal(f.calls.saved,0);
 }
});
