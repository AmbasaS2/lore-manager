/*
 * Lorebook translation snapshots live in SillyTavern's per-user /user/files.
 * Only small preferences remain in settings.json.
 * This module deliberately never writes translated text to browser storage.
 */
export const TRANSLATION_STORE_FORMAT = 'lore-manager-translations-v1';
export const TRANSLATION_INDEX_FORMAT = 'lore-manager-translation-index-v1';
export const TRANSLATION_RECOVERY_FORMAT = 'lore-manager-translation-recovery-v1';
export const TRANSLATION_INDEX_PATH = '/user/files/lore-manager-translation-index-v1.json';
const SEPARATOR = '\u241f';

function stableHash(value) {
    let a = 0x811c9dc5;
    let b = 0x85ebca6b;
    for (const point of String(value)) {
        const code = point.codePointAt(0);
        a = Math.imul(a ^ code, 0x01000193) >>> 0;
        b = Math.imul(b ^ (code & 65535), 0x27d4eb2d) >>> 0;
        b = Math.imul(b ^ (code >>> 16), 0x27d4eb2d) >>> 0;
    }
    return a.toString(16).padStart(8, '0') + b.toString(16).padStart(8, '0');
}
function slug(value) {
    return String(value).normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
        .replace(/[^A-Za-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 42) || 'book';
}
export function translationBookPath(book) {
    if (!book || typeof book !== 'string') throw new Error('Missing lorebook name');
    return '/user/files/lore-manager-translation-' + slug(book) + '-' + stableHash(book) + '.json';
}
function ownData(value) {
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}
function clone(value) {
    return JSON.parse(JSON.stringify(value));
}
function equal(a,b) {
    return JSON.stringify(a) === JSON.stringify(b);
}
function bookOf(key,record) {
    const split=String(key).lastIndexOf(SEPARATOR);
    if (split>0) return String(key).slice(0,split);
    if (typeof record?.book === 'string' && record.book) return record.book;
    return '';
}
function emptyIndex() {
    return {format:TRANSLATION_INDEX_FORMAT,books:[],hints:{}};
}
function validateIndex(value) {
    if (!value || value.format!==TRANSLATION_INDEX_FORMAT || !Array.isArray(value.books)
        || value.books.some(book=>typeof book!=='string'||!book)
        || new Set(value.books).size!==value.books.length
        || typeof value.hints!=='object' || value.hints===null || Array.isArray(value.hints)) {
        throw new Error('번역 저장소 색인 파일 형식이 잘못됐습니다.');
    }
    return { format:TRANSLATION_INDEX_FORMAT,books:[...value.books],
        hints:{...value.hints} };
}
function validateBook(book,value) {
    if (!value || value.format!==TRANSLATION_STORE_FORMAT || value.book!==book
        || !Number.isSafeInteger(value.revision) || value.revision<1
        || !value.records || typeof value.records!=='object' || Array.isArray(value.records)
        || !value.pairs || typeof value.pairs!=='object' || Array.isArray(value.pairs)) {
        throw new Error('로어북 번역 파일의 형식 또는 로어북 이름이 일치하지 않습니다: '+book);
    }
    return value;
}
function splitBookMemory(book,records,pairs) {
    const filteredRecords={};
    const filteredPairs={};
    for (const [key,record] of Object.entries(records)) {
        if (bookOf(key,record)===book) filteredRecords[key]=record;
    }
    for (const [key,value] of Object.entries(pairs)) {
        if (bookOf(key,records[key])===book) filteredPairs[key]=value;
    }
    return {records:clone(filteredRecords),pairs:clone(filteredPairs)};
}
function replaceMemoryBook(book,target,source) {
    for (const [key,value] of Object.entries(target.records)) {
        if (bookOf(key,value)===book) delete target.records[key];
    }
    for (const [key,value] of Object.entries(target.pairs)) {
        if (bookOf(key,target.records[key])===book || key.startsWith(book+SEPARATOR)) delete target.pairs[key];
    }
    Object.assign(target.records,source.records);
    Object.assign(target.pairs,source.pairs);
}
function fallbackHintKey(uid,sourceHash,language) {
    return String(uid)+SEPARATOR+String(sourceHash)+SEPARATOR+String(language);
}
function hintsForBook(book,records) {
    const hints={};
    for (const [key,record] of Object.entries(records)) {
        if (!record || typeof record!=='object' || !record.sourceHash || !record.language) continue;
        const uid=String(record.uid ?? key.slice(key.lastIndexOf(SEPARATOR)+1));
        hints[fallbackHintKey(uid,record.sourceHash,record.language)]=book;
    }
    return hints;
}
function setHidden(settings,key,value) {
    Object.defineProperty(settings,key,{value,writable:true,enumerable:false,configurable:true});
}
async function encodeBase64Json(value) {
    const json=JSON.stringify(value);
    if (typeof json!=='string') throw new Error('번역 데이터를 JSON으로 변환할 수 없습니다.');
    return new Promise((resolve,reject)=>{
        const reader=new FileReader();
        reader.onerror=()=>reject(reader.error || new Error('번역 파일 인코딩 실패'));
        reader.onload=()=>{
            const data=String(reader.result||'');
            const comma=data.indexOf(',');
            if(comma<0)reject(new Error('번역 파일 인코딩 실패'));
            else resolve(data.slice(comma+1));
        };
        reader.readAsDataURL(new Blob([json],{type:'application/json'}));
    });
}

export function createLoreTranslationStorage({getRequestHeaders,
    onBookLoaded=()=>{},onError=()=>{},delay=900}) {
    const memory={records:{},pairs:{}};
    const revisions=new Map();
    const loaded=new Set();
    const loading=new Map();
    const saving=new Map();
    const timers=new Map();
    const dirty=new Map();
    let settingsRef=null,index=null,initializing=null,started=false;
    let editingBlocked=false;
    let indexWrites=Promise.resolve();

    async function request(url,payload) {
        const response=await fetch(url,{method:'POST',headers:getRequestHeaders(),
            body:JSON.stringify(payload),cache:'no-store'});
        if(!response.ok)throw new Error('번역 파일 API 요청 실패 '+response.status+' ('+url+')');
        return response.json();
    }
    async function exists(path) {
        const response=await request('/api/files/verify',{urls:[path]});
        if (typeof response?.[path]!=='boolean') throw new Error('번역 파일 존재 확인 결과가 올바르지 않습니다.');
        return response[path];
    }
    async function read(path) {
        if(!await exists(path))return null;
        const response=await fetch(path,{method:'GET',headers:getRequestHeaders(),cache:'no-store'});
        if(!response.ok)throw new Error('번역 파일 읽기 실패 '+response.status+' ('+path+')');
        try{return await response.json()}catch{throw new Error('번역 JSON 읽기 오류: '+path)}
    }
    async function write(path,data) {
        const filename=path.split('/').at(-1);
        if(!/^lore-manager-[A-Za-z0-9_-]+\.json$/.test(filename))throw new Error('Invalid translation filename');
        const saved=await request('/api/files/upload',{name:filename,data:await encodeBase64Json(data)});
        if(saved?.path!==path)throw new Error('번역 파일 저장 위치가 일치하지 않습니다: '+path);
        const verified=await read(path);
        if(!equal(verified,data))throw new Error('저장된 번역 파일 재읽기 검증에 실패했습니다: '+path);
        return verified;
    }
    async function remove(path) {
        if(!/^\/user\/files\/lore-manager-[A-Za-z0-9_-]+\.json$/.test(path))throw new Error('Invalid translation delete path');
        if(!await exists(path))return;
        const response=await fetch('/api/files/delete',{method:'POST',headers:getRequestHeaders(),
            body:JSON.stringify({path}),cache:'no-store'});
        if(!response.ok || await exists(path))throw new Error('번역 파일 삭제 확인 실패: '+path);
    }
    function attach(settings) {
        if (settingsRef===settings) return;
        // A new store never imports legacy translations from settings.json.
        // If the user's no-legacy assumption is wrong, fail closed instead of
        // silently removing or replacing old user data.
        const oldRecords=ownData(settings.translations);
        const oldPairs=ownData(settings.entryLanguagePairs);
        if (Object.keys(oldRecords).length || Object.keys(oldPairs).length) {
            editingBlocked=true;
            settingsRef=settings;
            return;
        }
        setHidden(settings,'translations',memory.records);
        setHidden(settings,'entryLanguagePairs',memory.pairs);
        settingsRef=settings;
    }
    async function ensureIndex() {
        if(index)return index;
        index=validateIndex(await read(TRANSLATION_INDEX_PATH) || emptyIndex());
        return index;
    }
    async function writeIndex(next) {
        const verified=validateIndex(next);
        await write(TRANSLATION_INDEX_PATH,verified);
        index=verified;
        return verified;
    }
    function start() {
        if (editingBlocked) {
            const error = new Error('설정 파일에서 기존 로어북 번역 기록이 발견됐습니다. 이전 데이터는 자동으로 삭제하거나 이전하지 않습니다.');
            onError(error);
            return Promise.reject(error);
        }
        if (initializing) return initializing;
        initializing=ensureIndex().then(()=>{
            started=true;
            return true;
        }).catch(error=>{
            initializing=null;
            onError(error);
            throw error;
        });
        return initializing;
    }
    async function ensureBook(book) {
        if(!book)return;
        await start();
        if(loaded.has(book))return;
        if(loading.has(book))return loading.get(book);
        const work=(async()=>{
            const file=await read(translationBookPath(book));
            const snapshot=file?validateBook(book,file):null;
            if(snapshot){
                replaceMemoryBook(book,memory,snapshot);
                revisions.set(book,snapshot.revision);
            } else revisions.set(book,0);
            loaded.add(book);
            // Existing UI can be hydrated after one file read, not after
            // loading every book listed in the index.
            onBookLoaded(book);
        })();
        loading.set(book,work);
        try{await work}finally{loading.delete(book)}
    }
    function isBookReady(book) {
        return Boolean(book && started && !editingBlocked && loaded.has(book));
    }
    function assertBookReady(book) {
        if(!isBookReady(book)){
            void ensureBook(book).catch(()=>{});
            throw new Error('로어북 번역 파일을 아직 읽지 못했습니다. 저장소 상태를 확인한 후 다시 시도해주세요.');
        }
    }
    function hintFor(uid,sourceHash,language) {
        return index?.hints[fallbackHintKey(uid,sourceHash,language)] || '';
    }
    function incrementDirty(book) {dirty.set(book,(dirty.get(book)||0)+1)}
    function scheduleSave(book) {
        assertBookReady(book);
        incrementDirty(book);
        if(timers.has(book))clearTimeout(timers.get(book));
        timers.set(book,setTimeout(()=>{
            timers.delete(book);
            void flushBook(book).catch(onError);
        },delay));
    }
    async function commitBook(book) {
        const epoch=dirty.get(book)||0;
        if(!epoch)return;
        const data=splitBookMemory(book,memory.records,memory.pairs);
        const path=translationBookPath(book);
        const old=await read(path);
        if(old)validateBook(book,old);
        const revision=revisions.get(book)||0;
        if((old?.revision||0)!==revision) {
            throw new Error('다른 기기에서 로어북 번역이 변경됐습니다. 덮어쓰지 않았습니다: '+book);
        }
        const snapshot={format:TRANSLATION_STORE_FORMAT,book,revision:revision+1,updatedAt:Date.now(),...data};
        await write(path,snapshot);
        revisions.set(book,snapshot.revision);
        // Updating the translation text does not alter the lookup index.
        // Keep the (potentially large) global hint file completely untouched
        // unless a book first appears or its source-hash signatures change.
        const freshHints=hintsForBook(book,data.records);
        const updateIndex=async()=>{
            const cached=index || emptyIndex();
            const oldHints=Object.fromEntries(Object.entries(cached.hints).filter(([,owner])=>owner===book));
            if (cached.books.includes(book) && equal(oldHints,freshHints)) return;
            const latest=validateIndex(await read(TRANSLATION_INDEX_PATH)||emptyIndex());
            const hints=Object.fromEntries(Object.entries(latest.hints).filter(([,owner])=>owner!==book));
            Object.assign(hints,freshHints);
            const next={...latest,books:[...new Set([...latest.books,book])].sort(),hints};
            if (!equal(latest,next)) await writeIndex(next);
            else index=latest;
        };
        const pendingIndex=indexWrites.catch(()=>undefined).then(updateIndex);
        indexWrites=pendingIndex;
        await pendingIndex;
        if(dirty.get(book)===epoch)dirty.delete(book);
    }
    async function flushBook(book) {
        if(!book)return;
        if(timers.has(book)) {clearTimeout(timers.get(book));timers.delete(book)}
        await ensureBook(book);
        const previous=saving.get(book)||Promise.resolve();
        // Queue remains usable after failure, but the failure itself is
        // propagated to the caller and the dirty copy is not discarded.
        const task=previous.catch(()=>undefined).then(()=>commitBook(book));
        saving.set(book,task);
        try{await task}
        finally{if(saving.get(book)===task)saving.delete(book)}
        if(dirty.has(book))return flushBook(book);
    }
    async function flushAll() {
        for(const book of new Set([...dirty.keys(),...saving.keys()]))await flushBook(book);
    }
    async function backupFullStore() {
        await start();
        await flushAll();
        const books=[...(await ensureIndex()).books];
        const files={};
        for(const book of books){
            const file=await read(translationBookPath(book));
            if(!file)throw new Error('기존 번역 파일이 없어 삭제를 중단했습니다: '+book);
            files[book]=validateBook(book,file);
        }
        const path='/user/files/lore-manager-recovery-'+Date.now()+'-'+Math.floor(Math.random()*1e9).toString(36)+'.json';
        await write(path,{format:TRANSLATION_RECOVERY_FORMAT,createdAt:Date.now(),files});
        return {books,path};
    }
    async function clearAll({onlyTranslations=false}={}) {
        const {books}=await backupFullStore();
        for(const book of books) {
            if(onlyTranslations){
                await ensureBook(book);
                for(const [key,record] of Object.entries(memory.records)) {
                    if(bookOf(key,record)===book)delete memory.records[key];
                }
                scheduleSave(book);
                await flushBook(book);
            } else {
                await remove(translationBookPath(book));
                revisions.delete(book);loaded.delete(book);
            }
        }
        if(!onlyTranslations) {
            await remove(TRANSLATION_INDEX_PATH);
            index=emptyIndex();
            for(const k of Object.keys(memory.records))delete memory.records[k];
            for(const k of Object.keys(memory.pairs))delete memory.pairs[k];
        }
    }
    return {attach,start,ensureBook,isBookReady,assertBookReady,scheduleSave,flushBook,flushAll,
        clearAll,hintFor,memory,hasPending:()=>dirty.size>0 || saving.size>0 || timers.size>0,
        getIndex:()=>index};
}
