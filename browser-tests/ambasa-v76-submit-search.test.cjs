const {test}=require('node:test');
const assert=require('node:assert/strict');
const {chromium}=require('playwright');
const {readFileSync}=require('node:fs');
const {join}=require('node:path');
const css=readFileSync(join(__dirname,'..','library-shelf.css'),'utf8');
const js=readFileSync(join(__dirname,'..','library-shelf.js'),'utf8').replace(/^export /gm,'')+'\nwindow.createStandaloneLibrary=createStandaloneLibrary;';
test('Chromium: one search field with embedded magnifier, stable shelf, both-language submit on 4 themes × 3 widths',async()=>{
    const browser=await chromium.launch({headless:true});let checked=0;
    try{
        for(const width of [360,460,820]){
            const page=await browser.newPage({viewport:{width,height:900},hasTouch:width===360,isMobile:width===360});
            try{
                await page.setContent('<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body></body></html>');
                await page.addStyleTag({content:css});await page.addScriptTag({content:js});
                for(const theme of ['mac','blackberry','ebook','antique']){
                    const msg=width+' '+theme;
                    await page.evaluate(theme=>{
                        window.lib?.close();window.reads=0;window.translationReads=0;
                        const books=['Origin','Second'];
                        window.lib=window.createStandaloneLibrary({
                            document,listBooks:()=>books,linkedBooks:()=>new Set(books),
                            loadBook:async book=>{window.reads++;return{entries:{0:{uid:0,order:0,comment:'Original '+book,content:'Source '+book,key:['raw keyword']}}};},
                            loadTranslations:async()=>{window.translationReads++;},
                            translationFor:()=>({text:''}),
                            searchTranslationFor:book=>book==='Second'?{text:'번역본문',fields:{comment:{text:'번역제목'},key:{text:'검색전용 번역키'}}}:null,
                            getType:()=> 'world',getTheme:()=>theme,getRecent:()=>({book:'Origin',uid:'0'}),
                            getLinkedOnly:()=>true,getWindowSize:narrow=>narrow?null:{width:460,height:640},notify:()=>{},
                        });window.lib.open();
                    },theme);
                    const toggle=page.locator('[data-action="shelf-search-toggle"]');
                    const field=page.locator('#slb-library-shelf-search');
                    const action=page.locator('[data-action="submit-shelf-search"]');
                    const shelf=page.locator('.slb-library-bookshelf');
                    const toolbar=page.locator('.slb-library-shelf-toolbar');
                    assert.equal(await action.isVisible(),false,msg);
                    assert.equal(await page.locator('.slb-library-shelf-shortcuts').count(),0,msg);
                    const before=await shelf.boundingBox(),barBefore=await toolbar.boundingBox();
                    await toggle.click();
                    const assertField=async(input,submit)=>{
                        assert.equal(await submit.isVisible(),true,msg);
                        const parent=await input.locator('..').boundingBox(),a=await input.boundingBox(),b=await submit.boundingBox(),shell=await page.locator('.slb-library-shell').boundingBox();
                        assert.ok(b.x>=a.x+a.width-1&&b.y>=parent.y-1&&b.y+b.height<=parent.y+parent.height+1,msg+' '+JSON.stringify({parent,a,b}));
                        assert.ok(b.x+b.width<=parent.x+parent.width+1&&parent.x>=shell.x&&parent.x+parent.width<=shell.x+shell.width+1,msg);
                        assert.ok(b.width>=27&&b.height>=27,msg);
                    };
                    await assertField(field,action);
                    const after=await shelf.boundingBox(),barAfter=await toolbar.boundingBox();
                    assert.ok(Math.abs(after.y-before.y)<1&&Math.abs(barAfter.height-barBefore.height)<1,msg);
                    await field.fill('검색전용 번역키');
                    assert.deepEqual(await page.evaluate(()=>[window.reads,window.translationReads]),[0,0],msg);
                    assert.equal(await page.locator('.slb-library-global-panel').count(),0,msg);
                    if(width===360)await action.tap();else await field.press('Enter');
                    const result=page.locator('[data-action="global-result"]');
                    await result.waitFor({state:'visible'});
                    assert.equal(await result.count(),1,msg);
                    assert.equal(await result.getAttribute('data-book'),'Second',msg);
                    assert.equal(await shelf.isVisible(),false,msg);
                    assert.equal(await toolbar.isVisible(),true,msg);
                    assert.ok(await page.evaluate(()=>{const b=document.querySelector('.slb-library-body');return b.scrollWidth-b.clientWidth<=4;}),msg);
                    await result.click();
                    await page.waitForSelector('.slb-library-reader-frame');
                    const reader=page.locator('#slb-library-search'),readerAction=page.locator('[data-action="submit-reader-search"]');
                    await page.locator('[data-action="reader-search-toggle"]').click();
                    await assertField(reader,readerAction);
                    const frame=await page.locator('.slb-library-reader-frame').elementHandle();
                    await reader.fill('번역본문');
                    assert.equal(await frame.evaluate(node=>node.isConnected),true,msg);
                    if(width===360)await readerAction.tap();else await reader.press('Enter');
                    assert.equal(await page.locator('.slb-library-index-item').count(),1,msg);
                    assert.equal(await page.locator('.slb-library-index-item').getAttribute('data-uid'),'0',msg);
                    assert.equal(await frame.evaluate(node=>node.isConnected),false,msg);
                    assert.ok(await page.evaluate(()=>{const b=document.querySelector('.slb-library-body');return b.scrollWidth-b.clientWidth<=4;}),msg);
                    checked++;
                }
            }finally{await page.close();}
        }
    }finally{await browser.close();}
    assert.equal(checked,12);
});
