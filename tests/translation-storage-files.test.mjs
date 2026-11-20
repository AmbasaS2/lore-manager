import test from 'node:test';
import assert from 'node:assert/strict';
import {Buffer} from 'node:buffer';
import {createLoreTranslationStorage,translationBookPath,TRANSLATION_INDEX_PATH,
    TRANSLATION_INDEX_FORMAT,TRANSLATION_STORE_FORMAT,TRANSLATION_RECOVERY_FORMAT}
    from '../translation-storage.js';

function host(settings = {}) {
    const files=new Map(),calls=[];
    let failNextUpload=0;
    globalThis.FileReader=class FileReader {
        readAsDataURL(blob) {
            blob.arrayBuffer().then(bytes=>{
                this.result='data:application/json;base64,'+Buffer.from(bytes).toString('base64');
                this.onload?.();
            },error=>{this.error=error;this.onerror?.()});
        }
    };
    globalThis.fetch=async (url,options={})=>{
        const body=options.body?JSON.parse(options.body):{};
        calls.push({url,method:options.method||'GET',name:body.name||'',path:body.path||''});
        const response=(payload,status=200)=>({ok:status>=200&&status<300,status,json:async()=>structuredClone(payload)});
        if(url==='/api/files/verify')return response(Object.fromEntries(body.urls.map(path=>[path,files.has(path)])));
        if(url==='/api/files/upload'){
            if(failNextUpload>0){failNextUpload--;return response({error:'offline'},500);}
            const path='/user/files/'+body.name;
            files.set(path,JSON.parse(Buffer.from(body.data,'base64').toString('utf8')));
            return response({path});
        }
        if(url==='/api/files/delete'){
            files.delete(body.path);return response({});
        }
        if(url.startsWith('/user/files/')){
            if(!files.has(url))return response({error:'not found'},404);
            return response(files.get(url));
        }
        throw Error('Unexpected API '+url);
    };
    const loaded=[],errors=[];
    const store=createLoreTranslationStorage({
        getRequestHeaders:()=>({'Content-Type':'application/json'}),
        onBookLoaded:book=>loaded.push(book),
        onError:error=>errors.push(error),
        delay:500,
    });
    store.attach(settings);
    return {store,settings,files,calls,loaded,errors,
        failUpload:()=>failNextUpload++,
        serialized:()=>JSON.stringify(settings)};
}
const fakeRecord=(book,uid,body='한국어 번역')=>({
    book,uid:String(uid),language:'Korean',sourceLanguage:'English',
    text:body,sourceHash:'hash-'+uid,syncedText:'이전 번역',syncedSourceHash:'oldhash',
    syncedSourceText:'Original text '.repeat(30000),
    fields:{comment:{source:'Original Title',text:'번역 제목'},
        key:{source:'alpha, beta',text:'알파, 베타'}},
});
const pair={sourceLanguage:'English',translationLanguage:'Korean'};

test('new translations and EN/KO pairs are saved to book JSON, never settings.json',async()=>{
    const a=host({autoBackupEnabled:false,profileId:'profile1',translationPrompt:'Use nicknames.'});
    await a.store.start();
    await a.store.ensureBook('리무스 기억');
    const record=fakeRecord('리무스 기억',1,'번역'.repeat(50000));
    a.store.memory.records['리무스 기억␟1']=record;
    a.store.memory.pairs['리무스 기억␟1']=pair;
    a.store.scheduleSave('리무스 기억');
    assert.equal(a.store.hasPending(),true);
    await a.store.flushBook('리무스 기억');
    const saved=a.files.get(translationBookPath('리무스 기억'));
    assert.equal(saved.format,TRANSLATION_STORE_FORMAT);
    assert.equal(saved.book,'리무스 기억');
    assert.equal(saved.revision,1);
    assert.deepEqual(saved.records['리무스 기억␟1'],record,'large full record and baseline preserved');
    assert.deepEqual(saved.pairs['리무스 기억␟1'],pair);
    assert.equal(a.store.hasPending(),false);
    assert.deepEqual(Object.keys(a.settings).sort(),['autoBackupEnabled','profileId','translationPrompt']);
    assert.equal(a.serialized().includes('한국어 번역'),false);
    assert.equal(a.serialized().includes('Original text'),false);
    assert.equal(a.serialized().includes('entryLanguagePairs'),false);
    assert.equal(a.serialized().includes('translations'),false);
    const index=a.files.get(TRANSLATION_INDEX_PATH);
    assert.equal(index.format,TRANSLATION_INDEX_FORMAT);
    assert.deepEqual(index.books,['리무스 기억']);
    assert.equal(index.hints['1␟hash-1␟Korean'],'리무스 기억');
});

