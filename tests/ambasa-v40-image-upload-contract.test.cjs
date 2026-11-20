const {test}=require('node:test');
const assert=require('node:assert/strict');
const {readFileSync}=require('node:fs');
const {join}=require('node:path');

const source=readFileSync(join(__dirname,'../index.js'),'utf8');
const first=source.indexOf('function libraryImagePath(');
const last=source.indexOf('function initStandaloneLibrary()',first);
assert.ok(first>0 && last>first);
const funcs=source.slice(first,last);
function fixture({responsePath='user/images/slb-lore-test.png',status=200,failSave=false}={}){
 const settings={libraryEntryImages:{},translations:{},libraryBookTags:{}};
 const calls={fetch:[],save:0};
 class Reader{readAsDataURL(file){this.result='data:'+file.type+';base64,YWJj';this.onload?.()}}
 const api=new Function('FileReader','fetch','getRequestHeaders','getSettings','saveSettings',
    funcs+'return {libraryImagePath,saveLibraryEntryImagePath,safeLibraryUploadedPath,uploadLibraryEntryImage};')(
    Reader,
    async(url,args)=>{calls.fetch.push({url,args});return {ok:status===200,status,json:async()=>({path:responsePath})}},
    ()=>({'Content-Type':'application/json','X-CSRF-Token':'test'}),
    ()=>settings,
    async()=>{calls.save++;if(failSave)throw Error('save failed')}
 );
 return {settings,calls,...api};
}
test('explicit ST native image upload stores only a short per-book/UID image path',async()=>{
 const f=fixture();
 const file={name:'painting.png',type:'image/png',size:12000};
 const path=await f.uploadLibraryEntryImage('Memory', {uid:42}, file);
 assert.equal(path,'/user/images/slb-lore-test.png');
 assert.equal(f.calls.fetch.length,1);
 const req=f.calls.fetch[0];
 assert.equal(req.url,'/api/images/upload');
 assert.equal(req.args.method,'POST');
 assert.equal(req.args.headers['Content-Type'],'application/json');
 assert.equal(req.args.headers['X-CSRF-Token'],'test');
 const data=JSON.parse(req.args.body);
 assert.equal(data.image,'YWJj');
 assert.equal(data.format,'png');
 assert.match(data.filename,/^slb-lore-\d+-[0-9a-z]+$/);
 assert.equal(f.calls.save,1);
 assert.equal(f.libraryImagePath('Memory',42),path);
 assert.equal(f.libraryImagePath('Other',42),'');
 assert.equal(JSON.stringify(f.settings).includes('YWJj'),false);
 assert.deepEqual(f.settings.translations,{});
 assert.deepEqual(f.settings.libraryBookTags,{});
});
test('native ST upload refuses invalid MIME, oversized file and untrusted returned image paths',async()=>{
 for(const [file,message] of [
    [{name:'bad.svg',type:'image/svg+xml',size:100},/5MB 이하/],
    [{name:'huge.png',type:'image/png',size:7*1024*1024},/5MB 이하/],
 ]) {
    const f=fixture();
    await assert.rejects(f.uploadLibraryEntryImage('Book',{uid:1},file),message);
    assert.equal(f.calls.fetch.length,0);
    assert.equal(f.calls.save,0);
 }
 for(const path of ['https://example.org/evil.jpg','javascript:alert(1)',
    '/user/images/../private.png','/user/images/pic.jpg?x=1','/img/not-user.png']) {
    const f=fixture({responsePath:path});
    await assert.rejects(f.uploadLibraryEntryImage('Book',{uid:1},{name:'a.jpg',type:'image/jpeg',size:400}),/저장 경로/);
    assert.equal(f.calls.save,0);
 }
});
test('image path persistence rolls back on settings errors and removal leaves ST image file alone',async()=>{
 const f=fixture({failSave:true});
 await assert.rejects(f.saveLibraryEntryImagePath('Book',9,'/user/images/foo.jpg'),/save failed/);
 assert.deepEqual(Object.keys(f.settings.libraryEntryImages),[]);
 f.settings.libraryEntryImages.Book={9:'/user/images/old.jpg',10:'/user/images/shared.png'};
 await assert.rejects(f.saveLibraryEntryImagePath('Book',9,'/user/images/new.jpg'),/save failed/);
 assert.equal(f.libraryImagePath('Book',9),'/user/images/old.jpg');
 assert.equal(f.libraryImagePath('Book',10),'/user/images/shared.png');
 const ok=fixture();
 ok.settings.libraryEntryImages.Book={9:'/user/images/foo.jpg',10:'/user/images/still.png'};
 await ok.saveLibraryEntryImagePath('Book',9,'');
 assert.equal(ok.libraryImagePath('Book',9),'');
 assert.equal(ok.libraryImagePath('Book',10),'/user/images/still.png');
 assert.equal(ok.calls.fetch.length,0,'unlink never calls an image DELETE endpoint');
 assert.equal(ok.calls.save,1);
});
