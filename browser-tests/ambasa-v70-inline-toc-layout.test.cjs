const {test}=require('node:test');
const assert=require('node:assert/strict');
const {chromium}=require('playwright');
const {readFileSync}=require('node:fs');
const {join}=require('node:path');
const root=join(__dirname,'..');
const css=readFileSync(join(root,'library-shelf.css'),'utf8');
const script=readFileSync(join(root,'library-shelf.js'),'utf8')
    .replace(/^export /gm,'')+'\nwindow.createStandaloneLibrary=createStandaloneLibrary;';
test('Chromium 4 themes x 3 modes x 3 viewports: one inline TOC toggle survives collapse',async()=>{
 const browser=await chromium.launch({headless:true});let count=0;
 try{
 for(const width of [390,720,1280]){
  const page=await browser.newPage({viewport:{width,height:940}});
  try{
   await page.setContent('<!doctype html><html><body></body></html>');
   await page.addStyleTag({content:css});
   await page.addScriptTag({content:script});
   for(const theme of ['mac','blackberry','ebook','antique']){
    for(const type of ['memory','world','people']){
     await page.evaluate(async({theme,type})=>{
      window.fixture?.close();
      const entries=Object.fromEntries(Array.from({length:23},(_,i)=>[i,{uid:i,displayIndex:i,comment:'Title '+i,content:'Body '+i,key:['k'] }]));
      window.fixture=window.createStandaloneLibrary({
       document,listBooks:()=>['Book'],linkedBooks:()=>new Set(['Book']),
       loadBook:async()=>({entries}),loadTranslations:async()=>{},translationFor:()=>({text:''}),
       saveContent:async()=>{},saveTranslation:async()=>{},translateOne:async()=>{},
       openAdvanced:()=>{},getTheme:()=>theme,getType:()=>type,
       getTags:()=>[],getTagMap:()=>({}),setTags:async()=>{},
       getListPageSize:()=>5,getListOrder:()=> 'normal',getLinkedOnly:()=>true,
       getWindowSize:narrow=>narrow?null:{width:720,height:740},notify:()=>{},
      });
      window.fixture.open();
      document.querySelector('[data-action="select-book"]').click();
     },{theme,type});
     if(type==='people'){
      await page.waitForSelector('[data-action="entry"]',{timeout:5000});
      await page.locator('[data-action="entry"]').first().click();
      await page.waitForSelector('.slb-library-people-detail-layout',{timeout:5000});
     } else await page.waitForSelector('.slb-library-detail',{timeout:5000});
     const outcome=await page.evaluate(({type})=>{
      const q=sel=>document.querySelector(sel);
      const root=q(type==='memory'?'#slb-library-memory-toc':type==='world'?'#slb-library-world-contents':'#slb-library-people-toc');
      const toggle=root?.querySelector('[data-action="'+type+'-toc-toggle"]');
      const heading=root?.querySelector('.slb-library-toc-heading');
      const bookLine=q('.slb-library-reader-bookline');
      const detail=q('.slb-library-detail');
      if(!root||!heading||!toggle||!detail)return {missing:true};
      const beforeHeading=heading.getBoundingClientRect();
      const beforeText=q('.slb-library-toc-label')?.textContent;
      toggle.click();
      const afterHeading=heading.getBoundingClientRect();
      const collapsed=toggle.getAttribute('aria-expanded')==='false';
      const sameArticle=q('.slb-library-detail')===detail;
      const contents=type==='memory'?q('#slb-library-memory-contents')
       :type==='people'?q('#slb-library-people-contents')
       :q('#slb-library-world-contents .slb-library-index-item');
      const hidden=type==='world'?getComputedStyle(contents).display==='none':contents.hidden;
      const activeHeader=afterHeading.width>70&&afterHeading.height>=20
       &&getComputedStyle(heading).display!=='none';
      const shell=q('.slb-library-shell').getBoundingClientRect();
      const paper=detail.getBoundingClientRect();
      const inBounds=paper.right<=shell.right+6&&paper.left>=shell.left-6;
      return {missing:false,collapsed,hidden,sameArticle,activeHeader,inBounds,
        count:document.querySelectorAll('.slb-library-toc-heading').length,
        noBookToggle:!bookLine.querySelector('[data-action$="-toc-toggle"]'),
        caption:beforeText,initialHeight:beforeHeading.height};
     },{type});
     const msg=theme+'/'+type+'/'+width+' '+JSON.stringify(outcome);
     assert.equal(outcome.missing,false,msg);
     assert.ok(outcome.collapsed&&outcome.hidden&&outcome.sameArticle&&outcome.activeHeader&&outcome.inBounds,msg);
     assert.equal(outcome.count,1,msg);
     assert.equal(outcome.noBookToggle,true,msg);
     assert.equal(outcome.caption,'CONTENTS · 목차',msg);
     count++;
    }
   }
  }finally{await page.close()}
 }
 }finally{await browser.close()}
 assert.equal(count,36);
});
