const {test}=require('node:test');
const assert=require('node:assert/strict');
const {readFileSync}=require('node:fs');
const {join}=require('node:path');
const css=readFileSync(join(__dirname,'../library-shelf.css'),'utf8');
const shelf=readFileSync(join(__dirname,'../library-shelf.js'),'utf8');
const js=readFileSync(join(__dirname,'../index.js'),'utf8');

function rule(selector) {
    const start=css.indexOf(selector);
    assert.ok(start>=0,'missing shelf rule '+selector);
    const a=css.indexOf('{',start),b=css.indexOf('}',a);
    return css.slice(a+1,b);
}

test('real-material bookshelf uses the same CSS grid column count as DOM two-row limit',()=>{
    const spines=rule('#slb-library-overlay .slb-library-book-spines');
    assert.match(spines,/display:\s*grid/);
    assert.match(spines,/grid-template-columns:\s*repeat\(var\(--slb-shelf-columns,\s*12\),\s*minmax\(0,\s*1fr\)\)/);
    assert.match(spines,/grid-auto-rows:\s*163px/);
    assert.match(spines,/width:\s*100%/);
    assert.doesNotMatch(spines,/width:\s*max-content|flex-wrap:\s*nowrap/);
    const scroll=rule('#slb-library-overlay .slb-library-books-scroll');
    assert.doesNotMatch(scroll,/overflow-x:\s*auto|overflow-y:\s*hidden/);
    assert.match(shelf,/spines\.style\.setProperty\('--slb-shelf-columns',\s*String\(rowWidth\)\)/);
    assert.match(shelf,/const maxVisible = shelfRows \* rowWidth/);
});

test('wrapped rows are separated by material shelf boards, no fixed spine width or font',()=>{
    const spines=rule('#slb-library-overlay .slb-library-book-spines');
    assert.match(spines,/repeating-linear-gradient\(to bottom/);
    assert.match(spines,/transparent 151px/);
    assert.match(spines,/#241a13 163px/);
    const book=rule('#slb-library-overlay button.slb-library-book-spine');
    assert.match(book,/margin:\s*0 0 13px/);
    assert.match(book,/width:\s*100%/);
    assert.match(rule('#slb-library-overlay .slb-library-wood-plank'),/display:\s*none/);
    assert.match(rule('#slb-library-overlay .slb-library-shelf-empty'),/grid-column:\s*1\s*\/\s*-1/);
    assert.doesNotMatch(css,/font-family\s*:|@font-face/i);
});

test('writing modes, translations, tags and original save path remain unchanged',()=>{
    assert.match(css,/writing-mode:\s*vertical-rl/);
    assert.match(css,/text-orientation:\s*mixed/);
    assert.match(shelf,/function saveBookTags\(/);
    assert.match(shelf,/function renderBookTagPanel\(/);
    assert.match(shelf,/function selectBook\(/);
    assert.match(js,/saveWorldInfo\(book,\s*fresh,\s*true\)/);
});
