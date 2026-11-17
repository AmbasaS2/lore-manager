const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { JSDOM } = require('jsdom');
const { parse } = require('rrweb-cssom');
const vm = require('node:vm');
const code = readFileSync(join(__dirname, '../index.js'), 'utf8');
const stylesheet = readFileSync(join(__dirname, '../style.css'), 'utf8');
const criticalFunction = code.slice(code.indexOf('function ensureCriticalLayoutStyles()'), code.indexOf('function getSettings()'));

// Resolve the actual header rules, including dynamically appended critical CSS.
// jsdom does not evaluate viewport media queries, so select the applicable
// width rules explicitly. The matched header selectors use IDs, classes,
// element names and :not(); no :is(), :where() or cascade layers.
function specificity(selector) {
    const plain = selector.replace(/:not\(([^()]*)\)/g, '$1');
    return (plain.match(/#[\w-]+/g) || []).length * 10000
        + ((plain.match(/\.[\w-]+|\[[^\]]+\]|:[\w-]+/g) || []).length * 100)
        + (plain.replace(/#[\w-]+|\.[\w-]+|\[[^\]]+\]|:[\w-]+/g, '').match(/[a-zA-Z][\w-]*/g) || []).length;
}
function winningProperty(sheets, element, property, width) {
    let winner = { value: '', rank: -1 };
    function visit(rules) {
        for (const rule of rules) {
            if (rule.media) {
                const query = rule.media.mediaText;
                const constraints = [...query.matchAll(/(min|max)-width:\s*(\d+)px/g)];
                if (constraints.every(([,kind,value]) => kind === 'min' ? width >= +value : width <= +value)) visit(rule.cssRules);
                continue;
            }
            if (!rule.selectorText || !rule.style.getPropertyValue(property)) continue;
            for (const selector of rule.selectorText.split(/,(?![^()]*\))/)) {
                if (!element.matches(selector)) continue;
                const rank = (rule.style.getPropertyPriority(property) === 'important' ? 1000000 : 0) + specificity(selector);
                if (rank >= winner.rank) winner = { value: rule.style.getPropertyValue(property), rank };
            }
        }
    }
    sheets.forEach(sheet => visit(sheet.cssRules));
    return winner.value;
}

for (const width of [320, 390, 760, 1280]) test(`translated title escapes fixed rows and display:contents at ${width}px`, () => {
    const dom = new JSDOM(`<div id="WorldInfo" class="slb-active slb-mobile-entry-state-enabled"><div class="world_entry slb-has-title-translation ${width <= 760 ? 'slb-compact-entry' : ''}"><div class="slb-entry-header-shell"><div class="slb-header-grid ${width <= 760 ? 'slb-header-title-only' : ''}"><div class="slb-header-field slb-title-field slb-has-field-translation"><textarea name="comment"></textarea><button class="text_pole slb-field-translation">번역 제목</button></div></div></div></div></div>`);
    try {
        vm.runInNewContext(criticalFunction + '\nensureCriticalLayoutStyles();', { document: dom.window.document, VERSION: 'test' });
        const sheets = [parse(stylesheet), parse(dom.window.document.querySelector('style').textContent)];
        const grid = dom.window.document.querySelector('.slb-header-grid');
        const title = dom.window.document.querySelector('.slb-title-field');
        assert.equal(winningProperty(sheets, grid, 'grid-template-rows', width), width <= 760 ? 'auto' : '22px minmax(32px, auto)');
        assert.equal(winningProperty(sheets, title, 'display', width), 'flex');
        assert.equal(winningProperty(sheets, title, 'height', width), 'auto');
        assert.match(winningProperty(sheets, title.lastElementChild, 'border', width), /^1px solid /);
        // Untranslated entries keep their previous compact layout.
        title.closest('.world_entry').classList.remove('slb-has-title-translation');
        title.classList.remove('slb-has-field-translation');
        assert.equal(winningProperty(sheets, grid, 'grid-template-rows', width), width <= 760 ? '29px' : '22px 32px');
    } finally { dom.window.close(); }
});
