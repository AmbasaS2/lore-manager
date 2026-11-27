const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const vm = require('node:vm');
const { JSDOM, uiText, uiHtml } = require('./fixture-ui-language.cjs');
const makeJQuery = require('jquery');
const code = readFileSync(require('node:path').join(__dirname, '../index.js'), 'utf8');
const fn = name => code.match(new RegExp(`^(?:async )?function ${name}\\([^]*?^}`, 'm'))[0];
const flush = () => new Promise(resolve => setImmediate(resolve));
const key = (book, uid) => `${book}:${uid}`;
const entryGroupImporter=import(require('node:url').pathToFileURL(require('node:path').join(__dirname,'../lore-entry-batch.js')).href);
function fixture(groupModule = null) {
    const dom = new JSDOM('<div id="rows"></div>');
    const data = { entries: Object.fromEntries([0, 1, 2, 3].map(uid => [uid, { uid, content: `source ${uid}` }])),
        originalData: { entries: [0, 1, 2, 3].map(uid => ({ uid })) } };
    let book = 'A', current = true, confirm = async () => 1;
    const settings = { hideOriginalWhenTranslated: true, translations: {}, entryLanguagePairs: {} };
    const events = [], requests = [], rows = [];
    let translate = async source => `translated ${source}`;
    const groupRequests=[];
    let groupResponse = async prompt => {
        const data=JSON.parse(prompt.split('=== SOURCE ENTRY JSON ===\n')[1]);
        const entries={};
        for(const [uid,item] of Object.entries(data.entries)) {
            entries[uid]={sourceTag:item.sourceTag};
            for(const [name,value] of Object.entries(item.fields))
                entries[uid][name]='translated '+value;
        }
        return JSON.stringify({entries});
    };
    let save = async () => { events.push('save'); };
    let debounceCalls = 0, backupCalls = 0;
    const context = vm.createContext({
        uiText, uiHtml,
        console: { warn() {} }, clearTimeout, document: dom.window.document, AbortController,
        toastr: { info: message => events.push(['toast',message]) },
        state: { sourceTimers: new Map(), translationTimers: new Map(), bulkTranslation: null },
        Popup: { show: { confirm: (...args) => { events.push(args); return confirm(); } } },
        POPUP_RESULT: { AFFIRMATIVE: 1, CANCELLED: null },
        entryBulkEditor: { isCurrentSelection: () => current, prune: () => events.push('prune') },
        loadWorldInfo: async () => data, currentBookName: () => book, getSettings: () => settings,
        saveWorldInfo: (...args) => save(...args),
        deleteWIOriginalDataValue: (data, uid) => { data.originalData.entries = data.originalData.entries.filter(e => String(e.uid) !== uid); },
        saveSettingsDebounced: () => { debounceCalls++; }, saveSettings: async () => {},
        // Browser persistence uses per-book verified files now, rather than
        // serializing the full settings.json after each translation.
        translationFiles: {
            ensureBook: async () => {},
            assertBookReady: () => {},
            flushBook: async () => { events.push('file-flush'); },
            isBookReady: () => true,
            hintFor: () => '',
        },
        saveBookTranslations: () => { debounceCalls++; },
        translationFallbackLookup: {
            find: (records, uid, hash, language) => Object.values(records).find(record =>
                record && String(record.uid) === String(uid) &&
                record.sourceHash === hash && record.language === language) ?? null,
            invalidate() {},
        },
        renderedEntries: () => rows, getUid: row => row.dataset.uid,
        worldInfoFilter: { onDataChanged: () => events.push('redraw') }, renderTokenSummary() {},
        notify: (...args) => events.push(args), updateBulkTranslationStatus() {},
        translationKey: key, canTranslate: () => true, entryLanguageBadge: language => language,
        planLoreEntryGroups: groupModule?.planLoreEntryGroups || (items=>items.map(item=>[item])),
        translateLoreEntryGroup: groupModule?.translateLoreEntryGroup || (()=>{throw Error('group transport not configured')}),
        requestWithProfile:async prompt=>{groupRequests.push(prompt);return groupResponse(prompt)},
        jQuery: makeJQuery(dom.window), setTimeout, getComputedStyle: dom.window.getComputedStyle.bind(dom.window),
        entryData: uid => data.entries[uid],
        updateNavigatorEntry() {}, scheduleSourceTranslation() {},
        metadataAppearanceTargets: new Map(), metadataAppearanceObserver: null,
        scheduleAutomaticLorebookBackup() { backupCalls++; },
        hashText: text => text, normalizeEntryLanguage: value => value,
        oppositeEntryLanguage: () => 'ko', ENTRY_LANGUAGE_ENGLISH: 'en',
        createElement: (tag, className, text) => { const el = dom.window.document.createElement(tag); el.className = className; el.textContent = text || ''; return el; },
        getEntryLanguagePair: () => ({ sourceLanguage: 'en', translationLanguage: 'ko' }),
        translateText: async (source, language) => { requests.push([source, language]); return translate(source); },

    });
    vm.runInContext(['mapLimit', 'throwIfTranslationCancelled', 'awaitCancelableTranslation', 'cancelBulkTranslation', 'deleteSelectedEntries', 'translateCurrentLorebook', 'translateMultipleLorebooks', 'translateLoreFieldsForEntry', 'translateEntryCombinedFields', 'lorebookEntries', 'hasEntryTranslation', 'syncSourceVisibility', 'selectedTranslationFields', 'getEntryTranslationSources', 'currentMetadataTranslation', 'saveMetadataTranslations', 'syncMetadataTranslations', 'syncMetadataFieldAppearance', 'unobserveMetadataAppearance', 'pruneMetadataAppearanceObservers', 'hasSamePersistedTranslationPayload', 'saveTranslationRecord', 'findTranslationRecord', 'saveEntryLanguagePair', 'markTranslationSynced', 'translateEntrySource', 'translateEntryBodySource', 'setEntryBusy'].map(fn).join('\n'), context);
    function ui(uid) {
        const row = dom.window.document.createElement('div'); row.dataset.uid = String(uid);
        row.innerHTML = '<div class="world_entry_edit"><div class="slb-content-grid"><div class="slb-source-pane"><textarea></textarea></div><textarea class="translation"></textarea></div></div>';
        dom.window.document.getElementById('rows').append(row); rows.push(row);
        const edit = row.querySelector('.world_entry_edit');
        const result = { entry: row, book: 'A', uid: String(uid), root: edit, source: row.querySelector('textarea'), translation: row.querySelector('.translation'), flags: {}, status: {}, sourceLanguage: 'en', translationLanguage: 'ko' };
        result.translationPane = result.translation.parentElement;
        result.source.value = data.entries[uid].content; edit.slbTranslationUI = result; return result;
    }
    return { context, data, settings, events, requests, groupRequests, ui, selection: { book: 'A', uids: ['0', '2', '3'] },
        groupResponse: handler=>{groupResponse=handler},
        confirm: handler => { confirm = handler; }, translate: handler => { translate = handler; },
        save: handler => { save = handler; }, invalidate: () => { current = false; }, switchBook: (next = 'B') => { book = next; },
        counters: () => ({ debounceCalls, backupCalls }),
        close: () => dom.window.close() };
}

test('delete requires explicit confirmation and aborts if selection changes during confirmation', async () => {
    for (const result of [null, 0, 1]) {
        const f = fixture();
        try {
            f.confirm(async () => { if (result === 1) f.invalidate(); return result; });
            await f.context.deleteSelectedEntries(f.selection);
            assert.equal(Object.keys(f.data.entries).length, 4);
            assert.equal(f.events.includes('save'), false);
            assert.equal(f.events[0][2].okButton, '삭제');
            assert.equal(f.events[0][2].cancelButton, '취소');
        } finally { f.close(); }
    }
});

test('confirmed delete removes only selected UIDs and export records, saves once and removes their translations', async () => {
    const f = fixture();
    try {
        for (const uid of [0, 1, 2, 3]) { f.settings.translations[key('A', uid)] = { text: 'old' }; f.settings.entryLanguagePairs[key('A', uid)] = {}; }
        const ui = f.ui(0);
        await f.context.deleteSelectedEntries(f.selection);
        assert.deepEqual(Object.keys(f.data.entries), ['1']);
        assert.deepEqual(f.data.originalData.entries.map(e => e.uid), [1]);
        assert.deepEqual(Object.keys(f.settings.translations), ['A:1']);
        assert.deepEqual(Object.keys(f.settings.entryLanguagePairs), ['A:1']);
        assert.equal(f.events.filter(e => e === 'save').length, 1);
        assert.equal(ui.flags.deleted, true);
        assert.ok(f.events.includes('redraw'));
    } finally { f.close(); }
});

