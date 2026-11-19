const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const { runInNewContext } = require('node:vm');

const source = readFileSync(path.join(__dirname, '../index.js'), 'utf8');
const css = readFileSync(path.join(__dirname, '../style.css'), 'utf8');
function extract(name) {
    const match = source.match(new RegExp('^(?:async )?function ' + name + '\\([^]*?^}', 'm'));
    assert.ok(match, 'production function exists: ' + name);
    return match[0];
}

test('backup section reads nothing while closed and renders buttons only on group expansion', async () => {
    const dom = new JSDOM('<div id="slb-ai-tools"><details class="slb-backup-settings"><span id="slb-backup-count"></span><div id="slb-backup-list"></div></details></div>',
        { runScripts: 'outside-only', pretendToBeVisual: true });
    const w = dom.window;
    const stub = [
        'const state = {backupRenderRunId: 0};',
        'let reads = 0;',
        'const listLorebookBackups = async () => { reads++; return [{id:"one",book:"Remus",createdAt:1234567890,entryCount:1,reason:"manual"}]; };',
        'const createElement = (tag,cls,value) => {const node=document.createElement(tag);if(cls)node.className=cls;if(value)node.textContent=value;return node;};',
        'const backupReasonLabel = () => "수동 백업";',
        'const restoreLorebookBackup = async()=>{};',
        'const getLorebookBackup = async()=>({lorebook:{entries:{}},translations:[]});',
        'const downloadJsonFile = ()=>{};',
        'const safeBackupFilename = x => x;',
        'const backupExportEnvelope = x => ({backups:x});',
        'const deleteLorebookBackup = async()=>{};',
        'const notify = ()=>{};',
    ].join('\n');
    w.eval(stub + '\n' + extract('createBackupRecordRow') + '\n' + extract('renderBackupList') +
        '\nwindow.renderList=renderBackupList;window.countReads=()=>reads;');
    try {
        await w.renderList();
        assert.equal(w.countReads(), 0, 'collapsed panel does not touch IndexedDB');
        const section = w.document.querySelector('details.slb-backup-settings');
        section.open = true;
        await w.renderList();
        assert.equal(w.countReads(), 1);
        assert.equal(w.document.querySelectorAll('.slb-backup-row').length, 0, 'collapsed lorebook has no action DOM');
        const group = w.document.querySelector('.slb-backup-group');
        group.open = true;
        group.dispatchEvent(new w.Event('toggle'));
        assert.equal(w.document.querySelectorAll('.slb-backup-row').length, 1);
        assert.match(w.document.querySelector('.slb-backup-row').textContent, /현재 로어북 복원/);
        group.open = false;
        group.dispatchEvent(new w.Event('toggle'));
        assert.equal(w.document.querySelectorAll('.slb-backup-row').length, 0, 'collapsing releases action nodes');
    } finally { w.close(); }
});

test('single-backup export reads the complete record, not the header; deleting touches only backup ID', async () => {
    const dom = new JSDOM('<main></main>', {runScripts: 'outside-only'});
    const w = dom.window;
    const stub = [
        'let saved = null, deleted = [], confirmations = [];',
        'const createElement = (tag,cls,text)=>{const e=document.createElement(tag);if(cls)e.className=cls;if(text)e.textContent=text;return e;};',
        'const backupReasonLabel = ()=>"수동 백업";',
        'const getLorebookBackup = async()=>({id:"abc",book:"Remus",lorebook:{entries:{0:{content:"precious original"}}},translations:[{text:"Korean"}]});',
        'const downloadJsonFile = (name, data)=>{saved={name,data}};',
        'const backupExportEnvelope = records=>({backups:records});',
        'const safeBackupFilename = x=>x;',
        'const deleteLorebookBackup = async id=>{deleted.push(id)};',
        'const renderBackupList = async()=>{};',
        'const restoreLorebookBackup = async()=>{};',
        'const notify = ()=>{};',
        'window.confirm = message=>{confirmations.push(message);return true};',
    ].join('\n');
    w.eval(stub + '\n' + extract('createBackupRecordRow') +
        '\nwindow.makeRow=createBackupRecordRow;window.result=()=>({saved,deleted,confirmations});');
    try {
        const row = w.makeRow({id:'abc',book:'Remus',createdAt:1234567890,entryCount:1,reason:'manual'});
        w.document.body.append(row);
        const buttons = Array.from(row.querySelectorAll('button'));
        buttons.find(b => b.textContent === 'JSON 내보내기').click();
        await new Promise(resolve => setTimeout(resolve, 1));
        assert.match(w.result().saved.name,/Remus/);
        assert.equal(w.result().saved.data.backups[0].lorebook.entries[0].content,'precious original');
        assert.equal(w.result().saved.data.backups[0].translations[0].text,'Korean');
        buttons.find(b => b.textContent === '백업 삭제').click();
        await new Promise(resolve => setTimeout(resolve, 1));
        assert.deepEqual(Array.from(w.result().deleted), ['abc']);
        assert.match(w.result().confirmations[0], /실제 로어북 원본은 유지/);
    } finally { w.close(); }
});

