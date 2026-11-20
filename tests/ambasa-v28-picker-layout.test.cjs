const {test}=require('node:test');
const assert=require('node:assert/strict');
const {readFileSync}=require('node:fs');
const {join}=require('node:path');
const source=readFileSync(join(__dirname,'../index.js'),'utf8');
const css=readFileSync(join(__dirname,'../style.css'),'utf8');

test('translation popup is compact and constrained to a single grid column',()=>{
    assert.match(css,/\.popup:has\(\.slb-translation-picker\)\s*\{[^}]*width:\s*min\(380px,\s*calc\(100dvw - 24px\)\)/);
    assert.match(css,/\.slb-translation-picker\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)/);
    assert.match(source,/list\.style\.maxHeight = 'min\(30dvh, 204px\)'/);
    assert.match(source,/list\.style\.overflowY = 'auto'/);
});

test('select-all button has a dedicated horizontal flex row and cannot break Korean into stacked letters',()=>{
    assert.match(source,/selectionTools\.append\(selectAllButton, selectedStatus\)/);
    assert.match(source,/form\.append\(fieldLabel, selectionTools, list, showAllLabel, status\)/);
    assert.match(css,/\.slb-translation-picker-tools\s*\{[^}]*display:\s*flex/);
    assert.match(css,/\.slb-translation-picker-tools > \.slb-translation-picker-select-all\s*\{[^}]*width:\s*auto !important/);
    assert.match(css,/\.slb-translation-picker-tools > \.slb-translation-picker-select-all\s*\{[^}]*white-space:\s*nowrap !important/);
    assert.match(css,/\.slb-translation-picker-selected\s*\{[^}]*white-space:\s*nowrap/);
});

test('popup changes are local to translation picker without editing unrelated styles',()=>{
    const onlyScoped = css.slice(css.indexOf('/* Native ST popup picker.'),css.indexOf('/* A single on-demand tooltip',css.indexOf('/* Native ST popup picker.')));
    assert.ok(onlyScoped.includes('.slb-translation-picker-tools'));
    assert.ok(!onlyScoped.includes('#WorldInfo .world_entry'));
});
