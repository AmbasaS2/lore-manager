// Extracted-function tests run in isolated browser/VM realms. Bind actual
// production localization helpers rather than hard-coding Korean labels.
const { JSDOM: BaseJSDOM } = require('jsdom');
const { configureUiLocale, uiText, uiHtml } = require('../ui-language.js');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
configureUiLocale(() => 'ko');
class JSDOM extends BaseJSDOM {
    constructor(...args) {
        super(...args);
        Object.assign(this.window, { uiText, uiHtml });
    }
}
function stripUiImport(source) {
    return source.replace(/^import\s+\{[^}\r\n]+\}\s+from\s+['"]\.\/ui-language\.js['"];?\s*$/gm, '');
}
function renderKoreanTemplate(source) {
    return source.replace(/\$\{uiHtml\("([^"]+)"\)\}/g, (_, label) => uiHtml(label));
}
function assertReleaseVersion(root) {
    const manifest = JSON.parse(readFileSync(join(root, 'manifest.json'), 'utf8'));
    const runtime = readFileSync(join(root, 'index.js'), 'utf8').match(/^const VERSION = '([^']+)';/m);
    assert.ok(runtime, 'runtime release version exists');
    assert.equal(manifest.version, runtime[1], 'manifest and runtime version must agree');
    const parsed = manifest.version.match(/^(\d+)\.(\d+)\.(\d+)-ambasa\.(\d+)$/);
    assert.ok(parsed, 'version follows the fork release format');
    const [, major, minor, patch, revision] = parsed.map(Number);
    assert.ok(major > 1 || major === 1 && (minor > 4 || minor === 4 && (patch > 85 || patch === 85 && revision >= 82)), 'release is not older than the regression baseline');
}
module.exports = { JSDOM, uiText, uiHtml, stripUiImport, renderKoreanTemplate, assertReleaseVersion };