test('failed delete save restores entries and original export data without erasing translations', async () => {
    const f = fixture();
    try {
        const before = JSON.stringify(f.data);
        const ui = f.ui(0);
        f.settings.translations['A:0'] = { text: 'keep' };
        f.save(async () => { throw new Error('offline'); });
        await assert.rejects(f.context.deleteSelectedEntries(f.selection), /offline/);
        assert.equal(JSON.stringify(f.data), before);
        assert.equal(ui.flags.deleted, false);
        assert.equal(f.settings.translations['A:0'].text, 'keep');
    } finally { f.close(); }
});

test('selected translation runs concurrently, includes off-page entries, and continues after an item fails', async () => {
    const f = fixture();
    try {
        const ui = f.ui(0); let finish;
        f.translate(source => source === 'source 0' ? new Promise(resolve => { finish = resolve; }) : source === 'source 2' ? Promise.reject(new Error('API')) : 'third');
        const pending = f.context.translateCurrentLorebook('selected', f.selection);
        await flush();
        assert.equal(f.requests.length, 3);
        assert.equal(f.settings.translations['A:3'].text, 'third', 'later item finishes before the slow first item');
        finish('first'); await pending;
        assert.deepEqual(f.requests.map(r => r[0]), ['source 0', 'source 2', 'source 3']);
        assert.equal(ui.translation.value, 'first');
        assert.equal(f.settings.translations['A:3'].text, 'third');
        assert.equal(f.settings.translations['A:1'], undefined);
        assert.equal(f.context.state.bulkTranslation, null);
    } finally { f.close(); }
});

test('translation cannot overwrite intervening edits, deleted entries or a different book', async () => {
    for (const action of ['source', 'translation', 'delete', 'book', 'cancel']) {
        const f = fixture();
        try {
            const ui = f.ui(0); let finish;
            f.translate(() => new Promise(resolve => { finish = resolve; }));
            const pending = f.context.translateCurrentLorebook('selected', { book: 'A', uids: ['0'] });
            await flush();
            if (action === 'source') ui.source.value = 'edited';
            if (action === 'translation') ui.translation.value = 'edited translation';
            if (action === 'delete') delete f.data.entries[0];
            if (action === 'book') f.switchBook();
            if (action === 'cancel') await f.context.translateCurrentLorebook('selected', f.selection);
            finish('stale'); await pending;
            assert.equal(f.settings.translations['A:0'], undefined, action);
            assert.notEqual(ui.translation.value, 'stale', action);
        } finally { f.close(); }
    }
});

test('source visibility follows actual translation content and toggle without changing the source', () => {
    const f = fixture();
    try {
        const ui = f.ui(0), pane = ui.source.parentElement, grid = pane.parentElement;
        const sync = () => f.context.syncSourceVisibility(ui);
        sync(); assert.equal(pane.classList.contains('slb-source-hidden'), false);
        ui.translation.value = '번역본'; sync();
        assert.equal(pane.classList.contains('slb-source-hidden'), true);
        assert.equal(grid.classList.contains('slb-translation-only'), true);
        f.settings.hideOriginalWhenTranslated = false; sync();
        assert.equal(pane.classList.contains('slb-source-hidden'), false);
        f.settings.hideOriginalWhenTranslated = true; ui.translation.value = '  \n '; sync();
        assert.equal(pane.classList.contains('slb-source-hidden'), false);
        assert.equal(ui.source.value, 'source 0');
    } finally { f.close(); }
});


test('three workers refill immediately and out-of-order results reach their own translation fields', async () => {
    const f = fixture();
    try {
        for (const uid of [4, 5]) f.data.entries[uid] = { uid, content: `source ${uid}` };
        const uis = [0, 2, 3, 4, 5].map(uid => f.ui(uid));
        const finish = new Map(); let active = 0, peak = 0;
        f.translate(source => {
            active++; peak = Math.max(peak, active);
            return new Promise(resolve => finish.set(source, text => { active--; resolve(text); }));
        });
        const pending = f.context.translateCurrentLorebook('selected', { book: 'A', uids: ['0', '2', '3', '4', '5'] });
        await flush();
        assert.equal(active, 3); assert.equal(f.requests.length, 3);
        finish.get('source 2')('translation 2'); await flush();
        assert.equal(uis[1].translation.value, 'translation 2');
        assert.equal(uis[0].translation.value, '');
        assert.equal(f.requests.length, 4, 'next item starts without waiting for all three workers');
        finish.get('source 4')('translation 4'); await flush();
        assert.equal(f.requests.length, 5);
        for (const uid of [5, 3, 0]) { finish.get(`source ${uid}`)(`translation ${uid}`); await flush(); }
        await pending;
        assert.equal(peak, 3);
        for (const ui of uis) {
            assert.equal(ui.translation.value, `translation ${ui.uid}`);
            assert.equal(f.settings.translations[key('A', ui.uid)].text, `translation ${ui.uid}`);
        }
        assert.equal(f.settings.translations['A:1'], undefined);
    } finally { f.close(); }
});

test('cancel releases the button immediately without waiting for in-flight work; stale results are never saved', async () => {
    for (const cancel of ['button', 'book']) {
        const f = fixture();
        try {
            const finish = [];
            f.translate(() => new Promise(resolve => finish.push(resolve)));
            const pending = f.context.translateCurrentLorebook('selected', { book: 'A', uids: ['0', '1', '2', '3'] });
            await flush();
            assert.equal(f.requests.length,3);
            const active=f.context.state.bulkTranslation;
            assert.equal(active.abortController.signal.aborted,false);
            if(cancel==='book') {
                f.switchBook();
                f.context.cancelBulkTranslation({silent:true});
            } else {
                await f.context.translateCurrentLorebook('selected',f.selection);
            }
            assert.equal(f.context.state.bulkTranslation,null,'ready immediately');
            assert.equal(active.abortController.signal.aborted,true,'in-flight requests signaled');
            assert.equal(f.requests.length,3,'no new requests are launched');
            if(cancel==='button') {
                assert.equal(f.events.filter(x=>Array.isArray(x)&&x[0]==='toast').length,1);
                assert.match(f.events.find(x=>Array.isArray(x)&&x[0]==='toast')[1],/번역이 취소되었습니다/);
            }
            await pending; // must finish without waiting for the remote request
            assert.deepEqual(Object.keys(f.settings.translations),[]);
            finish.forEach(resolve=>resolve('late stale response'));
            await flush();
            assert.deepEqual(Object.keys(f.settings.translations),[],'late results discarded');
        }finally{f.close();}
    }
});

test('an immediate retry can translate while a canceled provider request is still unresolved', async()=>{
    const f=fixture();
    try{
        let releaseOld;
        let calls=0;
        f.translate(source=>{
            calls++;
            if(calls===1)return new Promise(resolve=>{releaseOld=resolve;});
            return 'new valid translation';
        });
        const first=f.context.translateCurrentLorebook('selected',{book:'A',uids:['0']});
        await flush();
        assert.equal(f.requests.length,1);
        const before=f.context.state.bulkTranslation;
        assert.ok(before);
        const cancelled=f.context.cancelBulkTranslation();
        assert.equal(cancelled,true);
        assert.equal(f.context.state.bulkTranslation,null);
        assert.equal(before.abortController.signal.aborted,true);
        const second=f.context.translateCurrentLorebook('selected',{book:'A',uids:['0']});
        await second;
        assert.equal(f.requests.length,2,'new work starts without waiting for first provider');
        assert.equal(f.settings.translations['A:0'].text,'new valid translation');
        releaseOld('old stale translation');
        await first;
        assert.equal(f.settings.translations['A:0'].text,'new valid translation','late result cannot overwrite retry');
        assert.equal(f.context.state.bulkTranslation,null,'old job never changes new ownership');
        assert.equal(f.events.filter(e=>Array.isArray(e)&&e[0]==='toast').length,1);
    }finally{f.close();}
});

