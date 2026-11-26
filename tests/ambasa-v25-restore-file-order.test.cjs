const {test}=require('node:test');
const assert=require('node:assert/strict');
const {readFileSync}=require('node:fs');
const vm=require('node:vm');
const {join}=require('node:path');
const source=readFileSync(join(__dirname,'../index.js'),'utf8');
function prod(name){
 const m=source.match(new RegExp('^async function '+name+'\\([^]*?^}', 'm'));
 assert.ok(m,name+' missing');return m[0];
}
test('backup restore first loads and verifies the translation file, then commits translations before native lorebook write',async()=>{
 const calls=[];
 const { uiText } = await import('../ui-language.js');
 const ctx={
  uiText,
  state:{backupRestoreInProgress:false},
  getLorebookBackup:async()=>({book:'A',lorebook:{entries:{0:{uid:0,content:'source'}}},
    translations:[{book:'A',uid:'0',text:'번역',language:'Korean'}]}),
  currentBookName:()=> 'A',
  window:{confirm:()=>true},
  loadWorldInfo:async()=>({entries:{0:{uid:0,content:'original'}}}),
  createLorebookBackup:async()=>{calls.push('pre-restore-backup')},
  translationFiles:{ensureBook:async()=>calls.push('ensure-file'),flushBook:async()=>calls.push('flush-file')},
  replaceLorebookTranslations:()=>calls.push('restore-translations'),
  saveWorldInfo:async()=>calls.push('save-original-lore'),
  selectLorebookByName:()=>true,
  scheduleEnhance:()=>{throw Error('selected book should remain current')},
  scheduleTokenSummary:()=>{},
  renderBackupList:()=>{},
  notify:()=>{},
  structuredClone,
 };
 vm.runInNewContext(prod('restoreLorebookBackup')+'\nglobalThis.restore=restoreLorebookBackup;',ctx);
 const ok=await ctx.restore('id','current');
 assert.equal(ok,true);
 assert.deepEqual(calls,['pre-restore-backup','ensure-file','restore-translations','flush-file','save-original-lore']);
 assert.equal(ctx.state.backupRestoreInProgress,false);
});
test('failed translation file flush must not restore native original, even with an existing backup',async()=>{
 const calls=[];
 const { uiText } = await import('../ui-language.js');
 const ctx={
  uiText,
  state:{backupRestoreInProgress:false},
  getLorebookBackup:async()=>({book:'A',lorebook:{entries:{0:{uid:0,content:'new'}}},translations:[]}),
  currentBookName:()=> 'A',
  window:{confirm:()=>true},
  loadWorldInfo:async()=>({entries:{0:{uid:0,content:'old'}}}),
  createLorebookBackup:async()=>{},
  translationFiles:{ensureBook:async()=>{},flushBook:async()=>{throw Error('disk write failed')}},
  replaceLorebookTranslations:()=>calls.push('memory-change'),
  saveWorldInfo:async()=>calls.push('WRONG-native-overwrite'),
  structuredClone,
 };
 vm.runInNewContext(prod('restoreLorebookBackup')+'\nglobalThis.restore=restoreLorebookBackup;',ctx);
 await assert.rejects(ctx.restore('id','current'),/disk write failed/);
 assert.deepEqual(calls,['memory-change'],'native original never overwritten on translation storage failure');
 assert.equal(ctx.state.backupRestoreInProgress,false);
});
