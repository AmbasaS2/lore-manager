const {test}=require('node:test');
const assert=require('node:assert/strict');
const {readFileSync}=require('node:fs');
const {join}=require('node:path');
const {pathToFileURL}=require('node:url');
const vm=require('node:vm');
const source=readFileSync(join(__dirname,'../index.js'),'utf8');
const getter=source.match(/^async function translateText\([^]*?^}/m);
assert.ok(getter,'production translateText function must exist');
const importer=import(pathToFileURL(join(__dirname,'../lore-translation.js')).href);

test('real translateText routes body/title/keywords to specific prompt without changing settings',async()=>{
 const {translateLoreWithValidation}=await importer;
 const settings={translationProvider:'profile',profileId:'test-profile',aiOutputTokens:8192,translationPrompt:'Keep familiar nicknames.'};
 const prompts=[],notices=[];
 const ctx=vm.createContext({
  getSettings:()=>settings,
  normalizeEntryLanguage:lang=>lang,
  ENTRY_LANGUAGE_KOREAN:'ko',
  translateLoreWithValidation,
  googleTranslate:()=>{throw Error('Google path must not run')},
  requestWithProfile:async prompt=>{
   prompts.push(prompt);
   return prompt.includes('DISPLAY translations of activation keywords')?'리무스, 루핀':prompt.includes('lorebook TITLE')?'057 - 1981/10/18 | 센강 유람선':'리무스는 담배를 드물게 피운다.';
  },
  notify:(message,type)=>notices.push([message,type]),
  console,
 });
 vm.runInContext(getter[0]+'\nthis.translate=translateText;',ctx);
 const body=await ctx.translate('Remus rarely smokes.','ko');
 assert.equal(body,'리무스는 담배를 드물게 피운다.');
 const title=await ctx.translate('057 - 1981/10/18 | Seine Cruise','ko',null,{field:'comment',reference:'Remus and Catherine were on the river.'});
 assert.equal(title,'057 - 1981/10/18 | 센강 유람선');
 const keys=await ctx.translate('Remus, Lupin','ko',null,{field:'key',reference:'He is a professor.'});
 assert.equal(keys,'리무스, 루핀');
 assert.equal(prompts.length,3);
 assert.match(prompts[1],/READ-ONLY REFERENCE/);
 assert.match(prompts[2],/comma-separated items/);
 assert.equal(notices.length,0);
 assert.equal(settings.translationPrompt,'Keep familiar nicknames.');
});

test('Google translation remains in the original independent request path',async()=>{
 const {translateLoreWithValidation}=await importer;
 const settings={translationProvider:'google',translationPrompt:'Should not be included'};
 let google=0,ai=0;
 const ctx=vm.createContext({
  getSettings:()=>settings,
  normalizeEntryLanguage:lang=>lang,
  ENTRY_LANGUAGE_KOREAN:'ko',
  translateLoreWithValidation:()=>{ai++;return 'AI'},
  googleTranslate:async(source,lang,cb)=>{google++;return source+':'+lang;},
  notify:()=>{},
 });
 vm.runInContext(getter[0]+'\nthis.translate=translateText;',ctx);
 assert.equal(await ctx.translate('Original','ko',null,{field:'comment'}),'Original:ko');
 assert.equal(google,1);assert.equal(ai,0);
});

test('entry source and bulk code pass field context without altering actual key data',()=>{
 const generated=source.match(/results\[field\] = await translateText\(/g)||[];
 assert.equal(generated.length,2,'both single and bulk translate use field context');
 assert.equal((source.match(/reference: field === 'content' \? '' : sources\.content/g)||[]).length,2);
});