test('second session loads ONLY the requested book; unrelated books stay untouched',async()=>{
    const a=host({autoBackupEnabled:false});
    await a.store.start();
    await a.store.ensureBook('A');await a.store.ensureBook('B');
    a.store.memory.records['A␟1']=fakeRecord('A',1,'번역 A');
    a.store.memory.records['B␟2']=fakeRecord('B',2,'번역 B');
    a.store.memory.pairs['B␟3']={sourceLanguage:'Korean',translationLanguage:'English'};
    a.store.scheduleSave('A');a.store.scheduleSave('B');
    await Promise.all([a.store.flushBook('A'),a.store.flushBook('B')]);
    const persistedFiles=structuredClone(Object.fromEntries(a.files));
    const b=host({autoBackupEnabled:false});
    Object.entries(persistedFiles).forEach(([path,data])=>b.files.set(path,data));
    await b.store.start();
    assert.equal(b.store.isBookReady('A'),false);
    assert.equal(b.store.isBookReady('B'),false);
    assert.equal(b.calls.some(call=>call.url===translationBookPath('B')),false);
    await b.store.ensureBook('A');
    assert.equal(b.store.isBookReady('A'),true);
    assert.equal(b.store.isBookReady('B'),false);
    assert.equal(b.store.memory.records['A␟1'].text,'번역 A');
    assert.equal(b.store.memory.records['B␟2'],undefined);
    const beforeB=JSON.stringify(b.files.get(translationBookPath('B')));
    b.store.memory.records['A␟1']={...b.store.memory.records['A␟1'],text:'A changed'};
    b.store.scheduleSave('A');
    await b.store.flushBook('A');
    assert.equal(JSON.stringify(b.files.get(translationBookPath('B'))),beforeB);
    assert.equal(b.files.get(translationBookPath('A')).revision,2);
    assert.equal(b.store.hintFor('2','hash-2','Korean'),'B');
    await b.store.ensureBook('B');
    assert.equal(b.store.memory.records['B␟2'].text,'번역 B');
    assert.equal(b.store.memory.pairs['B␟3'].translationLanguage,'English');
});

test('nonempty legacy settings data is NEVER auto-migrated or silently deleted',async()=>{
    const old={translations:{'A␟1':fakeRecord('A',1)},entryLanguagePairs:{'A␟1':pair},autoBackupEnabled:false};
    const original=structuredClone(old);
    const a=host(old);
    await assert.rejects(a.store.start(),/이전하지 않습니다/);
    assert.deepEqual(old,original);
    assert.equal(a.files.size,0);
    assert.equal(a.store.isBookReady('A'),false);
    assert.equal(a.errors.length,1);
});

test('empty old settings keys are harmless and stay OUT of new settings JSON',async()=>{
    const old={translations:{},entryLanguagePairs:{},autoBackupEnabled:false};
    const a=host(old);
    await a.store.start();
    assert.ok(!Object.hasOwn(JSON.parse(a.serialized()),'translations'));
    assert.ok(!Object.hasOwn(JSON.parse(a.serialized()),'entryLanguagePairs'));
    assert.equal(a.store.isBookReady('A'),false);
    assert.equal(a.files.size,0);
});

test('corrupt server JSON never gets replaced on load or write',async()=>{
    const a=host({});
    await a.store.start();
    a.files.set(translationBookPath('A'),{book:'A',revision:1,records:{},invalid:true});
    await assert.rejects(a.store.ensureBook('A'),/형식 또는 로어북 이름/);
    assert.equal(a.store.isBookReady('A'),false);
    assert.throws(()=>a.store.scheduleSave('A'),/읽지 못했습니다/);
    assert.equal(a.files.get(translationBookPath('A')).invalid,true);
});

test('stale revision fails closed when another device has changed the server file',async()=>{
    const a=host({});
    await a.store.start();
    await a.store.ensureBook('A');
    a.store.memory.records['A␟1']=fakeRecord('A',1,'first');
    a.store.scheduleSave('A');
    await a.store.flushBook('A');
    const file=translationBookPath('A');
    assert.equal(a.files.get(file).revision,1);
    const newer=structuredClone(a.files.get(file));
    newer.revision=2;
    newer.records['A␟1'].text='B updated';
    a.files.set(file,newer); // another client wrote revision 2
    a.store.memory.records['A␟1']={...a.store.memory.records['A␟1'],text:'A stale'};
    a.store.scheduleSave('A');
    await assert.rejects(a.store.flushBook('A'),/다른 기기/);
    assert.equal(a.files.get(file).records['A␟1'].text,'B updated');
    assert.equal(a.store.hasPending(),true);
});

