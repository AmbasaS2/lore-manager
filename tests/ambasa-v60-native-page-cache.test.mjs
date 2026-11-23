import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { JSDOM } from 'jsdom';
import { attachNativePageCache } from '../native-page-cache.js';

const require = createRequire(import.meta.url);
const jqueryFactory = require('jquery');
// Self-contained pagination.js 2.6.0 event/callback contract, previously
// verified against SillyTavern release's actual pagination.js runtime.
const pluginCode = String.raw`
(function($) {
  $.fn.pagination = function(action, ...args) {
    if (typeof action === 'object') {
      const opts = action, container = this;
      const plugin = {
        initialized: true,
        model: { pageNumber: 0, pageSize: opts.pageSize, totalNumber: opts.dataSource.length },
        currentPageData: [], hooks: {},
      };
      container.data('pagination', plugin);
      container.off('__pagination-go').on('__pagination-go', (event, next, done) => {
        if (plugin.hooks.beforePaging?.some(fn => fn(next) === false)) return;
        plugin.model.pageNumber = Number(next);
        plugin.currentPageData = opts.dataSource.slice(
          (next - 1) * plugin.model.pageSize, next * plugin.model.pageSize);
        if (typeof done === 'function') done(plugin.currentPageData, plugin.model);
        else opts.callback(plugin.currentPageData, plugin.model);
      });
      container.trigger('__pagination-go', [opts.pageNumber || 1]);
      return this;
    }
    const plugin = this.data('pagination');
    if (action === 'go') {
      // Reflect jquery 2.6.0 public string wrapper: callback arg is lost.
      this.trigger('__pagination-go', args[0]);
      return this;
    }
    if (action === 'getCurrentPageNum') return plugin.model.pageNumber;
    if (action === 'getCurrentPageData') return plugin.currentPageData;
    if (action === 'getTotalPage') return Math.ceil(plugin.model.totalNumber / plugin.model.pageSize);
    throw new Error('Unknown pagination action: ' + action);
  };
  $.fn.addHook = function(name, callback) {
    const hooks = this.data('pagination').hooks;
    (hooks[name] ??= []).push(callback);
    return this;
  };
})(window.jQuery);
`;

function fixture({ count = 25, pageSize = 5, maxPages = 2, maxRows = 30 } = {}) {
    const dom = new JSDOM('<!doctype html><html><body>' +
        '<div id="world_info_pagination"></div><div id="world_popup_entries_list"></div>' +
        '</body></html>', { pretendToBeVisual: true, runScripts: 'outside-only' });
    const win = dom.window;
    const $ = jqueryFactory(win);
    win.$ = $;
    win.jQuery = $;
    win.eval(pluginCode);
    const pagination = $('#world_info_pagination');
    const list = $('#world_popup_entries_list');
    const data = Array.from({ length: count }, (_, uid) => ({ uid, text: 'text ' + uid }));
    const stats = { renders: 0, builds: 0, calls: 0, clickCount: 0 };
    let currentSignature = 'book=1|sort=none|filter=none';
    let allowed = true;
    const callback = page => {
        stats.renders++;
        // Model the real SillyTavern clearEntryList teardown, which destroys
        // old jquery handlers and Select2 refs on rows that aren't detached.
        list.find('*').off();
        list.empty();
        const rows = page.map(item => {
            stats.builds++;
            const row = $('<div class="world_entry" data-slb-header-enhanced=".59" data-slb-display-ready="true">');
            row.attr('data-uid', item.uid);
            const button = $('<button class="save">Save ' + item.uid + '</button>');
            button.on('click', () => { stats.clickCount++; });
            const editor = $('<textarea name="content">').val('Original ' + item.uid);
            row.append(button, editor);
            return row;
        });
        list.append(rows);
    };
    pagination.pagination({
        dataSource: data, pageSize, pageNumber: 1, triggerPagingOnInit: true,
        callback,
    });
    const attach = () => attachNativePageCache({
        pagination, list, jQuery: $, book: 'Book 1',
        isAllowed: () => allowed,
        signature: () => currentSignature,
        maxPages, maxRows,
    });
    const getUids = () => list.children('.world_entry').toArray().map(node => Number(node.dataset.uid));
    return {
        dom, win, $, pagination, list, data, stats, attach, getUids,
        setSignature(v) { currentSignature = v; },
        setAllowed(v) { allowed = v; },
        close() { dom.window.close(); },
    };
}

