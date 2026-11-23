const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');

const css = readFileSync(join(__dirname, '../library-shelf.css'), 'utf8');
const shelf = readFileSync(join(__dirname, '../library-shelf.js'), 'utf8');
const js = readFileSync(join(__dirname, '../index.js'), 'utf8');

function rule(selector) {
  const start=css.indexOf(selector);
  assert.ok(start >= 0,'missing shelf rule: '+selector);
  const open=css.indexOf('{',start);
  const close=css.indexOf('}',open);
  return css.slice(open+1,close);
}

test('bookshelf uses responsive auto-wrapping grid rather than a single horizontal row', () => {
  const spines=rule('#slb-library-overlay .slb-library-book-spines');
  assert.match(spines,/display:\s*grid;/);
  assert.match(spines,/grid-template-columns:\s*repeat\(auto-fill,\s*52px\);/);
  assert.match(spines,/grid-auto-rows:\s*250px;/);
  assert.match(spines,/width:\s*100%;/);
  assert.doesNotMatch(spines,/width:\s*max-content|flex-wrap:\s*nowrap/);
  const scroll=rule('#slb-library-overlay .slb-library-books-scroll');
  assert.doesNotMatch(scroll,/overflow-x:\s*auto|overflow-y:\s*hidden/);
  assert.match(css,/\.slb-library-book-spines\s*\{\s*grid-template-columns:\s*repeat\(auto-fill,\s*47px\);/);
});

test('each wrapped row includes a wooden shelf; empty books keep full width', () => {
  const spines=rule('#slb-library-overlay .slb-library-book-spines');
  assert.match(spines,/repeating-linear-gradient\(to bottom,/);
  assert.match(spines,/transparent 230px/);
  assert.match(spines,/#4f311f 250px/);
  const book=rule('#slb-library-overlay button.slb-library-book-spine');
  assert.match(book,/margin-bottom:\s*20px;/);
  assert.match(rule('#slb-library-overlay .slb-library-wood-plank'),/display:\s*none;/);
  assert.match(rule('#slb-library-overlay .slb-library-shelf-empty'),/grid-column:\s*1\s*\/\s*-1;/);
});

test('wrapping changes CSS only and keeps tag, translation and font inheritance', () => {
  assert.match(shelf,/slb-library-book-spines/);
  assert.match(shelf,/getTagMap/);
  assert.match(shelf,/function saveBookTags\(/);
  assert.match(shelf,/function renderBookTagPanel\(/);
  assert.match(shelf,/function selectBook\(/);
  assert.match(js,/saveWorldInfo\(book,\s*fresh,\s*true\)/);
  assert.match(css,/writing-mode:\s*vertical-rl/);
  assert.match(css,/text-orientation:\s*mixed/);
  assert.doesNotMatch(css,/(?:font-family\s*:|@font-face|Georgia|Noto Serif KR)/i);
});
