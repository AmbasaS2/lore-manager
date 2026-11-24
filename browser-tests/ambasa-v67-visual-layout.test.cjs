const { test } = require('node:test');
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');

const root = join(__dirname, '..');
const css = readFileSync(join(root, 'library-shelf.css'), 'utf8');
const library = readFileSync(join(root, 'library-shelf.js'), 'utf8')
    .replace(/^export /gm, '') + '\nwindow.createStandaloneLibrary = createStandaloneLibrary;';
const themes = ['mac','blackberry','ebook','antique'];
const kinds = ['general','memory','world','people'];

test('Chromium 4 themes x 4 readers x 3 widths: pager, settings layer and mini launcher', async () => {
    const browser = await chromium.launch({ headless: true });
    let checked = 0;
    try {
        for (const width of [1280, 390, 300]) {
            const page = await browser.newPage({ viewport: { width, height: 900 } });
            try {
                await page.setContent('<!doctype html><html><body></body></html>');
                await page.addStyleTag({ content: css });
                await page.addScriptTag({ content: library });
                for (const theme of themes) {
                    for (const kind of kinds) {
                        await page.evaluate(async ({ theme, kind }) => {
                            window.fixture?.close();
                            const records = Object.fromEntries(Array.from({ length: 24 }, (_, i) => [i, {
                                uid: i, displayIndex: i, comment: '기록 ' + i,
                                content: 'A harmless lore record ' + i, key: ['key'],
                            }]));
                            window.fixture = window.createStandaloneLibrary({
                                document,
                                listBooks: () => ['World'],
                                linkedBooks: () => new Set(['World']),
                                loadBook: async () => ({ entries: records }),
                                loadTranslations: async () => {},
                                translationFor: () => ({ text: '' }),
                                saveContent: async () => {}, saveTranslation: async () => {},
                                translateOne: async () => {}, openAdvanced: () => {},
                                getTheme: () => theme, setTheme: async () => {},
                                getType: () => kind, setType: () => {},
                                getTags: () => [], getTagMap: () => ({}),
                                setTags: async () => {},
                                getListPageSize: () => 5, setListPageSize: async () => {},
                                getListOrder: () => 'normal', setListOrder: async () => {},
                                getLinkedOnly: () => true, setLinkedOnly: async () => {},
                                notify: () => {},
                            });
                            window.fixture.open();
                            document.querySelector('[data-action="select-book"]').click();
                        }, { theme, kind });
                        await page.waitForSelector('.slb-library-page-navigation', { timeout: 4000 });
                        const result = await page.evaluate(({ kind }) => {
                            const q = sel => document.querySelector(sel);
                            const pager = q(kind === 'world' ? '.slb-library-world-pages' :
                                kind === 'people' ? '.slb-library-people-pages' : '.slb-library-list-pages');
                            const nav = pager?.querySelector('.slb-library-page-navigation');
                            const options = pager?.querySelector('.slb-library-page-options');
                            const typeSelect = q('#slb-library-book-type');
                            const icons = q('.slb-library-type-arrows');
                            // Capture geometry BEFORE minimizing hides the shell.
                            const typeWidth = typeSelect?.getBoundingClientRect().width;
                            const arrowsVisible = Boolean(icons && getComputedStyle(icons).display !== 'none');
                            const p1 = nav?.getBoundingClientRect(), p2 = options?.getBoundingClientRect();
                            const safePager = Boolean(pager && nav && options &&
                                (p1.right <= p2.left + 1 || p2.top >= p1.bottom - 1) &&
                                pager.scrollWidth <= pager.clientWidth + 4 &&
                                p1.left >= pager.getBoundingClientRect().left - 2 &&
                                p2.right <= pager.getBoundingClientRect().right + 3);
                            const pane = q('#slb-library-settings-panel');
                            q('[data-action="settings"]').click();
                            const titlebar = q('.slb-library-top');
                            const settingsFront = pane.parentNode === titlebar &&
                                getComputedStyle(titlebar).zIndex === '40' &&
                                Number(getComputedStyle(pane).zIndex) > Number(getComputedStyle(titlebar).zIndex);
                            q('[data-action="settings"]').click();
                            q('[data-action="minimize"]').click();
                            const mini = q('.slb-library-minimized-launcher');
                            const miniStyle = getComputedStyle(mini);
                            return {
                                safePager, typeWidth, arrowsVisible,
                                settingsFront,
                                minNoShadow: miniStyle.boxShadow === 'none' && miniStyle.filter === 'none',
                                memoryToc: kind !== 'memory' || Boolean(q('[data-action="memory-toc-toggle"]')),
                            };
                        }, { kind });
                        const context = width + 'px ' + theme + '/' + kind;
                        assert.ok(result.safePager, context + ' pager overlaps: ' + JSON.stringify(result));
                        assert.ok(result.typeWidth >= 79 && result.typeWidth <= 85,
                            context + ' select width: ' + result.typeWidth);
                        assert.ok(result.arrowsVisible, context + ' sort arrows missing');
                        assert.ok(result.settingsFront, context + ' settings behind toolbar');
                        assert.ok(result.minNoShadow, context + ' launcher has shadow');
                        assert.ok(result.memoryToc, context + ' memory TOC control missing');
                        checked++;
                    }
                }
            } finally { await page.close(); }
        }
    } finally { await browser.close(); }
    assert.equal(checked, 48);
});
