const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const vm = require('node:vm');
const { JSDOM } = require('jsdom');
const makeJQuery = require('jquery');
const code = readFileSync(require('node:path').join(__dirname, '../index.js'), 'utf8');
const fn = name => code.match(new RegExp(`^(?:async )?function ${name}\\([^]*?^}`, 'm'))[0];
const flush = () => new Promise(resolve => setImmediate(resolve));
const key = (book, uid) => `${book}:${uid}`;
function fixture() {
    const dom = new JSDOM('<div id="rows"></div>');
    const data = { entries: Object.fromEntries([0, 1, 2, 3].map(uid => [uid, { uid, content: `source ${uid}` }])),
        originalData: { entries: [0, 1, 2, 3].map(uid => ({ uid })) } };
    let book = 'A', current = true, confirm = async () => 1;
    const settings = { hideOriginalWhenTranslated: true, translations: {}, entryLanguagePairs: {} };
    const events = [], requests = [], rows = [];
    let translate = async source => `translated ${source}`;
    let save = async () => { events.push('save'); };
    const context = vm.createContext({
        console: { warn() {} }, clearTimeout, document: dom.window.document,
        state: { sourceTimers: new Map(), translationTimers: new Map(), bulkTranslation: null },
        Popup: { show: { confirm: (...args) => { events.push(args); return confirm(); } } },
        POPUP_RESULT: { AFFIRMATIVE: 1, CANCELLED: null },
        entryBulkEditor: { isCurrentSelection: () => current, prune: () => events.push('prune') },
        loadWorldInfo: async () => data, currentBookName: () => book, getSettings: () => settings,
        saveWorldInfo: (...args) => save(...args),
        deleteWIOriginalDataValue: (data, uid) => { data.originalData.entries = data.originalData.entries.filter(e => String(e.uid) !== uid); },
        saveSettingsDebounced: () => {}, saveSettings: async () => {},
        renderedEntries: () => rows, getUid: row => row.dataset.uid,
        worldInfoFilter: { onDataChanged: () => events.push('redraw') }, renderTokenSummary() {},
        notify: (...args) => events.push(args), updateBulkTranslationStatus() {},
        translationKey: key, canTranslate: () => true, entryLanguageBadge: language => language,
        jQuery: makeJQuery(dom.window), setTimeout, getComputedStyle: dom.window.getComputedStyle.bind(dom.window),
        entryData: uid => data.entries[uid],
        updateNavigatorEntry() {}, scheduleSourceTranslation() {}, scheduleAutomaticLorebookBackup() {},
        hashText: text => text, normalizeEntryLanguage: value => value,
        oppositeEntryLanguage: () => 'ko', ENTRY_LANGUAGE_ENGLISH: 'en',
        createElement: (tag, className, text) => { const el = dom.window.document.createElement(tag); el.className = className; el.textContent = text || ''; return el; },
        getEntryLanguagePair: () => ({ sourceLanguage: 'en', translationLanguage: 'ko' }),
        translateText: async (source, language) => { requests.push([source, language]); return translate(source); },

    });
    vm.runInContext(['mapLimit', 'deleteSelectedEntries', 'translateCurrentLorebook', 'lorebookEntries', 'hasEntryTranslation', 'syncSourceVisibility', 'selectedTranslationFields', 'getEntryTranslationSources', 'currentMetadataTranslation', 'saveMetadataTranslations', 'syncMetadataTranslations', 'syncMetadataFieldAppearance', 'saveTranslationRecord', 'findTranslationRecord', 'markTranslationSynced', 'translateEntrySource', 'translateEntryBodySource', 'setEntryBusy'].map(fn).join('\n'), context);
    function ui(uid) {
        const row = dom.window.document.createElement('div'); row.dataset.uid = String(uid);
        row.innerHTML = '<div class="world_entry_edit"><div class="slb-content-grid"><div class="slb-source-pane"><textarea></textarea></div><textarea class="translation"></textarea></div></div>';
        dom.window.document.getElementById('rows').append(row); rows.push(row);
        const edit = row.querySelector('.world_entry_edit');
        const result = { entry: row, book: 'A', uid: String(uid), root: edit, source: row.querySelector('textarea'), translation: row.querySelector('.translation'), flags: {}, status: {}, sourceLanguage: 'en', translationLanguage: 'ko' };
        result.translationPane = result.translation.parentElement;
        result.source.value = data.entries[uid].content; edit.slbTranslationUI = result; return result;
    }
    return { context, data, settings, events, requests, ui, selection: { book: 'A', uids: ['0', '2', '3'] },
        confirm: handler => { confirm = handler; }, translate: handler => { translate = handler; },
        save: handler => { save = handler; }, invalidate: () => { current = false; }, switchBook: () => { book = 'B'; }, close: () => dom.window.close() };
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

test('cancellation and book switch drain active workers without applying results or starting queued entries', async () => {
    for (const cancel of ['button', 'book']) {
        const f = fixture();
        try {
            const finish = [];
            f.translate(() => new Promise(resolve => finish.push(resolve)));
            const pending = f.context.translateCurrentLorebook('selected', { book: 'A', uids: ['0', '1', '2', '3'] });
            await flush(); assert.equal(f.requests.length, 3);
            if (cancel === 'book') f.switchBook();
            else await f.context.translateCurrentLorebook('selected', f.selection);
            finish[0]('stale'); await flush();
            assert.notEqual(f.context.state.bulkTranslation, null, 'job remains owned until in-flight requests settle');
            finish[1]('stale'); finish[2]('stale'); await pending;
            assert.equal(f.requests.length, 3);
            assert.deepEqual(Object.keys(f.settings.translations), []);
            assert.equal(f.context.state.bulkTranslation, null);
        } finally { f.close(); }
    }
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
            for (const property of ['height', 'font-size', 'padding-top', 'padding-left', 'border-top-width', 'border-top-color']) {
                assert.equal(view.style.getPropertyValue(property), style.getPropertyValue(property), `${name}: ${property}`);
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
        f.context.ResizeObserver = class { constructor(callback) { resized = callback; } observe() {} disconnect() {} };
        const ui = f.ui(0);
        ui.entry.insertAdjacentHTML('afterbegin', '<div class="slb-title-field"><textarea name="comment">Title</textarea></div>');
        f.settings.translations['A:0'] = { language: 'ko', fields: { comment: { source: 'Title', text: '제목' } } };
        const source = ui.entry.querySelector('[name="comment"]');
        let height = 29;
        source.getBoundingClientRect = () => ({ height });
        f.context.syncMetadataTranslations(ui.entry);
        const view = ui.entry.querySelector('[data-field="comment"]');
        assert.equal(view.style.height, '29px');
        height = 64; resized();
        assert.equal(view.style.height, '64px');
    } finally { f.close(); }
});
