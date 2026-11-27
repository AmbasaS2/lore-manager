const { test } = require('node:test');
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');

const root = join(__dirname, '..');
const css = readFileSync(join(root, 'library-shelf.css'), 'utf8');
const library = require('./library-fixture-script.cjs').libraryFixtureScript();

test('real Chromium: v72 design renders all 16 themes/modes at 360/460/820px without horizontal overflow', async () => {
    const browser = await chromium.launch({ headless:true });
    const themes = ['mac','blackberry','ebook','antique'];
    const kinds = ['general','memory','world','people'];
    let checked=0;
    try {
        for (const width of [360,460,820]) {
            const page=await browser.newPage({viewport:{width,height:900}});
            try {
                await page.setContent('<!doctype html><html><body></body></html>');
                await page.addStyleTag({ content: css });
                await page.addScriptTag({ content: library });
                for (const theme of themes) for (const type of kinds) {
                    await page.evaluate(async({theme,type})=>{
                        window.libraryFixture?.close();
                        const books=['Test World'];
                        const entries=Object.fromEntries(Array.from({length:240},(_,i)=>[i,{
                            uid:i,displayIndex:i,comment:'Lore entry '+i,
                            content:'The stored original lore '+i+' is read-only until editing.', key:['lore-'+i,'book'],
                        }]));
                        window.libraryFixture=window.createStandaloneLibrary({
                            document,listBooks:()=>books,linkedBooks:()=>new Set(books),
                            loadBook:async()=>({entries}),loadTranslations:async()=>{},
                            translationFor:(_book,entry)=>({
                                text:'저장된 번역 '+entry.uid,stale:false,
                                pair:{sourceLanguage:'English',translationLanguage:'Korean'},
                            }),
                            saveContent:async()=>{},saveTranslation:async()=>{},
                            translateOne:async()=>{},openAdvanced:()=>{},
                            getTheme:()=>theme,getType:()=>type,
                            getTypeMap:()=>({'Test World':type}),
                            getTags:()=>[],getTagMap:()=>({}),setTags:async()=>{},
                            getListPageSize:()=>5,getListOrder:()=> 'normal',
                            getLinkedOnly:()=>true,
                            getWindowSize:narrow=>narrow?null:{width:800,height:760},
                            notify:()=>{},
                        });
                        window.libraryFixture.open();
                        document.querySelector('[data-action="select-book"]').click();
                    },{theme,type});
                    await page.waitForSelector('.slb-library-reader-frame',{timeout:5000});
                    const headerButtons = await page.locator('.slb-library-top .slb-library-header-actions > button').evaluateAll(buttons => buttons.map(button => {
                        const style = getComputedStyle(button);
                        const color = document.createElement('canvas').getContext('2d');
                        color.fillStyle = style.borderTopColor;
                        color.fillRect(0,0,1,1);
                        const alpha = color.getImageData(0,0,1,1).data[3];
                        return { action: button.dataset.action, alpha, color: style.color, opacity: style.opacity,
                            width: style.width, height: style.height, border: style.borderTopWidth };
                    }));
                    assert.deepEqual(headerButtons.map(button => button.action), ['minimize','settings','close']);
                    for (const button of headerButtons) {
                        assert.ok(Math.abs(button.alpha - 61) <= 1, JSON.stringify(button));
                        assert.equal(button.opacity, '1');
                        assert.equal(button.width, '27px');
                        assert.equal(button.height, '27px');
                        assert.equal(button.border, '1px');
                        assert.equal(button.color, headerButtons[0].color);
                    }
                    if (type==='people' || (type==='general' && ['ebook','antique'].includes(theme))) {
                        await page.locator('[data-action="entry"]').first().click();
                    }
                    await page.waitForSelector('.slb-library-detail',{timeout:5000});
                    const result=await page.evaluate(({theme,type})=>{
                        const q=selector=>document.querySelector(selector);
                        const frame=q('.slb-library-reader-frame');
                        const body=q('.slb-library-body');
                        const shell=q('.slb-library-shell');
                        const doc=q('.slb-library-detail');
                        const toc=q(type==='memory'?'#slb-library-memory-contents':type==='world'?'#slb-library-world-contents':'#slb-library-people-contents');
                        const styles=getComputedStyle(frame);
                        const reader=getComputedStyle(q('.slb-library-reader-inner'));
                        const chips=doc?.querySelectorAll('.slb-library-keyword-chip').length;
                        const pageCount=type==='memory'?q('#slb-library-memory-contents').querySelectorAll('.slb-library-index-item').length:0;
                        const frameBox=frame.getBoundingClientRect();
                        const shellBox=shell.getBoundingClientRect();
                        const paperBox=doc.getBoundingClientRect();
                        const overflow=body.scrollWidth-body.clientWidth;
                        let preserved=null;
                        if(type!=='general'){
                            const toggle=q('[data-action="'+type+'-toc-toggle"]');
                            const node=doc;
                            toggle.click();
                            preserved=q('.slb-library-detail')===node;
                            toggle.click();
                        }
                        return {theme:frame.dataset.libraryMode,type:frame.dataset.bookType,
                            frameBg:styles.backgroundColor,readerBg:reader.backgroundColor,
                            overflow,chips,pageCount,preserved,
                            bounds:frameBox.left>=shellBox.left-3&&frameBox.right<=shellBox.right+3
                                &&paperBox.right<=shellBox.right+4,
                            liveEntry:doc.dataset.uid,
                        };
                    },{theme,type});
                    const msg=width+'px '+theme+'/'+type+' '+JSON.stringify(result);
                    assert.equal(result.theme,theme,msg);
                    assert.equal(result.type,type,msg);
                    assert.ok(result.overflow<=4,msg);
                    assert.ok(result.bounds,msg);
                    assert.equal(result.chips,2,msg);
                    if (type==='memory') assert.equal(result.pageCount,5,msg);
                    if (type!=='general') assert.equal(result.preserved,true,msg);
                    if (theme==='blackberry') assert.equal(result.frameBg,'rgb(23, 38, 47)',msg);
                    if (theme==='ebook') assert.equal(result.frameBg,'rgb(248, 248, 244)',msg);
                    if (theme==='antique') assert.equal(result.frameBg,'rgb(36, 56, 66)',msg);
                    checked++;
                }
            } finally { await page.close(); }
        }
    } finally { await browser.close(); }
    assert.equal(checked,48);
});
