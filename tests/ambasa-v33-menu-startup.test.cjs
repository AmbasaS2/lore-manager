const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { JSDOM } = require('./fixture-ui-language.cjs');
const source = readFileSync(join(__dirname, '../index.js'), 'utf8');
const menu = source.match(/^function bindStandaloneLibraryMenu\(\) \{[^]*?^\}/m)?.[0];
const bootstrap = source.slice(source.lastIndexOf('\njQuery(() => {') + 1);
assert.ok(menu && bootstrap.startsWith('jQuery(() => {'), 'production menu and startup blocks exist');

function fixture(html) {
    const dom = new JSDOM('<!doctype html><html><body>' + html + '</body></html>',
        {runScripts:'outside-only'});
    const w = dom.window;
    w.eval([
        "const VERSION = '1.4.85-ambasa.33';",
        "const event_types = { APP_READY: 'APP_READY' };",
        "const events = new Map();",
        "const eventSource = { on: (name, listener) => events.set(name, listener) };",
        "const jQuery = callback => callback();",
        "const createElement = (tag, className = '', text = '') => { const el = document.createElement(tag); if(className) el.className=className; if(text) el.textContent=text; return el; };",
        "const openStandaloneLibrary = () => window.__opened++;",
        "const openStandaloneLibraryEntry = async () => false;",
        "const init = () => { window.__initCalled++; /* world info not ready: defers */ };",
        "window.__opened=0; window.__initCalled=0;",
        menu,
        bootstrap,
        "window.api = { emitReady: () => events.get('APP_READY')?.(), installedEvents: () => [...events.keys()] };",
    ].join('\n'));
    return {dom,w};
}

test('menu action registers even if WorldInfo has not yet initialized', () => {
    const f=fixture('<div id="extensionsMenu"></div>');
    try{
        assert.equal(f.w.__initCalled,1);
        assert.equal(f.w.document.getElementById('WorldInfo'),null);
        assert.equal(f.w.document.querySelectorAll('#slb-library-menu-action').length,1);
        assert.equal(f.w.document.querySelector('#slb-library-menu-action span').textContent,'로어북 매니저');
        f.w.document.querySelector('#slb-library-menu-action').click();
        assert.equal(f.w.__opened,1);
    }finally{f.dom.window.close();}
});

test('menu action registers on app ready even if extensionsMenu was created late', () => {
    const f=fixture('<div id="other-extension">Folio</div>');
    try{
        assert.equal(f.w.document.getElementById('slb-library-menu-action'),null);
        assert.ok(f.w.api.installedEvents().includes('APP_READY'));
        const menuNode=f.w.document.createElement('div');
        menuNode.id='extensionsMenu';
        f.w.document.body.append(menuNode);
        f.w.api.emitReady();
        f.w.api.emitReady();
        assert.equal(f.w.document.querySelectorAll('#slb-library-menu-container').length,1);
        assert.equal(f.w.document.querySelector('#slb-library-menu-action').getAttribute('role'),'button');
    }finally{f.dom.window.close();}
});

test('keyboard open works and no menu action is added twice on repeated lifecycle calls', () => {
    const f=fixture('<div id="extensionsMenu"></div>');
    try{
        f.w.api.emitReady();
        const el=f.w.document.querySelector('#slb-library-menu-action');
        const event = new f.w.KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true});
        el.dispatchEvent(event);
        assert.equal(f.w.__opened,1);
        assert.equal(event.defaultPrevented,true);
        assert.equal(f.w.document.querySelectorAll('#slb-library-menu-action').length,1);
    }finally{f.dom.window.close();}
});
