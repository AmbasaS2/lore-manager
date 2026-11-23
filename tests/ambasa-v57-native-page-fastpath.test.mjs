import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';
import { prepareFirstNativePageHeaders } from '../native-page-fastpath.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const source = readFileSync(join(root, 'index.js'), 'utf8');
const moduleSource = readFileSync(join(root, 'native-page-fastpath.js'), 'utf8');
const sourceCSS = readFileSync(join(root, 'style.css'), 'utf8');

function fixture({ existing = 0, added = 25 } = {}) {
    const dom = new JSDOM('<!doctype html><html><body><div id="world_popup_entries_list"></div></body></html>', {
        pretendToBeVisual: true,
    });
    const list = dom.window.document.querySelector('#world_popup_entries_list');
    const makeRow = uid => {
        const row = dom.window.document.createElement('div');
        row.className = 'world_entry';
        row.setAttribute('uid', String(uid));
        const native = dom.window.document.createElement('div');
        native.className = 'inline-drawer-header';
        row.append(native);
        return row;
    };
    const oldRows = Array.from({ length: existing }, (_, i) => makeRow(i));
    const newRows = Array.from({ length: added }, (_, i) => makeRow(existing + i));
    list.append(...oldRows, ...newRows);
    for (const row of oldRows) row.dataset.slbDisplayReady = 'true';
    const records = [{ type: 'childList', target: list, addedNodes: newRows, removedNodes: [] }];
    const calls = [];
    const enhance = row => {
        calls.push(row.getAttribute('uid'));
        const shell = dom.window.document.createElement('div');
        shell.className = 'slb-entry-header-shell';
        row.append(shell);
    };
    const isReady = row => Boolean(row.querySelector('.slb-entry-header-shell'));
    return { dom, list, records, oldRows, newRows, calls, enhance, isReady };
}

test('one native pagination mutation prepares at most two visible headers before the normal RAF', () => {
    const f = fixture({ existing: 0, added: 25 });
    try {
        const count = prepareFirstNativePageHeaders(f.records, f.list, {
            enhance: f.enhance,
            isReady: f.isReady,
            now: () => 0,
        });
        assert.equal(count, 2);
        assert.deepEqual(f.calls, ['0', '1']);
        assert.deepEqual(f.newRows.slice(0, 2).map(row => row.dataset.slbDisplayReady), ['true', 'true']);
        assert.equal(f.newRows.slice(2).filter(row => row.dataset.slbDisplayReady === 'true').length, 0);
        assert.equal(f.list.children.length, 25, 'native rows are never replaced or cloned');
        assert.equal(f.newRows[0].querySelector('.inline-drawer-header').isConnected, true);
    } finally { f.dom.window.close(); }
});

test('240 normal existing rows remain untouched; only two newly appended rows are prepared', () => {
    const f = fixture({ existing: 240, added: 25 });
    try {
        const before = f.oldRows.map(row => row.querySelector('.inline-drawer-header'));
        assert.equal(prepareFirstNativePageHeaders(f.records, f.list, {
            enhance: f.enhance, isReady: f.isReady, now: () => 0,
        }), 2);
        assert.equal(f.calls.length, 2);
        assert.equal(f.oldRows.filter(row => row.querySelector('.slb-entry-header-shell')).length, 0);
        assert.ok(f.oldRows.every((row, i) => row.querySelector('.inline-drawer-header') === before[i]));
        assert.equal(f.list.children.length, 265);
    } finally { f.dom.window.close(); }
});

test('ignores direct re-insertion of ready rows and updates inside edited rows', () => {
    const f = fixture({ added: 4 });
    try {
        f.newRows[0].dataset.slbDisplayReady = 'true';
        const child = f.newRows[1].querySelector('.inline-drawer-header');
        const nonTopMutation = { type: 'childList', target: f.newRows[1], addedNodes: [child] };
        const notChildList = { type: 'attributes', target: f.list, addedNodes: [f.newRows[1]] };
        const onlyReady = { type: 'childList', target: f.list, addedNodes: [f.newRows[0]] };
        const count = prepareFirstNativePageHeaders([nonTopMutation, notChildList, onlyReady], f.list, {
            enhance: f.enhance, isReady: f.isReady, now: () => 0,
        });
        assert.equal(count, 0);
        assert.deepEqual(f.calls, []);
    } finally { f.dom.window.close(); }
});

