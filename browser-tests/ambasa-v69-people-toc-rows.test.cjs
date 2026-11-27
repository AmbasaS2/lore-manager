const { test } = require('node:test');
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const root = join(__dirname, '..');
const css = readFileSync(join(root, 'library-shelf.css'), 'utf8');
const script = require('./library-fixture-script.cjs').libraryFixtureScript();

test('Chromium 4 themes x 3 viewports x 3 shelf row settings retain layout and live people TOC', async () => {
    const browser = await chromium.launch({ headless: true });
    let checked = 0;
    try {
        for (const viewport of [390, 820, 1280]) {
            const page = await browser.newPage({ viewport: { width: viewport, height: 950 } });
            try {
                await page.setContent('<!doctype html><html><body></body></html>');
                await page.addStyleTag({ content: css });
                await page.addScriptTag({ content: script });
                for (const theme of ['mac', 'blackberry', 'ebook', 'antique']) {
                    for (const rows of [1, 2, 3]) {
                        const result = await page.evaluate(async ({ theme, rows }) => {
                            window.fixture?.close();
                            const books = Array.from({ length: 80 }, (_, i) => 'Book ' + i);
                            const entries = Object.fromEntries(Array.from({ length: 40 }, (_, i) => [i, {
                                uid: i, displayIndex: i, comment: 'Person ' + i,
                                content: 'A source record ' + i, key: ['index'],
                            }]));
                            let stored = rows;
                            let saves = 0;
                            window.fixture = window.createStandaloneLibrary({
                                document, listBooks: () => books,
                                linkedBooks: () => new Set(books),
                                loadBook: async () => ({ entries }),
                                loadTranslations: async () => {},
                                translationFor: () => ({ text: '' }),
                                saveContent: async () => { saves++; },
                                saveTranslation: async () => { saves++; },
                                translateOne: async () => { saves++; }, openAdvanced: () => {},
                                getTheme: () => theme, getType: () => 'people',
                                getTypeMap: () => Object.fromEntries(books.map(x => [x, 'people'])),
                                getTags: () => [], getTagMap: () => ({}), setTags: async () => {},
                                getListPageSize: () => 5, getListOrder: () => 'normal',
                                getShelfRows: () => stored,
                                setShelfRows: async next => { stored = next; },
                                getLinkedOnly: () => true,
                                getWindowSize: narrow => narrow ? null : { width: 900, height: 760 },
                                notify: () => {},
                            });
                            window.fixture.open();
                            const grid = document.querySelector('.slb-library-book-spines,.slb-library-folder-grid,.slb-library-app-grid,.slb-library-cover-grid');
                            const cols = Number(grid.style.getPropertyValue('--slb-shelf-columns'));
                            const initial = document.querySelectorAll('[data-action="select-book"]').length;
                            const configuredRows = document.querySelector('#slb-library-shelf-rows').value;
                            document.querySelector('[data-action="select-book"]').click();
                            await Promise.resolve();
                            await Promise.resolve();
                            document.querySelector('[data-action="entry"]').click();
                            const toc = document.querySelector('#slb-library-people-toc');
                            const detail = document.querySelector('.slb-library-detail-people');
                            const layout = document.querySelector('.slb-library-people-detail-layout');
                            const button = document.querySelector('[data-action="people-toc-toggle"]');
                            if (!toc || !detail || !button) return { missing: true, initial, cols, configuredRows };
                            const before = detail.getBoundingClientRect();
                            const shell = document.querySelector('.slb-library-shell');
                            button.click();
                            const after = detail.getBoundingClientRect();
                            const hidden = getComputedStyle(document.querySelector('#slb-library-people-contents')).display === 'none' && getComputedStyle(toc.querySelector('.slb-library-toc-heading')).display !== 'none';
                            const layoutRect = layout.getBoundingClientRect();
                            const shellRect = shell.getBoundingClientRect();
                            return {
                                missing: false, cols, initial, configuredRows, hidden,
                                sameDetail: document.querySelector('.slb-library-detail-people') === detail,
                                oneCol: getComputedStyle(layout).gridTemplateColumns.split(' ').length <= 1,
                                minWidth: after.width >= Math.min(before.width, layoutRect.width) - 2,
                                inside: layoutRect.right <= shellRect.right + 4 &&
                                    layoutRect.left >= shellRect.left - 4,
                                saves,
                            };
                        }, { theme, rows });
                        const context = theme + '/' + viewport + 'px/' + rows + ' rows ' + JSON.stringify(result);
                        assert.equal(result.missing, false, context);
                        assert.equal(result.initial, rows * result.cols, context);
                        assert.equal(result.configuredRows, String(rows), context);
                        assert.ok(result.hidden && result.sameDetail && result.oneCol && result.minWidth, context);
                        assert.ok(result.inside, context);
                        assert.equal(result.saves, 0, context);
                        checked++;
                    }
                }
            } finally { await page.close(); }
        }
    } finally { await browser.close(); }
    assert.equal(checked, 36);
});
