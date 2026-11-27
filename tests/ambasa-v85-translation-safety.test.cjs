const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const src=require('node:fs').readFileSync(require('node:path').join(__dirname,'../index.js'),'utf8');
const reflect=src.match(/^async function reflectEntryTranslation\([^]*?^}/m)[0];
function fixture({source='Original',backup=async()=>({status:'created'}),liveSource=source}={}){
 const events=[];
 const ui={book:'A',uid:'1',flags:{},root:{isConnected:true},
  source:{value:source,dispatchEvent(){events.push('write')}},
  translation:{value:'번역'},sourceLanguage:'en',translationLanguage:'ko',status:{}};
 const ctx=vm.createContext({state:{},getSettings:()=>({autoSyncToSource:false}),entryLanguageBadge:v=>v,
  canTranslate:()=>true,hashText:v=>v,setEntryBusy:()=>{},translateText:async()=>'Revised',
  assertProtectedStructurePreserved:()=>{},loadWorldInfo:async()=>({entries:{'1':{uid:1,content:liveSource}}}),
  createLorebookBackup:async(book,options)=>{events.push(['backup',book,options.reason,options.data.entries['1'].content]);return backup(ui);},
  currentBookName:()=>ui.book,uiText:v=>v,notify:(msg,type)=>events.push([type,msg]),
  Event:class{},markTranslationSynced:()=>events.push('synced'),scheduleTranslationReflection:()=>{}});
 vm.runInContext(reflect,ctx);
 return {ui,ctx,events};
}
test('new installations disable reverse auto-sync while keeping explicit saved settings',()=>{
 assert.match(src,/autoSyncToSource: false,/);
 assert.match(src,/if \(!\(key in settings\)\)/);
});
test('existing nonempty original is backed up before AI full replacement even with auto backup off',async()=>{
 const f=fixture();await f.ctx.reflectEntryTranslation(f.ui,{manual:true});
 assert.deepEqual(f.events,[['backup','A','before-source-replace','Original'],'write','synced']);
 assert.equal(f.ui.source.value,'Revised');
});
test('failed backup, changed source, or changed editor during backup never replaces original',async()=>{
 for(const options of [{backup:async()=>{throw Error('disk error')}},{backup:async()=>({status:'clearing'})},
   {liveSource:'Different'},{backup:async ui=>{ui.translation.value='new';return {status:'created'}}}]){
  const f=fixture(options);await f.ctx.reflectEntryTranslation(f.ui,{manual:true});
  assert.equal(f.ui.source.value,'Original');assert.ok(!f.events.includes('write'));
 }
});
test('creating a previously empty original does not create an unnecessary backup',async()=>{
 const f=fixture({source:''});await f.ctx.reflectEntryTranslation(f.ui,{manual:true});
 assert.deepEqual(f.events,['write','synced']);
});
