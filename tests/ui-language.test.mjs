import test from 'node:test';
import assert from 'node:assert/strict';
import { configureUiLocale, resolveUiLocale, uiText, uiHtml } from '../ui-language.js';
test('follow ST locale, preserve Korean labels, use English fallback', () => {
  const cases = [['ko-kr','검색'],['en-us','Search'],['ja-jp','検索'],['zh-cn','搜索'],['zh-hant-tw','搜尋'],['es-mx','Buscar'],['de-de','Search']];
  for (const [locale, expected] of cases) { configureUiLocale(() => locale); assert.equal(uiText('검색'), expected); }
  assert.equal(resolveUiLocale('zh_HK'), 'zh-tw');
  configureUiLocale(() => 'en');
  assert.equal(uiText('unknown user content'), 'unknown user content');
  assert.equal(uiText('선택한 {0}개 항목을 삭제할까요?', 3), 'Delete 3 selected entries?');
  assert.equal(uiHtml('<b>'), '&lt;b&gt;');
  configureUiLocale(() => 'ko');
  assert.equal(uiText('선택한 {0}개 항목을 삭제할까요?', 3), '선택한 3개 항목을 삭제할까요?');
});