test('cancel during lorebook loading prevents API requests and immediately releases the button', async()=>{
    const f=fixture();
    try{
        let finishLoad;
        f.context.loadWorldInfo=()=>new Promise(resolve=>{finishLoad=resolve;});
        const old=f.context.translateCurrentLorebook('selected',f.selection);
        await flush();
        const job=f.context.state.bulkTranslation;
        assert.ok(job);
        f.context.cancelBulkTranslation();
        assert.equal(f.context.state.bulkTranslation,null);
        assert.equal(job.abortController.signal.aborted,true);
        finishLoad(f.data);
        await old;
        assert.equal(f.requests.length,0);
        assert.equal(f.settings.translations['A:0'],undefined);
    }finally{f.close();}
});

test('Google translation keeps one active request', async () => {
    const f = fixture();
    try {
        f.settings.translationProvider = 'google';
        const finish = [];
        f.translate(() => new Promise(resolve => finish.push(resolve)));
        const pending = f.context.translateCurrentLorebook('selected', f.selection);
        await flush(); assert.equal(f.requests.length, 1);
        finish[0]('first'); await flush(); assert.equal(f.requests.length, 2);
        finish[1]('second'); await flush(); assert.equal(f.requests.length, 3);
        finish[2]('third'); await pending;
        assert.equal(f.context.state.bulkTranslation, null);
    } finally { f.close(); }
});

test('all eight target combinations request only selected fields and preserve native lorebook values', async () => {
    for (let mask = 0; mask < 8; mask++) {
        const f = fixture();
        try {
            Object.assign(f.settings, { translateContent: !!(mask & 1), translateTitle: !!(mask & 2), translateKeywords: !!(mask & 4) });
            Object.assign(f.data.entries[0], { comment: 'The Estate', key: ['estate', 'Bennett'], keysecondary: ['home'] });
            const before = JSON.stringify(f.data);
            await f.context.translateCurrentLorebook('selected', { book: 'A', uids: ['0'] });
            const wanted = [...(mask & 1 ? ['source 0'] : []), ...(mask & 2 ? ['The Estate'] : []), ...(mask & 4 ? ['estate, Bennett', 'home'] : [])];
            assert.deepEqual(f.requests.map(r => r[0]), wanted, `mask ${mask}`);
            assert.equal(JSON.stringify(f.data), before);
            const saved = f.settings.translations['A:0'];
            if (mask & 2) assert.equal(saved.fields.comment.text, 'translated The Estate');
            if (mask & 4) assert.equal(saved.fields.keysecondary.text, 'translated home');
            if (mask && !(mask & 1)) assert.equal(saved.text, '', 'metadata-only must not fabricate a body translation');
        } finally { f.close(); }
    }
});

test('metadata-only translation includes empty body entries and retains the prior body and sync baseline', async () => {
    const f = fixture();
    try {
        f.settings.translateContent = false; f.settings.translateTitle = true;
        f.data.entries[0].content = ''; f.data.entries[0].comment = 'A title';
        const original = { language: 'ko', text: '기존 번역', sourceHash: 'old', syncedText: '기존 번역', syncedSourceText: 'old', syncedSourceHash: 'old' };
        f.settings.translations['A:0'] = original;
        await f.context.translateCurrentLorebook('selected', { book: 'A', uids: ['0'] });
        assert.deepEqual(f.requests.map(r => r[0]), ['A title']);
        for (const field of Object.keys(original)) assert.equal(f.settings.translations['A:0'][field], original[field]);
        f.settings.translateContent = true; f.settings.translateTitle = false; f.data.entries[0].content = 'New content';
        await f.context.translateCurrentLorebook('selected', { book: 'A', uids: ['0'] });
        assert.equal(f.settings.translations['A:0'].text, 'translated New content');
        assert.equal(f.settings.translations['A:0'].fields.comment.text, 'translated A title');
    } finally { f.close(); }
});

test('missing mode fills missing metadata without overwriting an existing body translation', async () => {
    const f = fixture();
    try {
        f.settings.translateTitle = true; f.settings.translateKeywords = true;
        f.data.entries[0].comment = 'The Estate'; f.data.entries[0].key = ['estate'];
        f.settings.translations['A:0'] = { uid: '0', language: 'ko', text: '내가 고친 본문', sourceHash: 'source 0', fields: { comment: { source: 'The Estate', text: '저택' } } };
        await f.context.translateCurrentLorebook('missing', { book: 'A', uids: ['0'] });
        assert.deepEqual(f.requests.map(r => r[0]), ['estate']);
        assert.equal(f.settings.translations['A:0'].text, '내가 고친 본문');
        assert.equal(f.settings.translations['A:0'].fields.comment.text, '저택');
        await f.context.translateCurrentLorebook('missing', { book: 'A', uids: ['0'] });
        assert.equal(f.requests.length, 1, 'no repeated requests after filling missing fields');
    } finally { f.close(); }
});

test('metadata edited during a request is not replaced with stale translation', async () => {
    for (const field of ['comment', 'key', 'keysecondary']) {
        const f = fixture();
        try {
            f.settings.translateContent = false;
            f.settings.translateTitle = field === 'comment'; f.settings.translateKeywords = field !== 'comment';
            f.data.entries[0][field] = field === 'comment' ? 'before' : ['before'];
            let finish; f.translate(() => new Promise(resolve => { finish = resolve; }));
            const pending = f.context.translateCurrentLorebook('selected', { book: 'A', uids: ['0'] });
            await flush(); f.data.entries[0][field] = field === 'comment' ? 'after' : ['after'];
            finish('stale'); await pending;
            assert.equal(f.settings.translations['A:0'], undefined);
        } finally { f.close(); }
    }
});

test('metadata UI keeps originals hidden on click, safely renders text, and preserves source handlers', () => {
    const f = fixture();
    try {
        const ui = f.ui(0), row = ui.entry;
        row.insertAdjacentHTML('afterbegin', '<div class="slb-title-field"><textarea name="comment">The Estate</textarea></div><div class="slb-keyword-core-field"><textarea name="key">estate, Bennett</textarea></div><div class="slb-keyword-core-field"><textarea name="keysecondary">home</textarea></div>');
        f.settings.translations['A:0'] = { language: 'ko', text: '본문', fields: {
            comment: { source: 'The Estate', text: '<img src=x onerror=alert(1)>저택' },
            key: { source: 'estate, Bennett', text: '저택, 베넷' },
        } };
        const source = row.querySelector('[name="comment"]'); let changes = 0;
        source.addEventListener('input', () => changes++);
        const sync = () => f.context.syncMetadataTranslations(row);
        sync(); sync();
        assert.equal(row.querySelectorAll('.slb-field-translation').length, 2);
        assert.equal(row.classList.contains('slb-has-title-translation'), true);
        assert.equal(source.parentElement.classList.contains('slb-has-field-translation'), true);
        assert.equal(row.querySelectorAll('textarea.slb-field-translation.text_pole:not([readonly])').length, 2);
        assert.equal(row.querySelector('img'), null, 'translation is text, never HTML');
        assert.equal(source.value, 'The Estate');
        assert.equal(source.parentElement.classList.contains('slb-field-original-hidden'), true);
        assert.equal(row.querySelector('[name="keysecondary"]').parentElement.classList.contains('slb-field-original-hidden'), false);
        row.querySelector('.slb-field-translation').click();
        assert.equal(source.parentElement.classList.contains('slb-field-editing'), false);
        assert.notEqual(source.ownerDocument.activeElement, source);
        assert.equal(source.parentElement.classList.contains('slb-field-original-hidden'), true);
        source.value = 'Changed title'; source.dispatchEvent(new source.ownerDocument.defaultView.Event('input', { bubbles: true }));
        assert.equal(changes, 1);
        assert.equal(row.classList.contains('slb-has-title-translation'), false);
        assert.equal(source.parentElement.classList.contains('slb-has-field-translation'), false);
        assert.equal(source.parentElement.classList.contains('slb-field-original-hidden'), false, 'stale translation must not hide edited source');
        assert.equal(source.parentElement.querySelector('.slb-field-translation').hidden, true);
        f.settings.hideOriginalWhenTranslated = false; sync();
        assert.equal(row.querySelector('[name="key"]').parentElement.classList.contains('slb-field-original-hidden'), false);
        f.settings.hideOriginalWhenTranslated = true; ui.translationLanguage = 'en'; sync();
        assert.equal(row.querySelector('[name="key"]').parentElement.classList.contains('slb-field-original-hidden'), false, 'language direction is respected');
    } finally { f.close(); }
});

