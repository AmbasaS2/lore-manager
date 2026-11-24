const {test}=require('node:test');
const assert=require('node:assert/strict');
const {chromium}=require('playwright');
const {readFileSync}=require('node:fs');
const {join}=require('node:path');
const root=join(__dirname,'..');
const css=readFileSync(join(root,'library-shelf.css'),'utf8');
const js=readFileSync(join(root,'library-shelf.js'),'utf8')
    .replace(/^export /gm,'')+'\nwindow.createStandaloneLibrary = createStandaloneLibrary;';

test('Chromium: all 4 world themes keep the article and use 62px sort in narrow/wide readers',async()=>{
    const browser=await chromium.launch({headless:true});
    let checked=0;
    try{
        for(const width of [390,1280]){
            const page=await browser.newPage({viewport:{width,height:950}});
            try{
                await page.setContent('<!doctype html><html><body></body></html>');
                await page.addStyleTag({content:css});
                await page.addScriptTag({content:js});
                for(const theme of ['mac','blackberry','ebook','antique']){
                    await page.evaluate(async({theme})=>{
                        window.fixture?.close();
                        const entries=Object.fromEntries(Array.from({length:25},(_,i)=>[i,{
                            uid:i,order:i,displayIndex:24-i,comment:'Entry '+i,
                            content:'Content '+i,key:['tag'],
                        }]));
                        window.fixture=window.createStandaloneLibrary({
                            document,listBooks:()=>['Book'],
                            linkedBooks:()=>new Set(['Book']),
                            loadBook:async()=>({entries}),
                            loadTranslations:async()=>{},translationFor:()=>({text:''}),
                            saveContent:async()=>{},saveTranslation:async()=>{},
                            translateOne:async()=>{},openAdvanced:()=>{},
                            getTheme:()=>theme,getType:()=> 'world',
                            getTags:()=>[],getTagMap:()=>({}),setTags:async()=>{},
                            getListPageSize:()=>5,getListOrder:()=> 'normal',
                            getLinkedOnly:()=>true,notify:()=>{},
                            getWindowSize:narrow=>narrow?null:{width:800,height:780},
                        });
                        window.fixture.open();
                        document.querySelector('[data-action="select-book"]').click();
                    },{theme});
                    await page.waitForSelector('.slb-library-detail-world',{timeout:4000});
                    const result=await page.evaluate(()=>{
                        const q=x=>document.querySelector(x);
                        const layout=q('.slb-library-index-layout');
                        const toc=q('#slb-library-world-contents');
                        const article=q('.slb-library-detail-world');
                        const paper=q('.slb-library-index-paper');
                        const toggle=q('[data-action="world-toc-toggle"]');
                        const sort=q('.slb-library-order-select');
                        // Sort lives inside the TOC: measure while it is visible,
                        // BEFORE collapsing the TOC intentionally hides it.
                        const sortWidth=sort.getBoundingClientRect().width;
                        const firstUid=q('.slb-library-index-item').dataset.uid;
                        const labels=[...sort.options].map(opt=>opt.textContent);
                        const sortVisible=getComputedStyle(sort).display!=='none';
                        const expanded=paper.getBoundingClientRect().width;
                        toggle.click();
                        return {
                            classClosed:!layout.classList.contains('is-index-open'),
                            hidden:getComputedStyle(toc.querySelector('.slb-library-index-item')).display==='none' && getComputedStyle(toc.querySelector('.slb-library-toc-heading')).display!=='none',
                            sameArticle:q('.slb-library-detail-world')===article,
                            fullPaper:paper.getBoundingClientRect().width>=expanded-1,
                            sortWidth, sortVisible, firstUid, labels,
                            expanded,
                            collapsed:paper.getBoundingClientRect().width,
                        };
                    });
                    const msg=theme+' width '+width+' '+JSON.stringify(result);
                    assert.ok(result.classClosed&&result.hidden&&result.sameArticle&&result.fullPaper,msg);
                    assert.ok(result.sortWidth>=61&&result.sortWidth<=63&&result.sortVisible,msg);
                    assert.equal(result.firstUid,'0',msg);
                    assert.deepEqual(result.labels,['Order↑','Order↓','제목↑','제목↓'],msg);
                    checked++;
                }
            }finally{await page.close()}
        }
    }finally{await browser.close()}
    assert.equal(checked,8);
});