test('real pagination.js: 1→2 first visit native renders; 2→1 restores exact nodes and handlers without rebuilding', () => {
    const f = fixture();
    try {
        const firstNode = f.list.children('.world_entry').get(0);
        const firstSave = f.list.find('.save').get(0);
        const firstTextarea = f.list.find('textarea[name="content"]').get(0);
        const cache = f.attach();
        assert.ok(cache);
        assert.deepEqual(f.getUids(), [0,1,2,3,4]);
        f.pagination.pagination('go', 2);
        assert.deepEqual(f.getUids(), [5,6,7,8,9]);
        assert.equal(f.stats.builds, 10);
        const secondNode = f.list.children('.world_entry').get(0);
        f.pagination.pagination('go', 1);
        assert.deepEqual(f.getUids(), [0,1,2,3,4]);
        assert.equal(f.list.children('.world_entry').get(0), firstNode);
        assert.equal(f.list.find('.save').get(0), firstSave);
        assert.equal(f.list.find('textarea').get(0), firstTextarea);
        assert.equal(f.stats.builds, 10, 'return visit does not call ST rendering');
        f.list.find('.save').first().trigger('click');
        assert.equal(f.stats.clickCount, 1, 'native save handler survived');
        assert.equal(f.pagination.pagination('getCurrentPageNum'), 1);
        assert.equal(f.pagination.pagination('getCurrentPageData')[0].uid, 0);
        f.pagination.pagination('go', 2);
        assert.equal(f.list.children('.world_entry').get(0), secondNode);
        assert.equal(f.stats.builds, 10);
        assert.equal(f.stats.renders, 2, 'ST callback only for first visit of pages 1 and 2');
    } finally { f.close(); }
});

test('editing form values and event handler identity survive a cached round trip, without writes', () => {
    const f = fixture();
    try {
        const cache = f.attach();
        const input = f.list.find('textarea[name="content"]').get(0);
        input.value = 'User draft';
        f.pagination.pagination('go', 2);
        f.pagination.pagination('go', 1);
        assert.equal(f.list.find('textarea[name="content"]').get(0), input);
        assert.equal(input.value, 'User draft');
        assert.equal(f.stats.builds, 10);
        cache.dispose();
        assert.equal(cache.cachedPageCount, 0);
    } finally { f.close(); }
});

test('cache invalidation on content changes forces ST native rebuild instead of restoring stale rows', () => {
    const f = fixture();
    try {
        const cache = f.attach();
        f.pagination.pagination('go', 2);
        cache.markDirty();
        assert.equal(cache.cachedPageCount, 0);
        f.pagination.pagination('go', 1);
        assert.deepEqual(f.getUids(), [0,1,2,3,4]);
        assert.equal(f.stats.builds, 15);
        assert.equal(f.pagination.pagination('getCurrentPageNum'), 1);
    } finally { f.close(); }
});

test('search/sort filter change and external disallow invalidate without reusing stale row', () => {
    const f = fixture();
    try {
        f.attach();
        f.pagination.pagination('go', 2);
        f.setSignature('book=1|sort=title|filter=none');
        f.pagination.pagination('go', 1);
        assert.equal(f.stats.builds, 15);
        f.pagination.pagination('go', 3);
        f.setAllowed(false);
        f.pagination.pagination('go', 2);
        assert.equal(f.stats.builds, 25);
    } finally { f.close(); }
});