test('Select2 keywords use current selected values even when original controls are hidden', () => {
    const f = fixture();
    try {
        const ui = f.ui(0);
        ui.entry.insertAdjacentHTML('afterbegin', '<div class="slb-keyword-core-field"><textarea name="key" style="display:none">outdated</textarea><select name="key" multiple class="select2-hidden-accessible"><option selected>current</option><option selected>name</option></select><span class="select2-container"></span></div>');
        f.settings.translations['A:0'] = { language: 'ko', fields: { key: { source: 'current, name', text: '현재, 이름' } } };
        f.context.syncMetadataTranslations(ui.entry);
        assert.equal(f.context.getEntryTranslationSources(f.data.entries[0], ui).key, 'current, name');
        const select = ui.entry.querySelector('select');
        select.options[0].selected = false;
        f.context.jQuery(select).trigger('change');
        assert.equal(select.parentElement.classList.contains('slb-field-original-hidden'), false);
    } finally { f.close(); }
});

test('single entry translation obeys targets, saves metadata and keeps native fields intact', async () => {
    const f = fixture();
    try {
        const ui = f.ui(0);
        ui.entry.insertAdjacentHTML('afterbegin', '<div class="slb-title-field"><textarea name="comment">The Estate</textarea></div>');
        f.settings.translateTitle = true; f.settings.translateKeywords = true;
        f.data.entries[0].key = ['estate']; f.data.entries[0].keysecondary = ['home'];
        const before = JSON.stringify(f.data);
        await f.context.translateEntrySource(ui, true);
        assert.deepEqual(f.requests.map(r => r[0]), ['source 0', 'The Estate', 'estate', 'home']);
        assert.equal(ui.translation.value, 'translated source 0');
        assert.equal(ui.entry.querySelector('.slb-field-translation').value, 'translated The Estate');
        assert.equal(ui.entry.querySelector('[name="comment"]').value, 'The Estate');
        assert.equal(JSON.stringify(f.data), before);
        assert.equal(ui.flags.translating, false);
        f.settings.translateContent = false;
        ui.translation.value = '수정한 본문'; f.requests.length = 0;
        await f.context.translateEntrySource(ui, true);
        assert.equal(ui.translation.value, '수정한 본문');
        assert.deepEqual(f.requests.map(r => r[0]), ['The Estate', 'estate', 'home']);
    } finally { f.close(); }
});

test('automatic missing translation fills a newly enabled title without retranslating a current body', async () => {
    const f = fixture();
    try {
        const ui = f.ui(0);
        ui.entry.insertAdjacentHTML('afterbegin', '<div class="slb-title-field"><textarea name="comment">The Estate</textarea></div>');
        f.settings.translateTitle = true;
        ui.translation.value = '기존 본문';
        f.settings.translations['A:0'] = { language: 'ko', text: '기존 본문', sourceHash: 'source 0' };
        await f.context.translateEntrySource(ui, true, true);
        assert.deepEqual(f.requests.map(r => r[0]), ['The Estate']);
        assert.equal(ui.translation.value, '기존 본문');
        assert.equal(f.settings.translations['A:0'].text, '기존 본문');
    } finally { f.close(); }
});

test('single metadata response is discarded when the original title changes during translation', async () => {
    const f = fixture();
    try {
        const ui = f.ui(0); f.settings.translateContent = false; f.settings.translateTitle = true;
        ui.entry.insertAdjacentHTML('afterbegin', '<div class="slb-title-field"><textarea name="comment">before</textarea></div>');
        let finish; f.translate(() => new Promise(resolve => { finish = resolve; }));
        const pending = f.context.translateEntrySource(ui, true);
        await flush(); ui.entry.querySelector('[name="comment"]').value = 'after';
        finish('stale'); await pending;
        assert.equal(f.settings.translations['A:0'], undefined);
        assert.equal(ui.flags.translating, false);
    } finally { f.close(); }
});

test('editable translation fields copy native theme metrics and follow source resize', () => {
    const f = fixture();
    try {
        const ui = f.ui(0);
        ui.entry.insertAdjacentHTML('afterbegin', '<div class="slb-title-field"><textarea name="comment" style="height:29px;box-sizing:border-box;padding:3px 5px;border:1px solid rgb(180,160,175);border-radius:5px;font-size:13px;line-height:normal">Title</textarea></div><div class="slb-keyword-core-field"><textarea name="key" rows="1" style="height:22px;box-sizing:border-box;padding:2px 4px;border:1px solid rgb(180,160,175);border-radius:4px;font-size:12px">key</textarea></div>');
        f.settings.hideOriginalWhenTranslated = false;
        f.settings.translations['A:0'] = { language: 'ko', fields: { comment: { source: 'Title', text: '제목' }, key: { source: 'key', text: '키워드' } } };
        f.context.syncMetadataTranslations(ui.entry);
        for (const name of ['comment', 'key']) {
            const source = ui.entry.querySelector(`[name="${name}"]`);
            const view = ui.entry.querySelector(`[data-field="${name}"]`);
            assert.equal(view.tagName, 'TEXTAREA'); assert.equal(view.readOnly, false); assert.equal(view.name, '');
            const style = f.context.getComputedStyle(source);
            // Title text grows with content; keyword inputs retain native metrics.
            assert.equal(view.style.getPropertyValue('height'),
                name === 'comment' ? '' : style.getPropertyValue('height'));
            for (const property of ['font-size', 'padding-top', 'padding-left', 'border-top-width', 'border-top-color']) {
                assert.equal(view.style.getPropertyValue(property), style.getPropertyValue(property), name + ': ' + property);
            }
            view.click();
            assert.equal(source.parentElement.classList.contains('slb-field-editing'), false, 'visible translations can be selected without jumping to the source');
        }
        const keyword = ui.entry.querySelector('[name="key"]');
        keyword.style.height = '75px'; f.context.syncMetadataTranslations(ui.entry);
        assert.equal(ui.entry.querySelector('[data-field="key"]').style.height, '75px');
        assert.equal(keyword.value, 'key');
    } finally { f.close(); }
});

test('source hiding is directly below translation targets and uses the mobile-display option styles', () => {
    const markup = code.slice(code.indexOf('function createAIBar()')).match(/bar.innerHTML = `([\s\S]*?)`;/)[1];
    const dom = new JSDOM(`<div id="slb-ai-tools">${markup}</div>`);
    try {
        const targets = dom.window.document.querySelector('.slb-translation-targets');
        const hide = dom.window.document.getElementById('slb-hide-translated-source');
        assert.equal(targets.nextElementSibling, hide.closest('.slb-translation-display-options'));
        assert.equal(hide.parentElement.classList.contains('checkbox_label'), false);
        assert.equal(hide.parentElement.parentElement.classList.contains('slb-mobile-display-options'), true);
        assert.equal(targets.querySelectorAll('.slb-mobile-display-options > label > input').length, 3);
    } finally { dom.window.close(); }
});


test('title and both keyword translations save edits independently without changing native values or calling translation', () => {
    const f = fixture();
    try {
        const ui = f.ui(0), row = ui.entry;
        row.insertAdjacentHTML('afterbegin', '<div class="slb-title-field"><textarea name="comment">Title</textarea></div><div class="slb-keyword-core-field"><textarea name="key">key</textarea></div><div class="slb-keyword-core-field"><textarea name="keysecondary">secondary</textarea></div>');
        f.settings.translations['A:0'] = { language: 'ko', text: '본문 보존', sourceHash: 'original-hash', fields: Object.fromEntries(['comment', 'key', 'keysecondary'].map(name => [name, { source: row.querySelector(`[name="${name}"]`).value, text: '번역' }])) };
        f.context.syncMetadataTranslations(row);
        for (const name of ['comment', 'key', 'keysecondary']) {
            const source = row.querySelector(`[name="${name}"]`), view = row.querySelector(`[data-field="${name}"]`);
            const original = source.value;
            view.focus(); view.click();
            view.value = `수정 ${name} `;
            view.dispatchEvent(new source.ownerDocument.defaultView.Event('input', { bubbles: true }));
            f.context.syncMetadataTranslations(row);
            assert.equal(view.value, `수정 ${name} `, 'focused value and caret must not be reset by trimmed display text');
            assert.equal(f.settings.translations['A:0'].fields[name].text, `수정 ${name} `);
            assert.equal(source.value, original);
            assert.equal(source.parentElement.classList.contains('slb-field-original-hidden'), true);
            assert.equal(source.parentElement.classList.contains('slb-field-editing'), false);
            view.blur(); view.remove();
            f.context.syncMetadataTranslations(row);
            assert.equal(row.querySelector(`[data-field="${name}"]`).value, `수정 ${name}`, 'saved edit survives recreated UI');
        }
        assert.equal(f.settings.translations['A:0'].text, '본문 보존');
        assert.equal(f.settings.translations['A:0'].sourceHash, 'original-hash');
        assert.equal(f.requests.length, 0);
    } finally { f.close(); }
});

