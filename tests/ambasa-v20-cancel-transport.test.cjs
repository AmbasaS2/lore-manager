const {test}=require('node:test');
const assert=require('node:assert/strict');
const {readFileSync}=require('node:fs');
const {join}=require('node:path');
const {JSDOM}=require('./fixture-ui-language.cjs');
const vm=require('node:vm');
const src=readFileSync(join(__dirname,'../index.js'),'utf8');
function getFunction(name){
    const found=src.match(new RegExp('^(?:async )?function '+name+'\\([^]*?^}','m'));
    assert.ok(found,'missing '+name);
    return found[0];
}
const microtasks=()=>new Promise(resolve=>setImmediate(resolve));

test('bulk button changes to 번역 중… and cancel click immediately restores original + single toast',async()=>{
    const dom=new JSDOM('<div id="slb-ai-tools"></div>',{runScripts:'outside-only',pretendToBeVisual:true});
    const w=dom.window;
    const stubs=[
        "const VERSION='test';",
        "const state={bulkTranslation:null};let toasts=[],opened=0;",
        "const toastr={info:(message,title)=>toasts.push([message,title])};",
        "const getSettings=()=>({translateMissingOnOpen:false,autoTranslateSource:false,autoSyncToSource:false});",
        "const createElement=(tag,cls,txt)=>{const e=document.createElement(tag);if(cls)e.className=cls;if(txt)e.textContent=txt;return e;};",
        "const saveSettingsDebounced=()=>{};",
        "const syncAutoControls=()=>{};",
        "const showLorebookTranslationPicker=()=>{opened++};",
    ].join('\n');
    w.eval(stubs+'\n'+getFunction('updateBulkTranslationStatus')+'\n'
      +getFunction('slothToastTitle')+'\n'+getFunction('cancelBulkTranslation')+'\n'+getFunction('createQuickTranslationOptions')
      +'\nwindow.api={state,updateBulkTranslationStatus,make:createQuickTranslationOptions,getToasts:()=>toasts,getOpened:()=>opened};');
    try{
        const controls=w.api.make();
        w.document.querySelector('#slb-ai-tools').append(controls);
        const button=controls.querySelector('#slb-translate-book');
        const text=button.querySelector('span');
        const status=controls.querySelector('#slb-bulk-status');
        assert.equal(text.textContent,'로어북 일괄 번역');
        const active={book:'Remus',cancelled:false,abortController:new w.AbortController()};
        w.api.state.bulkTranslation=active;
        w.api.updateBulkTranslationStatus('Remus · 2/5 (완료 2)');
        assert.equal(text.textContent,'번역 중…');
        assert.equal(button.disabled,false);
        button.click();
        assert.equal(active.cancelled,true);
        assert.equal(active.abortController.signal.aborted,true);
        assert.equal(w.api.state.bulkTranslation,null,'immediately unlocked');
        assert.equal(text.textContent,'로어북 일괄 번역');
        assert.equal(button.disabled,false);
        assert.equal(status.textContent,'','canceled progress removed');
        assert.equal(w.api.getToasts().length,1);
        assert.equal(w.api.getToasts()[0][0],'번역이 취소되었습니다.');
        assert.equal(w.api.getToasts()[0][1],'🦥 로어북 매니저');
        button.click();
        assert.equal(w.api.getOpened(),1,'ready button opens picker rather than requesting cancellation');
    }finally{w.close();}
});

test('profile transport receives AbortSignal and its pending request rejects on cancel',async()=>{
    let passedSignal,requestCount=0;
    const ac=new AbortController();
    const ctx=vm.createContext({
        getSettings:()=>({profileId:'profile',aiOutputTokens:4096}),
        ConnectionManagerRequestService:{sendRequest:(_id,_prompt,_max,options)=>{
            requestCount++;
            passedSignal=options.signal;
            return new Promise((_resolve,reject)=>{
                options.signal.addEventListener('abort',()=>reject(options.signal.reason),{once:true});
            });
        }},
        getResponseText:value=>value?.text,
        getAIRequestErrorMessage:error=>error.message,
        console,
    });
    vm.runInContext(getFunction('throwIfTranslationCancelled')+'\n'+getFunction('requestWithProfile')
        +'\nglobalThis.call=requestWithProfile;',ctx);
    const task=ctx.call('translate safely',null,ac.signal);
    await microtasks();
    assert.equal(requestCount,1);
    assert.equal(passedSignal,ac.signal);
    ac.abort();
    await assert.rejects(task,error=>error.name==='AbortError');
    await assert.rejects(ctx.call('late request',null,ac.signal),error=>error.name==='AbortError');
    assert.equal(requestCount,1,'aborted jobs never schedule more requests');
});

test('Google fetch transport receives AbortSignal and does not retry after cancellation',async()=>{
    let requests=0,sentSignal;
    const ac=new AbortController();
    const ctx=vm.createContext({
        GOOGLE_TRANSLATE_RETRY_DELAYS:[10,20],
        getRequestHeaders:()=>({'Content-Type':'application/json'}),
        maskLineBreaks:text=>({masked:text,lineBreaks:[]}),
        unmaskLineBreaks:text=>text,
        fetch:(_url,options)=>{
            requests++;
            sentSignal=options.signal;
            return new Promise((_resolve,reject)=>{
                options.signal.addEventListener('abort',()=>reject(options.signal.reason),{once:true});
            });
        },
        setTimeout,clearTimeout,
    });
    vm.runInContext(getFunction('throwIfTranslationCancelled')+'\n'
        +getFunction('awaitCancelableTranslation')+'\n'
        +getFunction('waitForGoogleTranslation')+'\n'
        +getFunction('requestGoogleTranslationChunk')+
        '\nglobalThis.request=requestGoogleTranslationChunk;',ctx);
    const pending=ctx.request('Some lengthy text','ko',ac.signal);
    await microtasks();
    assert.equal(requests,1);
    assert.equal(sentSignal,ac.signal);
    ac.abort();
    await assert.rejects(pending,error=>error.name==='AbortError');
    assert.equal(requests,1,'no retries after user canceled');
});

test('a provider ignoring abort does not prevent immediate worker completion',async()=>{
    const ctx=vm.createContext({});
    vm.runInContext(getFunction('throwIfTranslationCancelled')+'\n'
      +getFunction('awaitCancelableTranslation')+'\nglobalThis.race=awaitCancelableTranslation;',ctx);
    const ac=new AbortController();
    let finish;
    const task=ctx.race(()=>new Promise(resolve=>{finish=resolve;}),ac.signal);
    await microtasks();
    assert.equal(typeof finish,'function');
    ac.abort();
    await assert.rejects(task,error=>error.name==='AbortError');
    finish('late billed response');
    await microtasks();
    assert.equal(ac.signal.aborted,true);
});