test('only a bounded number of detached pages are retained in memory', () => {
    const f = fixture({ count: 100, maxPages: 2 });
    try {
        const cache = f.attach();
        for (let page = 2; page <= 12; page++) {
            f.pagination.pagination('go', page);
            assert.ok(cache.cachedPageCount <= 2, 'no unbounded retained pages');
        }
        assert.equal(f.stats.builds, 60);
        f.pagination.pagination('go', 1);
        assert.equal(f.stats.builds, 65, 'page 1 was evicted, native renderer used');
        cache.dispose();
        assert.equal(cache.cachedPageCount, 0);
        assert.equal(f.pagination.data('pagination').slbPageCache, undefined);
    } finally { f.close(); }
});

test('changing native page size cannot restore a page with the old page-size layout', () => {
    const f = fixture();
    try {
        const cache = f.attach();
        f.pagination.pagination('go', 2);
        const model = f.pagination.data('pagination').model;
        model.pageSize = 10; // ST plugin sets this before calling beforePaging
        f.pagination.pagination('go', 1);
        assert.equal(cache.cachedPageCount, 0);
        assert.equal(f.stats.renders, 3);
    } finally { f.close(); }
});

test('invalid rows or incomplete editors do not intercept native paging', () => {
    const f = fixture();
    try {
        const cache = f.attach();
        f.list.children('.world_entry').first().removeAttr('data-slb-display-ready');
        f.pagination.pagination('go', 2);
        assert.equal(cache.cachedPageCount, 0);
        assert.equal(f.stats.builds, 10);
        f.pagination.pagination('go', 1);
        assert.equal(f.stats.builds, 15);
    } finally { f.close(); }
});

test('repeated invalidation and reattachment never accumulates plugin paging hooks', () => {
    const f = fixture();
    try {
        const plugin = f.pagination.data('pagination');
        for (let i = 0; i < 80; i++) {
            const cache = f.attach();
            assert.equal(plugin.hooks.beforePaging.length, 1);
            cache.dispose();
            assert.equal(plugin.hooks.beforePaging.length, 0);
        }
        assert.equal(f.stats.renders, 1, 'no extra native render while attaching');
    } finally { f.close(); }
});

test('incompatible pagination event falls back to native rendering, never a blank list', () => {
    const f = fixture();
    try {
        f.attach();
        f.pagination.pagination('go', 2);
        const original = f.pagination.trigger.bind(f.pagination);
        f.pagination.trigger = function (event, args) {
            if (event === '__pagination-go' && Array.isArray(args)
                && typeof args[1] === 'function') return f.pagination;
            return original(event, args);
        };
        f.pagination.pagination('go', 1);
        assert.deepEqual(f.getUids(), [0,1,2,3,4]);
        assert.equal(f.stats.builds, 15, 'ST callback rendered after incompatible optimization');
    } finally { f.close(); }
});

test('third-party beforePaging hooks disable DOM reuse rather than firing other hooks twice', () => {
    const f = fixture();
    try {
        const plugin = f.pagination.data('pagination');
        plugin.hooks.beforePaging = [() => true];
        assert.equal(f.attach(), null, 'do not attach over an existing extension hook');
        plugin.hooks.beforePaging.length = 0;
        f.attach();
        f.pagination.pagination('go', 2);
        let thirdPartyRuns = 0;
        plugin.hooks.beforePaging.push(() => { thirdPartyRuns++; return true; });
        f.pagination.pagination('go', 1);
        assert.deepEqual(f.getUids(), [0,1,2,3,4]);
        assert.equal(f.stats.builds, 15, 'fall back to ST native callback');
        assert.equal(thirdPartyRuns, 1, 'other extension observes only original native page move');
    } finally { f.close(); }
});

test('session attaches only when ST paging plugin is initialized and supports required API', () => {
    const f = fixture();
    try {
        const a = f.attach();
        const b = f.attach();
        assert.equal(a, b, 'exact same session reused');
        a.dispose();
        assert.equal(a.disposed, true);
        const c = f.attach();
        assert.notEqual(c, a);
        c.dispose();
    } finally { f.close(); }
});
