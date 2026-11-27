const {test} = require('node:test');
const assert = require('node:assert/strict');
const {readFileSync} = require('node:fs');
const {join} = require('node:path');
const { JSDOM, uiText, uiHtml } = require('./fixture-ui-language.cjs');
const vm = require('node:vm');

const source = readFileSync(join(__dirname, '../index.js'), 'utf8');
const css = readFileSync(join(__dirname, '../style.css'), 'utf8');
function production(name) {
    const found = source.match(new RegExp('^function ' + name + '\\([^]*?^}', 'm'));
    assert.ok(found, 'missing production function ' + name);
    return found[0];
}

test('compact token summary displays five Font Awesome icons with only numeric values', () => {
    const dom = new JSDOM('<main id="fixture"></main>', {runScripts:'outside-only'});
    const ctx = {
        uiText, uiHtml,
        document: dom.window.document,
        state: {editorUiSuspended:false},
        WeakMap,
        hashText: text => 'h:' + String(text),
        createElement(tag, className) {
            const node = dom.window.document.createElement(tag);
            if (className) node.className = className;
            return node;
        },
        currentBookName: () => 'Vivian',
        lorebookEntries: data => Object.values(data.entries),
    };
    const entries = Array.from({length:57}, (_,i)=>({
        uid:i,
        content:'lore ' + i,
        constant:i<3,
        vectorized:i>=3,
        disable:false,
    }));
    const cache = new Map();
    let total = 0;
    for(const entry of entries) {
        const count = entry.constant ? (entry.uid===2 ? 954 : 953) : (entry.uid===56 ? 397 : 390);
        total += count;
        cache.set(String(entry.uid), {hash:'h:'+entry.content,count});
    }
    assert.equal(total,23927,'the user example sums correctly');
    ctx.getBookTokenCache = () => cache;
    vm.runInNewContext('const entryContentHashCache = new WeakMap();\n'
        + production('hashEntryContent') + '\n'
        + production('updateTokenStatDisplay') + '\n'
        + production('createTokenStrip') + '\n'
        + production('renderTokenSummary') + '\n'
        + production('setTokenSummaryPending') + '\n'
        + 'globalThis.api={createTokenStrip,renderTokenSummary,setTokenSummaryPending};',ctx);
    try {
        const strip=ctx.api.createTokenStrip();
        dom.window.document.getElementById('fixture').append(strip);
        assert.equal(strip.querySelectorAll('.slb-token-stat').length,5);
        assert.equal(strip.querySelectorAll('.slb-stat-icon').length,5);
        const ids=['slb-total-tokens','slb-constant-tokens','slb-selective-tokens','slb-vectorized-tokens','slb-entry-count'];
        const get = id => dom.window.document.getElementById(id);
        const values = () => ids.map(id=>get(id).textContent);
        ctx.api.renderTokenSummary('Vivian', {entries:Object.fromEntries(entries.map(e=>[e.uid,e]))});
        assert.deepEqual(values(),['23,927','2,860','0','21,067','57']);
        for(const item of strip.querySelectorAll('.slb-token-stat')){
            assert.match(item.querySelector('strong').textContent,/^[0-9,]+$/);
            assert.ok(item.getAttribute('aria-label'));
            assert.equal(item.querySelectorAll('i').length,1);
        }
        assert.match(get('slb-entry-count').parentElement.title,/활성 57개 · 상시 3개 · 선택 0개 · 벡터 54개/);
        assert.equal(strip.querySelector('.slb-stat-constant').classList.contains('fa-circle'),true);
        assert.equal(strip.querySelector('.slb-stat-normal').classList.contains('fa-circle'),true);
        assert.equal(strip.querySelectorAll('.fa-link').length,1);

        entries[5].content='edited lore';
        ctx.api.renderTokenSummary('Vivian',{entries:Object.fromEntries(entries.map(e=>[e.uid,e]))});
        assert.equal(get('slb-total-tokens').textContent,'…');
        assert.equal(get('slb-vectorized-tokens').textContent,'…');
        assert.match(get('slb-total-tokens').parentElement.title,/계산 중/);
        cache.set('5',{hash:'h:edited lore',count:390});
        ctx.api.renderTokenSummary('Vivian',{entries:Object.fromEntries(entries.map(e=>[e.uid,e]))});
        assert.deepEqual(values(),['23,927','2,860','0','21,067','57']);

        ctx.api.setTokenSummaryPending();
        assert.deepEqual(values(),['…','…','…','…','—']);
        assert.match(get('slb-total-tokens').parentElement.getAttribute('aria-label'),/계산 중/);
    }finally{dom.window.close();}
});

test('stat strip uses one theme-native compact layout and does not hide full accessible counts', () => {
    assert.match(css,/#WorldInfo\.slb-active \.slb-token-strip > span\s*\{[^}]*display:\s*inline-flex/s);
    assert.match(css,/#WorldInfo\.slb-active \.slb-token-strip > span\s*\{[^}]*white-space:\s*nowrap/s);
    assert.match(css,/#WorldInfo\.slb-active \.slb-stat-constant\s*\{\s*color:\s*#428bfa/);
    assert.match(css,/#WorldInfo\.slb-active \.slb-stat-normal\s*\{\s*color:\s*#29b765/);
    assert.match(source,/wrapper\.setAttribute\('aria-label', detail\)/);
    assert.match(source,/wrapper\.title = breakdown/);
});