test('temporarily empty focused translation stays editable and never reveals its source', () => {
    const f = fixture();
    try {
        const ui = f.ui(0);
        ui.entry.insertAdjacentHTML('afterbegin', '<div class="slb-title-field"><textarea name="comment">Title</textarea></div>');
        f.settings.translations['A:0'] = { language: 'ko', fields: { comment: { source: 'Title', text: '제목' } } };
        f.context.syncMetadataTranslations(ui.entry);
        const view = ui.entry.querySelector('[data-field="comment"]');
        view.focus(); view.value = '';
        view.dispatchEvent(new view.ownerDocument.defaultView.Event('input', { bubbles: true }));
        f.context.syncMetadataTranslations(ui.entry);
        assert.equal(view.hidden, false);
        assert.equal(view.parentElement.classList.contains('slb-field-original-hidden'), true);
        view.value = '새 제목';
        view.dispatchEvent(new view.ownerDocument.defaultView.Event('input', { bubbles: true }));
        f.switchBook(); view.value = '다른 책에서 온 이벤트';
        view.dispatchEvent(new view.ownerDocument.defaultView.Event('input', { bubbles: true }));
        assert.equal(f.settings.translations['A:0'].fields.comment.text, '새 제목');
    } finally { f.close(); }
});

test('pending translation cannot overwrite a manual metadata edit', async () => {
    const f = fixture();
    try {
        const ui = f.ui(0);
        ui.entry.insertAdjacentHTML('afterbegin', '<div class="slb-title-field"><textarea name="comment">Title</textarea></div>');
        Object.assign(f.settings, { translateContent: false, translateTitle: true });
        f.settings.translations['A:0'] = { language: 'ko', fields: { comment: { source: 'Title', text: '제목' } } };
        f.context.syncMetadataTranslations(ui.entry);
        let finish; f.translate(() => new Promise(resolve => { finish = resolve; }));
        const pending = f.context.translateEntrySource(ui, true);
        await flush();
        const view = ui.entry.querySelector('[data-field="comment"]');
        view.value = '내가 수정한 제목';
        view.dispatchEvent(new view.ownerDocument.defaultView.Event('input', { bubbles: true }));
        finish('늦게 도착한 번역'); await pending;
        assert.equal(f.settings.translations['A:0'].fields.comment.text, '내가 수정한 제목');
    } finally { f.close(); }
});

test('unchanged metadata refresh reuses native metrics, explicit responsive refresh remeasures', () => {
    const f = fixture();
    try {
        const ui = f.ui(0);
        ui.entry.insertAdjacentHTML('afterbegin', '<div class="slb-title-field"><textarea name="comment" style="height:29px">Title</textarea></div>');
        f.settings.translations['A:0'] = { language: 'ko', fields: { comment: { source: 'Title', text: '제목' } } };
        let reads = 0; const original = f.context.getComputedStyle;
        f.context.getComputedStyle = element => { reads++; return original(element); };
        f.context.syncMetadataTranslations(ui.entry);
        assert.equal(reads, 1);
        for (let i = 0; i < 100; i++) f.context.syncMetadataTranslations(ui.entry);
        assert.equal(reads, 1, 'ordinary refreshes should not repeat layout/style reads');
        f.context.syncMetadataTranslations(ui.entry, { refreshAppearance: true });
        assert.equal(reads, 2);
    } finally { f.close(); }
});

test('title update skips scanning all entries when navigation UI is absent', () => {
    const dom = new JSDOM('<div></div>');
    try {
        let scans = 0;
        const context = vm.createContext({ document: dom.window.document, renderedEntries: () => { scans++; return []; } });
        vm.runInContext(fn('updateNavigatorEntry'), context);
        for (let i = 0; i < 500; i++) context.updateNavigatorEntry(String(i));
        assert.equal(scans, 0);
    } finally { dom.window.close(); }
});


test('native resize observer refreshes cached translation dimensions', () => {
    const f = fixture();
    try {
        let resized;
        f.context.ResizeObserver = class { constructor(callback) { resized = callback; } observe() {} unobserve() {} disconnect() {} };
        const ui = f.ui(0);
        ui.entry.insertAdjacentHTML('afterbegin', '<div class="slb-keyword-core-field"><textarea name="key">key</textarea></div>');
        f.settings.translations['A:0'] = { language: 'ko', fields: { key: { source: 'key', text: '키워드' } } };
        const source = ui.entry.querySelector('[name="key"]');
        let height = 29;
        source.getBoundingClientRect = () => ({ height });
        f.context.syncMetadataTranslations(ui.entry);
        const view = ui.entry.querySelector('[data-field="key"]');
        assert.equal(view.style.height, '29px');
        height = 64; resized([{target: source}]);
        assert.equal(view.style.height, '64px');
    } finally { f.close(); }
});


test('translated titles never mirror pixel heights or subscribe to resize observers', () => {
    const f = fixture();
    try {
        let observers = 0, measurements = 0;
        f.context.ResizeObserver = class {
            constructor() { observers++; }
            observe() {}
            disconnect() {}
        };
        const ui = f.ui(0);
        ui.entry.insertAdjacentHTML('afterbegin', '<div class="slb-title-field"><textarea name="comment">Long title wrapping on several lines</textarea></div>');
        const source = ui.entry.querySelector('[name="comment"]');
        source.getBoundingClientRect = () => { measurements++; return { height: 29 }; };
        f.settings.translations['A:0'] = { language:'ko', fields: { comment: { source:source.value, text:'길고 긴 번역 제목' } } };
        f.context.syncMetadataTranslations(ui.entry);
        f.context.syncMetadataTranslations(ui.entry, { refreshAppearance:true });
        const view = ui.entry.querySelector('[data-field="comment"]');
        assert.equal(view.style.getPropertyValue('height'), '');
        assert.equal(view.style.getPropertyValue('min-height'), '');
        assert.equal(view.style.getPropertyValue('max-height'), '');
        assert.equal(observers, 0);
        assert.equal(measurements, 0);
        assert.equal(source.value, 'Long title wrapping on several lines');
        assert.equal(view.value, '길고 긴 번역 제목');
    } finally { f.close(); }
});

test('identical body translations do not reschedule full settings saves or backups', () => {
    const f=fixture();
    try {
        const options={markSynced:true,sourceLanguage:'en',translationLanguage:'ko'};
        f.context.saveTranslationRecord('A',0,'Original paragraph','Translated paragraph',options);
        const first=f.settings.translations['A:0'];
        assert.equal(first.text,'Translated paragraph');
        assert.deepEqual(f.counters(),{debounceCalls:1,backupCalls:1});
        f.context.saveTranslationRecord('A',0,'Original paragraph','Translated paragraph',options);
        assert.equal(f.settings.translations['A:0'],first,'exact record remains stable');
        assert.deepEqual(f.counters(),{debounceCalls:1,backupCalls:1});
        assert.equal(f.settings.translations['A:0'].syncedSourceText,'Original paragraph');
        f.context.saveTranslationRecord('A',0,'Original paragraph','Changed translation',options);
        assert.notEqual(f.settings.translations['A:0'],first);
        assert.deepEqual(f.counters(),{debounceCalls:2,backupCalls:2});
        assert.equal(f.settings.translations['A:0'].text,'Changed translation');
    } finally { f.close(); }
});

test('identical metadata translations preserve the record and avoid full settings saves', () => {
    const f=fixture();
    try {
        const pair={sourceLanguage:'en',translationLanguage:'ko'};
        const sources={comment:'Original Title',key:'Some Keyword',keysecondary:'Other'};
        const results={comment:'번역 제목',key:'번역 키워드'};
        f.context.saveMetadataTranslations('A',0,pair,sources,results);
        const first=f.settings.translations['A:0'];
        assert.equal(first.fields.comment.text,'번역 제목');
        assert.deepEqual(f.counters(),{debounceCalls:1,backupCalls:1});
        f.context.saveMetadataTranslations('A',0,pair,sources,results);
        assert.equal(f.settings.translations['A:0'],first);
        assert.deepEqual(f.counters(),{debounceCalls:1,backupCalls:1});
        f.context.saveMetadataTranslations('A',0,pair,sources,{comment:'수정된 제목'});
        assert.equal(f.settings.translations['A:0'].fields.comment.text,'수정된 제목');
        assert.equal(f.settings.translations['A:0'].fields.key.text,'번역 키워드');
        assert.deepEqual(f.counters(),{debounceCalls:2,backupCalls:2});
    } finally { f.close(); }
});

