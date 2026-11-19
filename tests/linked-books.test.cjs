const { test } = require('node:test');
const assert = require('node:assert/strict');
const { pathToFileURL } = require('node:url');
const { join } = require('node:path');
const importer = import(pathToFileURL(join(__dirname, '../linked-books.js')).href);

test('unselected character always exposes the complete lorebook list', async () => {
    const { linkedBooksForCharacter, isVisibleWorldOption } = await importer;
    assert.equal(linkedBooksForCharacter(null, {}, ''), null);
    assert.equal(isVisibleWorldOption('10', 'Unrelated', [], null), true);
});
test('primary and auxiliary character books are included, global and chat books are not', async () => {
    const { linkedBooksForCharacter, isVisibleWorldOption } = await importer;
    const character = { data: { extensions: { world: 'Remus' } } };
    const info = { globalSelect: ['Global'], charLore: [
        { name: 'remus', extraBooks: ['Sirius', 'Remus', '', null] },
        { name: 'other', extraBooks: ['Other'] },
    ] };
    const set = linkedBooksForCharacter(character, info, 'remus');
    assert.deepEqual([...set].sort(), ['Remus', 'Sirius']);
    assert.equal(isVisibleWorldOption('0', 'Wrong', ['Remus','Sirius','Global'], set), true);
    assert.equal(isVisibleWorldOption('1', 'Wrong', ['Remus','Sirius','Global'], set), true);
    assert.equal(isVisibleWorldOption('2', 'Wrong', ['Remus','Sirius','Global'], set), false);
    assert.equal(isVisibleWorldOption('', '--', [], set), true);
});
test('character without attached books yields an empty list, not all books', async () => {
    const { linkedBooksForCharacter, isVisibleWorldOption } = await importer;
    const books = linkedBooksForCharacter({ data: {extensions:{}} }, {}, 'none');
    assert.equal(books.size, 0);
    assert.equal(isVisibleWorldOption('1', 'Unrelated', [], books), false);
});
test('names rather than numeric option positions decide the filter', async () => {
    const { isVisibleWorldOption } = await importer;
    const linked = new Set(['Second']);
    assert.equal(isVisibleWorldOption('7','Second', [], linked), true);
    assert.equal(isVisibleWorldOption('0','Second', ['Other'], linked), false);
});
