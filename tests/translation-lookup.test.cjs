const { test } = require('node:test');
const assert = require('node:assert/strict');
const { join } = require('node:path');
const { pathToFileURL } = require('node:url');
const modulePromise = import(pathToFileURL(join(__dirname, '../translation-lookup.js')).href);

test('fallback lookup matches the first record like the original scan', async () => {
    const { createTranslationFallbackLookup } = await modulePromise;
    const lookup = createTranslationFallbackLookup();
    const records = {
        old: {book:'First',uid:2,sourceHash:'abc_123',language:'ko',text:'old'},
        next: {book:'Second',uid:'2',sourceHash:'abc_123',language:'ko',text:'new'},
        other: {book:'First',uid:'2',sourceHash:'abc_123',language:'en',text:'English'},
        bad: {book:'First',uid:'2',sourceHash:4,language:'ko',text:'invalid'},
    };
    assert.equal(lookup.find(records,'2','abc_123','ko'),records.old);
    assert.equal(lookup.find(records,2,'abc_123','en'),records.other);
    assert.equal(lookup.find(records,2,'xyz','ko'),null);
    assert.equal(lookup.find(records,3,'abc_123','ko'),null);
});

test('cache invalidation makes updates and deletions visible, replacement objects need no migration', async () => {
    const { createTranslationFallbackLookup } = await modulePromise;
    const lookup = createTranslationFallbackLookup();
    const old = {r:{uid:'1',sourceHash:'hash',language:'ko',text:'first'}};
    assert.equal(lookup.find(old,'1','hash','ko'),old.r);
    old.r={uid:'1',sourceHash:'hash',language:'ko',text:'edited'};
    lookup.invalidate(old);
    assert.equal(lookup.find(old,'1','hash','ko'),old.r);
    delete old.r;
    lookup.invalidate(old);
    assert.equal(lookup.find(old,'1','hash','ko'),null);
    const replacement={r:{uid:'1',sourceHash:'hash',language:'ko',text:'new storage'}};
    assert.equal(lookup.find(replacement,'1','hash','ko'),replacement.r);
});

test('large translation data requires a single full scan per unchanged store', async () => {
    const { createTranslationFallbackLookup } = await modulePromise;
    const lookup=createTranslationFallbackLookup();
    let enumerate=0;
    const store={};
    const records={};
    for(let i=0;i<500;i++){
        store[i]={book:'B',uid:String(i),sourceHash:'hash_'+i,language:'ko',text:'번역'.repeat(500)};
    }
    const proxy=new Proxy(store,{
        ownKeys(target){enumerate++;return Reflect.ownKeys(target);},
        getOwnPropertyDescriptor:Reflect.getOwnPropertyDescriptor,
        get:Reflect.get,
    });
    for(let i=0;i<30;i++){
        assert.equal(lookup.find(proxy,500+i,'missing','ko'),null);
    }
    assert.equal(enumerate,1,'index each stored record only once between writes');
    lookup.invalidate(proxy);
    lookup.find(proxy,'500','missing','ko');
    assert.equal(enumerate,2,'new revision rebuilds the index exactly once');
    assert.ok(Buffer.byteLength(JSON.stringify(store),'utf8') > 500_000,'represents a large persisted settings payload');
});

test('legacy fallback still copies a matching record to the current book once', async () => {
    const { createTranslationFallbackLookup } = await modulePromise;
    const { readFileSync } = require('node:fs');
    const vm = require('node:vm');
    const source = readFileSync(join(__dirname,'../index.js'),'utf8');
    const match = source.match(/^function findTranslationRecord\([^]*?^}/m);
    assert.ok(match,'production fallback function');
    let saves=0;
    const settings = { translations:{
        'old':{book:'Old',uid:'8',sourceHash:'source-hash',language:'ko',text:'keep me'}
    }};
    const context = vm.createContext({
        getSettings:()=>settings,
        translationKey:(book,uid)=>book+'\u241f'+uid,
        hashText:source=>source,
        translationFallbackLookup:createTranslationFallbackLookup(),
        saveSettingsDebounced:()=>{saves++},
    });
    vm.runInContext(match[0],context);
    const found = context.findTranslationRecord('New',8,'source-hash','ko');
    assert.equal(found.text,'keep me');
    assert.equal(found.book,'New');
    assert.equal(settings.translations['New\u241f8'],found);
    assert.equal(settings.translations.old.book,'Old','original record untouched');
    assert.equal(saves,1);
    assert.equal(context.findTranslationRecord('New',8,'source-hash','ko'),found);
    assert.equal(saves,1,'reopening the current book must not write again');
});
