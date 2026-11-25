const {test} = require('node:test');
const assert = require('node:assert/strict');
const {JSDOM} = require('jsdom');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(process.env.SLB_FOLDY_SOURCE || path.join(__dirname, '../index.js'), 'utf8');
function production(name) {
    const found = source.match(new RegExp('^function ' + name + '\\([^]*?^}', 'm'));
    assert.ok(found, 'missing production function ' + name);
    return found[0];
}
function fixture({count = 25, foldy = true} = {}) {
    const dom = new JSDOM('<div id="WorldInfo"><div id="world_popup"><div id="world_popup_entries_list"></div></div></div>');
    const {document, Element, MutationObserver} = dom.window;
    const list = document.getElementById('world_popup_entries_list');
    const metrics = {enhance:0, masks:0, guards:0, layout:0, memory:0, readyChecks:0};
    const state = {managerMode: foldy ? 'foldy' : 'standard', workspace:null, observer:null, bookSwitch:null, sorting:false, enhancing:false, enhancePending:false, navigatorDirty:false};
    function row(id, ready = true) {
        const el = document.createElement('div');
        el.className = 'world_entry';
        el.setAttribute('uid', String(id));
        if (ready) {
            el.dataset.slbDisplayReady = 'true';
            el.dataset.slbHeaderEnhanced = 'test';
            el.innerHTML = '<div class="inline-drawer-header slb-entry-header"><div class="slb-entry-header-shell"><div class="slb-header-grid"><div class="slb-title-field"><textarea></textarea></div></div><select name="entryStateSelector"></select><div class="slb-header-actions"></div></div></div><div class="world_entry_edit"><div class="world_entry_thin_controls"></div></div>';
        } else {
            el.innerHTML = '<div class="inline-drawer-header"><div class="world_entry_thin_controls"><textarea name="comment"></textarea></div></div>';
        }
        return el;
    }
    function folder(name) {
        const el = document.createElement('section');
        el.className = 'foldy-folder foldy-lore-folder';
        el.innerHTML = '<header><span class="foldy-folder-count">0</span><div class="foldy-folder-actions"></div></header><div class="foldy-folder-items foldy-lore-items"></div>';
        el.dataset.folder = name;
        return el;
    }
    const a = folder('A'), b = folder('B');
    const aItems = a.querySelector('.foldy-lore-items'), bItems = b.querySelector('.foldy-lore-items');
    if (foldy) {
        list.append(a,b);
        for (let i=0;i<count;i++) aItems.append(row(i));
    } else for (let i=0;i<count;i++) list.append(row(i));
    let callback;
    const realObserver = new MutationObserver(() => {});
    const ctx = {document, Element, state,
        MutationObserver: class {
            constructor(cb) { callback = cb; }
            observe(target, options) { realObserver.observe(target, options); }
            disconnect() { realObserver.disconnect(); }
        },
        isFoldyLinkedMode: () => state.managerMode === 'foldy',
        unbindWorkspaceEntries: () => {},
        handleWorkspaceEntryInput: () => {},
        handleWorkspaceEntryClick: () => {},
        bindFoldyFolderDeleteDrawerGuards: () => {metrics.guards++},
        syncMemoryBooksRegenerationButton: () => {metrics.memory++},
        markFoldyLinkedPreparing: () => {metrics.masks++;list.classList.add('slb-foldy-linked-preparing')},
        scheduleBookSwitchReadyCheck: () => {metrics.readyChecks++},
        scheduleEnhance: () => {metrics.enhance++},
        scheduleResponsiveEntryLayouts: () => {metrics.layout++},
        prepareFirstNativePageHeaders: () => {},
        isNarrowEntryLayout: () => true,
        currentBookName: () => 'book',
        MANAGER_MODE_STANDARD:'standard',
        jQuery: () => ({off(){return this},on(){return this}}),
        releaseNativePageCache: () => {},
        pruneMetadataAppearanceObservers: () => {},
        console,
    };
    vm.runInNewContext(['bindWorkspaceEntries','syncEntryHeaderActions','isEntryHeaderReadyForReveal'].map(production).join('\n')+'\nglobalThis.bind=bindWorkspaceEntries;globalThis.actions=syncEntryHeaderActions;',ctx);
    ctx.bind(list);
    metrics.guards=0;
    function flush() {
        let batches=0;
        for (;;) {
            const records=realObserver.takeRecords();
            if (!records.length) break;
            assert.ok(++batches<=20, 'observer must settle without a feedback loop');
            callback(records);
        }
        return batches;
    }
    return {dom,document,list,state,metrics,a,b,aItems,bItems,row,folder,flush,actions:ctx.actions,
        close(){realObserver.disconnect();dom.window.close()}};
}