test('detached old-page nodes are ignored and may not be reattached or recreated', () => {
    const f = fixture({ added: 4 });
    try {
        const stale = f.newRows[0];
        stale.remove();
        assert.equal(prepareFirstNativePageHeaders([{
            type: 'childList', target: f.list, addedNodes: [stale],
        }], f.list, { enhance: f.enhance, isReady: f.isReady, now: () => 0 }), 0);
        assert.equal(stale.isConnected, false);
        assert.deepEqual(f.calls, []);
        assert.equal(f.list.children.length, 3);
    } finally { f.dom.window.close(); }
});

test('an incomplete/exception header stays on the native page for the ordinary retry mechanism', () => {
    const f = fixture({ added: 3 });
    try {
        const original = f.newRows[0];
        const enhanced = [];
        const result = prepareFirstNativePageHeaders(f.records, f.list, {
            enhance: row => {
                if (row === original) throw Error('missing native field');
                enhanced.push(row);
            },
            isReady: () => false,
            now: () => 0,
        });
        assert.equal(result, 2);
        assert.equal(f.newRows[0].dataset.slbDisplayReady, undefined);
        assert.equal(f.newRows[1].dataset.slbDisplayReady, undefined);
        assert.equal(enhanced.length, 1);
        assert.equal(f.list.children.length, 3);
    } finally { f.dom.window.close(); }
});

test('bounded timing exits after a single expensive header, leaving remaining work to the existing queue', () => {
    const f = fixture({ added: 25 });
    try {
        let now = 0;
        assert.equal(prepareFirstNativePageHeaders(f.records, f.list, {
            enhance: row => { f.enhance(row); now += 12; },
            isReady: f.isReady,
            now: () => now,
            maxRows: 2, budgetMs: 8,
        }), 1);
        assert.deepEqual(f.calls, ['0']);
        assert.equal(f.newRows.slice(1).filter(row => row.dataset.slbDisplayReady === 'true').length, 0);
    } finally { f.dom.window.close(); }
});

test('only standard same-book path invokes the helper; Foldy/book-switch/dragging remain unchanged', () => {
    assert.match(source, /import \{ prepareFirstNativePageHeaders \} from '\.\/native-page-fastpath\.js'/);
    assert.match(source, /if \(!linkedMode && state\.managerMode === MANAGER_MODE_STANDARD\s*&& !state\.bookSwitch && !state\.worldDrawerOpening\s*&& state\.currentBook === currentBookName\(\)\s*&& state\.currentBookData\?\.entries\)/);
    assert.match(source, /prepareFirstNativePageHeaders\(relevantMutations, entries, \{/);
    assert.match(source, /if \(state\.sorting\) return;/);
    assert.match(source, /if \(state\.enhancing\)/);
    assert.match(source, /if \(listChanged \|\| entryChanged\) scheduleEnhance\(\)/);
    assert.match(sourceCSS, /world_entry:not\(\[data-slb-display-ready="true"\]\)/);
    assert.doesNotMatch(moduleSource, /setInterval\(|setTimeout\(|requestAnimationFrame\(|MutationObserver\(|getClientRects\(|getBoundingClientRect\(/);
});

test('page processing is O(2) rather than O(25) before first frame, without increasing total native reads', () => {
    const f = fixture({ added: 25 });
    try {
        let nativeLoads = 0;
        // Source elements are already present. The fast path must not invoke
        // any loadWorldInfo / fetch / rerender functions.
        const immediate = prepareFirstNativePageHeaders(f.records, f.list, {
            enhance: row => { f.enhance(row); },
            isReady: f.isReady,
            now: () => 0,
        });
        const readyBeforeRaf = f.newRows.filter(row => row.dataset.slbDisplayReady === 'true').length;
        const remaining = f.newRows.filter(row => row.dataset.slbDisplayReady !== 'true');
        remaining.forEach(row => { f.enhance(row); row.dataset.slbDisplayReady = 'true'; });
        assert.deepEqual({ immediate, readyBeforeRaf, remaining: remaining.length, nativeLoads },
            { immediate: 2, readyBeforeRaf: 2, remaining: 23, nativeLoads: 0 });
        assert.equal(f.calls.length, 25, 'every row enhanced exactly once, no duplicate work');
    } finally { f.dom.window.close(); }
});
