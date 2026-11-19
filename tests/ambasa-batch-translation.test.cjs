const {test}=require('node:test');
const assert=require('node:assert/strict');
const {join}=require('node:path');
const {pathToFileURL}=require('node:url');
const modulePromise=import(pathToFileURL(join(__dirname,'../lore-translation-batch.js')).href);

const sources={
    content:'## Remus\nRemus rarely smokes. {{char}} and Catherine arrived on 1981/10/18…',
    comment:'057 - 1981/10/18 | The Seine Cruise',
    key:'Remus, Catherine',
    keysecondary:'Moony',
};
const translation={
    content:'## 리무스\n리무스는 담배를 거의 피우지 않는다. {{char}}와 캐서린은 1981/10/18에 도착했다…',
    comment:'057 - 1981/10/18 | 센강 유람선',
    key:'리무스, 캐서린',
    keysecondary:'무니',
};

test('all four fields from one entry use one AI request and keep named values separate',async()=>{
 const {translateLoreFieldsBatch,buildLoreFieldBatchPrompt}=await modulePromise;
 const fields=['content','comment','key','keysecondary'];
 const prompt=buildLoreFieldBatchPrompt({sources,fields,targetLanguage:'ko',instructions:'Use established names.'});
 assert.match(prompt,/ONE lorebook entry/);
 assert.match(prompt,/Use the full body as shared context/);
 assert.match(prompt,/JSON object/);
 assert.match(prompt,/Use established names/);
 const requests=[],fallbacks=[];
 const result=await translateLoreFieldsBatch({
    sources,fields,request:async p=>{requests.push(p);return JSON.stringify(translation)},
    fallback:async f=>{fallbacks.push(f);return 'unused'}
 });
 assert.equal(requests.length,1);
 assert.equal(fallbacks.length,0);
 assert.deepEqual(result,translation);
 assert.deepEqual(sources.key,'Remus, Catherine','actual keywords remain unmodified');
});

test('the model can wrap JSON in fenced Markdown without breaking field placement',async()=>{
 const {parseLoreFieldBatchResponse}=await modulePromise;
 const fields=['content','comment'];
 const json=JSON.stringify({content:translation.content,comment:translation.comment});
 const out=parseLoreFieldBatchResponse('Here is the JSON:\n\x60\x60\x60json\n'+json+'\n\x60\x60\x60',sources,fields);
 assert.deepEqual(out.invalid,[]);
 assert.equal(out.results.content,translation.content);
 assert.equal(out.results.comment,translation.comment);
});

test('a broken title is retried alone; valid content and keywords are kept',async()=>{
 const {translateLoreFieldsBatch}=await modulePromise;
 const requests=[],fallbacks=[];
 const answer={...translation,comment:'057 - 1981/10/19 | 센강 유람선'};
 const result=await translateLoreFieldsBatch({
    sources,fields:['content','comment','key'],
    request:async p=>{requests.push(p);return JSON.stringify(answer)},
    fallback:async(f)=>{fallbacks.push(f);return translation[f]},
 });
 assert.deepEqual(fallbacks,['comment']);
 assert.equal(requests.length,1);
 assert.equal(result.comment,translation.comment);
 assert.equal(result.content,translation.content);
 assert.equal(result.key,translation.key);
});

test('missing or wrong-key JSON never inserts text into a different field',async()=>{
 const {translateLoreFieldsBatch}=await modulePromise;
 let calls=0;const fallbackFields=[];
 const result=await translateLoreFieldsBatch({
    sources,fields:['content','key'],
    request:async()=>{calls++;return JSON.stringify({content:translation.content,title:translation.key})},
    fallback:async field=>{fallbackFields.push(field);return translation[field]},
 });
 assert.equal(calls,1);
 assert.deepEqual(fallbackFields,['key']);
 assert.equal(result.content,translation.content);
 assert.equal(result.key,translation.key);
 assert.equal(result.comment,undefined);
});

test('bad output mapping falls back to named translations only instead of guessing by position',async()=>{
 const {translateLoreFieldsBatch}=await modulePromise;
 let requests=0;
 const fallbacks=[];
 const result=await translateLoreFieldsBatch({
    sources,fields:['comment','key','keysecondary'],
    request:async()=>{requests++;return 'This is not structured JSON'},
    fallback:async f=>{fallbacks.push(f);return translation[f]},
 });
 assert.equal(requests,1);
 assert.deepEqual(fallbacks,['comment','key','keysecondary']);
 assert.equal(result.comment,translation.comment);
 assert.equal(result.keysecondary,'무니');
});

test('single field and large body preserve existing paragraph-aware translation path',async()=>{
 const {translateLoreFieldsBatch}=await modulePromise;
 const source={...sources,content:'Remus rarely smokes.\n\n'.repeat(1000)};
 let batches=0; const fallback=[];
 const result=await translateLoreFieldsBatch({
    sources:source,fields:['content','comment'],
    maxCombinedChars:2000,
    request:async()=>{batches++;throw Error('unexpected huge JSON request')},
    fallback:async field=>{fallback.push(field);return translation[field]},
 });
 assert.equal(batches,0);
 assert.deepEqual(fallback,['content','comment']);
 assert.equal(result.content,translation.content);
 const only=await translateLoreFieldsBatch({
   sources,fields:['comment'],
   request:async()=>{batches++;return ''},
   fallback:async f=>{fallback.push(f);return translation[f]},
 });
 assert.equal(only.comment,translation.comment);
 assert.equal(batches,0);
});

test('a malformed batch cannot erase a previously saved translation',async()=>{
 const {translateLoreFieldsBatch}=await modulePromise;
 const saved={content:'내가 수정한 번역'};
 let calls=0;
 await assert.rejects(translateLoreFieldsBatch({
  sources,fields:['content','key'],
  request:async()=>{calls++;return '{}'},
  fallback:async field=>{
   if(field==='content')throw Error('connection offline');
   return translation[field];
  },
 }),/offline/);
 assert.equal(saved.content,'내가 수정한 번역','module has no persistent mutation');
 assert.equal(calls,1);
});