test('unsynced and synced translation baselines remain distinct despite no-op detection', () => {
    const f=fixture();
    try {
        const opt={markSynced:true,sourceLanguage:'en',translationLanguage:'ko'};
        f.context.saveTranslationRecord('A',0,'Source','Korean',opt);
        const synced=f.settings.translations['A:0'];
        f.context.saveTranslationRecord('A',0,'Source','Korean',{
            baseline:{text:'',sourceHash:'',sourceText:'Source'},
            sourceLanguage:'en',translationLanguage:'ko',
        });
        const unsynced=f.settings.translations['A:0'];
        assert.notEqual(unsynced,synced,'sync state was persisted');
        assert.equal(unsynced.syncedText,'');
        assert.equal(unsynced.syncedSourceHash,'');
        assert.deepEqual(f.counters(),{debounceCalls:2,backupCalls:2});
    } finally { f.close(); }
});


test('reselecting an unchanged language direction never queues another full settings save', () => {
    const f=fixture();
    try {
        assert.equal(f.counters().debounceCalls,0);
        f.context.saveEntryLanguagePair('A',0,'en','ko');
        assert.equal(f.settings.entryLanguagePairs['A:0'].sourceLanguage,'en');
        assert.equal(f.settings.entryLanguagePairs['A:0'].translationLanguage,'ko');
        assert.equal(f.counters().debounceCalls,1);
        f.context.saveEntryLanguagePair('A',0,'en','ko');
        assert.equal(f.counters().debounceCalls,1,'same direction should not re-save');
        f.context.saveEntryLanguagePair('A',0,'ko','en');
        assert.equal(f.settings.entryLanguagePairs['A:0'].sourceLanguage,'ko');
        assert.equal(f.settings.entryLanguagePairs['A:0'].translationLanguage,'en');
        assert.equal(f.counters().debounceCalls,2);
    } finally {f.close();}
});

test('independently chosen lorebook continues translating after switching to a different displayed book', async () => {
    const f=fixture();
    try {
        const openUI=f.ui(0);
        let release;
        const gate=new Promise(resolve=>{release=resolve});
        let first=true;
        f.translate(async src=>{
            if(first){first=false;await gate;}
            return 'translated '+src;
        });
        const running=f.context.translateCurrentLorebook('all',null,'A');
        await flush();
        f.switchBook();
        release();
        await running;
        assert.equal(f.settings.translations['A:0'].text,'translated source 0');
        assert.equal(f.settings.translations['A:1'].text,'translated source 1');
        assert.equal(f.settings.translations['A:2'].text,'translated source 2');
        assert.equal(f.settings.translations['A:3'].text,'translated source 3');
        assert.equal(openUI.translation.value,'','stale editor not written after switching books');
        assert.equal(f.settings.translations['B:0'],undefined,'other book with same UID untouched');
        assert.equal(f.context.state.bulkTranslation,null,'work completed without cancellation');
    } finally{f.close();}
});

test('missing-only translation uses the chosen off-screen lorebook records, never the current displayed rows', async () => {
    const f=fixture();
    try{
        f.ui(0).translation.value='Visible UI text from book B';
        f.switchBook();
        f.settings.translations['A:0']={
            uid:'0',book:'A',sourceHash:'source 0',sourceText:'source 0',
            language:'ko',text:'existing saved translation',
        };
        await f.context.translateCurrentLorebook('missing',null,'A');
        assert.equal(f.settings.translations['A:0'].text,'existing saved translation');
        assert.equal(f.requests.length,3);
        assert.equal(f.settings.translations['B:0'],undefined);
    }finally{f.close();}
});

test('profile bulk translation sends body, title and both keyword fields in one request',async()=>{
 const {translateLoreFieldsBatch}=await import(require('node:url').pathToFileURL(require('node:path').join(__dirname,'../lore-translation-batch.js')).href);
 const f=fixture();
 try{
  f.settings.translationProvider='profile';
  f.settings.translateContent=true;
  f.settings.translateTitle=true;
  f.settings.translateKeywords=true;
  f.settings.translationPrompt='Use established names.';
  f.context.translateLoreFieldsBatch=translateLoreFieldsBatch;
  const entry=f.data.entries[0];
  entry.comment='057 - 1981/10/18 | The First Dance';
  entry.key=['Remus','Catherine'];entry.keysecondary=['Moony'];
  const original=JSON.stringify(f.data);
  const prompts=[];
  f.context.requestWithProfile=async prompt=>{
   prompts.push(prompt);
   assert.match(prompt,/Fields to return: content, comment, key, keysecondary/);
   assert.match(prompt,/Use established names/);
   return JSON.stringify({
    content:'번역 source 0',
    comment:'057 - 1981/10/18 | 첫 춤',
    key:'리무스, 캐서린',
    keysecondary:'무니',
   });
  };
  await f.context.translateCurrentLorebook('selected',{book:'A',uids:['0']});
  assert.equal(prompts.length,1,'one paid model call for the entire entry');
  assert.equal(f.requests.length,0,'no separately billed field requests');
  assert.equal(f.settings.translations['A:0'].text,'번역 source 0');
  assert.equal(f.settings.translations['A:0'].fields.comment.text,'057 - 1981/10/18 | 첫 춤');
  assert.equal(f.settings.translations['A:0'].fields.key.text,'리무스, 캐서린');
  assert.equal(f.settings.translations['A:0'].fields.keysecondary.text,'무니');
  assert.equal(JSON.stringify(f.data),original,'actual lorebook fields remain intact');
 }finally{f.close();}
});

test('editor full translation batches body and title; keyword source values remain native',async()=>{
 const {translateLoreFieldsBatch}=await import(require('node:url').pathToFileURL(require('node:path').join(__dirname,'../lore-translation-batch.js')).href);
 const f=fixture();
 try{
  f.settings.translationProvider='profile';
  f.settings.translateContent=true;
  f.settings.translateTitle=true;
  f.settings.translateKeywords=true;
  f.context.translateLoreFieldsBatch=translateLoreFieldsBatch;
  const ui=f.ui(0);
  ui.entry.insertAdjacentHTML('afterbegin',
    '<div class="slb-title-field"><textarea name="comment">The First Meeting</textarea></div>'+
    '<div class="slb-keyword-core-field"><textarea name="key">Remus, Catherine</textarea></div>');
  f.data.entries[0].comment='The First Meeting';f.data.entries[0].key=['Remus','Catherine'];
  const prompts=[];
  f.context.requestWithProfile=async prompt=>{
   prompts.push(prompt);
   return JSON.stringify({
    content:'번역 source 0',
    comment:'첫 만남',
    key:'리무스, 캐서린',
   });
  };
  await f.context.translateEntrySource(ui,true,false);
  assert.equal(prompts.length,1);
  assert.equal(f.requests.length,0);
  assert.equal(ui.source.value,'source 0');
  assert.equal(ui.translation.value,'번역 source 0');
  assert.equal(ui.entry.querySelector('[name="comment"]').value,'The First Meeting');
  assert.equal(ui.entry.querySelector('[name="key"]').value,'Remus, Catherine');
  assert.equal(f.settings.translations['A:0'].fields.comment.text,'첫 만남');
  assert.equal(f.settings.translations['A:0'].fields.key.text,'리무스, 캐서린');
 }finally{f.close();}
});

test('batch translation skips saving if a title changes while a shared request is pending',async()=>{
 const {translateLoreFieldsBatch}=await import(require('node:url').pathToFileURL(require('node:path').join(__dirname,'../lore-translation-batch.js')).href);
 const f=fixture();
 try{
  f.settings.translationProvider='profile';
  f.settings.translateContent=true;
  f.settings.translateTitle=true;
  f.context.translateLoreFieldsBatch=translateLoreFieldsBatch;
  f.data.entries[0].comment='Before';
  let finish;
  f.context.requestWithProfile=async()=>new Promise(resolve=>{finish=resolve;});
  const task=f.context.translateCurrentLorebook('selected',{book:'A',uids:['0']});
  await flush();
  f.data.entries[0].comment='After';
  finish(JSON.stringify({content:'번역 source 0',comment:'번역 Before'}));
  await task;
  assert.equal(f.settings.translations['A:0'],undefined,'stale combined result never applied');
 }finally{f.close();}
});


