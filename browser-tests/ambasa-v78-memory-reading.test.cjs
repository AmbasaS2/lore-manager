const { test } = require('node:test');
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const root = join(__dirname, '..');
const css = readFileSync(join(root, 'library-shelf.css'), 'utf8');
const library = readFileSync(join(root, 'library-shelf.js'), 'utf8')
    .replace(/^export /gm, '') + '\nwindow.createStandaloneLibrary = createStandaloneLibrary;';

test('Chromium: 3 memory views, all 4 themes, 3 widths; append and exact UID navigation', async () => {
    const browser = await chromium.launch({headless:true, ...(process.env.CHROME_PATH ? {executablePath:process.env.CHROME_PATH,args:['--no-sandbox']} : {})});
    let checked=0;
    try {
        for(const width of [320,390,900]){
            const page=await browser.newPage({viewport:{width,height:820}});
            try{
                await page.setContent('<!doctype html><html><body></body></html>');
                await page.addStyleTag({content:css});
                await page.addScriptTag({content:library});
                for(const theme of ['mac','blackberry','ebook','antique']){
                    await page.evaluate(async ({theme,width})=>{
                        window.libraryFixture?.close();
                        const entries=Object.fromEntries(Array.from({length:240},(_,i)=>[i,{
                            uid:i,order:i,comment:'Record '+i,content:'**Timeline**: 1975-09-01\n\n**Scene**\n'+('Full source text with long content. '.repeat(24))+'\n\n**Result**\nOutcome '+i
                        }]));
                        window.mode='timeline';
                        window.libraryFixture=window.createStandaloneLibrary({
                            document,listBooks:()=>['Book'],linkedBooks:()=>new Set(['Book']),
                            loadBook:async()=>({entries}),loadTranslations:async()=>{},translationFor:()=>({}),
                            saveContent:async()=>{},saveTranslation:async()=>{},translateOne:async()=>{},openAdvanced:()=>{},
                            getType:()=> 'memory',getTypeMap:()=>({Book:'memory'}),getTags:()=>[],getTagMap:()=>({}),setTags:async()=>{},
                            getTheme:()=>theme,getListPageSize:()=>5,getListOrder:()=> 'normal',
                            getMemoryView:()=>window.mode,setMemoryView:async v=>{window.mode=v;},
                            getLinkedOnly:()=>true,getWindowSize:()=>({width:Math.min(width-16,820),height:760}),notify:()=>{}
                        });
                        window.libraryFixture.open();document.querySelector('[data-action="select-book"]').click();
                    },{theme,width});
                    await page.waitForSelector('.slb-library-memory-record');
                    for(const mode of ['timeline','continuous','page']){
                        if(mode!=='timeline'){
                            await page.evaluate(mode=>document.querySelector('[data-action="memory-view"][data-mode="'+mode+'"]').click(),mode);
                            await page.waitForSelector('[data-action="memory-view"][data-mode="'+mode+'"][aria-pressed="true"]');
                        }
                        const result=await page.evaluate(({mode})=>{
                            const q=s=>document.querySelector(s);
                            const body=q('.slb-library-body');
                            const frame=q('.slb-library-reader-frame');
                            const buttons=[...document.querySelectorAll('.slb-library-memory-views button')];
                            const start=body.scrollWidth-body.clientWidth;
                            const frameOverflow=frame.scrollWidth-frame.clientWidth;
                            let count, preserved=true;
                            if(mode!=='page'){
                                const first=q('.slb-library-memory-record');
                                q('[data-action="memory-more"]').click();
                                preserved=first===q('.slb-library-memory-record');
                                count=document.querySelectorAll('.slb-library-memory-record').length;
                            }else count=document.querySelectorAll('.slb-library-diary-page').length;
                            return {start,frameOverflow,count,preserved,
                                buttonOverlap:buttons.some((b,i)=>buttons.slice(i+1).some(c=>{
                                    const a=b.getBoundingClientRect(),d=c.getBoundingClientRect();
                                    return a.left<d.right-1&&a.right>d.left+1&&a.top<d.bottom-1&&a.bottom>d.top+1;
                                }))};
                        },{mode});
                        assert.ok(result.start<=1,JSON.stringify({theme,width,mode,result}));
                        assert.ok(result.frameOverflow<=1,JSON.stringify({theme,width,mode,result}));
                        assert.equal(result.buttonOverlap,false,JSON.stringify({theme,width,mode,result}));
                        assert.ok(result.preserved);
                        assert.equal(result.count,mode==='page'?(theme==='antique'&&width===900?2:1):10);
                        checked++;
                    }
                }
            }finally{await page.close();}
        }
    }finally{await browser.close();}
    assert.equal(checked,36);
});
