const {test}=require('node:test');
const assert=require('node:assert/strict');
const {join}=require('node:path');
const {pathToFileURL}=require('node:url');
const importer=import(pathToFileURL(join(__dirname,'../lore-translation.js')).href);

test('lorebook body, title and keyword prompts have separate rules without roleplay inventions',async()=>{
 const {buildLoreTranslationPrompt}=await importer;
 const source='042 - 1981/10/18 | The Seine Cruise';
 const title=buildLoreTranslationPrompt({source,field:'comment',reference:'Remus and Catherine know each other.',targetLanguage:'ko'});
 assert.match(title,/TITLE/);
 assert.match(title,/1981\/10\/18/);
 assert.match(title,/READ-ONLY REFERENCE/);
 assert.match(title,/only for understanding names/);
 assert.match(title,/exact factual meaning/);
 const keywords=buildLoreTranslationPrompt({source:'Remus, Catherine',field:'key'});
 assert.match(keywords,/comma-separated items/);
 assert.match(keywords,/activation keywords/);
 const content=buildLoreTranslationPrompt({source:'Remus rarely smokes.',field:'content',additionalInstructions:'Consistent term: chocolate.'});
 assert.match(content,/every actor, fact/);
 assert.match(content,/source meaning/);
 assert.match(content,/Consistent term: chocolate/);
 assert.doesNotMatch(content,/READ-ONLY REFERENCE/);
});

test('validation keeps immutable macros, numbers, structure and meaningful ellipses',async()=>{
 const {checkLoreTranslation}=await importer;
 const source='## History\n- **{{char}}** arrived on 1981/10/18…\n- <b>Remus</b> rarely smokes.';
 const valid='## 역사\n- **{{char}}**는 1981/10/18에 도착했다…\n- <b>리무스</b>는 드물게 담배를 피운다.';
 assert.deepEqual(checkLoreTranslation(source,valid),{ok:true,issues:[]});
 assert.ok(checkLoreTranslation(source,valid.replace('{{char}}','{{user}}')).issues.includes('protected-tokens'));
 assert.ok(checkLoreTranslation(source,valid.replace('1981/10/18','1981/10/19')).issues.includes('numbers'));
 assert.ok(checkLoreTranslation(source,valid.replace('…','……')).issues.includes('punctuation'));
 assert.ok(checkLoreTranslation(source,valid.replace('\n- <b>',' <b>')).issues.includes('line-structure'));
 assert.ok(checkLoreTranslation(source,'').issues.includes('empty'));
 assert.ok(checkLoreTranslation('057 - 1981/10/18 | Seine Cruise','057 - 1981/10/18 센강 유람선','comment').issues.includes('title-delimiters'));
});

test('keyword translation preserves the number of independent comma-separated triggers',async()=>{
 const {checkLoreTranslation}=await importer;
 assert.equal(checkLoreTranslation('Moony, Remus, Professor Lupin','무니, 리무스, 루핀 교수','key').ok,true);
 assert.ok(checkLoreTranslation('Moony, Remus, Professor Lupin','무니, 리무스와 루핀 교수','key').issues.includes('keyword-count'));
});

test('split huge lorebooks only at paragraph boundaries and keep exact contents',async()=>{
 const {splitLongLoreSource}=await importer;
 const a='Remus '.repeat(350),b='Catherine '.repeat(350),c='Sirius '.repeat(350);
 const source=a+'\n\n'+b+'\r\n\r\n'+c;
 const chunks=splitLongLoreSource(source,2700);
 assert.ok(chunks.length>=2);
 assert.equal(chunks.join(''),source);
 assert.equal(splitLongLoreSource('short',2700).length,1);
 assert.ok(chunks.every(part=>part && !part.startsWith('ation ')));
});

test('successful normal translation uses one request, restores boundary blank lines',async()=>{
 const {translateLoreWithValidation}=await importer;
 const calls=[],progress=[],warnings=[];
 const result=await translateLoreWithValidation({
  source:'\n\nRemus rarely smokes.\n\n',field:'content',targetLanguage:'ko',
  request:async prompt=>{calls.push(prompt);return '리무스는 담배를 거의 피우지 않는다.';},
  onProgress:(i,n)=>progress.push([i,n]),onWarning:warning=>warnings.push(warning),
 });
 assert.equal(result,'\n\n리무스는 담배를 거의 피우지 않는다.\n\n');
 assert.equal(calls.length,1);
 assert.deepEqual(progress,[[1,1]]);
 assert.equal(warnings.length,0);
});

test('broken numeric translation gets exactly one corrective call and uses verified repair',async()=>{
 const {translateLoreWithValidation}=await importer;
 const calls=[];
 const output=await translateLoreWithValidation({
  source:'- 1981/10/18: Remus seldom smokes.',
  request:async prompt=>{
    calls.push(prompt);
    return calls.length===1?'- 1981/10/19: 리무스는 담배를 자주 피운다.':'- 1981/10/18: 리무스는 담배를 거의 피우지 않는다.';
  },
 });
 assert.equal(calls.length,2);
 assert.match(calls[1],/numbers/);
 assert.equal(output,'- 1981/10/18: 리무스는 담배를 거의 피우지 않는다.');
});