test('multi-book translation processes each selected lorebook sequentially and persists only its own translations',async()=>{
    const f=fixture();
    try {
        const events=[];
        f.context.updateBulkTranslationStatus=message=>events.push(message);
        const result=await f.context.translateMultipleLorebooks(['A','B','A'],'all');
        assert.equal(result.booksCompleted,2,'duplicate book names do not duplicate paid requests');
        assert.equal(result.succeeded,8,'four entries across two books');
        assert.equal(result.failed,0);
        assert.equal(f.requests.length,8);
        assert.equal(f.context.state.bulkTranslation,null);
        for(const book of ['A','B'])for(const uid of ['0','1','2','3']){
            assert.equal(f.settings.translations[key(book,uid)].text,'translated source '+uid);
        }
        assert.equal(f.events.filter(item=>item==='file-flush').length,2,
            'one flushed file for each completed book');
        const completion=f.events.filter(item=>Array.isArray(item)&&item[0].includes('2개 로어북 번역 완료'));
        assert.equal(completion.length,1,'one notification, not one per book');
        assert.ok(events.some(message=>message?.includes('[1/2] A')));
        assert.ok(events.some(message=>message?.includes('[2/2] B')));
    }finally{f.close()}
});

test('multi-book missing mode preserves existing translations and reuses same-source cache across books',async()=>{
    const f=fixture();
    try {
        f.settings.translations[key('A','0')]={book:'A',uid:'0',sourceHash:'source 0',language:'ko',text:'내가 수정한 번역'};
        const result=await f.context.translateMultipleLorebooks(['A','B'],'missing');
        assert.equal(result.booksCompleted,2);
        assert.equal(f.settings.translations[key('A','0')].text,'내가 수정한 번역');
        assert.equal(f.settings.translations[key('B','0')].text,'내가 수정한 번역',
            'exact matching source reuses the valid cached translation rather than a paid request');
        assert.equal(f.requests.length,3,'second identical book reuses all matching results; only A missing entries invoke API');
        assert.equal(f.context.state.bulkTranslation,null);
    }finally{f.close()}
});

test('one cancel aborts the entire multi-book queue without starting the following books',async()=>{
    const f=fixture();
    try {
        const delayed=[];
        f.translate(()=>new Promise(resolve=>delayed.push(resolve)));
        const pending=f.context.translateMultipleLorebooks(['A','B','C'],'all');
        await flush();
        assert.ok(f.requests.length>=1,'book A has started');
        assert.equal(f.context.state.bulkTranslation?.book,'A');
        const cancelled=f.context.cancelBulkTranslation();
        assert.equal(cancelled,true);
        assert.equal(f.context.state.bulkTranslation,null,'cancel releases shared job immediately');
        await pending;
        assert.equal(Object.keys(f.settings.translations).length,0);
        const before=f.requests.length;
        delayed.forEach(resolve=>resolve('stale translated text'));
        await flush();
        assert.equal(f.requests.length,before,'no request starts for B or C');
        assert.equal(Object.keys(f.settings.translations).length,0,'late result discarded');
    }finally{f.close()}
});

test('an unavailable second book counts as a failure but does not erase the first book',async()=>{
    const f=fixture();
    try {
        const ensure=f.context.translationFiles.ensureBook;
        f.context.translationFiles.ensureBook=async book=>{
            if(book==='B')throw Error('book B file missing');
            return ensure(book);
        };
        const result=await f.context.translateMultipleLorebooks(['A','B','C'],'all');
        assert.equal(result.booksCompleted,3);
        assert.equal(result.failed,1);
        assert.equal(result.succeeded,8);
        assert.equal(f.settings.translations[key('A','0')].text,'translated source 0');
        assert.equal(f.settings.translations[key('B','0')],undefined);
        assert.equal(f.settings.translations[key('C','0')].text,'translated source 0');
        assert.equal(f.context.state.bulkTranslation,null);
    }finally{f.close()}
});

test('32 and 33 short lore entries use 11 total model requests with three-entry grouping',async()=>{
    const groupModule=await entryGroupImporter;
    for(const size of [32,33]){
        const f=fixture(groupModule);
        try {
            f.settings.translationProvider='profile';
            f.settings.aiOutputTokens=8192;
            f.data.entries=Object.fromEntries(Array.from({length:size},(_,uid)=>[
                String(uid),{uid,content:'Remus and Catherine entered room '+uid+'.'}]));
            const result=await f.context.translateCurrentLorebook('all',null,'A');
            assert.equal(result.succeeded,size);
            assert.equal(result.failed,0);
            assert.equal(f.groupRequests.length,11);
            assert.equal(f.requests.length,0,'both 32 and 33 end in a two-or-three entry group');
            assert.equal(f.groupRequests.length+f.requests.length,11);
            for(let uid=0;uid<size;uid++){
                const stored=f.settings.translations[key('A',uid)];
                assert.ok(stored?.text.includes('translated Remus and Catherine entered room '+uid+'.'),'UID '+uid);
            }
            assert.equal(f.context.state.bulkTranslation,null);
            assert.equal(f.events.filter(e=>e==='file-flush').length,Math.floor(size/5)+1,
                'existing every-five-saves checkpoints and final flush are preserved');
        } finally {f.close()}
    }
});

test('a failed field in a three-entry group retries only that field without overwriting the other entries',async()=>{
    const groupModule=await entryGroupImporter;
    const f=fixture(groupModule);
    try {
        f.settings.translationProvider='profile';
        const normal=async prompt=>{
            const data=JSON.parse(prompt.split('=== SOURCE ENTRY JSON ===\n')[1]);
            const entries={};
            for(const [uid,item] of Object.entries(data.entries)){
                entries[uid]={sourceTag:item.sourceTag};
                for(const [name,value] of Object.entries(item.fields))
                    entries[uid][name]='translated '+value;
            }
            return {entries};
        };
        f.groupResponse(async prompt=>{
            const result=await normal(prompt);
            delete result.entries['1'];
            return JSON.stringify(result);
        });
        const result=await f.context.translateCurrentLorebook('all',null,'A');
        assert.equal(result.succeeded,4);
        assert.equal(result.failed,0);
        assert.equal(f.groupRequests.length,1);
        assert.equal(f.requests.length,2,'one missing item recovery plus the fourth solo item');
        for(let uid=0;uid<4;uid++){
            assert.equal(f.settings.translations[key('A',uid)].text,'translated source '+uid);
        }
    }finally{f.close()}
});

test('a source edit while grouped model request is in flight does not save a stale translation to that UID',async()=>{
    const groupModule=await entryGroupImporter;
    const f=fixture(groupModule);
    try{
        f.settings.translationProvider='profile';
        let release;
        f.groupResponse(prompt=>new Promise(resolve=>{
            const data=JSON.parse(prompt.split('=== SOURCE ENTRY JSON ===\n')[1]);
            const entries={};
            for(const [uid,item] of Object.entries(data.entries)){
                entries[uid]={sourceTag:item.sourceTag};
                for(const [name,value] of Object.entries(item.fields))
                    entries[uid][name]='translated '+value;
            }
            release=()=>resolve(JSON.stringify({entries}));
        }));
        const pending=f.context.translateCurrentLorebook('all',null,'A');
        await flush();
        assert.equal(f.groupRequests.length,1);
        f.data.entries[0].content='changed by user while model runs';
        release();
        const outcome=await pending;
        assert.equal(outcome.skipped,1);
        assert.equal(outcome.succeeded,3);
        assert.equal(f.settings.translations['A:0'],undefined);
        for(const uid of [1,2,3])assert.equal(f.settings.translations[key('A',uid)].text,'translated source '+uid);
    }finally{f.close()}
});

