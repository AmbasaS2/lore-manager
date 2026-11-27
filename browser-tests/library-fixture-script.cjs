// Load the actual locale dictionaries and library implementation in
// isolated Chromium with the default Korean fixture locale.
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
function libraryFixtureScript() {
    const root = join(__dirname, '..');
    const files = ['ui-language-settings.js', 'ui-language-library.js', 'ui-language-editor.js', 'ui-language.js', 'library-shelf.js'];
    return files.map(file => readFileSync(join(root, file), 'utf8')
        .replace(/^import\s+\{[^}\r\n]+\}\s+from\s+['"][^'"]+['"];?\s*$/gm, '')
        .replace(/^export /gm, '')).join('\n') + '\nwindow.createStandaloneLibrary = createStandaloneLibrary;';
}
module.exports = { libraryFixtureScript };