test('failed corrective request keeps the original paid translation for inspection and warns',async()=>{
 const {translateLoreWithValidation}=await importer;
 let calls=0;const warnings=[];
 const result=await translateLoreWithValidation({
  source:'{{char}} is 21.',
  request:async()=>{
    calls++;
    if(calls===2)throw Error('Connection unavailable');
    return '{{user}}는 21세다.';
  },
  onWarning:item=>warnings.push(item),
 });
 assert.equal(calls,2);
 assert.equal(result,'{{user}}는 21세다.');
 assert.deepEqual(warnings[0].issues,['protected-tokens']);
});

test('empty source needs no AI request',async()=>{
 const {translateLoreWithValidation}=await importer;
 let calls=0;
 assert.equal(await translateLoreWithValidation({source:'\n \n',request:async()=>{calls++;return 'wrong';}}),'\n \n');
 assert.equal(calls,0);
});

test('long body chunks are each checked and assembled in the source order',async()=>{
 const {translateLoreWithValidation}=await importer;
 const paragraphs=['First paragraph '.repeat(130),'Second paragraph '.repeat(130)];
 const source=paragraphs.join('\n\n');
 let calls=0;const progress=[];
 const output=await translateLoreWithValidation({
  source,maxChars:2800,
  request:async prompt=>{calls++;return prompt.includes('First paragraph')?'첫째 문단 ':'둘째 문단 ';},
  onProgress:(i,n)=>progress.push([i,n]),
  onWarning:()=>{},
 });
 assert.equal(calls,2);
 assert.match(output,/첫째 문단/);
 assert.match(output,/둘째 문단/);
 assert.match(output,/\n\n/);
 assert.deepEqual(progress,[[1,2],[2,2]]);
});

test('fenced code blocks containing blank lines stay in one chunk',async()=>{
 const {splitLongLoreSource}=await importer;
 const fence=String.fromCharCode(96).repeat(3);
 const source='Opening paragraph '.repeat(120)+'\n\n'
    +fence+'js\nconst data = { a: 1 };\n\nconst other = 2;\n'+fence+'\n\n'
    +'Closing paragraph '.repeat(170);
 const chunks=splitLongLoreSource(source,2600);
 assert.equal(chunks.join(''),source);
 const containingCode=chunks.filter(x=>x.includes('const data = { a: 1 }'));
 assert.equal(containingCode.length,1);
 assert.ok(containingCode[0].includes('const other = 2'));
 assert.ok(containingCode[0].includes(fence+'js'));
 assert.ok(containingCode[0].includes('\n'+fence));
});

test('prefatory model chatter is detected and repaired without silently accepting it',async()=>{
 const {checkLoreTranslation,translateLoreWithValidation}=await importer;
 assert.ok(checkLoreTranslation('Remus seldom smokes.','번역: 리무스는 담배를 거의 피우지 않는다.').issues.includes('output-wrapper'));
 let count=0;
 const translated=await translateLoreWithValidation({
  source:'Remus seldom smokes.',
  request:async()=>{
   count++;
   return count===1?'번역: 리무스는 담배를 거의 피우지 않는다.':'리무스는 담배를 거의 피우지 않는다.';
  },
 });
 assert.equal(count,2);
 assert.equal(translated,'리무스는 담배를 거의 피우지 않는다.');
});

test('oversized single paragraphs and mixed CJK/emoji respect the configured budget',async()=>{
 const {splitLongLoreSource}=await importer;
 const source='First sentence. '.repeat(100)+'{{char}} '+ '한국어🙂'.repeat(120);
 const chunks=splitLongLoreSource(source,300);
 assert.equal(chunks.join(''),source);
 assert.ok(chunks.length>2 && chunks.every(chunk=>chunk.length<=300));
 assert.equal(chunks.filter(chunk=>chunk.includes('{{char}}')).length,1);
 assert.ok(chunks.every(chunk=>!/[\uD800-\uDBFF]$/.test(chunk) && !/^[\uDC00-\uDFFF]/.test(chunk)));
});
test('an indivisible protected block larger than budget fails before any paid request',async()=>{
 const {translateLoreWithValidation}=await importer;
 const fence=String.fromCharCode(96).repeat(3);
 let calls=0;
 await assert.rejects(translateLoreWithValidation({source:fence+'js\n'+'x'.repeat(600)+'\n'+fence,maxChars:300,request:async()=>{calls++;return 'unused'}}),/한도/);
 assert.equal(calls,0);
});


test('an interrupted long translation resumes paid chunks only for the same source and settings',async()=>{
 const {translateLoreWithValidation}=await importer;
 const source=['First paragraph '.repeat(130),'Second paragraph '.repeat(130)].join('\n\n');
 let first=0, second=0;
 const options={source,maxChars:2800,resumeScope:'test-profile'};
 await assert.rejects(translateLoreWithValidation({...options,request:async prompt=>{
  if(prompt.includes('First paragraph')){first++;return '첫째 문단';}
  second++;throw Error('temporary connection failure');
 }}),/1\/2/);
 const result=await translateLoreWithValidation({...options,request:async prompt=>{
  if(prompt.includes('First paragraph')){first++;return 'first again';}
  second++;return '둘째 문단';
 }});
 assert.equal(first,1);assert.equal(second,2);
 assert.equal(result,'첫째 문단 \n\n둘째 문단 ');
});
