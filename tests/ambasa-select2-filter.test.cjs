const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { JSDOM } = require('jsdom');
const makeJQuery = require('jquery');

const source = readFileSync(join(__dirname, '../index.js'), 'utf8');
function productionFunction(name) {
    const match = source.match(new RegExp('^function ' + name + '\\([^]*?^}', 'm'));
    assert.ok(match, name);
    return match[0];
}

test('Select2 filtering works with and without jQuery data', () => {
    const dom = new JSDOM(`<div class="select2-container--open"><div class="select2-results" id="select2-world_editor_select-results">
        <li role="option" class="select2-results__option">Remus</li>
        <li role="option" class="select2-results__option">Sirius</li>
        <li role="option" class="select2-results__option">Global</li>
    </div></div><div class="select2-container--open"><ul id="select2-other-results"><li role="option" class="select2-results__option">Other</li></ul></div>`, { runScripts: 'outside-only' });
    const w = dom.window;
    w.jQuery = makeJQuery(w);
    w.eval(`
        const world_names = ['Remus','Sirius','Global'];
        const isVisibleWorldOption = (id,text,names,links) => links === null || id === '' || links.has(names[Number(id)] || text);
        ${productionFunction('renderConnectedWorldResults')}
    `);
    const items = [...w.document.querySelectorAll('.select2-results__option')];
    try {
        w.jQuery(items[1]).data('data', {id: '1', text:'Sirius'});
        w.renderConnectedWorldResults(new Set(['Remus','Sirius']));
        assert.equal(items[0].classList.contains('slb-unlinked-world-option'), false);
        assert.equal(items[1].classList.contains('slb-unlinked-world-option'), false);
        assert.equal(items[2].classList.contains('slb-unlinked-world-option'), true);
        assert.equal(items[3].classList.contains('slb-unlinked-world-option'), false);
        w.renderConnectedWorldResults(null);
        assert.equal(items[2].classList.contains('slb-unlinked-world-option'), false);
    } finally { w.close(); }
});
