const { test } = require('node:test');
const assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { pathToFileURL } = require('node:url');

const root = join(__dirname, '..');
const libraryUrl = pathToFileURL(join(root, 'library-shelf.js')).href;
const css = readFileSync(join(root, 'library-shelf.css'), 'utf8');
const js = readFileSync(join(root, 'library-shelf.js'), 'utf8');
const tick = () => new Promise(resolve => setImmediate(resolve));

async function fixture(theme, type, n = 24) {
    const { createStandaloneLibrary } = await import(libraryUrl);
    const dom = new JSDOM('<!doctype html><html><body></body></html>', { pretendToBeVisual: true });
    const win = dom.window; win.confirm = () => true;
    const entries = Object.fromEntries(Array.from({ length: n }, (_, i) => [i, {
        uid: i, displayIndex: i, comment: 'Record ' + i,
        content: 'Original story text ' + i + ' with a clue',
        key: ['key-' + i, 'harbor'],
    }]));
    const original = JSON.stringify(entries);
    const stats = { read: 0, writes: 0, ai: 0 };
    const lib = createStandaloneLibrary({
        document: win.document,
        listBooks: () => ['World'], linkedBooks: () => new Set(['World']),
        loadBook: async () => { stats.read++; return { entries }; },
        loadTranslations: async () => {},
        translationFor: (_book,entry) => ({
            title: '', text: '번역문 ' + entry.uid, stale: false,
            pair: { sourceLanguage: 'English', translationLanguage: 'Korean' },
        }),
        saveContent: async () => { stats.writes++; },
        saveTranslation: async () => { stats.writes++; },
        translateOne: async () => { stats.ai++; },
        openAdvanced: () => {},
        getType: () => type, setType: () => {},
        getTypeMap: () => ({ World: type }),
        getTheme: () => theme, setTheme: async () => {},
        getTags: () => [], getTagMap: () => ({}), setTags: async () => {},
        getListPageSize: () => 5, setListPageSize: async () => {},
        getListOrder: () => 'normal', setListOrder: async () => {},
        getLinkedOnly: () => true, setLinkedOnly: async () => {},
        getWindowSize: () => ({ width: 460, height: 700 }),
        notify: () => {},
    });
    const q = selector => win.document.querySelector(selector);
    const click = selector => { const node = q(selector); assert.ok(node, selector); node.click(); };
    const open = async () => { lib.open(); click('[data-action="select-book"]'); await tick(); };
    return { lib,dom,win,entries,original,stats,q,click,open };
}

test('v72 visual identity: all 16 real reader combinations render their existing data safely', async () => {
    for (const theme of ['mac','blackberry','ebook','antique']) {
        for (const type of ['general','memory','world','people']) {
            const f = await fixture(theme, type);
            try {
                await f.open();
                const frame = f.q('.slb-library-reader-frame');
                assert.ok(frame, theme + '/' + type);
                assert.equal(frame.dataset.libraryMode, theme);
                assert.equal(frame.dataset.bookType, type);
                if (type === 'general') {
                    assert.ok(f.q('.slb-library-clean-list-row') || f.q('.slb-library-catalog-card'));
                    if (theme === 'ebook' || theme === 'antique') {
                        const excerpt = f.q('.slb-library-card-excerpt');
                        assert.ok(excerpt && excerpt.textContent.startsWith('Original story text'));
                        f.click('[data-action="entry"]');
                    }
                } else if (type === 'memory') {
                    assert.equal(f.win.document.querySelectorAll('.slb-library-diary-toc .slb-library-index-item').length, 5);
                    assert.ok(f.q('[data-action="memory-toc-toggle"]'));
                } else if (type === 'world') {
                    assert.equal(f.win.document.querySelectorAll('#slb-library-world-contents .slb-library-index-item').length, 5);
                    assert.ok(f.q('[data-action="world-toc-toggle"]'));
                } else {
                    assert.equal(f.win.document.querySelectorAll('.slb-library-person-row').length, 5);
                    f.click('[data-action="entry"]');
                    assert.ok(f.q('[data-action="people-toc-toggle"]'));
                }
                const entry = f.q('.slb-library-detail');
                assert.ok(entry);
                const chips = entry.querySelectorAll('.slb-library-keyword-chip');
                assert.equal(chips.length, 2, theme+'/'+type);
                assert.equal(chips[0].textContent, 'key-0');
                assert.deepEqual(f.stats, { read:1,writes:0,ai:0 });
                assert.equal(JSON.stringify(f.entries), f.original);
            } finally { f.dom.window.close(); }
        }
    }
});

test('240 memory entries remain paginated: five TOC rows, no eager translation/AI writes', async () => {
    for (const theme of ['mac','blackberry','ebook','antique']) {
        const f = await fixture(theme, 'memory', 240);
        try {
            await f.open();
            assert.equal(f.win.document.querySelectorAll('.slb-library-diary-toc .slb-library-index-item').length, 5);
            f.click('[data-action="memory-list-next"]');
            assert.equal(f.win.document.querySelectorAll('.slb-library-diary-toc .slb-library-index-item').length, 5);
            f.click('[data-action="memory-toc-toggle"]');
            assert.equal(f.q('#slb-library-memory-contents').hidden, true);
            assert.ok(f.q('.slb-library-detail-memory'));
            assert.equal(f.stats.writes, 0);
            assert.equal(f.stats.ai, 0);
            assert.equal(JSON.stringify(f.entries),f.original);
        } finally {f.dom.window.close();}
    }
});

test('v72 skin rules contain 4 distinct themes × 4 view-mode scopes, with no background work', () => {
    const scoped = css.slice(css.lastIndexOf('/* ambasa.71'));
    assert.ok(scoped.length > 15000);
    for(const theme of ['mac','blackberry','ebook','classic']) {
        for(const type of ['general','memory','world','people']) {
            assert.ok(scoped.includes('slb-library-reader-' + theme + '[data-book-type="' + type + '"]'),
                theme+'/'+type+' missing dedicated style');
        }
    }
    assert.match(scoped, /BlackBerry.*MemoPad/i);
    assert.match(scoped, /background: linear-gradient\(#28414f,#233945\)/);
    assert.match(scoped, /grid-template-columns: repeat\(2,minmax\(0,1fr\)\)/);
    assert.match(scoped, /white-space:\s*nowrap/);
    assert.doesNotMatch(scoped, /MutationObserver|ResizeObserver|setInterval|setTimeout|requestAnimationFrame|fetch\(/);
    assert.doesNotMatch(js, /setInterval\(/);
    assert.equal(JSON.parse(readFileSync(join(root,'manifest.json'),'utf8')).version,'1.4.85-ambasa.78');
});