test('backup reset waits for in-flight snapshot before clearing IDB and is backup-only', async () => {
    let finish;
    const task = new Promise(resolve => { finish=resolve; });
    const calls = [];
    const state = {backupTasks: new Set([task]), backupClearInProgress:false, backupRenderRunId:0};
    const database = {close(){calls.push('close');},transaction(){
        return {objectStore(){return {clear(){calls.push('clear');}};}}; }};
    const ctx = {state, indexedDB:{}, openBackupDatabase:async()=>database, backupTransactionDone:async()=>{},
        BACKUP_STORE_NAME:'lorebook-backups', document:{getElementById:()=>null}, console};
    runInNewContext(extract('clearAllLorebookBackups')+'\nglobalThis.clear=clearAllLorebookBackups',ctx);
    const clearing = ctx.clear();
    await new Promise(resolve=>setImmediate(resolve));
    assert.equal(calls.length,0,'a pending write has not yet finished');
    assert.equal(state.backupClearInProgress,true);
    finish();
    await clearing;
    assert.deepEqual(calls,['clear','close']);
    assert.equal(state.backupClearInProgress,false);
    assert.doesNotMatch(extract('clearAllLorebookBackups'),/saveWorldInfo|extension_settings|translations\s*=/);
});

test('existing explicit backup setting survives; picker and hints are single-source',()=>{
    assert.match(source,/autoBackupEnabled:\s*false/);
    assert.match(source,/if \(!\(key in settings\)\)/);
    assert.match(source,/settings\.autoBackupEnabled = Boolean\(settings\.autoBackupEnabled\)/);
    assert.match(source,/form\.append\(fieldLabel, select, showAllLabel, status\)/);
    assert.doesNotMatch(extract('showLorebookTranslationPicker'),/slb-translation-picker-title/);
    assert.match(css,/\.popup:has\(\.slb-translation-picker\) \.popup-controls\s*\{[^}]*flex-direction:\s*column/s);
    assert.match(extract('addLoreInfoIcon'),/icon\.removeAttribute\('title'\)/);
    assert.match(css,/\.slb-lore-tooltip\s*\{/);
});

test('native advanced settings labels gain one accessible hint without changing ST values', () => {
    const dom = new JSDOM('<section id="activation">' +
      '<div class="slb-keyword-core-field"><small>Logic</small><select name="entryLogicType"><option value="0" selected>AND ANY</option></select></div>' +
      '<div class="slb-override-field"><small title="Whole Words">Whole Words</small><select name="matchWholeWords"><option value="true" selected>True</option></select></div>' +
      '<div class="slb-override-field"><small>Case Sensitive</small><select name="caseSensitive"><option value="false" selected>False</option></select></div>' +
      '<div class="slb-override-field"><small>Use Group Scoring</small><select name="useGroupScoring"><option value="true" selected>True</option></select></div>' +
      '<div class="slb-header-field"><small>Trigger %</small><input name="probability" value="50"></div>' +
      '</section><section id="group"></section><section id="filter"></section>', {runScripts:'outside-only'});
    const w = dom.window;
    w.eval(
      extract('addLoreInfoIcon') + '\n' +
      extract('attachLoreEntryHelp') + '\nwindow.setHints=attachLoreEntryHelp;');
    const panels = {activation:w.document.querySelector('#activation'),group:w.document.querySelector('#group'),filter:w.document.querySelector('#filter')};
    try {
       w.setHints(panels);
       w.setHints(panels);
       assert.equal(panels.activation.querySelectorAll('.slb-lore-info-icon').length,5);
       assert.match(panels.activation.querySelector('[name="entryLogicType"]').closest('.slb-keyword-core-field').textContent,/AND ANY/);
       assert.match(panels.activation.querySelector('[name="matchWholeWords"]').closest('.slb-override-field').querySelector('.slb-lore-info-icon').dataset.slbHelp,/king/);
       assert.equal(panels.activation.querySelector('[name="probability"]').value,'50');
       assert.equal(panels.activation.querySelector('[name="useGroupScoring"]').value,'true');
       assert.equal(panels.activation.querySelector('small').hasAttribute('title'),false);
       for (const icon of panels.activation.querySelectorAll('.slb-lore-info-icon')) {
         assert.equal(icon.getAttribute('role'),'button');
         assert.equal(icon.tabIndex,0);
         assert.equal(icon.hasAttribute('title'),false);
         assert.ok(icon.getAttribute('aria-label'));
       }
    } finally { w.close(); }
});

test('mobile override labels do not clip focus/hover help and avoid tiny forced fonts',()=>{
    const label = css.match(/#WorldInfo\.slb-active \.slb-overrides-grid > \.slb-override-field > small \{([^}]+)\}/);
    assert.ok(label);
    assert.match(label[1], /overflow:\s*visible/);
    assert.match(label[1], /white-space:\s*normal/);
    assert.doesNotMatch(label[1], /font-size:\s*0\.61em/);
    assert.match(css,/grid-template-columns:\s*repeat\(auto-fit, minmax\(min\(136px, 100%\), 1fr\)\)/);
    assert.match(css, /\.slb-lore-tooltip\s*\{/);
});
