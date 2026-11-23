const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const shelf = readFileSync(join(__dirname, '../library-shelf.js'), 'utf8');
const index = readFileSync(join(__dirname, '../index.js'), 'utf8');

test('independent library UI has no informal second-person copy', () => {
  // This targets the new independent library. Existing lore entry content,
  // RP prose, translated user documents and model prompts are out of scope.
  const ban = /(?:했어|됐어|졌어|했지|할까\?|해\s*줘|해줘|열어줘|불러와\.|보여줘|보여줄게|바뀌었어|못했어|없어[.!?]|있어[.!?]|않아[.!?]|저장했어|펼쳐져[.!?]|열려[.!?])/g;
  assert.equal(shelf.match(ban), null, 'independent library guidance must be respectful Korean');
  assert.match(shelf, /연결된 로어북을 선택하세요/);
  assert.match(shelf, /변경 내용을 버리고 이동하시겠습니까/);
  assert.match(shelf, /API 이용 요금이 발생할 수 있습니다/);
  assert.match(shelf, /AI 번역이 저장되었습니다/);
});

test('new mode and standalone integration messages avoid informal user guidance', () => {
  const start=index.indexOf('function libraryTypeFor(');
  const end=index.indexOf('\nfunction init()',start);
  assert.ok(start>0 && end>start,'library integration boundaries found');
  const integration=index.slice(start,end);
  assert.equal(integration.match(/(?:했어|됐어|졌어|해\s*줘|해줘|못했어|없어[.!?]|있어[.!?]|않아[.!?]|바뀌었어)/g), null);
  assert.match(index, /실리태번 기본 로어북 화면으로 전환되었습니다/);
  assert.match(index, /로어북 매니저 통합 화면으로 전환되었습니다/);
});

test('text-only change preserves key actions, stored data model and four book types', () => {
  assert.match(shelf,/const LIBRARY_BOOK_TYPES = Object\.freeze/);
  assert.match(shelf,/function renderCatalog\(/);
  assert.match(shelf,/function renderDiary\(/);
  assert.match(shelf,/function renderIndex\(/);
  assert.match(shelf,/function saveEdit\(/);
  assert.match(shelf,/action === 'translate'/);
  assert.match(index,/saveWorldInfo\(book, fresh, true\)/);
  assert.match(index,/translationFiles\.flushBook\(book\)/);
  assert.match(index,/getTheme: \(\) => getSettings\(\)\.libraryTheme === 'clean'/);
});