test('failed save holds unsaved data in memory and does not fall back to settings.json',async()=>{
    const a=host({profileId:'p'});
    await a.store.start();
    await a.store.ensureBook('A');
    a.store.memory.records['A␟1']=fakeRecord('A',1);
    a.store.scheduleSave('A');
    a.failUpload();
    await assert.rejects(a.store.flushBook('A'),/API 요청 실패/);
    assert.equal(a.store.hasPending(),true);
    assert.equal(a.store.memory.records['A␟1'].text,'한국어 번역');
    assert.equal(a.serialized(),'{"profileId":"p"}');
    await a.store.flushBook('A');
    assert.equal(a.store.hasPending(),false);
    assert.equal(a.files.get(translationBookPath('A')).revision,1);
});

test('clearing translations writes a VERIFIED recovery file and preserves language direction',async()=>{
    const a=host({});
    await a.store.start(); await a.store.ensureBook('A');
    a.store.memory.records['A␟1']=fakeRecord('A',1);
    a.store.memory.pairs['A␟1']=pair;
    a.store.scheduleSave('A'); await a.store.flushBook('A');
    a.failUpload();
    await assert.rejects(a.store.clearAll({onlyTranslations:true}),/API 요청 실패/);
    assert.ok(a.files.get(translationBookPath('A')).records['A␟1']);
    await a.store.clearAll({onlyTranslations:true});
    assert.deepEqual(a.files.get(translationBookPath('A')).records,{});
    assert.deepEqual(a.files.get(translationBookPath('A')).pairs['A␟1'],pair);
    const recovery=[...a.files.values()].find(v=>v?.format===TRANSLATION_RECOVERY_FORMAT);
    assert.ok(recovery?.files?.A?.records?.['A␟1']);
});

test('complete reset removes only extension files AFTER verified recovery and keeps recovery',async()=>{
    const a=host({});
    await a.store.start();await a.store.ensureBook('A');
    a.store.memory.records['A␟1']=fakeRecord('A',1);
    a.store.scheduleSave('A');await a.store.flushBook('A');
    await a.store.clearAll();
    assert.equal(a.files.has(translationBookPath('A')),false);
    assert.equal(a.files.has(TRANSLATION_INDEX_PATH),false);
    assert.ok([...a.files.values()].some(v=>v?.format===TRANSLATION_RECOVERY_FORMAT));
});

test('two simultaneous book writes do not lose either index entry',async()=>{
    const a=host({});
    await a.store.start();
    await a.store.ensureBook('A');await a.store.ensureBook('B');
    a.store.memory.records['A␟1']=fakeRecord('A',1,'Hello');
    a.store.memory.records['B␟2']=fakeRecord('B',2,'World');
    a.store.scheduleSave('A');a.store.scheduleSave('B');
    await Promise.all([a.store.flushBook('A'),a.store.flushBook('B')]);
    assert.deepEqual(a.files.get(TRANSLATION_INDEX_PATH).books,['A','B']);
    assert.equal(a.store.hasPending(),false);
});

test('editing an existing translation never rewrites the global index unless source hashes change',async()=>{
    const a=host({});
    await a.store.start();
    await a.store.ensureBook('A');
    a.store.memory.records['A␟1']=fakeRecord('A',1,'initial');
    a.store.scheduleSave('A');
    await a.store.flushBook('A');
    const countIndex=()=>a.calls.filter(call=>call.url==='/api/files/upload'
        &&call.name==='lore-manager-translation-index-v1.json').length;
    const countBook=()=>a.calls.filter(call=>call.url==='/api/files/upload'
        &&call.name===translationBookPath('A').split('/').at(-1)).length;
    const baseline=countIndex();
    assert.equal(baseline,1);
    assert.equal(countBook(),1);
    // Simulate multiple keystrokes: just one write after the debounce.
    for(let i=0;i<30;i++){
        a.store.memory.records['A␟1']={...a.store.memory.records['A␟1'],text:'edited'+i};
        a.store.scheduleSave('A');
    }
    await a.store.flushBook('A');
    assert.equal(countBook(),2,'30 changes coalesce into one book file write');
    assert.equal(countIndex(),baseline,'unchanged content hash does not rewrite the entire shared index');
    assert.equal(a.files.get(translationBookPath('A')).records['A␟1'].text,'edited29');
    a.store.memory.records['A␟1']={...a.store.memory.records['A␟1'],sourceHash:'new-hash'};
    a.store.scheduleSave('A');
    await a.store.flushBook('A');
    assert.equal(countIndex(),baseline+1,'the lookup index changes when its hash actually changes');
    assert.equal(a.store.hintFor('1','new-hash','Korean'),'A');
    assert.equal(a.store.hintFor('1','hash-1','Korean'),'');
});
