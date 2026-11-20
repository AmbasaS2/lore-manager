const { test } = require('node:test');
const assert = require('node:assert/strict');
const {readFileSync}=require('node:fs');
const {join}=require('node:path');
const source=readFileSync(join(__dirname,'../index.js'),'utf8');
const a=source.indexOf('        getTags: book => {');
const b=source.indexOf("        getTheme: () => 'antique',",a);
assert.ok(a>0 && b>a,'production book-tags callbacks exist');
const production=source.slice(a,b);
function make({fail=false}={}){
 const settings={libraryBookTags:{}};
 let saved=0;
 const getSettings=()=>settings;
 const saveSettings=async()=>{saved++;if(fail)throw Error('disk write failed')};
 const callbacks=new Function('getSettings','saveSettings','return ({'+production+'})')(getSettings,saveSettings);
 return {settings,callbacks,saved:()=>saved};
}
test('book tags write only lightweight settings metadata without changing originals or translations',async()=>{
 const s=make();
 await s.callbacks.setTags('Memory Peter',['기억','마법 세계']);
 assert.deepEqual(s.callbacks.getTags('Memory Peter'),['기억','마법 세계']);
 assert.equal(s.saved(),1,'settings saved once only on explicit edit');
 assert.equal(s.callbacks.getTags('Cody Core').length,0);
 assert.deepEqual(Object.keys(s.settings),['libraryBookTags']);
 assert.doesNotMatch(production,/(?:saveWorldInfo|loadWorldInfo|translateText|translationFiles|setInterval|MutationObserver)/);
});
test('malicious lorebook name __proto__ cannot alter settings prototype',async()=>{
 const s=make();
 await s.callbacks.setTags('__proto__',['안전']);
 assert.deepEqual(s.callbacks.getTags('__proto__'),['안전']);
 assert.equal(Object.getPrototypeOf(s.settings.libraryBookTags),Object.prototype);
 assert.equal(Object.prototype.polluted,undefined);
 assert.ok(Object.hasOwn(s.settings.libraryBookTags,'__proto__'));
});
test('failed preferences save restores prior tags without losing other books',async()=>{
 const s=make({fail:true});
 s.settings.libraryBookTags['A']=['원래 태그'];
 s.settings.libraryBookTags['B']=['보존'];
 await assert.rejects(s.callbacks.setTags('A',['새 태그']),/disk write failed/);
 assert.deepEqual(s.callbacks.getTags('A'),['원래 태그']);
 assert.deepEqual(s.callbacks.getTags('B'),['보존']);
 await assert.rejects(s.callbacks.setTags('C',['새 태그']),/disk write failed/);
 assert.equal(Object.hasOwn(s.settings.libraryBookTags,'C'),false);
 assert.equal(s.saved(),2);
});