test('canceling one three-item API request discards its late model reply and does not start next groups',async()=>{
    const groupModule=await entryGroupImporter;
    const f=fixture(groupModule);
    try{
        f.settings.translationProvider='profile';
        let release;
        f.groupResponse(prompt=>new Promise(resolve=>{
            const data=JSON.parse(prompt.split('=== SOURCE ENTRY JSON ===\n')[1]);
            const entries={};
            for(const [uid,item] of Object.entries(data.entries)){
                entries[uid]={sourceTag:item.sourceTag};
                for(const [name,value] of Object.entries(item.fields))entries[uid][name]='translated '+value;
            }
            release=()=>resolve(JSON.stringify({entries}));
        }));
        const pending=f.context.translateCurrentLorebook('all',null,'A');
        await flush();
        assert.equal(f.groupRequests.length,1);
        assert.equal(f.context.cancelBulkTranslation(),true);
        await pending;
        assert.equal(f.context.state.bulkTranslation,null);
        assert.deepEqual(Object.keys(f.settings.translations),[]);
        release();
        await flush();
        assert.deepEqual(Object.keys(f.settings.translations),[]);
        assert.equal(f.requests.length,0,'no solo fallback launches after cancellation');
    } finally{f.close()}
});

test('multi-book full translation reuses three-entry grouping separately for each book',async()=>{
    const groupModule=await entryGroupImporter;
    const f=fixture(groupModule);
    try{
        f.settings.translationProvider='profile';
        const result=await f.context.translateMultipleLorebooks(['A','B'],'all');
        assert.equal(result.booksCompleted,2);
        assert.equal(result.succeeded,8);
        assert.equal(result.failed,0);
        assert.equal(f.groupRequests.length,2);
        assert.equal(f.requests.length,2,'one leftover singleton per book');
        assert.equal(f.events.filter(e=>e==='file-flush').length,2);
        assert.equal(f.context.state.bulkTranslation,null);
    }finally{f.close()}
});

test('Google translation and selected-entry tasks preserve their original single-entry API flow',async()=>{
    const groupModule=await entryGroupImporter;
    const f=fixture(groupModule);
    try{
        f.settings.translationProvider='google';
        await f.context.translateCurrentLorebook('all',null,'A');
        assert.equal(f.groupRequests.length,0);
        assert.equal(f.requests.length,4);
        f.requests.length=0;
        f.settings.translationProvider='profile';
        await f.context.translateCurrentLorebook('selected',f.selection);
        assert.equal(f.groupRequests.length,0);
        assert.equal(f.requests.length,3);
    }finally{f.close()}
});

test('independent translation never reads or writes stale A rows while selected B is still rendering',async()=>{
    const f=fixture();
    try{
        const staleA=f.ui(0);
        staleA.source.value='A unsaved editor content';
        f.data.entries[0].content='B server source 0';
        f.switchBook();
        f.context.state.bookSwitch={book:'B',ready:false};
        const result=await f.context.translateCurrentLorebook('all',null,'B');
        assert.equal(result.succeeded,4);
        assert.equal(f.requests[0][0],'B server source 0',
            'translate the selected book JSON, not a previous book textarea');
        assert.equal(f.settings.translations['B:0'].text,'translated B server source 0');
        assert.equal(f.settings.translations['A:0'],undefined);
        assert.equal(staleA.translation.value,'','old book UI must not be written');
    }finally{f.close()}
});

test('25 and 240 entries translate without reading any outgoing-book DOM during B loading',async()=>{
    for(const count of [25,240]){
        const f=fixture();
        try{
            f.data.entries=Object.fromEntries(Array.from({length:count},(_,uid)=>[
                String(uid),{uid,content:'B source '+uid},
            ]));
            const staleRows=Array.from({length:count},(_,uid)=>({
                dataset:{uid:String(uid)},
                querySelector:()=>null,
            }));
            let listPasses=0,inspectedRows=0;
            f.context.renderedEntries=()=>{
                listPasses++;
                inspectedRows+=staleRows.length;
                return staleRows;
            };
            f.switchBook();
            f.context.state.bookSwitch={book:'B',ready:false};
            const result=await f.context.translateCurrentLorebook('missing',null,'B');
            assert.equal(result.succeeded,count);
            assert.equal(listPasses,0, count+' items must not query stale row list');
            assert.equal(inspectedRows,0, count+' items must not enumerate stale rows');
        }finally{f.close()}
    }
});

test('A -> B -> C during one multi-book job keeps all three book-local records isolated',async()=>{
    const f=fixture();
    try{
        const staleA=f.ui(0);
        const dataFor=book=>book==='A'?f.data:{
            entries:Object.fromEntries(Array.from({length:4},(_,uid)=>[
                String(uid),{uid,content:book+' source '+uid},
            ])),
        };
        f.context.loadWorldInfo=async book=>dataFor(book);
        const pendingGates=new Map();
        f.translate(source=>{
            if(source==='source 0' || source==='B source 0'){
                return new Promise(resolve=>pendingGates.set(source,resolve));
            }
            return 'translated '+source;
        });
        const pending=f.context.translateMultipleLorebooks(['A','B','C'],'all');
        await flush();
        assert.ok(pendingGates.has('source 0'),'A translation began');
        f.switchBook('B');
        f.context.state.bookSwitch={book:'B',ready:false};
        pendingGates.get('source 0')('translated source 0');
        for(let i=0;i<12 && !pendingGates.has('B source 0');i++)await flush();
        assert.ok(pendingGates.has('B source 0'),'B must proceed after A');
        f.switchBook('C');
        f.context.state.bookSwitch={book:'C',ready:false};
        pendingGates.get('B source 0')('translated B source 0');
        const result=await pending;
        assert.equal(result.booksCompleted,3);
        assert.equal(result.succeeded,12);
        for(const book of ['A','B','C']){
            for(let uid=0;uid<4;uid++){
                const source=book==='A'?'source '+uid:book+' source '+uid;
                assert.equal(f.settings.translations[key(book,uid)].text,'translated '+source);
                assert.equal(f.settings.translations[key(book,uid)].book,book);
            }
        }
        assert.equal(staleA.translation.value,'','previous book editor stays untouched');
        assert.equal(f.events.filter(event=>event==='file-flush').length,3);
        assert.equal(f.context.state.bulkTranslation,null);
    }finally{f.close()}
});

test('partial bulk success saves body, preserves failed title and retries only missing metadata',async()=>{
 const {translateLoreFieldsBatch}=await import(require('node:url').pathToFileURL(require('node:path').join(__dirname,'../lore-translation-batch.js')).href);
 const f=fixture();
 try{
  Object.assign(f.settings,{translationProvider:'profile',translateContent:true,translateTitle:true});
  f.context.translateLoreFieldsBatch=translateLoreFieldsBatch;
  f.data.entries[0].comment='New title';
  f.settings.translations['A:0']={book:'A',uid:'0',language:'ko',sourceLanguage:'en',text:'old body',sourceHash:'source 0',fields:{comment:{source:'Old title',text:'old title'}}};
  f.context.requestWithProfile=async()=>JSON.stringify({content:'새 번역 0'});
  f.translate(async()=>{throw Error('offline')});
  const result=await f.context.translateCurrentLorebook('selected',{book:'A',uids:['0']});
  assert.equal(result.partial,1);assert.equal(result.succeeded,0);assert.equal(result.failed,0);
  assert.equal(f.settings.translations['A:0'].text,'새 번역 0');
  assert.equal(f.settings.translations['A:0'].fields.comment.text,'old title');
  f.translate(async source=>{assert.equal(source,'New title');return '새 제목'});
  const next=await f.context.translateCurrentLorebook('missing',{book:'A',uids:['0']});
  assert.equal(next.succeeded,1);
  assert.equal(f.settings.translations['A:0'].text,'새 번역 0');
  assert.equal(f.settings.translations['A:0'].fields.comment.text,'새 제목');
 }finally{f.close();}
});

test('partial grouped result is saved even when another field of that UID cannot be recovered',async()=>{
 const f=fixture(await entryGroupImporter);
 try{
  Object.assign(f.settings,{translationProvider:'profile',translateContent:true,translateTitle:true});
  f.data.entries[0].comment='Title';
  f.groupResponse(async prompt=>{
   const data=JSON.parse(prompt.split('=== SOURCE ENTRY JSON ===\n')[1]);const entries={};
   for(const [id,item] of Object.entries(data.entries))entries[id]={sourceTag:item.sourceTag,content:'translated '+item.fields.content};
   return JSON.stringify({entries});
  });
  f.translate(async source=>{if(source==='Title')throw Error('offline');return 'translated '+source});
  const result=await f.context.translateCurrentLorebook('all',null,'A');
  assert.equal(result.partial,1);assert.equal(result.succeeded,3);assert.equal(result.failed,0);
  assert.equal(f.settings.translations['A:0'].text,'translated source 0');
  assert.equal(f.settings.translations['A:0'].fields?.comment,undefined);
 }finally{f.close();}
});