for (const count of [25,240]) {
    test('Foldy '+count+' intact rows retain their header when one row moves; no full-list mask', () => {
        const f=fixture({count});
        try {
            const moved=f.aItems.firstElementChild;
            const header=moved.querySelector('.slb-entry-header-shell');
            f.bItems.append(moved);
            f.flush();
            assert.equal(f.metrics.masks,0);
            assert.equal(f.metrics.enhance,1);
            assert.equal(moved.dataset.slbDisplayReady,'true');
            assert.equal(moved.querySelector('.slb-entry-header-shell'),header);
            assert.equal(f.list.querySelectorAll('[data-slb-display-ready="true"]').length,count);
        } finally {f.close()}
    });
    test('Foldy '+count+' deferred folder insertion preserves other rows and ignores folder text/menu mutations',()=>{
        const f=fixture({count});
        try {
            f.bItems.append(f.row(count,false));
            f.flush();
            assert.equal(f.metrics.masks,0);
            assert.equal(f.metrics.enhance,1);
            assert.equal(f.list.querySelectorAll('[data-slb-display-ready="true"]').length,count);
            for(let i=0;i<25;i++){
                f.a.querySelector('.foldy-folder-count').textContent=String(i);
                const menu=f.document.createElement('button');menu.textContent='menu';
                f.a.querySelector('.foldy-folder-actions').replaceChildren(menu);
                f.flush();
            }
            assert.equal(f.metrics.enhance,1);
            assert.equal(f.metrics.masks,0);
        } finally {f.close()}
    });
    test('Foldy '+count+' real header actions move once, preserve click listeners, and never queue a whole-list layout',()=>{
        const f=fixture({count});
        try {
            let clicks=0;
            for(const row of f.aItems.children){
                const header=row.querySelector('.slb-entry-header');
                const actions=f.document.createElement('div');actions.className='foldy-lore-entry-actions';
                const button=f.document.createElement('button');button.className='foldy-move-to-folder menu_button';
                button.addEventListener('click',()=>clicks++);
                actions.append(button);header.append(actions);
                f.actions(row);
                assert.equal(button.parentElement,row.querySelector('.slb-header-actions'));
                button.click();
            }
            f.flush();
            assert.equal(clicks,count);
            assert.equal(f.metrics.layout,0);
            assert.equal(f.list.querySelectorAll('.foldy-move-to-folder').length,count);
            assert.equal(f.list.querySelectorAll('.foldy-lore-entry-actions').length,0);
        } finally {f.close()}
    });
}
test('Foldy fresh page fragment renders through existing enhancement path without an extra mask',()=>{
    const f=fixture();
    try{
        const folder=f.folder('next');
        folder.querySelector('.foldy-lore-items').append(f.row(99,false));
        const header=f.document.createElement('div');header.id='WIEntryHeaderTitlesPC';
        f.list.classList.add('foldy-lore-pending');
        f.list.replaceChildren(header,folder);
        f.list.classList.remove('foldy-lore-pending');
        f.flush();
        assert.equal(f.metrics.enhance,1);
        assert.equal(f.metrics.masks,0);
        assert.equal(f.list.querySelector('[uid="99"]').dataset.slbDisplayReady,undefined);
    }finally{f.close()}
});
test('new native header still invalidates readiness; old-book mutation still wakes switch guard',()=>{
    const f=fixture();
    try{
        const row=f.aItems.firstElementChild;
        const header=f.document.createElement('div');header.className='inline-drawer-header';
        header.innerHTML='<div class="world_entry_thin_controls"></div>';
        row.querySelector('.slb-entry-header').replaceWith(header);
        f.flush();
        assert.equal(row.dataset.slbDisplayReady,undefined);
        assert.equal(f.metrics.enhance,1);
        f.state.bookSwitch={ready:false,domMutationVersion:0,readyCandidate:{}};
        f.bItems.append(f.row(200,false));
        f.flush();
        assert.equal(f.metrics.readyChecks,1);
        assert.equal(f.state.bookSwitch.domMutationObserved,true);
        assert.equal(f.state.bookSwitch.readyCandidate,null);
    }finally{f.close()}
});
test('Foldy-only empty folder addition/cleanup still wakes enhancement and never masks',()=>{
    const f=fixture();
    try{
        const c=f.folder('C');
        f.list.append(c);
        f.flush();
        assert.equal(f.metrics.enhance,1);
        c.remove();
        f.flush();
        assert.equal(f.metrics.enhance,2);
        assert.equal(f.metrics.masks,0);
    }finally{f.close()}
});
test('normal mode still schedules native action layout and ignores Foldy-only chrome',()=>{
    const f=fixture({foldy:false});
    try{
        const row=f.list.firstElementChild;
        const orphan=f.document.createElement('button');orphan.className='menu_button';
        row.querySelector('.slb-entry-header').append(orphan);
        f.actions(row);
        assert.equal(f.metrics.layout,1);
        assert.equal(orphan.parentElement,row.querySelector('.slb-header-actions'));
    }finally{f.close()}
});
