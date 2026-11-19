const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { JSDOM } = require('jsdom');
const source = readFileSync(join(__dirname, '../index.js'), 'utf8');

function productionFunction(name) {
    const match = source.match(new RegExp('^(?:async )?function ' + name + '\\([^]*?^}', 'm'));
    assert.ok(match, 'missing production function ' + name);
    return match[0];
}
const makeDOM = html => new JSDOM(html, { runScripts: 'outside-only' });

test('settings cards preserve controls and user data; connected filter is managed here', () => {
    const dom = makeDOM('<div id="extensions_settings2"></div>');
    const w = dom.window;
    const stubs = `
        const settings = {
            translationPrompt:'Existing custom translation instructions',
            profileId:'stored-profile',translationProvider:'profile',
            translateContent:true,translateTitle:false,translateKeywords:false,
            hideOriginalWhenTranslated:true,aiOutputTokens:2048,
            quickOptionsLocation:'lorebook',autoBackupEnabled:true,managerMode:'standard',
            showMobileEntryState:false,showMobileTokenSummary:true,
            showMobileEntryFilters:true,showOnlyLinkedLorebooks:true
        };
        const state = {backupRenderRunId:0};
        const MANAGER_MODE_FOLDY = 'foldy';
        const getSettings = () => settings;
        const fillProfileSelect = () => document.getElementById('slb-profile')
            .append(new Option('Stored',settings.profileId));
        const createElement = (tag,cls,text) => {
            const el=document.createElement(tag);
            if(cls) el.className=cls;
            if(text) el.textContent=text;
            return el;
        };
        const isFoldyLoreAvailable=()=>false;
        const saveSettingsDebounced=()=>{};
        let saves=0,filterSync=0,backupReads=0;
        const saveSettings=()=>{saves++};
        const syncConnectedWorldOptions=()=>{filterSync++};
        const syncQuickTranslationOptionsPlacement=()=>{};
        const applyMobileDisplaySettings=()=>{};
        const renderBackupList=()=>{backupReads++};
    `;
    w.eval(stubs + '\n' + productionFunction('createAIBar') + '\n'
        + 'window.makePanel=createAIBar; window.getCounters=()=>({settings,saves,filterSync,backupReads});');
    try {
        w.makePanel();
        w.makePanel();
        const root = w.document.getElementById('slb-ai-tools');
        assert.ok(root);
        assert.equal(w.document.querySelectorAll('#slb-ai-tools').length,1);
        assert.equal(root.querySelectorAll('.slb-settings-card').length,4);
        assert.equal(root.querySelector('.slb-translation-settings').open,true);
        assert.equal(root.querySelector('.slb-advanced-settings').open,false);
        assert.equal(root.querySelector('.slb-backup-settings').open,false);
        assert.equal(w.getCounters().backupReads,0);
        assert.equal(root.querySelector('#slb-translate-prompt').value,
            'Existing custom translation instructions');
        assert.equal(root.querySelector('#slb-profile').value,'stored-profile');
        for (const id of ['slb-provider','slb-profile','slb-output-tokens','slb-translate-content',
            'slb-translate-title','slb-translate-keywords','slb-hide-translated-source',
            'slb-translate-prompt','slb-options-location','slb-filter-linked-lorebooks',
            'slb-show-mobile-entry-state','slb-show-mobile-token-summary','slb-show-mobile-entry-filters',
            'slb-auto-backup-enabled','slb-backup-now','slb-backup-export-all','slb-clear-translations',
            'slb-reset-extension']) {
            assert.ok(root.querySelector('#'+id),'missing native setting '+id);
        }
        assert.equal(root.querySelector('#slb-connected-world-toggle'),null);
        const checkbox=root.querySelector('#slb-filter-linked-lorebooks');
        assert.equal(checkbox.checked,true);
        checkbox.checked=false;
        checkbox.dispatchEvent(new w.Event('change',{bubbles:true}));
        assert.equal(w.getCounters().settings.showOnlyLinkedLorebooks,false);
        assert.equal(w.getCounters().filterSync,1);
        assert.equal(w.getCounters().saves,1);
        assert.equal(w.getCounters().settings.translationPrompt,
            'Existing custom translation instructions');
        const backup=root.querySelector('.slb-backup-settings');
        backup.open=true;
        backup.dispatchEvent(new w.Event('toggle'));
        assert.ok(w.getCounters().backupReads>=1);
    } finally {w.close();}
});

test('collapsed backup settings never initiate IndexedDB retrieval', async () => {
    const dom = makeDOM('<section id="slb-ai-tools"><details class="slb-backup-settings"><summary>Backup</summary><div id="slb-backup-list"></div></details><span id="slb-backup-count"></span></section>');
    const w=dom.window;
    const stubs=`
        const state={backupRenderRunId:0};
        let reads=0;
        const listLorebookBackups=async()=>{reads++;return []};
        const createElement=(tag,cls,text)=>{
            const el=document.createElement(tag);
            if(cls) el.className=cls;
            if(text) el.textContent=text;
            return el;
        };
    `;
    w.eval(stubs + '\n' + productionFunction('renderBackupList') + '\n'
        + 'window.loadBackups=renderBackupList;window.countReads=()=>reads;');
    try {
        await w.loadBackups();
        assert.equal(w.countReads(),0);
        const card=w.document.querySelector('.slb-backup-settings');
        card.open=true;
        await w.loadBackups();
        assert.equal(w.countReads(),1);
        assert.equal(w.document.getElementById('slb-backup-count').textContent,'0개');
        card.open=false;
        await w.loadBackups();
        assert.equal(w.countReads(),1);
    } finally {w.close();}
});

test('unavailable AI connection never erases saved profile', () => {
    const dom=makeDOM('<select id="slb-profile"></select>');
    const w=dom.window;
    const stubs=`
        const settings={profileId:'persist-profile'};
        const getSettings=()=>settings;
        const ConnectionManagerRequestService={getSupportedProfiles(){throw new Error('offline')}};
        let writes=0;
        const saveSettingsDebounced=()=>{writes++};
    `;
    w.eval(stubs + '\n' + productionFunction('fillProfileSelect') + '\n'
        + 'window.fill=fillProfileSelect;window.read=()=>({settings,writes});');
    try {
        w.fill();
        assert.equal(w.read().settings.profileId,'persist-profile');
        assert.equal(w.document.getElementById('slb-profile').value,'persist-profile');
        assert.equal(w.read().writes,0);
    } finally {w.close();}
});
