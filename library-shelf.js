
// Independent, on-demand lorebook reader. This module neither watches nor
// reparents SillyTavern's WorldInfo DOM. Original data remains in ST world files.
export const LIBRARY_BOOK_TYPES = Object.freeze({
    general: '카드파일',
    memory: '메모리',
    world: '백과사전',
    people: '인물록',
});
const LIBRARY_THEME_LABELS = Object.freeze({
    mac: '맥북',
    blackberry: '블랙베리',
    ebook: 'E북 서재',
    antique: '클래식 아카이브',
});
const LIBRARY_TYPE_MARKS = Object.freeze({ general: 'F', memory: 'J', world: 'W', people: 'A–Z' });
// Korean 가나다 order, Latin alphabetical order, natural numeric sorting.
const LIBRARY_TITLE_COLLATOR = new Intl.Collator('ko', { numeric: true, sensitivity: 'base' });

export function orderedLoreEntries(book) {
    const entries = Object.values(book?.entries || {}).filter(item => item && typeof item.content === 'string');
    // Reader-only numeric World Info Order. displayIndex belongs to the editor
    // and may be unrelated to the order values or numbered memory titles.
    // Missing/invalid orders follow numeric orders in ascending order; ties
    // retain the source-file order. Descending is the exact reversed list.
    return entries.map((entry, index) => {
        const raw = entry.order;
        const numeric = typeof raw === 'number' || (typeof raw === 'string' && raw.trim() !== '')
            ? Number(raw) : NaN;
        return { entry, index, order: Number.isFinite(numeric) ? numeric : Infinity };
    }).sort((a, b) => a.order === b.order ? a.index - b.index : a.order < b.order ? -1 : 1)
        .map(item => item.entry);
}

// User-defined book tags are metadata, never lorebook entry properties.
export function normalizeLibraryTags(tags) {
    if (!Array.isArray(tags)) return [];
    return [...new Set(tags.filter(tag => typeof tag === 'string').map(tag => tag.trim()).filter(Boolean))].slice(0, 8);
}

export function canonicalLibraryBookNames(worldNames) {
    return [...new Set((Array.isArray(worldNames) ? worldNames : [])
        .filter(name => typeof name === 'string' && name.trim()))];
}

// ST stores uploaded images at user/images/*. Do not render external URLs,
 // data: payloads or executable URLs from untrusted extension settings.
export function safeLibraryImagePath(value) {
    if (typeof value !== 'string') return '';
    const path = value.startsWith('/') ? value : '/' + value;
    if (!path.startsWith('/user/images/') || path.includes('..') || path.includes('\\')
        || /[<>?#]/.test(path) || /[\r\n\0]/.test(path)) return '';
    return path;
}

export function uniqueLibraryBooks(names, linkedNames) {
    const unique = [...new Set((names || []).map(String).map(value => value.trim()).filter(Boolean))];
    const linked = linkedNames instanceof Set ? linkedNames : null;
    return unique.map(name => ({ name, linked: linked === null || linked.has(name) }));
}

function element(doc, tag, className = '', text = '') {
    const node = doc.createElement(tag);
    if (className) node.className = className;
    if (text) node.textContent = text;
    return node;
}

function button(doc, className, label, action, uid = null) {
    const node = element(doc, 'button', className, label);
    node.type = 'button';
    node.dataset.action = action;
    if (uid !== null) node.dataset.uid = String(uid);
    return node;
}

function faIcon(doc, icon) {
    const node = element(doc, 'i', 'fa-solid fa-' + icon);
    node.setAttribute('aria-hidden', 'true');
    return node;
}

function dateLabel(title) {
    const found = String(title || '').match(/\b(?:19|20)\d{2}[./-](?:0?[1-9]|1[0-2])[./-](?:[0-2]?\d|3[01])\b/);
    return found ? found[0].replace(/[./]/g, '-') : '';
}

// A timeline is a view of stored data, never a new AI-generated summary.
export function memoryTimelinePreview(content, title = '') {
    const text = String(content || '').trim();
    const lines = text.split(/\r?\n/u);
    const heading = line => line.trim().replace(/^#{1,6}\s+/u, '').replace(/\*\*|__/gu, '').trim();
    const dateLine = lines.map(heading).find(line => /^(?:Timeline|타임라인|시간선|시간대|일시|날짜)\s*[:：]/iu.test(line));
    const marker = dateLine?.replace(/^[^:：]+[:：]\s*/u, '').trim() || '';
    const date = marker && !/^(?:unknown|not established|미상|알 수 없음|불명|미확인)[.!]?$/iu.test(marker)
        ? marker : dateLabel(title);
    const resultIndex = lines.findIndex(line => /^(?:Result|결과|결말)\s*(?:[:：].*)?$/iu.test(heading(line)));
    if (resultIndex >= 0) {
        const sameLine = heading(lines[resultIndex]).replace(/^(?:Result|결과|결말)\s*[:：]?\s*/iu, '');
        const result = sameLine || lines.slice(resultIndex + 1).find(line => line.trim())?.trim() || '';
        if (result) return { date, text: result, isResult: true };
    }
    const plain = lines.filter(line => !/^(?:Timeline|타임라인|시간선|시간대|일시|날짜)\s*[:：]/iu.test(heading(line))
        && !/^(?:Scene|장면|씬)\s*[:：]?$/iu.test(heading(line))).join(' ').replace(/\s+/gu, ' ').trim();
    const prefix = Array.from(plain.slice(0, 400));
    return { date, text: prefix.length > 200 ? prefix.slice(0, 200).join('') + '…' : plain, isResult: false };
}

export function createStandaloneLibrary({
    document: doc,
    listBooks,
    linkedBooks,
    loadBook,
    saveContent,
    loadTranslations,
    translationFor,
    searchTranslationFor = translationFor,
    renderReadMarkdown = null,
    translateOne,
    saveTranslation,
    openAdvanced,
    getType,
    setType,
    getTypeMap = null,
    getTags = () => [],
    getTagMap = null,
    setTags = async () => {},
    getEntryImage = () => '',
    uploadEntryImage = async () => {},
    removeEntryImage = async () => {},
    getBookCover = () => '',
    getBookCoverMap = null,
    uploadBookCover = async () => {},
    removeBookCover = async () => {},
    getTheme = () => 'antique',
    setTheme = async () => {},
    getWindowSize = () => null,
    setWindowSize = () => {},
    getShelfRows = () => 3,
    setShelfRows = async () => {},
    getListPageSize = () => 5,
    setListPageSize = async () => {},
    getListOrder = () => 'normal',
    getMemoryView = () => 'page',
    setMemoryView = async () => {},
    setListOrder = async () => {},
    getCleanVariant = () => 'mac',
    setCleanVariant = async () => {},
    getLinkedOnly = () => true,
    getFavorites = () => [],
    setFavorites = async () => {},
    getRecent = () => null,
    setRecent = () => {},
    setLinkedOnly = async () => {},
    notify,
}) {
    let overlay = null;
    let originalFocus = null;
    let currentBook = '';
    let currentData = null;
    let entries = [];
    let selectedUid = null;
    let entryReadViews = new Map();
    let query = '';
    let catalogPage = 0;
    let diaryTocPage = 0;
    let memoryTocCollapsed = false;
    let worldTocCollapsed = false;
    let peopleTocCollapsed = false;
    let allBooks = false;
    let loadVersion = 0;
    let externalOpenSerial = 0;
    let edit = null;
    let saving = false;
    let searchIndex = new Map();
    let searchIndexDirty = true;
    let entryNumbers = new Map();
    let filteredCache = null;
    let shelfColumnCount = 0;
    let diaryPageCount = 0;
    let favorites = new Set();
    let recent = null;
    let suppressRecent = false;
    let globalSearchSerial = 0;
    let globalSearchOpen = false;
    let bookNames = [];
    let bookToneByName = new Map();
    let linkedNames = null;
    let shelfTag = 'all';
    let shelfSelectedTags = new Set();
    let shelfRows = [1, 2, 3].includes(Number(getShelfRows())) ? Number(getShelfRows()) : 3;
    let shelfSearchOpen = false;
    let worldTocPage = 0;
    let peoplePage = 0;
    let readerSearchOpen = false;
    let shelfType = 'all';
    let shelfQuery = '';
    let diaryIndex = 0;
    const memoryViews = ['continuous', 'timeline', 'page'];
    const preferredMemoryView = () => {
        const value = getMemoryView();
        return memoryViews.includes(value) ? value : 'page';
    };
    let memoryView = preferredMemoryView();
    let memoryStreamStart = 0;
    let memoryStreamEnd = 0;
    function resetMemoryStream() {
        memoryStreamStart = Math.floor(diaryIndex / libraryPageSize()) * libraryPageSize();
        memoryStreamEnd = memoryStreamStart + libraryPageSize();
    }
    let worldQuery = '';
    let peopleQuery = '';
    let settingsOpen = false;
    let resizeCleanup = null;
    let dragCleanup = null;
    let movedByUser = false;
    let viewportCleanup = null;
    let floatingSize = null;
    let tagSaving = false;
    let tagDraft = '';
    let tagInitial = '';
    let tagPanelExpanded = false;
    let coverEditor = null;
    let coverContextBook = '';
    let coverLongPressTimer = null;
    let coverLongPressPointer = null;
    let activeToolsUid = null;
    let appearanceSaving = false;
    let minimized = false;
    let minimizedLauncherPosition = null;
    let minimizedDragCleanup = null;
    let ignoreMinimizedClick = false;
    let savedScrollPositions = [];
    // Only the currently opened book can have a pending, explicitly selected
    // image. These File objects are never stored in ST settings.
    const pendingImages = new Map();

    function isOpen() { return Boolean(overlay?.isConnected); }
    function libraryPageSize() {
        const value = Number(getListPageSize());
        return [5, 10, 20].includes(value) ? value : 5;
    }
    function pageData(total, current) {
        const size = libraryPageSize();
        const pageCount = Math.max(1, Math.ceil(total / size));
        const page = Math.min(Math.max(0, current), pageCount - 1);
        return { size, page, pageCount, start: page * size };
    }
    function libraryListOrder() {
        const order = getListOrder();
        return ['normal', 'reverse', 'title-asc', 'title-desc'].includes(order) ? order : 'normal';
    }
    function pageSizePicker() {
        // A single persisted setting shared across the four reader styles.
        // Place its selector next to each contents pager, never in settings.
        const select = element(doc, 'select', 'slb-library-page-size-select');
        select.setAttribute('aria-label', '한 페이지에 표시할 항목 수');
        select.setAttribute('title', '한 페이지에 표시할 항목 수');
        for (const size of [5, 10, 20]) {
            const option = element(doc, 'option', '', size + '개');
            option.value = String(size);
            select.append(option);
        }
        select.value = String(libraryPageSize());
        return select;
    }
    function pageOrderPicker() {
        const select = element(doc, 'select', 'slb-library-order-select');
        select.setAttribute('aria-label', '목록 정렬 순서');
        select.setAttribute('title', 'Order(로어북 순서값) 또는 제목 기준 정렬');
        for (const [value, label] of [
            ['normal', 'Order↑'], ['reverse', 'Order↓'],
            ['title-asc', '제목↑'], ['title-desc', '제목↓'],
        ]) {
            const option = element(doc, 'option', '', label);
            option.value = value;
            select.append(option);
        }
        select.value = libraryListOrder();
        return select;
    }
    function pageOptions() {
        const options = element(doc, 'div', 'slb-library-page-options');
        options.append(pageSizePicker(), pageOrderPicker());
        return options;
    }
    function pageNavigation(previous, index, next) {
        const group = element(doc, 'div', 'slb-library-page-navigation');
        const [pageText, countText] = index.split(' / ');
        const page = Number(pageText) || 1;
        const pageCount = Math.max(1, Number(countText) || 1);
        const prefix = previous.dataset.action.replace(/-prev$/, '');
        const jump = button(doc, 'slb-library-page-jump', '', 'page-jump');
        jump.dataset.prefix = prefix;
        jump.dataset.page = String(page);
        jump.dataset.pageCount = String(pageCount);
        jump.setAttribute('aria-label', '페이지 이동 · ' + page + ' / ' + pageCount);
        jump.setAttribute('title', '페이지 번호를 눌러 이동');
        jump.append(element(doc, 'small', '', index));
        const editor = element(doc, 'span', 'slb-library-page-jump-editor');
        editor.hidden = true;
        const input = element(doc, 'input', 'slb-library-page-jump-input');
        input.type = 'number';
        input.inputMode = 'numeric';
        input.min = '1';
        input.max = String(pageCount);
        input.step = '1';
        input.value = String(page);
        input.dataset.prefix = prefix;
        input.setAttribute('aria-label', '이동할 페이지 번호 (1–' + pageCount + ')');
        input.autocomplete = 'off';
        input.addEventListener('keydown', event => {
            if (event.key === 'Enter') {
                event.preventDefault();
                event.stopPropagation();
                finishPageJump(input, true);
            } else if (event.key === 'Escape') {
                // Escape cancels only this numeric input, not the whole reader.
                event.preventDefault();
                event.stopPropagation();
                finishPageJump(input, false);
            }
        });
        input.addEventListener('blur', () => {
            if (!editor.hidden) finishPageJump(input, true);
        });
        editor.append(input, element(doc, 'small', '', '/ ' + pageCount));
        const first = button(doc, 'slb-library-page-edge', '«', prefix + '-first');
        first.disabled = page <= 1;
        first.setAttribute('aria-label', '첫 페이지');
        first.setAttribute('title', '첫 페이지');
        const last = button(doc, 'slb-library-page-edge', '»', prefix + '-last');
        last.disabled = page >= pageCount;
        last.setAttribute('aria-label', '마지막 페이지');
        last.setAttribute('title', '마지막 페이지');
        group.append(first, previous, jump, editor, next, last);
        return group;
    }
    function openPageJump(buttonNode) {
        const group = buttonNode.closest('.slb-library-page-navigation');
        const editor = group?.querySelector('.slb-library-page-jump-editor');
        const input = editor?.querySelector('.slb-library-page-jump-input');
        if (!input) return;
        // Number inputs cannot reliably select their contents in Chrome.
        // Start blank with the current page as a hint, so typing 18 goes
        // directly to page 18 instead of accidentally appending to "1".
        input.value = '';
        input.placeholder = buttonNode.dataset.page;
        buttonNode.hidden = true;
        editor.hidden = false;
        input.focus();
    }
    function finishPageJump(input, commit) {
        const editor = input.closest('.slb-library-page-jump-editor');
        if (!editor || editor.hidden) return;
        editor.hidden = true;
        const group = editor.closest('.slb-library-page-navigation');
        const jump = group?.querySelector('[data-action="page-jump"]');
        if (!jump) return;
        jump.hidden = false;
        const pageCount = Number(jump.dataset.pageCount);
        const currentPage = Number(jump.dataset.page);
        const inputPage = Number(input.value);
        if (!commit || !Number.isFinite(inputPage) || input.value.trim() === '') {
            jump.focus?.();
            return;
        }
        const target = Math.max(1, Math.min(Math.trunc(inputPage), pageCount));
        if (target === currentPage) { jump.focus?.(); return; }
        if (!discardOrStay({ allowTags: true })) {
            jump.focus?.();
            return;
        }
        const prefix = input.dataset.prefix;
        if (prefix === 'catalog-list') {
            catalogPage = target - 1;
            if (['mac', 'blackberry'].includes(libraryTheme())) selectedUid = null;
        } else if (prefix === 'memory-list') {
            diaryTocPage = target - 1;
        } else if (prefix === 'world') {
            worldTocPage = target - 1;
        } else if (prefix === 'people') {
            peoplePage = target - 1;
        } else return;
        resetEdit();
        renderBook();
        overlay?.querySelector('[data-action="page-jump"][data-prefix="' + prefix + '"]')?.focus?.();
    }
    function pageButtons(actionPrefix, page, total, label, includeOptions = true) {
        const info = pageData(total, page);
        const pager = element(doc, 'nav', 'slb-library-list-pages');
        pager.setAttribute('aria-label', label + ' 페이지 · ' + total + '개 항목');
        const previous = button(doc, '', '‹', actionPrefix + '-prev');
        previous.disabled = info.page === 0;
        previous.setAttribute('aria-label', '이전 ' + label);
        const next = button(doc, '', '›', actionPrefix + '-next');
        next.disabled = info.page >= info.pageCount - 1;
        next.setAttribute('aria-label', '다음 ' + label);
        pager.append(pageNavigation(previous, (info.page + 1) + ' / ' + info.pageCount, next));
        if (includeOptions) pager.append(pageOptions());
        return pager;
    }
    function libraryTheme() {
        const value = getTheme();
        return value === 'clean' ? 'ebook'
            : Object.hasOwn(LIBRARY_THEME_LABELS, value) ? value : 'mac';
    }
    function notifyStatus(message, type = 'info') {
        // No unsolicited saved/loading banners or success toasts. Only
        // actionable warnings and errors should interrupt the reader.
        if (type === 'warning' || type === 'error') notify?.(message, type);
    }
    function hasPendingEdit({ allowTags = false } = {}) {
        return Boolean((edit && edit.textarea && edit.textarea.value !== edit.initial)
            || (!allowTags && currentBook && (tagDraft !== tagInitial || pendingImages.size > 0)));
    }
    function discardOrStay({ allowTags = false } = {}) {
        if (saving || tagSaving || appearanceSaving || coverEditor?.saving) {
            notifyStatus('저장 작업이 완료된 후 이동할 수 있습니다.', 'warning');
            return false;
        }
        return !hasPendingEdit({ allowTags }) || doc.defaultView.confirm('저장하지 않은 수정 사항이 있습니다. 변경 내용을 버리고 이동하시겠습니까?');
    }
    function resetEdit() { edit = null; }
    function placeMinimizedLauncher(left, top) {
        const launcher = overlay?.querySelector('.slb-library-minimized-launcher');
        if (!launcher) return;
        const vp = visibleLibraryViewport();
        const margin = 8;
        const width = 34;
        const height = 34;
        const nextLeft = Math.max(vp.left + margin,
            Math.min(left, vp.left + vp.width - margin - width));
        const nextTop = Math.max(vp.top + margin,
            Math.min(top, vp.top + vp.height - margin - height));
        minimizedLauncherPosition = { left: nextLeft, top: nextTop };
        launcher.style.setProperty('left', nextLeft + 'px', 'important');
        launcher.style.setProperty('top', nextTop + 'px', 'important');
        launcher.style.setProperty('right', 'auto', 'important');
        launcher.style.setProperty('bottom', 'auto', 'important');
    }
    function setMinimized(value) {
        if (!isOpen()) return;
        const next = Boolean(value);
        if (minimized === next) return;
        const shell = overlay.querySelector('.slb-library-shell');
        const launcher = overlay.querySelector('.slb-library-minimized-launcher');
        if (!shell || !launcher) return;
        minimizedDragCleanup?.();
        minimizedDragCleanup = null;
        if (next) {
            // Only snapshot existing scroll offsets. Do not recreate book
            // content, reread translation files, or discard an unsaved draft.
            savedScrollPositions = [...shell.querySelectorAll(
                '.slb-library-body, .slb-library-books-scroll, ' +
                '.slb-library-app-reading-screen, .slb-library-index, ' +
                '.slb-library-app-device-screen')].map(node => [node, node.scrollTop]);
            const x = Number.parseFloat(shell.style.left);
            const y = Number.parseFloat(shell.style.top);
            const width = floatingSize?.width || Number.parseFloat(shell.style.width) || 460;
            minimized = true;
            overlay.classList.add('slb-library-is-minimized');
            shell.hidden = true;
            launcher.hidden = false;
            placeMinimizedLauncher((Number.isFinite(x) ? x : 0) + width - 34,
                Number.isFinite(y) ? y : 16);
            launcher.focus?.();
        } else {
            minimized = false;
            overlay.classList.remove('slb-library-is-minimized');
            launcher.hidden = true;
            shell.hidden = false;
            if (floatingSize) {
                const x = Number.parseFloat(shell.style.left);
                const y = Number.parseFloat(shell.style.top);
                const vp = visibleLibraryViewport();
                placeFloatingShell(shell, floatingSize.width, floatingSize.height,
                    (Number.isFinite(x) ? x : vp.left) + floatingSize.width / 2,
                    (Number.isFinite(y) ? y : vp.top) + floatingSize.height / 2);
            }
            for (const [node, position] of savedScrollPositions) {
                if (node.isConnected) node.scrollTop = position;
            }
            savedScrollPositions = [];
            ignoreMinimizedClick = false;
            shell.focus?.();
        }
    }
    function beginMinimizedDrag(event) {
        if (!minimized || event.button !== 0 && event.pointerType !== 'touch') return;
        const launcher = overlay?.querySelector('.slb-library-minimized-launcher');
        if (!launcher) return;
        minimizedDragCleanup?.();
        ignoreMinimizedClick = false;
        const initial = minimizedLauncherPosition || { left: 0, top: 0 };
        const startX = event.clientX;
        const startY = event.clientY;
        const pointerId = event.pointerId;
        const win = doc.defaultView;
        let moved = false;
        const move = e => {
            if (e.pointerId !== pointerId) return;
            if (!moved && Math.abs(e.clientX - startX) + Math.abs(e.clientY - startY) < 4) return;
            moved = true;
            placeMinimizedLauncher(initial.left + e.clientX - startX,
                initial.top + e.clientY - startY);
            e.preventDefault?.();
        };
        const end = e => {
            if (e.pointerId !== pointerId) return;
            ignoreMinimizedClick = moved;
            minimizedDragCleanup?.();
            minimizedDragCleanup = null;
        };
        minimizedDragCleanup = () => {
            win.removeEventListener('pointermove', move);
            win.removeEventListener('pointerup', end);
            win.removeEventListener('pointercancel', end);
            try {
                if (launcher.hasPointerCapture?.(pointerId)) launcher.releasePointerCapture(pointerId);
            } catch {}
        };
        try { launcher.setPointerCapture?.(pointerId); } catch {}
        win.addEventListener('pointermove', move);
        win.addEventListener('pointerup', end);
        win.addEventListener('pointercancel', end);
    }
    function close() {
        if (coverEditor) return dismissCoverEditor();
        closeReaderTools();
        if (!isOpen() || !discardOrStay()) return false;
        cancelCoverLongPress();
        closeCoverMenu();
        minimizedDragCleanup?.();
        minimizedDragCleanup = null;
        minimized = false;
        minimizedLauncherPosition = null;
        ignoreMinimizedClick = false;
        savedScrollPositions = [];
        loadVersion += 1;
        ++externalOpenSerial;
        ++globalSearchSerial;
        globalSearchOpen = false;
        resizeCleanup?.();
        resizeCleanup = null;
        dragCleanup?.();
        dragCleanup = null;
        viewportCleanup?.();
        viewportCleanup = null;
        floatingSize = null;
        doc.removeEventListener('keydown', onKeyDown);
        doc.removeEventListener('click', onOutsideSearchClick, true);
        overlay.remove();
        overlay = null;
        resetEdit();
        pendingImages.clear();
        if (originalFocus?.isConnected) originalFocus.focus?.();
        return true;
    }
    function onKeyDown(event) {
        // While minimized, Escape belongs to SillyTavern and other extensions,
        // not to this hidden reader with possible unsaved edits.
        if (!isOpen() || minimized) return;
        if (event.key === 'Enter' && !event.isComposing && event.keyCode !== 229
            && overlay.contains(event.target)) {
            if (event.target.id === 'slb-library-shelf-search') {
                event.preventDefault();
                void runGlobalSearch();
                return;
            }
            if (event.target.id === 'slb-library-search') {
                event.preventDefault();
                submitReaderSearch();
                return;
            }
        }
        if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) {
            const opener = event.target.closest?.('.slb-library-cover-open');
            if (opener) {
                event.preventDefault();
                openCoverMenu(opener.dataset.book);
                overlay.querySelector('.slb-library-cover-menu:not([hidden]) [data-action="cover-config"]')?.focus();
            }
            return;
        }
        if (event.key !== 'Escape') return;
        event.preventDefault();
        if (coverEditor) dismissCoverEditor();
        else if (coverContextBook) closeCoverMenu();
        else if (activeToolsUid !== null) closeReaderTools();
        else if (settingsOpen) setSettingsOpen(false);
        else if (shelfSearchOpen) closeShelfSearch();
        else if (globalSearchOpen) returnToShelf();
        else if (readerSearchOpen) closeReaderSearch();
        else close();
    }
    function closeShelfSearch() {
        shelfSearchOpen = false;
        const bar = overlay?.querySelector('.slb-library-shelf-toolbar');
        bar?.classList.remove('is-search-open');
        bar?.querySelector('[data-action="shelf-search-toggle"]')?.setAttribute('aria-expanded', 'false');
    }
    function closeReaderSearch() {
        readerSearchOpen = false;
        overlay?.querySelector('.slb-library-navigation')?.classList.remove('is-search-open');
        overlay?.querySelector('[data-action="reader-search-toggle"]')?.setAttribute('aria-expanded', 'false');
    }
    // One listener exists only while the floating library is open. Clicking
    // outside a search control dismisses its field without closing the window.
    function onOutsideSearchClick(event) {
        if (!isOpen() || coverEditor) return;
        const target = event.target;
        if (shelfSearchOpen && !target.closest?.('.slb-library-books-head')) closeShelfSearch();
        if (readerSearchOpen && !target.closest?.('.slb-library-reader-search-anchor')) closeReaderSearch();
    }
    function cancelCoverLongPress() {
        if (coverLongPressTimer !== null) doc.defaultView.clearTimeout(coverLongPressTimer);
        coverLongPressTimer = null;
        coverLongPressPointer = null;
    }
    function closeCoverMenu() {
        coverContextBook = '';
        for (const menu of overlay?.querySelectorAll('.slb-library-cover-menu') || []) {
            menu.hidden = true;
            menu.parentElement?.querySelector('.slb-library-cover-open')?.setAttribute('aria-expanded', 'false');
        }
    }
    function openCoverMenu(book) {
        if (!isOpen() || currentBook || coverEditor || !bookNames.includes(book)) return;
        const opener = [...overlay.querySelectorAll('.slb-library-cover-open')]
            .find(node => node.dataset.book === book);
        const menu = opener?.closest('.slb-library-cover-item')?.querySelector('.slb-library-cover-menu');
        if (!menu) return;
        closeCoverMenu();
        coverContextBook = book;
        menu.hidden = false;
        opener.setAttribute('aria-expanded', 'true');
    }
    function onCoverContextMenu(event) {
        const opener = event.target.closest?.('.slb-library-cover-open');
        if (!opener || !overlay?.contains(opener) || coverEditor) return;
        event.preventDefault();
        cancelCoverLongPress();
        openCoverMenu(opener.dataset.book);
    }
    function onCoverPointerDown(event) {
        if (event.pointerType !== 'touch' && event.pointerType !== 'pen') return;
        cancelCoverLongPress();
        const opener = event.target.closest?.('.slb-library-cover-open');
        if (!opener || !overlay?.contains(opener) || coverEditor || currentBook) return;
        const book = opener.dataset.book;
        coverLongPressPointer = { id: event.pointerId, x: event.clientX, y: event.clientY };
        // A single short-lived hold timer per user gesture, never a scan/observer.
        coverLongPressTimer = doc.defaultView.setTimeout(() => {
            coverLongPressTimer = null;
            coverLongPressPointer = null;
            if (opener.isConnected && isOpen()) openCoverMenu(book);
        }, 520);
    }
    function onCoverPointerMove(event) {
        const start = coverLongPressPointer;
        if (!start || start.id !== event.pointerId) return;
        if (Math.abs(event.clientX - start.x) > 10 || Math.abs(event.clientY - start.y) > 10)
            cancelCoverLongPress();
    }
    function onCoverPointerEnd(event) {
        if (coverLongPressPointer?.id === event.pointerId) cancelCoverLongPress();
    }
    function closeReaderTools() {
        activeToolsUid = null;
        if (!overlay) return;
        for (const menu of overlay.querySelectorAll('.slb-library-tools-popover')) menu.hidden = true;
        for (const trigger of overlay.querySelectorAll('[data-action="more-tools"]'))
            trigger.setAttribute('aria-expanded', 'false');
    }
    function toggleReaderTools(uid) {
        if (!isOpen()) return;
        const id = String(uid);
        if (activeToolsUid === id) { closeReaderTools(); return; }
        closeReaderTools();
        const article = [...overlay.querySelectorAll('.slb-library-detail')]
            .find(node => node.dataset.uid === id);
        const menu = article?.querySelector('.slb-library-tools-popover');
        if (!menu) return;
        activeToolsUid = id;
        menu.hidden = false;
        article.querySelector('[data-action="more-tools"]')?.setAttribute('aria-expanded', 'true');
    }
    function createShell() {
        overlay = element(doc, 'div', 'slb-library-overlay');
        overlay.id = 'slb-library-overlay';
        const shell = element(doc, 'section', 'slb-library-shell');
        shell.setAttribute('role', 'dialog');
        shell.setAttribute('aria-modal', 'false');
        shell.setAttribute('aria-labelledby', 'slb-library-title');
        shell.tabIndex = -1;
        const top = element(doc, 'header', 'slb-library-top');
        top.addEventListener('pointerdown', beginHeaderDrag);
        const heading = element(doc, 'div', 'slb-library-heading');
        heading.append(element(doc, 'span', 'slb-library-crest', '✦'),
            element(doc, 'h2', '', 'THE LORE LIBRARY'));
        heading.querySelector('h2').id = 'slb-library-title';
        const headerActions = element(doc, 'div', 'slb-library-header-actions');
        const settingsButton = button(doc, 'slb-library-settings-button', '', 'settings');
        // SillyTavern provides Font Awesome; use the existing solid icons.
        settingsButton.append(faIcon(doc, 'gear'));
        settingsButton.setAttribute('aria-label', '서재 설정');
        settingsButton.setAttribute('aria-controls', 'slb-library-settings-panel');
        settingsButton.setAttribute('aria-expanded', 'false');
        const minimizeButton = button(doc, 'slb-library-minimize-button', '', 'minimize');
        minimizeButton.append(faIcon(doc, 'minus'));
        minimizeButton.setAttribute('aria-label', '서재 최소화');
        minimizeButton.setAttribute('title', '서재 최소화');
        const closeButton = button(doc, 'slb-library-close', '', 'close');
        closeButton.append(faIcon(doc, 'xmark'));
        closeButton.setAttribute('aria-label', '서재 닫기');
        headerActions.append(minimizeButton, settingsButton, closeButton);
        top.append(heading, headerActions);
        const navigation = element(doc, 'div', 'slb-library-navigation');
        const navTop = element(doc, 'div', 'slb-library-nav-top');
        navTop.append(button(doc, '', '‹ 서재 목록', 'books'),
            element(doc, 'span', 'slb-library-current', '연결된 로어북을 선택하세요.'),
            element(doc, 'div', 'slb-library-nav-tags'));
        const filters = element(doc, 'div', 'slb-library-filters');
        const typeLabel = element(doc, 'label', '', '보기 방식');
        typeLabel.htmlFor = 'slb-library-book-type';
        const select = element(doc, 'select', '', '');
        select.id = 'slb-library-book-type';
        for (const [value, caption] of Object.entries(LIBRARY_BOOK_TYPES)) {
            const option = element(doc, 'option', '', caption);
            option.value = value;
            select.append(option);
        }
        const typeArrows = faIcon(doc, 'sort');
        typeArrows.classList.add('slb-library-type-arrows');
        filters.append(typeLabel, select, typeArrows);
        const search = element(doc, 'input', '');
        search.id = 'slb-library-search';
        search.type = 'search';
        search.autocomplete = 'off';
        search.placeholder = '검색';
        search.setAttribute('aria-label', '로어북 내 검색');
        search.setAttribute('enterkeyhint', 'search');
        const navTools = element(doc, 'div', 'slb-library-nav-tools');
        const searchToggle = button(doc, 'slb-library-reader-search-toggle', '', 'reader-search-toggle');
        searchToggle.append(faIcon(doc, 'magnifying-glass'));
        searchToggle.setAttribute('aria-label', '검색');
        searchToggle.setAttribute('title', '검색');
        searchToggle.setAttribute('aria-controls', 'slb-library-search');
        searchToggle.setAttribute('aria-expanded', 'false');
        const readerSearchAnchor = element(doc, 'div', 'slb-library-reader-search-anchor');
        readerSearchAnchor.append(search, searchToggle);
        navTools.append(filters, readerSearchAnchor);
        const appearance = element(doc, 'div', 'slb-library-appearance');
        const appearanceLabel = element(doc, 'label', '', '테마');
        appearanceLabel.htmlFor = 'slb-library-theme-mode';
        const themeMode = element(doc, 'select', 'slb-library-theme-select');
        themeMode.id = 'slb-library-theme-mode';
        for (const [value, title] of Object.entries(LIBRARY_THEME_LABELS)) {
            const option = element(doc, 'option', '', title);
            option.value = value;
            themeMode.append(option);
        }
        appearance.append(appearanceLabel, themeMode);
        const settingsPanel = element(doc, 'aside', 'slb-library-settings-panel');
        settingsPanel.id = 'slb-library-settings-panel';
        settingsPanel.hidden = true;
        settingsPanel.setAttribute('data-no-drag', '');
        const settingsHeading = element(doc, 'strong', 'slb-library-settings-title', '로어북 서재 설정');
        const shelfRowsLabel = element(doc, 'label', 'slb-library-shelf-rows-setting');
        shelfRowsLabel.htmlFor = 'slb-library-shelf-rows';
        shelfRowsLabel.append(element(doc, 'span', '', '서가 표시 줄 수'));
        const shelfRowsSelect = element(doc, 'select', 'slb-library-shelf-rows-select');
        shelfRowsSelect.id = 'slb-library-shelf-rows';
        shelfRowsSelect.setAttribute('aria-label', '서가 표시 줄 수');
        for (const count of [1, 2, 3]) {
            const option = element(doc, 'option', '', count + '줄 보기');
            option.value = String(count);
            shelfRowsSelect.append(option);
        }
        shelfRowsSelect.value = String([1, 2, 3].includes(Number(getShelfRows())) ? getShelfRows() : 3);
        shelfRowsLabel.append(shelfRowsSelect);
        const memoryViewLabel = element(doc, 'label', 'slb-library-memory-view-setting');
        memoryViewLabel.htmlFor = 'slb-library-memory-view';
        memoryViewLabel.append(element(doc, 'span', '', '메모리 보기 방식'));
        const memoryViewSelect = element(doc, 'select', 'slb-library-memory-view-select');
        memoryViewSelect.id = 'slb-library-memory-view';
        memoryViewSelect.setAttribute('aria-label', '메모리 보기 방식');
        for (const [value, label] of [['continuous', '연속 기록장'], ['timeline', '타임라인'], ['page', '페이지 넘김']]) {
            const option = element(doc, 'option', '', label);
            option.value = value;
            memoryViewSelect.append(option);
        }
        memoryViewSelect.value = preferredMemoryView();
        memoryViewLabel.append(memoryViewSelect);
        const linkedLabel = element(doc, 'label', 'slb-library-linked-setting');
        const linkedCheck = element(doc, 'input');
        linkedCheck.type = 'checkbox';
        linkedCheck.id = 'slb-library-linked-only';
        linkedLabel.append(linkedCheck, element(doc, 'span', '',
            '현재 캐릭터에 연결된 로어북만 보기'));
        const linkedHint = element(doc, 'small', 'slb-library-linked-hint',
            '연결된 로어북이 없으면 모든 책이 표시됩니다.');
        const resume = button(doc, 'slb-library-resume-search-action', '이어 읽기', 'resume-reading');
        resume.hidden = true;
        settingsPanel.append(settingsHeading, appearance, shelfRowsLabel, memoryViewLabel, linkedLabel, linkedHint, resume);
        navigation.append(navTop, navTools);
        const body = element(doc, 'main', 'slb-library-body');
        // Keep the structural footer hook for existing layouts without
        // rendering the previous unsolicited bottom-left status messages.
        const footer = element(doc, 'footer', 'slb-library-footer');
        const resizeGrip = button(doc, 'slb-library-resize-grip', '', 'resize-grip');
        const gripSvg = doc.createElementNS('http://www.w3.org/2000/svg', 'svg');
        gripSvg.setAttribute('viewBox', '0 0 20 20');
        gripSvg.setAttribute('aria-hidden', 'true');
        gripSvg.setAttribute('fill', 'none');
        gripSvg.setAttribute('stroke', 'currentColor');
        gripSvg.setAttribute('stroke-width', '1.5');
        gripSvg.setAttribute('stroke-linecap', 'round');
        const gripLines = doc.createElementNS('http://www.w3.org/2000/svg', 'path');
        gripLines.setAttribute('d', 'M12 5 5 12M16 7 7 16M16 13 13 16');
        gripSvg.append(gripLines);
        resizeGrip.append(gripSvg);
        resizeGrip.setAttribute('aria-label', '창 크기 조절');
        resizeGrip.setAttribute('title', '모서리를 끌어 창 크기 조절');
        // Anchor settings to the title bar so it overlays the navigation
        // instead of being painted underneath the book controls.
        top.append(settingsPanel);
        shell.append(top, navigation, body, footer, resizeGrip);
        const minimizedLauncher = button(doc, 'slb-library-minimized-launcher', '', 'restore');
        minimizedLauncher.append(faIcon(doc, 'book-open'));
        minimizedLauncher.setAttribute('aria-label', '서재 다시 열기');
        minimizedLauncher.setAttribute('title', '서재 다시 열기');
        minimizedLauncher.hidden = true;
        minimizedLauncher.addEventListener('pointerdown', beginMinimizedDrag);
        overlay.append(shell, minimizedLauncher);
        resizeGrip.addEventListener('pointerdown', beginResize);
        resizeGrip.addEventListener('keydown', onResizeKeyDown);
        overlay.addEventListener('click', event => {
            if (settingsOpen && !event.target.closest('.slb-library-settings-panel, [data-action="settings"]')) setSettingsOpen(false);
            if (activeToolsUid !== null && !event.target.closest('.slb-library-tools-popover, [data-action="more-tools"]')) closeReaderTools();
            if (coverContextBook && !event.target.closest('.slb-library-cover-menu, .slb-library-cover-open')) closeCoverMenu();
            if (event.target === overlay) close();
        });
        overlay.addEventListener('contextmenu', onCoverContextMenu);
        overlay.addEventListener('pointerdown', onCoverPointerDown);
        overlay.addEventListener('pointermove', onCoverPointerMove);
        overlay.addEventListener('pointerup', onCoverPointerEnd);
        overlay.addEventListener('pointercancel', onCoverPointerEnd);
        overlay.addEventListener('click', onClick);
        overlay.addEventListener('change', onChange);
        overlay.addEventListener('input', onInput);
        overlay.addEventListener('compositionend', onInput);
        return shell;
    }

    function setSettingsOpen(value) {
        if (!overlay) return;
        settingsOpen = Boolean(value);
        const panel = overlay.querySelector('#slb-library-settings-panel');
        if (panel) {
            panel.hidden = !settingsOpen;
            const memoryPicker = panel.querySelector('#slb-library-memory-view');
            if (memoryPicker && !appearanceSaving) memoryPicker.value = preferredMemoryView();
            const resume = panel.querySelector('[data-action="resume-reading"]');
            if (resume) {
                resume.hidden = Boolean(currentBook || !recent || !bookNames.includes(recent.book));
                resume.title = resume.hidden ? '' : recent.book;
            }
        }
        const opener = overlay.querySelector('[data-action="settings"]');
        if (opener) opener.setAttribute('aria-expanded', String(settingsOpen));
    }
    function refreshAfterResize() {
        if (!isOpen() || minimized || globalSearchOpen) return;
        if (!currentBook) {
            const body = overlay.querySelector('.slb-library-body');
            if (body?.dataset.type === 'books' && shelfColumns(body, libraryTheme()) !== shelfColumnCount)
                bookList({ resultsOnly: true });
            return;
        }
        // Only the journal depends on the reader's actual width for its
        // record count. Reuse the loaded entries, never reload or auto-save.
        // Do not replace an editor/unfinished upload in progress.
        if (currentData && getType(currentBook) === 'memory' && memoryView === 'page'
            && !edit && !tagSaving && !saving && !pendingImages.size
            && diaryStep() !== diaryPageCount) {
            const body = overlay.querySelector('.slb-library-body');
            const previousScroll = body?.scrollTop || 0;
            renderBook();
            if (body) body.scrollTop = previousScroll;
        }
    }
    // Phrase Desk reference: position the window in viewport pixel coordinates
    // with fixed left/top and transform:none. Do not mix absolute 50% anchors
    // and translation during resizing: other ST themes can move that anchor.
    function visibleLibraryViewport() {
        const win = doc.defaultView;
        const visual = win.visualViewport;
        const width = visual?.width || win.innerWidth || doc.documentElement.clientWidth || 360;
        const height = visual?.height || win.innerHeight || doc.documentElement.clientHeight || 640;
        return {
            left: visual?.offsetLeft || 0,
            top: visual?.offsetTop || 0,
            width: Math.max(1, width),
            height: Math.max(1, height),
        };
    }
    function placeFloatingShell(shell, requestedWidth, requestedHeight, centerX, centerY) {
        const vp = visibleLibraryViewport();
        const margin = vp.width <= 760 ? 10 : 16;
        const widthMax = Math.max(1, vp.width - margin * 2);
        const heightMax = Math.max(1, vp.height - margin * 2);
        const minWidth = Math.min(280, widthMax);
        const minHeight = Math.min(310, heightMax);
        const width = Math.min(widthMax, Math.max(minWidth, requestedWidth));
        const height = Math.min(heightMax, Math.max(minHeight, requestedHeight));
        const left = Math.min(vp.left + vp.width - margin - width,
            Math.max(vp.left + margin, centerX - width / 2));
        const top = Math.min(vp.top + vp.height - margin - height,
            Math.max(vp.top + margin, centerY - height / 2));
        // Local inline important declarations override the user's ST/theme
        // modal positioning while this independent reader is open.
        const set = (name, value) => shell.style.setProperty(name, value, 'important');
        set('position', 'fixed');
        set('left', left + 'px');
        set('top', top + 'px');
        set('right', 'auto');
        set('bottom', 'auto');
        set('transform', 'none');
        set('margin', '0');
        set('width', width + 'px');
        set('height', height + 'px');
        set('min-width', minWidth + 'px');
        set('min-height', minHeight + 'px');
        set('max-width', widthMax + 'px');
        set('max-height', heightMax + 'px');
        floatingSize = { width, height };
        return { width, height, left, top };
    }
    function beginHeaderDrag(event) {
        if (!isOpen() || event.button !== 0 && event.pointerType !== 'touch') return;
        if (event.target.closest('button, input, select, textarea, a, [contenteditable="true"], [data-no-drag]')) return;
        const shell = overlay.querySelector('.slb-library-shell');
        const header = event.currentTarget;
        if (!shell || coverEditor) return;
        const rect = shell.getBoundingClientRect();
        const deltaX = event.clientX - rect.left, deltaY = event.clientY - rect.top;
        const startX=event.clientX, startY=event.clientY;
        const win=doc.defaultView;
        dragCleanup?.();
        event.preventDefault();
        let shifted=false;
        const move = e => {
            if (e.pointerId !== event.pointerId) return;
            if (Math.abs(e.clientX - startX) + Math.abs(e.clientY - startY) < 3 && !shifted) return;
            shifted = true;
            const bounds = visibleLibraryViewport();
            const margin = bounds.width <= 760 ? 10 : 16;
            const x = Math.max(bounds.left + margin,
                Math.min(e.clientX - deltaX, bounds.left + bounds.width - margin - rect.width));
            const y = Math.max(bounds.top + margin,
                Math.min(e.clientY - deltaY, bounds.top + bounds.height - margin - rect.height));
            shell.style.setProperty('left', x + 'px', 'important');
            shell.style.setProperty('top', y + 'px', 'important');
            movedByUser = true;
        };
        const end = e => {
            if (e?.pointerId !== event.pointerId) return;
            dragCleanup?.();
            dragCleanup = null;
        };
        shell.classList.add('slb-library-is-dragging');
        dragCleanup = () => {
            win.removeEventListener('pointermove', move);
            win.removeEventListener('pointerup', end);
            win.removeEventListener('pointercancel', end);
            shell.classList.remove('slb-library-is-dragging');
            try { if (header.hasPointerCapture?.(event.pointerId)) header.releasePointerCapture(event.pointerId); } catch {}
        };
        try { header.setPointerCapture?.(event.pointerId); } catch {}
        win.addEventListener('pointermove', move);
        win.addEventListener('pointerup', end);
        win.addEventListener('pointercancel', end);
    }
    function placeOnViewportChange() {
        if (!isOpen() || !floatingSize) return;
        if (minimized) {
            if (minimizedLauncherPosition) placeMinimizedLauncher(
                minimizedLauncherPosition.left, minimizedLauncherPosition.top);
            // Do not re-render the hidden reader on viewport/keyboard changes.
            return;
        }
        const shell = overlay.querySelector('.slb-library-shell');
        if (!shell) return;
        const vp = visibleLibraryViewport();
        const rect = shell.getBoundingClientRect();
        placeFloatingShell(shell, floatingSize.width, floatingSize.height,
            movedByUser && rect.width ? rect.left + rect.width / 2 : vp.left + vp.width / 2,
            movedByUser && rect.height ? rect.top + rect.height / 2 : vp.top + vp.height / 2);
        refreshAfterResize();
    }
    function bindLibraryViewport() {
        viewportCleanup?.();
        const win = doc.defaultView;
        win.addEventListener('resize', placeOnViewportChange);
        win.visualViewport?.addEventListener?.('resize', placeOnViewportChange);
        win.visualViewport?.addEventListener?.('scroll', placeOnViewportChange);
        viewportCleanup = () => {
            win.removeEventListener('resize', placeOnViewportChange);
            win.visualViewport?.removeEventListener?.('resize', placeOnViewportChange);
            win.visualViewport?.removeEventListener?.('scroll', placeOnViewportChange);
        };
    }
    // Save only an explicitly completed resize, never on initial layout,
    // mobile keyboard changes, viewport clamping, or minimize/restore.
    function rememberWindowSize() {
        if (!floatingSize) return;
        const size = { width: floatingSize.width, height: floatingSize.height };
        if (!Number.isFinite(size.width) || !Number.isFinite(size.height)) return;
        try {
            setWindowSize(size, visibleLibraryViewport().width <= 760);
        } catch {
            notifyStatus('서재 창 크기를 저장하지 못했습니다.', 'warning');
        }
    }
    function beginResize(event) {
        if (event.button !== 0 && event.pointerType !== 'touch') return;
        const shell = overlay?.querySelector('.slb-library-shell');
        if (!shell || !isOpen() || coverEditor) return;
        event.preventDefault();
        resizeCleanup?.();
        const rect = shell.getBoundingClientRect();
        const vp = visibleLibraryViewport();
        const width = rect.width || floatingSize?.width || Math.min(1000, vp.width - 32);
        const height = rect.height || floatingSize?.height || Math.min(785, vp.height - 32);
        const centerX = rect.width ? rect.left + rect.width / 2 : vp.left + vp.width / 2;
        const centerY = rect.height ? rect.top + rect.height / 2 : vp.top + vp.height / 2;
        const startX = event.clientX, startY = event.clientY;
        let resized = false;
        // The initial fixed coordinates exactly preserve the current rectangle.
        placeFloatingShell(shell, width, height, centerX, centerY);
        const grip = event.currentTarget;
        const win = doc.defaultView;
        const onMove = move => {
            if (move.pointerId !== event.pointerId) return;
            if (move.clientX === startX && move.clientY === startY) return;
            resized = true;
            placeFloatingShell(shell,
                width + 2 * (move.clientX - startX),
                height + 2 * (move.clientY - startY),
                centerX, centerY);
        };
        const stop = move => {
            if (move && move.pointerId !== event.pointerId) return;
            resizeCleanup?.();
            resizeCleanup = null;
            if (resized && move?.type === 'pointerup') rememberWindowSize();
            refreshAfterResize();
        };
        resizeCleanup = () => {
            win.removeEventListener('pointermove', onMove);
            win.removeEventListener('pointerup', stop);
            win.removeEventListener('pointercancel', stop);
            try {
                if (grip.hasPointerCapture?.(event.pointerId)) grip.releasePointerCapture?.(event.pointerId);
            } catch {}
        };
        try { grip.setPointerCapture?.(event.pointerId); } catch {}
        win.addEventListener('pointermove', onMove);
        win.addEventListener('pointerup', stop);
        win.addEventListener('pointercancel', stop);
    }
    function onResizeKeyDown(event) {
        if (!['ArrowRight', 'ArrowLeft', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
        const shell = overlay?.querySelector('.slb-library-shell');
        if (!shell) return;
        event.preventDefault();
        const rect = shell.getBoundingClientRect();
        const vp = visibleLibraryViewport();
        const width = rect.width || floatingSize?.width || 800;
        const height = rect.height || floatingSize?.height || 640;
        const centerX = rect.width ? rect.left + rect.width / 2 : vp.left + vp.width / 2;
        const centerY = rect.height ? rect.top + rect.height / 2 : vp.top + vp.height / 2;
        const step = event.shiftKey ? 50 : 20;
        placeFloatingShell(shell,
            width + (event.key === 'ArrowRight' ? step : event.key === 'ArrowLeft' ? -step : 0),
            height + (event.key === 'ArrowDown' ? step : event.key === 'ArrowUp' ? -step : 0),
            centerX, centerY);
        rememberWindowSize();
        refreshAfterResize();
    }
    // This editor is mounted only when a user explicitly opens a cover
    // setting; neither book data nor images are fetched for the antique shelf.
    function dismissCoverEditor(force = false) {
        if (!coverEditor) return true;
        if (coverEditor.saving && !force) {
            notifyStatus('표지 저장이 완료된 후 이동할 수 있습니다.', 'warning');
            return false;
        }
        if (!force && coverEditor.file
            && !doc.defaultView.confirm('저장하지 않은 표지 이미지가 있습니다. 변경을 취소하시겠습니까?')) return false;
        const previous = coverEditor;
        coverEditor = null;
        if (previous.previewUrl) doc.defaultView.URL?.revokeObjectURL?.(previous.previewUrl);
        previous.backdrop.remove();
        previous.focus?.focus?.();
        return true;
    }
    function openCoverEditor(book) {
        if (coverEditor || currentBook || !bookNames.includes(book) || !isOpen()) return;
        // Returning from the modal should focus the visible cover, not the
        // context menu item that becomes hidden when the editor opens.
        const coverOpener = [...overlay.querySelectorAll('.slb-library-cover-open')]
            .find(node => node.dataset.book === book);
        const restoreFocus = coverOpener || doc.activeElement;
        cancelCoverLongPress();
        closeCoverMenu();
        const backdrop = element(doc, 'div', 'slb-library-cover-backdrop');
        const dialog = element(doc, 'section', 'slb-library-cover-dialog');
        dialog.setAttribute('role', 'dialog');
        dialog.setAttribute('aria-modal', 'true');
        dialog.setAttribute('aria-labelledby', 'slb-library-cover-dialog-title');
        const header = element(doc, 'div', 'slb-library-cover-dialog-head');
        const title = element(doc, 'h3', '', '책 표지 설정');
        title.id = 'slb-library-cover-dialog-title';
        header.append(title, button(doc, 'slb-library-cover-dismiss', '×', 'cover-cancel'));
        const bookTitle = element(doc, 'p', 'slb-library-cover-book-name', book);
        const preview = element(doc, 'div', 'slb-library-cover-preview');
        const existing = safeLibraryImagePath(getBookCover(book));
        if (existing) {
            const image = element(doc, 'img', 'slb-library-cover-preview-image');
            image.src = existing;
            image.alt = book + ' · 현재 책 표지';
            image.addEventListener('error', () => image.remove(), { once: true });
            preview.append(image);
        } else preview.append(element(doc, 'span', '', '기본 표지'));
        const description = element(doc, 'p', 'slb-library-cover-help',
            '표지 이미지는 서가에만 표시됩니다. 로어북 원문과 항목 이미지는 변경되지 않습니다.');
        const fileLabel = element(doc, 'label', 'slb-library-cover-file-label', '이미지 선택');
        fileLabel.htmlFor = 'slb-library-cover-file';
        const file = element(doc, 'input', 'slb-library-cover-file');
        file.id = 'slb-library-cover-file';
        file.type = 'file';
        file.accept = 'image/png,image/jpeg,image/webp';
        const status = element(doc, 'p', 'slb-library-cover-file-status', 'PNG · JPG · WEBP / 최대 5MB');
        const actions = element(doc, 'div', 'slb-library-cover-dialog-actions');
        const reset = button(doc, '', '기본 표지 복원', 'cover-reset');
        reset.disabled = !existing;
        const cancel = button(doc, '', '취소', 'cover-cancel');
        const save = button(doc, 'slb-library-cover-save', '표지 저장', 'cover-save');
        save.disabled = true;
        actions.append(reset, cancel, save);
        dialog.append(header, bookTitle, preview, description, fileLabel, file, status, actions);
        backdrop.append(dialog);
        backdrop.addEventListener('click', event => {
            if (event.target === backdrop) dismissCoverEditor();
        });
        coverEditor = { book, backdrop, preview, file: null, previewUrl: null, focus: restoreFocus, saving: false };
        // Keep the picker inside the movable shell rather than centering it
        // on the full-screen overlay after the shell has been dragged.
        overlay.querySelector('.slb-library-shell').append(backdrop);
        fileLabel.tabIndex = 0;
        fileLabel.addEventListener('keydown', event => {
            if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                file.click();
            }
        });
        cancel.focus();
    }
    function previewCoverFile(file) {
        if (!coverEditor || coverEditor.saving) return;
        const editor = coverEditor;
        if (!file || !['image/png', 'image/jpeg', 'image/webp'].includes(file.type)
            || file.size < 1 || file.size > 5 * 1024 * 1024) {
            editor.file = null;
            if (editor.previewUrl) doc.defaultView.URL?.revokeObjectURL?.(editor.previewUrl);
            editor.previewUrl = null;
            editor.backdrop.querySelector('[data-action="cover-save"]').disabled = true;
            editor.backdrop.querySelector('.slb-library-cover-file-status').textContent =
                'PNG, JPG 또는 WEBP 형식의 5MB 이하 이미지를 선택하세요.';
            return;
        }
        editor.file = file;
        if (editor.previewUrl) doc.defaultView.URL?.revokeObjectURL?.(editor.previewUrl);
        editor.previewUrl = null;
        editor.preview.replaceChildren();
        if (typeof doc.defaultView.URL?.createObjectURL === 'function') {
            editor.previewUrl = doc.defaultView.URL.createObjectURL(file);
            const image = element(doc, 'img', 'slb-library-cover-preview-image');
            image.src = editor.previewUrl;
            image.alt = '선택한 표지 미리보기';
            editor.preview.append(image);
        } else editor.preview.append(element(doc, 'span', '', file.name));
        editor.backdrop.querySelector('.slb-library-cover-file-status').textContent = file.name;
        editor.backdrop.querySelector('[data-action="cover-save"]').disabled = false;
    }
    async function commitCover(remove = false) {
        const editor = coverEditor;
        if (!editor || editor.saving || (!remove && !editor.file)) return;
        editor.saving = true;
        for (const control of editor.backdrop.querySelectorAll('button, input')) control.disabled = true;
        const status = editor.backdrop.querySelector('.slb-library-cover-file-status');
        status.textContent = '표지를 저장하는 중입니다…';
        try {
            if (remove) await removeBookCover(editor.book);
            else await uploadBookCover(editor.book, editor.file);
            dismissCoverEditor(true);
            if (isOpen()) {
                bookList();
                notifyStatus(remove ? '기본 표지로 복원되었습니다.' : '책 표지가 저장되었습니다.', 'success');
            }
        } catch (error) {
            status.textContent = '표지 저장 실패: ' + (error?.message || error);
            notify?.(status.textContent, 'error');
        } finally {
            editor.saving = false;
            if (coverEditor === editor) {
                for (const control of editor.backdrop.querySelectorAll('button, input')) control.disabled = false;
                editor.backdrop.querySelector('[data-action="cover-save"]').disabled = !editor.file;
                editor.backdrop.querySelector('[data-action="cover-reset"]').disabled =
                    !safeLibraryImagePath(getBookCover(editor.book));
            }
        }
    }
    function syncAppearanceControls() {
        if (!isOpen()) return;
        const value = libraryTheme();
        // Keep the stable legacy skin namespace for shared clean CSS, but
        // expose all four actual user-facing themes as dataset.libraryTheme.
        overlay.dataset.theme = value === 'antique' ? 'antique' : 'clean';
        overlay.dataset.variant = value === 'blackberry' ? 'blackberry'
            : value === 'mac' ? 'mac' : 'ebook';
        overlay.dataset.libraryTheme = value;
        const themeSelect = overlay.querySelector('#slb-library-theme-mode');
        if (themeSelect) themeSelect.value = value;
        const rowsSelect = overlay.querySelector('#slb-library-shelf-rows');
        if (rowsSelect) rowsSelect.value = String([1, 2, 3].includes(Number(getShelfRows())) ? getShelfRows() : 3);
        const linkedCheck = overlay.querySelector('#slb-library-linked-only');
        if (linkedCheck) linkedCheck.checked = Boolean(getLinkedOnly());
    }
    async function updateAppearance(value) {
        if (!isOpen() || appearanceSaving || coverEditor) return;
        if (!discardOrStay()) { syncAppearanceControls(); return; }
        if (!Object.hasOwn(LIBRARY_THEME_LABELS, value)) { syncAppearanceControls(); return; }
        const previous = libraryTheme();
        if (value === previous) return;
        appearanceSaving = true;
        const controls = overlay.querySelectorAll('.slb-library-appearance select');
        for (const input of controls) input.disabled = true;
        try {
            await setTheme(value);
            // If persistence failed the callback must restore its old value.
            syncAppearanceControls();
            if (!currentBook) { shelfRows = [1, 2, 3].includes(Number(getShelfRows())) ? Number(getShelfRows()) : 3; shelfType = 'all'; bookList(); }
            else if (currentData) renderBook();
            notifyStatus('서재 테마가 저장되었습니다.', 'success');
        } catch (error) {
            syncAppearanceControls();
            notifyStatus('서재 테마 저장 실패: ' + (error?.message || error), 'error');
        } finally {
            appearanceSaving = false;
            for (const input of controls) input.disabled = false;
        }
    }
    async function updateLibraryPageSize(value) {
        const size = Number(value);
        const inputs = [...(overlay?.querySelectorAll('.slb-library-page-size-select') || [])];
        if (!isOpen() || appearanceSaving || ![5, 10, 20].includes(size)) {
            for (const input of inputs) input.value = String(libraryPageSize());
            return;
        }
        if (!discardOrStay({ allowTags: true })) {
            for (const input of inputs) input.value = String(libraryPageSize());
            return;
        }
        if (size === libraryPageSize()) return;
        appearanceSaving = true;
        for (const input of inputs) input.disabled = true;
        try {
            await setListPageSize(size);
            catalogPage = 0;
            worldTocPage = 0;
            diaryTocPage = 0;
            peoplePage = 0;
            resetMemoryStream();
            if (currentData) renderBook();
        } catch (error) {
            notifyStatus('목록 표시 개수 저장 실패: ' + (error?.message || error), 'error');
        } finally {
            appearanceSaving = false;
            // Rerendering after save replaces the pager; handle either the
            // existing input (failure) or its new counterpart (success).
            for (const input of overlay?.querySelectorAll('.slb-library-page-size-select') || []) {
                input.disabled = false;
                input.value = String(libraryPageSize());
            }
        }
    }
    async function updateLibraryListOrder(value) {
        const selects = [...(overlay?.querySelectorAll('.slb-library-order-select') || [])];
        if (!isOpen() || appearanceSaving || !['normal', 'reverse', 'title-asc', 'title-desc'].includes(value)) {
            for (const select of selects) select.value = libraryListOrder();
            return;
        }
        if (!discardOrStay({ allowTags: true })) {
            for (const select of selects) select.value = libraryListOrder();
            return;
        }
        if (value === libraryListOrder()) return;
        appearanceSaving = true;
        for (const select of selects) select.disabled = true;
        try {
            await setListOrder(value);
            // Start at the first visible entry in the selected reading order.
            // This also moves the journal's actual first reading page.
            catalogPage = 0;
            diaryTocPage = 0;
            diaryIndex = 0;
            resetMemoryStream();
            worldTocPage = 0;
            peoplePage = 0;
            selectedUid = null;
            resetEdit();
            if (currentData) renderBook();
        } catch (error) {
            notifyStatus('정렬 순서 저장 실패: ' + (error?.message || error), 'error');
        } finally {
            appearanceSaving = false;
            for (const select of overlay?.querySelectorAll('.slb-library-order-select') || []) {
                select.disabled = false;
                select.value = libraryListOrder();
            }
        }
    }
    async function updateShelfRows(nextValue) {
        const count = Number(nextValue);
        const picker = overlay?.querySelector('#slb-library-shelf-rows');
        if (!isOpen() || appearanceSaving || ![1, 2, 3].includes(count)) {
            if (picker) picker.value = String(getShelfRows());
            return;
        }
        if (count === Number(getShelfRows())) return;
        appearanceSaving = true;
        if (picker) picker.disabled = true;
        try {
            await setShelfRows(count);
            shelfRows = count;
            if (!currentBook) bookList();
        } catch (error) {
            notifyStatus('서가 표시 줄 수 저장 실패: ' + (error?.message || error), 'error');
        } finally {
            appearanceSaving = false;
            if (picker) {
                picker.disabled = false;
                picker.value = String(getShelfRows());
            }
        }
    }
    async function updateLibraryLinkedOnly(enabled) {
        if (!isOpen() || appearanceSaving || coverEditor) return;
        const old = Boolean(getLinkedOnly());
        if (old === enabled) return;
        appearanceSaving = true;
        const input = overlay.querySelector('#slb-library-linked-only');
        if (input) input.disabled = true;
        try {
            await setLinkedOnly(enabled);
            allBooks = !enabled;
            shelfRows = [1, 2, 3].includes(Number(getShelfRows())) ? Number(getShelfRows()) : 3;
            if (!currentBook) bookList();
            notifyStatus('연결된 책 표시 설정이 저장되었습니다.', 'success');
        } catch (error) {
            notifyStatus('표시 설정 저장 실패: ' + (error?.message || error), 'error');
        } finally {
            appearanceSaving = false;
            if (input) {
                input.disabled = false;
                input.checked = Boolean(getLinkedOnly());
            }
        }
    }
    function bookTags(book) {
        return normalizeLibraryTags(getTags(book));
    }
    function spineTone(book) {
        // Use the actual saved shelf order for the approved material/cover
        // sequence; filtering never changes an individual book's appearance.
        return bookToneByName.get(book) ?? 0;
    }
    function shelfColumns(body, mode) {
        // Read geometry only on explicit shelf render, never through observers.
        const shellWidth = overlay?.querySelector('.slb-library-shell')?.clientWidth
            || Math.min(doc.defaultView.innerWidth || 1024, 1000);
        const width = body.clientWidth || Math.max(260, shellWidth - 32);
        if (mode === 'ebook') return Math.max(3, Math.min(6, Math.floor((shellWidth - 14) / 96)));
        // The Finder sidebar is now 56px instead of 135px; use the reclaimed width.
        if (mode === 'mac') return Math.max(3, Math.min(5, Math.floor((shellWidth - 20) / 106)));
        if (mode === 'blackberry') return Math.max(3, Math.min(5, Math.floor((shellWidth - 16) / 98)));
        return Math.max(3, Math.min(14, Math.floor((width - 28 + 4) / 47)));
    }
    function clearGlobalSearch() {
        ++globalSearchSerial;
        globalSearchOpen = false;
        const body = overlay?.querySelector('.slb-library-body');
        body?.querySelector('.slb-library-global-panel')?.remove();
        body?.classList.remove('is-global-search');
    }
    function returnToShelf() {
        clearGlobalSearch();
        const body = overlay?.querySelector('.slb-library-body');
        if (body?.dataset.type === 'books' && shelfColumns(body, libraryTheme()) !== shelfColumnCount)
            bookList({ resultsOnly: true });
    }
    function bookList({ resultsOnly = false } = {}) {
        if (!isOpen()) return;
        clearGlobalSearch();
        const body = overlay.querySelector('.slb-library-body');
        const oldScroll = body.dataset.type === 'books' ? body.scrollTop : 0;
        const oldShelf = body.querySelector('.slb-library-bookshelf');
        const oldSummary = body.querySelector('.slb-library-shelf-summary');
        const oldShelfScroll = oldShelf?.querySelector('.slb-library-books-scroll')?.scrollTop || 0;
        const partial = resultsOnly && body.dataset.type === 'books' && oldShelf && oldSummary;
        if (!partial) {
        ++globalSearchSerial;
        globalSearchOpen = false;
        resetEdit();
        closeReaderTools();
        cancelCoverLongPress();
        closeCoverMenu();
        currentBook = '';
        pendingImages.clear();
        currentData = null;
        selectedUid = null;
        const nav = overlay.querySelector('.slb-library-navigation');
        nav.classList.remove('slb-library-has-book', 'is-search-open');
        nav.querySelector('.slb-library-current').textContent = '로어북 서가';
        nav.querySelector('.slb-library-nav-tags')?.replaceChildren();
        body.replaceChildren();
        body.dataset.type = 'books';
        }

        const hasLinks = linkedNames instanceof Set && linkedNames.size > 0;
        const linked = uniqueLibraryBooks(bookNames, linkedNames).filter(book =>
            allBooks || !hasLinks || book.linked);
        const tagMap = typeof getTagMap === 'function' ? getTagMap() : null;
        const tagsFor = book => tagMap && typeof tagMap === 'object'
            ? normalizeLibraryTags(Object.hasOwn(tagMap, book) ? tagMap[book] : []) : bookTags(book);
        let head, tagbar;
        if (!partial) {
        const knownTags = [];
        const seenTags = new Set();
        for (const item of linked) {
            for (const tag of tagsFor(item.name)) {
                if (!seenTags.has(tag)) { seenTags.add(tag); knownTags.push(tag); }
            }
        }
        head = element(doc, 'div', 'slb-library-books-head');
        const shelfSearchToggle = button(doc, 'slb-library-shelf-search-toggle', '', 'shelf-search-toggle');
        shelfSearchToggle.setAttribute('aria-label', '검색');
        shelfSearchToggle.setAttribute('title', '검색');
        shelfSearchToggle.prepend(faIcon(doc, 'magnifying-glass'));
        shelfSearchToggle.setAttribute('aria-controls', 'slb-library-shelf-search');
        shelfSearchToggle.setAttribute('aria-expanded', String(shelfSearchOpen));
        const titleSearch = element(doc, 'input', 'slb-library-shelf-search');
        titleSearch.id = 'slb-library-shelf-search';
        titleSearch.type = 'search';
        titleSearch.autocomplete = 'off';
        titleSearch.placeholder = '검색';
        titleSearch.setAttribute('aria-label', '전체 로어북 검색');
        titleSearch.setAttribute('enterkeyhint', 'search');
        titleSearch.value = shelfQuery;
        head.append(titleSearch, shelfSearchToggle);

        tagbar = element(doc, 'nav', 'slb-library-tagbar');
        tagbar.setAttribute('aria-label', '로어북 태그');
        for (const [key, name] of [['all', '전체'], ['untagged', '미분류']]) {
            const choice = button(doc, 'slb-library-tag-tab' +
                (shelfTag === key && !shelfSelectedTags.size ? ' is-active' : ''), name, 'shelf-tag');
            choice.dataset.filter = key;
            choice.setAttribute('aria-pressed', String(shelfTag === key));
            tagbar.append(choice);
        }
        const tagSelect = element(doc, 'select', 'slb-library-shelf-tag-select');
        tagSelect.id = 'slb-library-shelf-tag-select';
        tagSelect.setAttribute('aria-label', '저장된 로어북 태그 선택');
        tagSelect.append(element(doc, 'option', '', '태그 선택'));
        tagSelect.options[0].value = '';
        for (const tag of knownTags) {
            const option = element(doc, 'option', '', tag);
            option.value = 'tag:' + tag;
            tagSelect.append(option);
        }
        // Keep the native picker for keyboard and touch accessibility. Every
        // selection toggles one persistent chip; multiple tags match ANY (OR).
        tagSelect.value = '';
        tagbar.append(tagSelect);
        }
        const typeMap = typeof getTypeMap === 'function' ? getTypeMap() : null;
        const mode = libraryTheme();
        const savedTypeOf = book => {
            const value = typeMap && typeof typeMap === 'object'
                ? (Object.hasOwn(typeMap, book) ? typeMap[book] : 'general')
                : getType(book);
            return Object.hasOwn(LIBRARY_BOOK_TYPES, value) ? value : 'general';
        };
        let candidates = linked.filter(book => {
            const tags = tagsFor(book.name);
            if (shelfTag === 'untagged' && tags.length) return false;
            if (shelfSelectedTags.size && !tags.some(tag => shelfSelectedTags.has(tag))) return false;
            if (mode === 'mac' && shelfType !== 'all' && savedTypeOf(book.name) !== shelfType) return false;
            return true;
        });
        if (favorites.size) candidates = [
            ...candidates.filter(book => favorites.has(book.name)),
            ...candidates.filter(book => !favorites.has(book.name)),
        ];
        const ebook = mode === 'ebook';
        const classic = mode === 'antique';
        const shelf = element(doc, 'div', 'slb-library-bookshelf' +
            (classic ? '' : ' slb-library-digital-bookshelf slb-library-mode-' + mode));
        const scroll = element(doc, 'div', 'slb-library-books-scroll');
        scroll.setAttribute('role', 'region');
        scroll.setAttribute('aria-label', classic ? '책등 목록'
            : ebook ? '전자책 표지 목록' : mode === 'mac' ? '폴더 목록' : '앱 목록');
        scroll.tabIndex = 0;
        const spines = element(doc, 'div', classic ? 'slb-library-book-spines'
            : ebook ? 'slb-library-cover-grid' : mode === 'mac' ? 'slb-library-folder-grid' : 'slb-library-app-grid');
        const coverMap = ebook && typeof getBookCoverMap === 'function' ? getBookCoverMap() : null;
        const rowWidth = shelfColumns(body, mode);
        shelfColumnCount = rowWidth;
        spines.style.setProperty('--slb-shelf-columns', String(rowWidth));
        const maxVisible = shelfRows * rowWidth;
        const shown = candidates.slice(0, maxVisible);
        for (const [index, item] of shown.entries()) {
            const type = savedTypeOf(item.name);
            if (mode === 'mac') {
                const folder = button(doc, 'slb-library-folder-card', '', 'select-book');
                folder.dataset.book = item.name;
                folder.setAttribute('aria-label', item.name + ' · 폴더 열기');
                const face = element(doc, 'span', 'slb-library-folder-icon slb-library-folder-type-' + type);
                face.append(element(doc, 'span', 'slb-library-folder-symbol', LIBRARY_TYPE_MARKS[type]));
                folder.append(face, element(doc, 'span', 'slb-library-folder-caption', item.name));
                spines.append(folder);
                continue;
            }
            if (mode === 'blackberry') {
                const app = button(doc, 'slb-library-app-card', '', 'select-book');
                app.dataset.book = item.name;
                app.setAttribute('aria-label', item.name + ' · 앱 열기');
                const icon = element(doc, 'span', 'slb-library-app-icon slb-library-app-type-' + type);
                icon.append(element(doc, 'span', 'slb-library-app-symbol', LIBRARY_TYPE_MARKS[type]));
                app.append(icon, element(doc, 'span', 'slb-library-app-caption', item.name));
                spines.append(app);
                continue;
            }
            if (ebook) {
                const entry = element(doc, 'div', 'slb-library-cover-item');
                const opener = button(doc, 'slb-library-cover-open', '', 'select-book');
                opener.dataset.book = item.name;
                opener.setAttribute('aria-label', item.name + ' · 로어북 열기');
                const art = element(doc, 'div', 'slb-library-cover-art slb-library-cover-type-' + type
                    + ' slb-library-type-variant-' + (spineTone(item.name) % 3));
                art.append(element(doc, 'span', 'slb-library-cover-mark',
                    { general: 'F', memory: 'J', world: 'W', people: 'A–Z' }[type]));
                art.append(element(doc, 'span', 'slb-library-cover-title', item.name));
                art.append(element(doc, 'span', 'slb-library-cover-type-label',
                    { general: 'RECORD', memory: 'JOURNAL', world: 'WORLD', people: 'PEOPLE' }[type]));
                const stored = coverMap && typeof coverMap === 'object'
                    ? (Object.hasOwn(coverMap, item.name) ? coverMap[item.name] : '')
                    : getBookCover(item.name);
                const imagePath = safeLibraryImagePath(stored);
                if (imagePath) {
                    const image = element(doc, 'img', 'slb-library-cover-image');
                    image.src = imagePath;
                    image.alt = item.name + ' 표지 이미지';
                    image.loading = 'lazy';
                    image.decoding = 'async';
                    image.addEventListener('error', () => image.remove(), { once: true });
                    art.append(image);
                }
                opener.append(art, element(doc, 'span', 'slb-library-cover-caption', item.name));
                opener.title = '클릭하여 열기 · 우클릭 또는 길게 눌러 표지 설정';
                opener.setAttribute('aria-haspopup', 'menu');
                opener.setAttribute('aria-expanded', String(coverContextBook === item.name));
                const menu = element(doc, 'div', 'slb-library-cover-menu');
                menu.hidden = coverContextBook !== item.name;
                menu.setAttribute('role', 'menu');
                menu.setAttribute('aria-label', item.name + ' · 표지 메뉴');
                const configure = button(doc, 'slb-library-cover-config', imagePath ? '표지 교체' : '표지 설정', 'cover-config');
                configure.dataset.book = item.name;
                configure.setAttribute('role', 'menuitem');
                configure.setAttribute('aria-label', item.name + ' · 표지 설정');
                menu.append(configure);
                entry.append(opener, menu);
                spines.append(entry);
                continue;
            }
            const tone = spineTone(item.name);
            // The saved book type owns its cover/binding identity. The shelf
            // position changes ONLY the shade within that same type template.
            const binding = { general: 'linen', memory: 'cloth', world: 'leather', people: 'cloth' }[type];
            const spine = button(doc, 'slb-library-book-spine slb-library-spine-type-' + type
                + ' slb-library-type-variant-' + (tone % 3)
                + ' slb-library-binding-' + binding, '', 'select-book');
            spine.dataset.book = item.name;
            spine.dataset.bookType = type;
            spine.title = item.name;
            spine.setAttribute('aria-label', item.name + ' · 로어북 열기');
            const adornment = { general: 'F', memory: 'J', world: 'W', people: 'A–Z' };
            spine.append(element(doc, 'span', 'slb-library-spine-ornament', adornment[type]));
            const name = element(doc, 'span', 'slb-library-spine-title', item.name);
            name.lang = /[가-힣]/.test(item.name) ? 'ko' : 'en';
            spine.append(name);
            spine.append(element(doc, 'span', 'slb-library-spine-bottom',
                { general: 'FILE', memory: 'DIARY', world: 'ATLAS', people: 'A–Z' }[type]));
            spines.append(spine);
        }
        if (!shown.length) {
            spines.append(element(doc, 'p', 'slb-library-shelf-empty',
                linked.length === 0
                    ? (allBooks ? '저장된 로어북이 없습니다.' : '연결된 로어북이 없습니다. 설정에서 전체 보기를 선택하세요.')
                    : '검색 또는 분류에 해당하는 로어북이 없습니다.'));
        }
        scroll.append(spines);
        if (mode === 'mac') {
            const finder = element(doc, 'section', 'slb-library-finder');
            const titlebar = element(doc, 'div', 'slb-library-finder-titlebar');
            const traffic = element(doc, 'span', 'slb-library-finder-traffic');
            traffic.setAttribute('aria-hidden', 'true');
            for (let i = 0; i < 3; i++) traffic.append(element(doc, 'i'));
            titlebar.append(traffic, element(doc, 'strong', '', '내 서재'),
                element(doc, 'span', 'slb-library-finder-caption', 'FINDER'));
            const workspace = element(doc, 'div', 'slb-library-finder-workspace');
            const sidebar = element(doc, 'nav', 'slb-library-finder-sidebar');
            sidebar.setAttribute('aria-label', '폴더 분류');
            sidebar.append(element(doc, 'small', '', 'COLLECTIONS'));
            for (const [value, label] of [['all', '전체'],
                ...Object.entries(LIBRARY_BOOK_TYPES)]) {
                const tab = button(doc, 'slb-library-finder-category' +
                    (shelfType === value ? ' is-active' : ''), label, 'shelf-type');
                tab.dataset.filter = value;
                tab.setAttribute('aria-pressed', String(shelfType === value));
                tab.setAttribute('aria-label', label);
                tab.title = label;
                tab.replaceChildren(faIcon(doc, {
                    all: 'layer-group', general: 'address-card',
                    memory: 'book-open', world: 'globe', people: 'users',
                }[value]));
                sidebar.append(tab);
            }
            workspace.append(sidebar, scroll);
            finder.append(titlebar, workspace);
            shelf.append(finder);
        } else if (mode === 'blackberry') {
            const device = element(doc, 'section', 'slb-library-app-device');
            const head = element(doc, 'div', 'slb-library-app-device-head');
            head.append(element(doc, 'span', 'slb-library-app-device-led', '•'),
                element(doc, 'strong', '', 'LORE LIBRARY'),
                element(doc, 'span', '', '▰ ▰'));
            const screen = element(doc, 'div', 'slb-library-app-device-screen');
            screen.append(scroll);
            device.append(head, screen, blackBerryKeys());
            shelf.append(device);
        } else if (ebook) shelf.append(scroll);
        else shelf.append(scroll, element(doc, 'div', 'slb-library-wood-plank'));
        if (!partial) {
        const toolbar = element(doc, 'div', 'slb-library-shelf-toolbar');
        toolbar.classList.toggle('is-search-open', shelfSearchOpen);
        toolbar.append(tagbar, head);
        body.append(toolbar);
        if (shelfSelectedTags.size) {
            const active = element(doc, 'div', 'slb-library-active-tags');
            active.setAttribute('aria-label', '선택한 태그 필터 · 하나라도 포함하면 표시');
            for (const tag of shelfSelectedTags) {
                const chip = button(doc, 'slb-library-active-tag', '× ' + tag, 'shelf-tag-chip');
                chip.dataset.tag = tag;
                chip.setAttribute('aria-label', tag + ' 필터 해제');
                active.append(chip);
            }
            body.append(active);
        }
        }
        const summary = element(doc, 'div', 'slb-library-shelf-summary');
        summary.append(element(doc, 'span', '', candidates.length + '권 중 ' + shown.length + '권 표시'));
        if (candidates.length > shown.length) {
            const more = button(doc, 'slb-library-shelf-more', '', 'shelf-more');
            more.append(element(doc, 'span', 'slb-library-more-caption',
                '더 보기 (' + (candidates.length - shown.length) + ')'));
            summary.append(more);
        }
        if (partial) {
            oldShelf.replaceWith(shelf);
            oldSummary.replaceWith(summary);
            scroll.scrollTop = oldShelfScroll;
        } else body.append(shelf, summary);
        body.scrollTop = oldScroll;
        notifyStatus(candidates.length + '권');
    }
    function renderBookTagPanel() {
        // Native details/summary provides a lightweight toggle without observers,
        // extra DOM reflow passes or a bespoke accordion state machine.
        const row = element(doc, 'details', 'slb-library-book-meta');
        row.setAttribute('aria-label', '현재 로어북 태그');
        row.open = tagPanelExpanded;
        row.addEventListener('toggle', () => {
            if (row.isConnected) tagPanelExpanded = row.open;
        });
        const summary = element(doc, 'summary', 'slb-library-book-meta-summary');
        const chips = element(doc, 'div', 'slb-library-book-chips');
        const existing = bookTags(currentBook);
        if (!existing.length) chips.append(element(doc, 'span', 'slb-library-no-tags', '미분류'));
        else for (const tag of existing) chips.append(element(doc, 'span', 'slb-library-tag-chip', tag));
        summary.append(chips);
        if (favorites.has(currentBook)) summary.append(element(doc, 'span', 'slb-library-favorite-mark', '★'));
        // Metadata-only suggestions: no lorebook file reads, writes, or content
        // scans. The popover is absolutely positioned, so TOC controls do not shift.
        const picker = element(doc, 'div', 'slb-library-book-tag-picker');
        const favorite = button(doc, 'slb-library-book-favorite', favorites.has(currentBook) ? '★ 즐겨찾기 해제' : '☆ 즐겨찾기 추가', 'favorite-book');
        favorite.setAttribute('aria-pressed', String(favorites.has(currentBook)));
        picker.append(favorite);
        const allTags = new Set();
        const tagMap = typeof getTagMap === 'function' ? getTagMap() : null;
        if (tagMap && typeof tagMap === 'object') {
            for (const value of Object.values(tagMap)) {
                for (const tag of normalizeLibraryTags(value)) allTags.add(tag);
            }
        } else {
            for (const book of bookNames) {
                for (const tag of bookTags(book)) allTags.add(tag);
            }
        }
        if (allTags.size) {
            const suggestions = element(doc, 'div', 'slb-library-book-tag-suggestions');
            suggestions.setAttribute('role', 'group');
            suggestions.setAttribute('aria-label', '기존 태그 선택');
            const draftTags = new Set(tagDraft.split(',').map(value => value.trim()).filter(Boolean));
            for (const tag of allTags) {
                const isSelected = draftTags.has(tag);
                const choice = button(doc, 'slb-library-book-tag-suggestion' +
                    (isSelected ? ' is-selected' : ''), tag, 'book-tag-suggest');
                choice.dataset.tag = tag;
                choice.setAttribute('aria-pressed', String(isSelected));
                choice.disabled = tagSaving;
                suggestions.append(choice);
            }
            picker.append(suggestions);
        }
        const field = element(doc, 'div', 'slb-library-book-tag-field');
        const input = element(doc, 'input', 'slb-library-book-tag-input');
        input.id = 'slb-library-book-tag-input';
        input.type = 'text';
        input.autocomplete = 'off';
        input.maxLength = 250;
        input.placeholder = '쉼표로 구분 · 최대 8개';
        input.setAttribute('aria-label', '로어북 태그 입력');
        input.value = tagDraft;
        input.disabled = tagSaving;
        const save = button(doc, 'slb-library-book-tag-save', '태그 저장', 'book-tag-save');
        save.disabled = tagSaving || tagDraft === tagInitial;
        field.append(input, save);
        picker.append(field);
        row.append(summary, picker);
        return row;
    }
    function toggleBookTagSuggestion(tag) {
        if (!currentBook || tagSaving || typeof tag !== 'string') return;
        const draft = normalizeLibraryTags(tagDraft.split(',').map(value => value.trim()).filter(Boolean));
        const index = draft.indexOf(tag);
        if (index >= 0) draft.splice(index, 1);
        else {
            if (draft.length >= 8) {
                notifyStatus('태그는 최대 8개까지 지정할 수 있습니다.', 'warning');
                return;
            }
            draft.push(tag);
        }
        tagDraft = draft.join(', ');
        const input = overlay?.querySelector('#slb-library-book-tag-input');
        if (input) input.value = tagDraft;
        const save = overlay?.querySelector('[data-action="book-tag-save"]');
        if (save) save.disabled = tagDraft === tagInitial;
        syncTagSuggestionStates();
    }
    function syncTagSuggestionStates() {
        const current = new Set(tagDraft.split(',').map(value => value.trim()).filter(Boolean));
        for (const choice of overlay?.querySelectorAll('[data-action="book-tag-suggest"]') || []) {
            const selected = current.has(choice.dataset.tag);
            choice.classList.toggle('is-selected', selected);
            choice.setAttribute('aria-pressed', String(selected));
        }
    }
    async function saveBookTags() {
        if (!currentBook || tagSaving || !overlay?.isConnected) return;
        const input = overlay.querySelector('#slb-library-book-tag-input');
        if (!input) return;
        tagDraft = input.value;
        const parts = tagDraft.split(',').map(item => item.trim()).filter(Boolean);
        if (parts.length > 8 || parts.some(item => item.length > 30)) {
            notifyStatus('태그는 최대 8개, 각 30자까지 지정할 수 있습니다.', 'warning');
            return;
        }
        const next = normalizeLibraryTags(parts);
        const oldTags = bookTags(currentBook);
        if (next.length === oldTags.length && next.every((value, i) => value === oldTags[i])) {
            tagInitial = next.join(', ');
            tagDraft = tagInitial;
            overlay.querySelector('.slb-library-book-meta')?.replaceWith(renderBookTagPanel());
            return;
        }
        tagSaving = true;
        input.disabled = true;
        const button = overlay.querySelector('[data-action="book-tag-save"]');
        if (button) button.disabled = true;
        try {
            // Only extension settings metadata is persisted; worldbook stays intact.
            await setTags(currentBook, next);
            tagInitial = next.join(', ');
            tagDraft = tagInitial;
            if (isOpen()) {
                overlay.querySelector('.slb-library-book-meta')?.replaceWith(renderBookTagPanel());
                notifyStatus('태그가 저장되었습니다.', 'success');
            }
        } catch (error) {
            notifyStatus('태그 저장 실패: ' + (error?.message || error), 'error');
        } finally {
            tagSaving = false;
            const freshInput = overlay?.querySelector('#slb-library-book-tag-input');
            if (freshInput) freshInput.disabled = false;
            const freshSave = overlay?.querySelector('[data-action="book-tag-save"]');
            if (freshSave) freshSave.disabled = tagDraft === tagInitial;
        }
    }
    async function selectBook(book, preloadedData = null) {
        if (!bookNames.includes(book) || !discardOrStay()) return;
        ++globalSearchSerial;
        globalSearchOpen = false;
        resetEdit();
        closeReaderTools();
        const version = ++loadVersion;
        currentBook = book;
        readerSearchOpen = false;
        pendingImages.clear();
        tagPanelExpanded = false;
        tagInitial = bookTags(book).join(', ');
        tagDraft = tagInitial;
        memoryTocCollapsed = false;
        worldTocCollapsed = false;
        peopleTocCollapsed = false;
        catalogPage = 0;
        diaryTocPage = 0;
        currentData = null;
        entries = [];
        selectedUid = null;
        diaryIndex = 0;
        memoryView = preferredMemoryView();
        memoryTocCollapsed = memoryView !== 'page';
        resetMemoryStream();
        worldQuery = '';
        peopleQuery = '';
        worldTocPage = 0;
        peoplePage = 0;
        overlay?.querySelector('.slb-library-nav-tags')?.replaceChildren();
        searchIndex = new Map();
        query = '';
        entryReadViews = new Map();
        const body = overlay?.querySelector('.slb-library-body');
        if (!body) return;
        overlay.querySelector('.slb-library-navigation').classList.add('slb-library-has-book');
        overlay.querySelector('.slb-library-navigation').classList.remove('is-search-open');
        overlay.querySelector('[data-action="reader-search-toggle"]')?.setAttribute('aria-expanded', 'false');
        overlay.querySelector('.slb-library-current').textContent = book;
        overlay.querySelector('#slb-library-search').value = '';
        overlay.querySelector('#slb-library-book-type').value = getType(book) || 'general';
        body.classList.remove('is-global-search');
        body.replaceChildren(element(doc, 'p', 'slb-library-loading', '책과 번역 기록을 여는 중…'));
        body.dataset.type = 'loading';
        notifyStatus('선택한 로어북 파일을 불러오는 중입니다.');
        try {
            // Translation loading does not trigger an AI call or retranslate.
            const [data] = await Promise.all([preloadedData ? Promise.resolve(preloadedData) : loadBook(book), loadTranslations(book)]);
            if (!isOpen() || version !== loadVersion || currentBook !== book) return;
            if (!data?.entries) throw new Error('로어북 데이터가 비어 있거나 올바르지 않습니다.');
            currentData = data;
            entries = orderedLoreEntries(data);
            buildSearchIndex();
            renderBook();
            notifyStatus(entries.length + '개 항목');
        } catch (error) {
            if (!isOpen() || version !== loadVersion || currentBook !== book) return;
            body.replaceChildren(element(doc, 'p', 'slb-library-empty', '로어북 불러오기 실패: ' + (error.message || error)));
            notifyStatus('로어북 불러오기 실패 · 원본은 변경되지 않았습니다.', 'error');
        }
    }
    let readerSnapshot = new Map();
    let readerSourceOrder = [];
    function readerMetadata(entry) {
        return JSON.stringify([entry.comment, entry.key, entry.keysecondary, entry.order]);
    }
    function buildSearchIndex() {
        readerSnapshot = new Map(entries.map(entry => [String(entry.uid), {
            content: entry.content, metadata: readerMetadata(entry),
        }]));
        readerSourceOrder = Object.values(currentData?.entries || {})
            .filter(entry => entry && typeof entry.content === 'string').map(entry => String(entry.uid));
        searchIndex = new Map();
        searchIndexDirty = true;
        entryNumbers = new Map();
        filteredCache = null;
        for (const [index, entry] of entries.entries()) {
            entryNumbers.set(String(entry.uid), index + 1);
        }
    }
    function searchableFields(entry, translation) {
        return [
            entry.comment || '',
            ...(Array.isArray(entry.key) ? entry.key : []),
            ...(Array.isArray(entry.keysecondary) ? entry.keysecondary : []),
            entry.content || '',
            translation?.text,
            translation?.title,
            translation?.fields?.comment?.text,
            translation?.fields?.key?.text,
            translation?.fields?.keysecondary?.text,
        ].filter(value => typeof value === 'string').join('\n').toLocaleLowerCase();
    }
    function indexEntry(entry) {
        searchIndex.set(String(entry.uid), searchableFields(entry, searchTranslationFor?.(currentBook, entry)));
    }
    function ensureSearchIndex() {
        if (!searchIndexDirty) return;
        searchIndex.clear();
        for (const entry of entries) indexEntry(entry);
        searchIndexDirty = false;
    }
    function invalidateTranslationSearch(book = null) {
        if (book && book !== currentBook) return;
        searchIndexDirty = true;
        filteredCache = null;
    }
    function filtered() {
        // Presentation-only sort: preserve live WorldInfo entries, UIDs,
        // displayIndex and translation/source data. Filter before ordering.
        const needle = query.toLocaleLowerCase().trim();
        const order = libraryListOrder();
        if (needle) ensureSearchIndex();
        if (filteredCache?.needle === needle && filteredCache.order === order) return filteredCache.found;
        const found = needle
            ? entries.filter(item => searchIndex.get(String(item.uid))?.includes(needle))
            : entries.slice();
        let result = found;
        if (order === 'reverse') result = found.reverse();
        else if (order !== 'normal') {
            const direction = order === 'title-desc' ? -1 : 1;
            result = found.map((entry, index) => ({ entry, index, title: titleOf(entry) }))
                .sort((a, b) => direction * LIBRARY_TITLE_COLLATOR.compare(a.title, b.title)
                    || a.index - b.index)
                .map(item => item.entry);
        }
        filteredCache = { needle, order, found: result };
        return result;
    }
    function originalEntryNumber(entry) {
        return entryNumbers.get(String(entry.uid)) || 0;
    }
    function titleOf(entry) {
        const name = String(entry.comment || '').trim();
        const translation = translationFor(currentBook, entry);
        return translation?.title?.trim() || name || '항목 #' + entry.uid;
    }
    function readerBookLine() {
        // Keep book name and tag editor in their original shared header.
        // TOC labels and chevrons belong only inside the actual TOC pane.
        const line = element(doc, 'div', 'slb-library-reader-bookline');
        const title = element(doc, 'strong', 'slb-library-reader-book-title', currentBook);
        title.title = currentBook;
        const tags = element(doc, 'div', 'slb-library-reader-book-tags');
        line.append(title, tags);
        return line;
    }
    function inlineTocHeading(type, collapsed, collapsible = true) {
        const heading = element(doc, 'div', 'slb-library-toc-heading');
        const label = 'CONTENTS · 목차';
        if (!collapsible) {
            heading.append(element(doc, 'strong', 'slb-library-toc-label', label));
            return heading;
        }
        const action = type + '-toc-toggle';
        const toggle = button(doc, 'slb-library-toc-inline-button', '', action);
        toggle.setAttribute('aria-controls', type === 'memory'
            ? 'slb-library-memory-contents' : type === 'world'
                ? 'slb-library-world-contents' : 'slb-library-people-contents');
        toggle.setAttribute('aria-label', collapsed ? '목차 펼치기' : '목차 접기');
        toggle.setAttribute('aria-expanded', String(!collapsed));
        toggle.append(element(doc, 'strong', 'slb-library-toc-label', label),
            element(doc, 'span', 'slb-library-toc-chevron', collapsed ? '▾' : '▴'));
        heading.append(toggle);
        return heading;
    }
    function cleanReaderChrome() {
        const chrome = element(doc, 'div', 'slb-library-clean-chrome');
        const dots = element(doc, 'span', 'slb-library-window-dots');
        dots.setAttribute('aria-hidden', 'true');
        dots.append(element(doc, 'i'), element(doc, 'i'), element(doc, 'i'));
        chrome.append(dots, readerBookLine());
        return chrome;
    }
    function blackBerryKeys() {
        const keyboard = element(doc, 'div', 'slb-library-device-keyboard');
        keyboard.setAttribute('aria-hidden', 'true');
        const nav = element(doc, 'div', 'slb-library-device-controls');
        nav.setAttribute('aria-hidden', 'true');
        nav.append(element(doc, 'span', 'slb-library-device-trackpad'));
        keyboard.append(nav);
        for (const line of ['QWERTYUIOP','ASDFGHJKL','ZXCVBNM']) {
            const row = element(doc, 'div', 'slb-library-device-key-row');
            for (const char of line) row.append(element(doc, 'span', '', char));
            keyboard.append(row);
        }
        return keyboard;
    }
    function readerContainer(body, type) {
        const mode = libraryTheme();
        const skin = mode === 'antique' ? 'slb-library-reader-classic'
            : mode === 'ebook' ? 'slb-library-reader-ebook'
            : 'slb-library-reader-clean slb-library-reader-' + mode;
        const frame = element(doc, 'section', 'slb-library-reader-frame ' + skin);
        frame.dataset.bookType = type;
        frame.dataset.libraryMode = mode;
        const inner = element(doc, 'div', 'slb-library-reader-inner');
        if (mode === 'mac') {
            frame.append(cleanReaderChrome());
            const workspace = element(doc, 'div', 'slb-library-clean-workspace');
            // The book-type picker already exists above the reader; duplicating
            // it in a left COLLECTIONS rail wastes space on narrow windows.
            workspace.append(inner);
            frame.append(workspace);
        } else if (mode === 'blackberry') {
            const top = element(doc, 'div', 'slb-library-app-device-head');
            const led = element(doc, 'span', 'slb-library-app-device-led', '•');
            led.setAttribute('aria-hidden', 'true');
            top.append(led, readerBookLine(),
                element(doc, 'span', 'slb-library-device-signal', '▰ ▰'));
            const screen = element(doc, 'div', 'slb-library-app-reading-screen');
            screen.append(inner);
            frame.append(top, screen, blackBerryKeys());
        } else if (mode === 'ebook') {
            const paper = element(doc, 'div', 'slb-library-ebook-paper');
            paper.append(readerBookLine(), inner);
            frame.append(paper);
        } else {
            const banner = element(doc, 'div', 'slb-library-classic-banner');
            banner.append(readerBookLine());
            frame.append(banner, inner);
        }
        body.append(frame);
        return inner;
    }
    function renderBook() {
        if (!currentData || !isOpen()) return;
        const type = getType(currentBook) || 'general';
        const body = overlay.querySelector('.slb-library-body');
        body.dataset.type = type;
        overlay.querySelector('.slb-library-navigation')?.classList.toggle('is-search-open', readerSearchOpen);
        overlay.querySelector('[data-action="reader-search-toggle"]')?.setAttribute('aria-expanded', String(readerSearchOpen));
        // Preserve the actual tag editor/input when a book page is replaced;
        // moving the node to the stable temporary slot keeps its unsaved draft.
        const tagSlot = overlay.querySelector('.slb-library-nav-tags');
        const previous = overlay.querySelector('.slb-library-book-meta');
        if (previous && tagSlot && previous.parentElement !== tagSlot) tagSlot.append(previous);
        body.replaceChildren();
        const found = filtered();
        const inner = readerContainer(body, type);
        const tagTarget = body.querySelector('.slb-library-reader-book-tags');
        const existingTagPanel = tagSlot?.querySelector('.slb-library-book-meta');
        if (tagTarget) tagTarget.append(existingTagPanel || renderBookTagPanel());
        if (!found.length) {
            inner.append(element(doc, 'p', 'slb-library-empty', '검색 결과가 없습니다.'));
            return;
        }
        if (type === 'memory') {
            renderDiary(inner, found);
        }
        else if (type === 'world') renderIndex(inner, found, 'world');
        else if (type === 'people') renderPeople(inner, found);
        else if (['mac', 'blackberry'].includes(libraryTheme())) renderCleanCatalog(inner, found);
        else renderCatalog(inner, found);
        const firstDetail = body.querySelector('.slb-library-detail');
        const uid = type === 'memory' ? found[diaryIndex]?.uid?.toString() : firstDetail?.dataset.uid;
        if (uid != null && !suppressRecent && (recent?.book !== currentBook || recent.uid !== uid)) {
            recent = { book: currentBook, uid };
            setRecent(recent);
        }
    }
    function renderCatalog(body, found) {
        const selectedIndex = found.findIndex(item => String(item.uid) === selectedUid);
        if (selectedIndex >= 0) {
            const nav = element(doc, 'div', 'slb-library-catalog-detail-nav');
            nav.append(button(doc, '', '‹ 카드함', 'catalog-back'));
            nav.append(element(doc, 'span', 'slb-library-catalog-position',
                String(selectedIndex + 1).padStart(2, '0') + ' / ' + String(found.length).padStart(2, '0')));
            body.append(nav, renderDetail(found[selectedIndex], 'general'));
            const pager = element(doc, 'nav', 'slb-library-catalog-pager');
            pager.setAttribute('aria-label', '카드 기록 탐색');
            const first = button(doc, '', '«', 'catalog-first');
            const prev = button(doc, '', '‹', 'catalog-prev');
            const next = button(doc, '', '›', 'catalog-next');
            const last = button(doc, '', '»', 'catalog-last');
            first.disabled = prev.disabled = selectedIndex === 0;
            next.disabled = last.disabled = selectedIndex === found.length - 1;
            for (const [control, caption] of [
                [first, '첫 기록'], [prev, '이전 기록'], [next, '다음 기록'], [last, '마지막 기록'],
            ]) control.setAttribute('aria-label', caption);
            pager.append(first, prev, element(doc, 'small', '',
                (selectedIndex + 1) + ' / ' + found.length), next, last);
            body.append(pager);
            return;
        }
        const info = pageData(found.length, catalogPage);
        catalogPage = info.page;
        const frame = element(doc, 'div', 'slb-library-catalog-frame slb-library-paged-contents');
        const contents = element(doc, 'div', 'slb-library-paged-list');
        contents.id = 'slb-library-catalog-contents';
        const stack = element(doc, 'div', 'slb-library-catalog');
        for (const entry of found.slice(info.start, info.start + info.size)) {
            const item = button(doc, 'slb-library-catalog-card', '', 'entry', String(entry.uid));
            item.append(element(doc, 'strong', '', titleOf(entry)));
            // v72 clipping cards show only a brief excerpt from the original
            // saved WorldInfo text; never copy or rewrite lore on the client.
            const excerpt = String(entry.content ?? '').replace(/\s+/g, ' ').trim().slice(0, 110);
            if (excerpt) item.append(element(doc, 'span', 'slb-library-card-excerpt', excerpt));
            stack.append(item);
        }
        contents.append(stack, pageButtons('catalog-list', info.page, found.length, '카드 목록'));
        frame.append(contents);
        body.append(frame);
    }
    function renderCleanCatalog(body, found) {
        const info = pageData(found.length, catalogPage);
        catalogPage = info.page;
        const visible = found.slice(info.start, info.start + info.size);
        const chosen = visible.find(item => String(item.uid) === selectedUid) || visible[0];
        selectedUid = String(chosen.uid);
        const frame = element(doc, 'div', 'slb-library-paged-contents');
        const contents = element(doc, 'div', 'slb-library-paged-list');
        contents.id = 'slb-library-catalog-contents';
        const list = element(doc, 'div', 'slb-library-clean-list');
        for (const item of visible) {
            const row = button(doc, 'slb-library-clean-list-row' +
                (String(item.uid) === selectedUid ? ' is-active' : ''), '', 'entry', String(item.uid));
            row.append(element(doc, 'strong', '', titleOf(item)),
                element(doc, 'span', 'slb-library-clean-list-chevron', '›'));
            list.append(row);
        }
        contents.append(list, pageButtons('catalog-list', info.page, found.length, '카드 목록'));
        frame.append(contents);
        body.append(frame);
        const preview = element(doc, 'div', 'slb-library-clean-preview');
        preview.append(renderDetail(chosen, 'general'));
        body.append(preview);
    }
    function shiftCatalog(direction) {
        const found = filtered();
        const current = found.findIndex(item => String(item.uid) === selectedUid);
        if (current < 0) return;
        const next = current + direction;
        if (next < 0 || next >= found.length || !discardOrStay({ allowTags: true })) return;
        resetEdit();
        selectedUid = String(found[next].uid);
        catalogPage = Math.floor(next / libraryPageSize());
        renderBook();
    }
    function diaryStep() {
        // A narrow floating window renders ONE actual journal page, not a
        // two-page spread with the second page hidden by CSS.
        const readerWidth = overlay?.querySelector('.slb-library-reader-inner')?.clientWidth
            || overlay?.querySelector('.slb-library-body')?.clientWidth
            || doc.defaultView.innerWidth || 1024;
        return getTheme() === 'antique' && readerWidth > 710 ? 2 : 1;
    }
    function memoryRecord(entry, index) {
        const uid = String(entry.uid);
        const record = element(doc, 'section', 'slb-library-memory-record');
        record.dataset.uid = uid;
        const translated = translationFor(currentBook, entry) || {};
        const view = entryReadViews.get(uid) || (translated.text ? 'translated' : 'source');
        const preview = memoryTimelinePreview(view === 'translated' && translated.text ? translated.text : entry.content, entry.comment);
        const head = element(doc, 'header', 'slb-library-memory-record-heading');
        head.append(element(doc, 'small', 'slb-library-memory-date',
            '기록 ' + String(originalEntryNumber(entry)).padStart(2, '0') + (preview.date ? ' · ' + preview.date : '')));
        head.append(element(doc, 'h3', '', titleOf(entry)));
        record.append(head);
        if (memoryView === 'continuous') {
            record.append(renderDetail(entry, 'memory'));
        } else {
            const text = element(doc, 'p', 'slb-library-memory-preview', preview.text || '본문이 비어 있습니다.');
            if (!preview.isResult) record.append(element(doc, 'small', 'slb-library-memory-excerpt-label', '본문 미리보기'));
            record.append(text);
            const open = button(doc, 'slb-library-memory-open', '전문 읽기 ›', 'memory-open-page', uid);
            open.dataset.index = String(index);
            record.append(open);
        }
        return record;
    }
    function renderMemoryStream(body, found) {
        const size = libraryPageSize();
        if (memoryStreamEnd <= memoryStreamStart || diaryIndex < memoryStreamStart || diaryIndex >= memoryStreamEnd) resetMemoryStream();
        memoryStreamStart = Math.max(0, Math.min(memoryStreamStart, Math.floor((found.length - 1) / size) * size));
        memoryStreamEnd = Math.min(found.length, Math.max(memoryStreamStart + size, memoryStreamEnd));
        const previous = button(doc, 'slb-library-memory-more', '이전 기록 더 보기', 'memory-more-prev');
        previous.hidden = memoryStreamStart === 0;
        const list = element(doc, 'div', 'slb-library-memory-stream slb-library-memory-' + memoryView);
        for (let i = memoryStreamStart; i < memoryStreamEnd; i++) list.append(memoryRecord(found[i], i));
        const more = button(doc, 'slb-library-memory-more', '더 보기', 'memory-more');
        more.hidden = memoryStreamEnd >= found.length;
        const count = element(doc, 'small', 'slb-library-memory-count',
            (memoryStreamStart + 1) + '–' + memoryStreamEnd + ' / ' + found.length);
        body.append(previous, list, count, more);
    }
    function extendMemoryStream(previous) {
        const found = filtered();
        const list = overlay?.querySelector('.slb-library-memory-stream');
        if (!list || memoryView === 'page') return;
        const oldStart = memoryStreamStart, oldEnd = memoryStreamEnd;
        const nextStart = previous ? Math.max(0, oldStart - libraryPageSize()) : oldStart;
        const nextEnd = previous ? oldEnd : Math.min(found.length, oldEnd + libraryPageSize());
        if (nextStart === oldStart && nextEnd === oldEnd) return;
        const fragment = doc.createDocumentFragment();
        const start = previous ? nextStart : oldEnd;
        const end = previous ? oldStart : nextEnd;
        for (let i = start; i < end; i++) fragment.append(memoryRecord(found[i], i));
        const scroller = overlay.querySelector('.slb-library-body');
        const priorHeight = previous ? scroller.scrollHeight : 0;
        const priorTop = previous ? scroller.scrollTop : 0;
        if (previous) list.prepend(fragment); else list.append(fragment);
        memoryStreamStart = nextStart;
        memoryStreamEnd = nextEnd;
        overlay.querySelector('[data-action="memory-more-prev"]').hidden = nextStart === 0;
        overlay.querySelector('[data-action="memory-more"]').hidden = nextEnd >= found.length;
        overlay.querySelector('.slb-library-memory-count').textContent = (nextStart + 1) + '–' + nextEnd + ' / ' + found.length;
        if (previous) scroller.scrollTop = priorTop + scroller.scrollHeight - priorHeight;
    }
    function memoryAnchorIndex() {
        if (memoryView === 'page') return diaryIndex;
        const scroller = overlay?.querySelector('.slb-library-body');
        if (!scroller) return diaryIndex;
        const top = scroller.getBoundingClientRect().top;
        // Measure only on an explicit view switch, not on scrolling or chat events.
        const records = [...scroller.querySelectorAll('.slb-library-memory-record')];
        const visible = records.find(record => record.getBoundingClientRect().bottom > top);
        return visible ? memoryStreamStart + records.indexOf(visible) : diaryIndex;
    }
    function scrollMemoryAnchor() {
        if (diaryIndex === 0) {
            overlay.querySelector('.slb-library-body').scrollTop = 0;
            return;
        }
        const uid = String(filtered()[diaryIndex]?.uid ?? '');
        if (!uid) return;
        const record = [...overlay.querySelectorAll('.slb-library-memory-record, .slb-library-diary-page')]
            .find(node => node.dataset.uid === uid);
        record?.scrollIntoView?.({ block: 'start', behavior: 'auto' });
    }
    function applyMemoryView(mode, targetIndex) {
        closeReaderTools();
        resetEdit();
        const previous = memoryView;
        memoryView = mode;
        if (mode !== 'page' && previous === 'page') memoryTocCollapsed = true;
        diaryIndex = targetIndex;
        diaryTocPage = Math.floor(diaryIndex / libraryPageSize());
        resetMemoryStream();
        renderBook();
        scrollMemoryAnchor();
    }
    function changeMemoryView(mode, index = null) {
        if (!memoryViews.includes(mode) || (memoryView === mode && index === null)
            || !discardOrStay({ allowTags: true })) return;
        const found = filtered();
        const targetIndex = index ?? memoryAnchorIndex();
        if (!Number.isInteger(targetIndex) || targetIndex < 0 || targetIndex >= found.length) return;
        applyMemoryView(mode, targetIndex);
    }
    async function updateMemoryViewPreference(mode) {
        const picker = overlay?.querySelector('#slb-library-memory-view');
        if (!picker) return;
        const preferred = preferredMemoryView();
        if (!isOpen() || appearanceSaving || !memoryViews.includes(mode)) {
            picker.value = preferred;
            return;
        }
        if (mode === preferred) return;
        const activeMemory = currentData && getType(currentBook) === 'memory';
        const needsViewChange = activeMemory && mode !== memoryView;
        if (needsViewChange && !discardOrStay({ allowTags: true })) {
            picker.value = preferred;
            return;
        }
        // A saved preference also works on the shelf and on non-memory books.
        // Only an open memory reader with a different view needs a rerender.
        const targetIndex = needsViewChange && filtered().length ? memoryAnchorIndex() : null;
        const book = currentBook;
        const previous = memoryView;
        appearanceSaving = true;
        picker.disabled = true;
        try {
            await setMemoryView(mode);
            if (!isOpen() || currentBook !== book || memoryView !== previous) return;
            if (targetIndex !== null) applyMemoryView(mode, targetIndex);
            else if (!activeMemory || needsViewChange) memoryView = mode;
            // If a temporary page becomes the saved preference, remove its
            // now-unnecessary return link without replacing an edited entry.
            else overlay.querySelector('[data-action="memory-return"]')?.remove();
        } catch (error) {
            notifyStatus('메모리 보기 저장 실패: ' + (error?.message || error), 'error');
        } finally {
            appearanceSaving = false;
            picker.disabled = false;
            picker.value = preferredMemoryView();
        }
    }
    function renderDiary(body, found) {
        diaryIndex = Math.min(Math.max(0, diaryIndex), found.length - 1);
        const info = pageData(found.length, diaryTocPage);
        diaryTocPage = info.page;
        const frame = element(doc, 'div', 'slb-library-paged-contents slb-library-diary-toc');
        frame.id = 'slb-library-memory-toc';
        const heading = inlineTocHeading('memory', memoryTocCollapsed);
        heading.classList.add('slb-library-memory-heading');
        if (memoryView !== 'page') heading.append(pageOptions());
        else if (preferredMemoryView() !== 'page') {
            const back = button(doc, 'slb-library-memory-return', '‹ 타임라인', 'memory-return');
            back.textContent = preferredMemoryView() === 'continuous' ? '‹ 연속 기록장' : '‹ 타임라인';
            back.setAttribute('aria-label', back.textContent.slice(2) + '으로 돌아가기');
            heading.append(back);
        }
        frame.append(heading);
        const contents = element(doc, 'div', 'slb-library-paged-list');
        contents.id = 'slb-library-memory-contents';
        contents.hidden = memoryTocCollapsed;
        const index = element(doc, 'nav', 'slb-library-index');
        index.setAttribute('aria-label', '기록 목차');
        for (const [offset, entry] of found.slice(info.start, info.start + info.size).entries()) {
            const position = info.start + offset;
            const item = button(doc, 'slb-library-index-item' +
                (position === diaryIndex ? ' is-selected' : ''), '', 'diary-entry', String(entry.uid));
            item.dataset.index = String(position);
            item.append(element(doc, 'span', 'slb-library-index-initial',
                String(originalEntryNumber(entry)).padStart(2, '0')),
                element(doc, 'span', '', titleOf(entry)));
            index.append(item);
        }
        contents.append(index, pageButtons('memory-list', info.page, found.length, '기록 목차', memoryView === 'page'));
        frame.append(contents);
        body.append(frame);
        if (memoryView !== 'page') {
            renderMemoryStream(body, found);
            return;
        }
        const journal = element(doc, 'div', 'slb-library-journal');
        const numberOfPages = diaryPageCount = diaryStep();
        for (const [offset, entry] of found.slice(diaryIndex, diaryIndex + numberOfPages).entries()) {
            const page = element(doc, 'article', 'slb-library-diary-page');
            page.dataset.uid = String(entry.uid);
            const head = element(doc, 'header', 'slb-library-diary-heading');
            const date = dateLabel(entry.comment);
            if (date) head.append(element(doc, 'span', 'slb-library-diary-date', date));
            head.append(element(doc, 'h3', '', titleOf(entry)));
            page.append(head, renderDetail(entry, 'memory'));
            page.append(element(doc, 'small', 'slb-library-diary-page-number',
                String(originalEntryNumber(entry)).padStart(2, '0') + ' / ' + String(entries.length).padStart(2, '0')));
            journal.append(page);
        }
        body.append(journal);
        // The reading spread remains one/two actual pages, independently of
        // the number of entries displayed in the TOC.
        const pager = element(doc, 'nav', 'slb-library-diary-pager');
        pager.setAttribute('aria-label', '일기 페이지 탐색');
        const first = button(doc, '', '«', 'diary-first');
        const previous = button(doc, '', '‹', 'diary-prev');
        const next = button(doc, '', '›', 'diary-next');
        const last = button(doc, '', '»', 'diary-last');
        first.disabled = previous.disabled = diaryIndex === 0;
        next.disabled = last.disabled = diaryIndex + numberOfPages >= found.length;
        for (const [control, caption] of [
            [first, '첫 일기 페이지'], [previous, '이전 일기 페이지'],
            [next, '다음 일기 페이지'], [last, '마지막 일기 페이지'],
        ]) control.setAttribute('aria-label', caption);
        pager.append(first, previous, element(doc, 'span', '',
            String(originalEntryNumber(found[diaryIndex])).padStart(2, '0') + '–'
            + String(originalEntryNumber(found[Math.min(found.length - 1, diaryIndex + numberOfPages - 1)])).padStart(2, '0')
            + ' / ' + String(entries.length).padStart(2, '0')), next, last);
        body.append(pager);
    }
    function renderIndex(body, found, type) {
        // World reference retains a separate, vertically scrolling TOC.
        // Contacts use renderPeople and never share this layout.
        const chosen = found.find(item => String(item.uid) === selectedUid) || found[0];
        if (!selectedUid) selectedUid = String(chosen.uid);
        const layout = element(doc, 'div', 'slb-library-index-layout');
        layout.classList.toggle('is-index-open', !worldTocCollapsed); // Toggle TOC without replacing the detail.
        const index = element(doc, 'nav', 'slb-library-index');
        index.id = 'slb-library-world-contents';
        index.append(inlineTocHeading('world', worldTocCollapsed));
        index.setAttribute('aria-label', '세계관 목차');
        // Global reader search already searches titles, keys, and original content.
        // One TOC only; render five bounded entries, page via buttons (no horizontal scroll).
        const info = pageData(found.length, worldTocPage);
        const pageCount = info.pageCount;
        worldTocPage = info.page;
        for (const [position, entry] of found.slice(info.start, info.start + info.size).entries()) {
            const uid = String(entry.uid);
            const item = button(doc, 'slb-library-index-item', '', 'entry', uid);
            if (String(chosen.uid) === uid) item.classList.add('is-selected');
            const originalPosition = originalEntryNumber(entry);
            item.append(element(doc, 'span', 'slb-library-index-initial',
                String(originalPosition).padStart(2, '0')));
            item.append(element(doc, 'span', '', titleOf(entry)));
            index.append(item);
        }
        const pages = element(doc, 'div', 'slb-library-world-pages');
        const prev = button(doc, '', '‹', 'world-prev');
        prev.setAttribute('aria-label', '이전 목차');
        prev.setAttribute('title', '이전 목차');
        prev.disabled = worldTocPage <= 0;
        const next = button(doc, '', '›', 'world-next');
        next.setAttribute('aria-label', '다음 목차');
        next.setAttribute('title', '다음 목차');
        next.disabled = worldTocPage >= pageCount - 1;
        pages.setAttribute('aria-label', '세계관 목차 페이지 · ' + found.length + '개 항목');
        pages.append(pageNavigation(prev, (worldTocPage + 1) + ' / ' + pageCount, next),
            pageOptions());
        index.append(pages);
        const paper = element(doc, 'div', 'slb-library-index-paper');
        paper.append(renderDetail(chosen, type));
        layout.append(index, paper);
        const frame = element(doc, 'div', 'slb-library-contents-frame');
        frame.append(layout);
        body.append(frame);
    }
    function renderPeople(body, found) {
        const selected = found.find(entry => String(entry.uid) === selectedUid);
        // Keep the real paged directory available alongside the selected
        // profile, instead of replacing it with a back-only detail screen.
        const directory = element(doc, 'div', 'slb-library-person-directory slb-library-paged-contents');
        directory.id = 'slb-library-people-toc';
        directory.append(inlineTocHeading('people', peopleTocCollapsed, Boolean(selected)));
        const contents = element(doc, 'div', 'slb-library-paged-list');
        contents.id = 'slb-library-people-contents';
        contents.hidden = Boolean(selected && peopleTocCollapsed);
        const names = element(doc, 'div', 'slb-library-people-list');
        const info = pageData(found.length, peoplePage);
        const pages = info.pageCount;
        peoplePage = info.page;
        for (const item of found.slice(info.start, info.start + info.size)) {
            const row = button(doc, 'slb-library-person-row' +
                (selected && String(selected.uid) === String(item.uid) ? ' is-selected' : ''),
                '', 'entry', String(item.uid));
            if (selected) row.setAttribute('aria-current', String(selected.uid) === String(item.uid) ? 'true' : 'false');
            row.append(element(doc, 'span', 'slb-library-person-initial', titleOf(item).slice(0, 1) || '•'),
                element(doc, 'strong', '', titleOf(item)),
                element(doc, 'span', 'slb-library-person-chevron', '›'));
            names.append(row);
        }
        if (!found.length) names.append(element(doc, 'p', 'slb-library-empty', '검색 결과가 없습니다.'));
        contents.append(names);
        const pager = element(doc, 'nav', 'slb-library-people-pages');
        pager.setAttribute('aria-label', '인물록 페이지 · ' + found.length + '개 항목');
        const prev = button(doc, '', '‹', 'people-prev');
        prev.setAttribute('aria-label', '이전 인물');
        prev.setAttribute('title', '이전 인물');
        prev.disabled = peoplePage === 0;
        const next = button(doc, '', '›', 'people-next');
        next.setAttribute('aria-label', '다음 인물');
        next.setAttribute('title', '다음 인물');
        next.disabled = peoplePage >= pages - 1;
        pager.append(pageNavigation(prev, (peoplePage + 1) + ' / ' + pages, next),
            pageOptions());
        contents.append(pager);
        directory.append(contents);
        if (selected) {
            const layout = element(doc, 'div', 'slb-library-people-detail-layout');
            layout.classList.toggle('is-people-toc-open', !peopleTocCollapsed);
            const detailPage = element(doc, 'div', 'slb-library-person-profile');
            detailPage.append(button(doc, 'slb-library-person-back', '‹ 인물록', 'people-back'));
            detailPage.append(renderDetail(selected, 'people'));
            layout.append(directory, detailPage);
            body.append(layout);
        } else body.append(directory);
    }
    function contentText(entry, format) {
        const info = translationFor(currentBook, entry) || {};
        const source = String(entry.content || '');
        const translated = String(info.text || '');
        const section = element(doc, 'section', 'slb-library-reading');
        section.dataset.readView = format;
        const pair = info.pair || { sourceLanguage: 'English', translationLanguage: 'Korean' };
        const lang = format === 'source' ? pair.sourceLanguage : pair.translationLanguage;
        section.append(element(doc, 'small', 'slb-library-language-mark', format === 'source'
            ? '원문 · ' + lang : translated ? '번역 · ' + lang : '번역 없음'));
        const prose = element(doc, 'div', 'slb-library-prose');
        const content = format === 'source'
            ? (source || '원문이 비어 있습니다.')
            : (translated || '저장된 번역본이 없습니다. 수정 버튼으로 번역문을 작성할 수 있습니다.');
        if (typeof renderReadMarkdown === 'function') {
            try {
                renderReadMarkdown(prose, content);
                prose.classList.add('is-markdown');
            } catch {
                // The optional presentation renderer cannot block original lore reading.
                prose.textContent = content;
            }
        } else prose.textContent = content;
        section.append(prose);
        if (format === 'translated' && info.stale) section.append(element(doc, 'small', 'slb-library-stale', '원문 변경 이전에 저장된 번역입니다. 필요한 경우 다시 번역하세요.'));
        return section;
    }
    function renderDetail(entry, type) {
        const uid = String(entry.uid);
        const article = element(doc, 'article', 'slb-library-detail slb-library-detail-' + type);
        article.dataset.uid = uid;
        if (type !== 'memory') {
            const header = element(doc, 'header', 'slb-library-detail-head');
            header.append(element(doc, 'h3', '', titleOf(entry)));
            if (type === 'people') header.prepend(element(doc, 'span', 'slb-library-avatar', (titleOf(entry).trim()[0] || '?').toUpperCase()));
            article.append(header);
        }
        const record = translationFor(currentBook, entry) || {};
        const hasTranslation = Boolean(String(record.text || ''));
        const view = entryReadViews.get(uid) || (hasTranslation ? 'translated' : 'source');
        const imagePath = safeLibraryImagePath(getEntryImage(currentBook, entry));
        const selectedImage = pendingImages.get(uid);
        const tools = element(doc, 'div', 'slb-library-reader-tools');
        const toggle = button(doc, 'slb-library-view-toggle',
            view === 'translated' ? '원문 보기' : '번역 보기', 'toggle-view', uid);
        tools.append(toggle);
        const more = button(doc, 'slb-library-more-tools', '', 'more-tools', uid);
        more.append(faIcon(doc, 'ellipsis'));
        more.setAttribute('aria-label', '기록 추가 기능');
        more.setAttribute('title', '수정 · 번역 · 이미지 등 추가 기능');
        more.setAttribute('aria-haspopup', 'true');
        more.setAttribute('aria-expanded', String(activeToolsUid === uid));
        const menu = element(doc, 'div', 'slb-library-tools-popover');
        menu.hidden = activeToolsUid !== uid;
        menu.setAttribute('role', 'group');
        menu.setAttribute('aria-label', '기록 추가 기능');
        menu.append(button(doc, '', '수정', 'edit', uid));
        menu.append(button(doc, '', 'AI 번역', 'translate', uid));
        menu.append(button(doc, '', '로어북 바로가기', 'advanced', uid));
        const imageControls = element(doc, 'div', 'slb-library-entry-image-controls');
        const fileInput = element(doc, 'input', 'slb-library-image-file');
        fileInput.type = 'file';
        fileInput.accept = 'image/png,image/jpeg,image/webp,image/gif';
        fileInput.dataset.uid = uid;
        fileInput.hidden = true;
        fileInput.setAttribute('aria-label', '로어 이미지 파일 선택');
        imageControls.append(fileInput, button(doc, 'slb-library-image-pick',
            imagePath ? '이미지 교체' : '참고 이미지 추가', 'image-pick', uid));
        if (selectedImage) {
            imageControls.append(element(doc, 'small', 'slb-library-image-file-name', selectedImage.name));
            imageControls.append(button(doc, 'slb-library-image-save', '이미지 저장', 'image-save', uid));
        }
        if (imagePath) imageControls.append(button(doc, 'slb-library-image-remove', '이미지 연결 해제', 'image-remove', uid));
        menu.append(imageControls);
        tools.append(more, menu);
        article.append(tools);
        // The saved picture is user metadata; render only when the detail is open.
        if (imagePath) {
            const frame = element(doc, 'figure', 'slb-library-entry-image');
            const img = element(doc, 'img', 'slb-library-entry-image-element');
            img.src = imagePath;
            img.alt = '로어 참고 이미지';
            img.setAttribute('loading', 'lazy');
            img.setAttribute('decoding', 'async');
            frame.append(img);
            article.append(frame);
        }
        const pages = element(doc, 'div', 'slb-library-pages');
        pages.append(contentText(entry, view));
        article.append(pages);
        // The v72 design's keyword chips reuse real ST key strings only.
        // Bound the visible chip count/length for huge lorebooks and regex keys.
        const keys = Array.isArray(entry.key) ? entry.key : [];
        const visibleKeys = [...new Set(keys.filter(key => typeof key === 'string')
            .map(key => key.trim()).filter(Boolean))].slice(0, 6);
        if (visibleKeys.length) {
            const chips = element(doc, 'div', 'slb-library-entry-keywords');
            chips.setAttribute('aria-label', '이 로어의 키워드');
            for (const key of visibleKeys) {
                const chip = element(doc, 'span', 'slb-library-keyword-chip', key.slice(0, 32));
                if (key.length > 32) chip.title = key;
                chips.append(chip);
            }
            article.append(chips);
        }
        if (edit && edit.uid === uid) {
            const editor = element(doc, 'section', 'slb-library-edit-panel');
            editor.append(element(doc, 'label', '', edit.kind === 'source' ? '원문 수정 · 저장 전에는 실제 로어북에 반영되지 않습니다.' : '번역 수정 · 실리태번 원문은 변경되지 않습니다.'));
            const input = element(doc, 'textarea', 'slb-library-editor-text');
            input.rows = 10;
            input.value = edit.textarea?.value ?? edit.initial;
            input.setAttribute('aria-label', edit.kind === 'source' ? '원문 수정' : '번역 수정');
            editor.append(input);
            const actions = element(doc, 'div', 'slb-library-edit-actions');
            actions.append(button(doc, 'slb-library-save', '저장', 'save-edit', uid), button(doc, '', '취소', 'cancel-edit', uid));
            editor.append(actions);
            article.append(editor);
            edit.textarea = input;
        }
        return article;
    }
    function replaceEntryDetail(uid) {
        const current = [...(overlay?.querySelectorAll('.slb-library-detail') || [])]
            .find(node => node.dataset.uid === String(uid));
        const entry = entries.find(item => String(item.uid) === String(uid));
        if (current && entry) {
            const focusAction = current.contains(doc.activeElement) ? doc.activeElement.dataset.action : null;
            const replacement = renderDetail(entry, getType(currentBook) || 'general');
            current.replaceWith(replacement);
            if (focusAction) [...replacement.querySelectorAll('[data-action]')]
                .find(node => node.dataset.action === focusAction)?.focus({ preventScroll: true });
        }
    }
    function pickEntryImage(uid) {
        const current = [...(overlay?.querySelectorAll('.slb-library-detail') || [])]
            .find(node => node.dataset.uid === String(uid));
        current?.querySelector('.slb-library-image-file')?.click();
    }
    async function saveEntryImage(uid) {
        if (saving || !currentBook || !isOpen()) return;
        const file = pendingImages.get(String(uid));
        const entry = entries.find(item => String(item.uid) === String(uid));
        if (!file || !entry) return;
        saving = true;
        notifyStatus('이미지를 저장하는 중입니다.');
        try {
            await uploadEntryImage(currentBook, entry, file);
            pendingImages.delete(String(uid));
            closeReaderTools();
            replaceEntryDetail(uid);
            notifyStatus('이미지가 연결되었습니다.', 'success');
        } catch (error) {
            notifyStatus('이미지 저장 실패: ' + (error?.message || error), 'error');
        } finally {
            saving = false;
        }
    }
    async function clearEntryImage(uid) {
        if (saving || !currentBook || !isOpen()) return;
        const entry = entries.find(item => String(item.uid) === String(uid));
        if (!entry || !safeLibraryImagePath(getEntryImage(currentBook, entry))) return;
        if (!doc.defaultView.confirm('이 로어에서 이미지 연결을 해제하시겠습니까? 서버의 원본 이미지 파일은 삭제하지 않습니다.')) return;
        saving = true;
        try {
            await removeEntryImage(currentBook, entry);
            pendingImages.delete(String(uid));
            closeReaderTools();
            replaceEntryDetail(uid);
            notifyStatus('이미지 연결이 해제되었습니다.', 'success');
        } catch (error) {
            notifyStatus('이미지 연결 해제 실패: ' + (error?.message || error), 'error');
        } finally {
            saving = false;
        }
    }
    function showEntry(uid) {
        if (!discardOrStay({ allowTags: true })) return;
        resetEdit();
        closeReaderTools();
        selectedUid = String(uid);
        if (getType(currentBook) === 'people') {
            const position = filtered().findIndex(entry => String(entry.uid) === String(uid));
            if (position >= 0) peoplePage = Math.floor(position / libraryPageSize());
        }
        renderBook();
        const selected = overlay?.querySelector('.slb-library-detail[data-uid="' + String(uid).replace(/[^a-zA-Z0-9_-]/g, '') + '"]');
        if (selected) selected.scrollIntoView?.({ block: 'nearest', behavior: 'auto' });
    }
    function showEdit(uid) {
        if (!discardOrStay({ allowTags: true })) return;
        const entry = entries.find(item => String(item.uid) === String(uid));
        if (!entry) return;
        const previousEditUid = edit?.uid;
        const current = translationFor(currentBook, entry) || {};
        // If there is no saved translation the reader displays the source.
        // Therefore the single Edit action must never write a phantom
        // translated record while showing source text.
        const kind = (entryReadViews.get(String(uid)) || (current.text ? 'translated' : 'source'))
            === 'translated' ? 'translated' : 'source';
        edit = {
            uid: String(uid),
            kind,
            initial: kind === 'source' ? String(entry.content || '') : String(current.text || ''),
            textarea: null,
        };
        if (getType(currentBook) !== 'memory') selectedUid = String(uid);
        if (previousEditUid && previousEditUid !== String(uid)) replaceEntryDetail(previousEditUid);
        replaceEntryDetail(uid);
        edit.textarea?.focus();
    }
    async function saveEdit() {
        if (!edit || saving || !isOpen()) return;
        const active = edit;
        const next = active.textarea?.value;
        const entry = entries.find(item => String(item.uid) === active.uid);
        if (!entry || typeof next !== 'string') return;
        if (next === active.initial) {
            resetEdit();
            replaceEntryDetail(active.uid);
            return;
        }
        saving = true;
        active.textarea.disabled = true;
        notifyStatus('저장 중…');
        try {
            if (active.kind === 'source') {
                const fresh = await saveContent(currentBook, active.uid, active.initial, next);
                if (fresh?.entries) {
                    currentData = fresh;
                    entries = orderedLoreEntries(fresh);
                } else entry.content = next;
                buildSearchIndex();
            } else {
                await saveTranslation(currentBook, entry, next, active.initial);
                invalidateTranslationSearch(currentBook);
            }
            resetEdit();
            if (active.kind === 'source' || query.trim()) renderBook();
            else replaceEntryDetail(active.uid);
            notifyStatus('저장 완료 · 원본 로어북/번역 파일에 반영되었습니다.', 'success');
        } catch (error) {
            active.textarea.disabled = false;
            notifyStatus('저장 실패: ' + (error.message || error), 'error');
        } finally {
            saving = false;
        }
    }
    async function runTranslate(uid) {
        if (saving || !discardOrStay({ allowTags: true })) return;
        const entry = entries.find(item => String(item.uid) === String(uid));
        if (!entry?.content?.trim()) {
            notifyStatus('번역할 원문이 없습니다.', 'warning');
            return;
        }
        if (!doc.defaultView.confirm('이 항목의 원문을 AI로 번역하시겠습니까? 연결 방식에 따라 API 이용 요금이 발생할 수 있습니다.')) return;
        const previousEditUid = edit?.uid;
        resetEdit();
        if (previousEditUid) replaceEntryDetail(previousEditUid);
        saving = true;
        notifyStatus('AI 번역 중…');
        try {
            const beforeTitle = titleOf(entry);
            await translateOne(currentBook, entry);
            entryReadViews.set(String(uid), 'translated');
            invalidateTranslationSearch(currentBook);
            if (query.trim() || beforeTitle !== titleOf(entry)) renderBook();
            else replaceEntryDetail(uid);
            notifyStatus('AI 번역이 저장되었습니다.', 'success');
        } catch (error) {
            notifyStatus('AI 번역 실패: ' + (error.message || error), 'error');
        } finally {
            saving = false;
        }
    }
    function toggleView(uid) {
        if (!discardOrStay({ allowTags: true })) return;
        const entry = entries.find(item => String(item.uid) === String(uid));
        if (!entry) return;
        const previousEditUid = edit?.uid;
        resetEdit();
        const current = entryReadViews.get(String(uid))
            || (String(translationFor(currentBook, entry)?.text || '') ? 'translated' : 'source');
        entryReadViews.set(String(uid), current === 'source' ? 'translated' : 'source');
        if (previousEditUid && previousEditUid !== String(uid)) replaceEntryDetail(previousEditUid);
        replaceEntryDetail(uid);
    }
    async function runGlobalSearch() {
        if (!isOpen() || currentBook) return;
        const body = overlay.querySelector('.slb-library-body');
        const input = body.querySelector('#slb-library-shelf-search');
        const needle = input?.value.toLocaleLowerCase().trim();
        if (!input) return;
        shelfQuery = input.value;
        ++externalOpenSerial;
        if (!needle) { returnToShelf(); return; }
        clearGlobalSearch();
        const serial = globalSearchSerial;
        globalSearchOpen = true;
        const panel = element(doc, 'section', 'slb-library-global-panel');
        const heading = element(doc, 'div', 'slb-library-global-heading');
        heading.append(element(doc, 'strong', '', '검색 결과'),
            button(doc, 'slb-library-search-action', '서가로 돌아가기', 'return-to-shelf'));
        const results = element(doc, 'div', 'slb-library-global-results');
        results.setAttribute('aria-live', 'polite');
        panel.append(heading, results);
        body.append(panel);
        body.classList.add('is-global-search');
        body.scrollTop = 0;
        const alive = () => isOpen() && globalSearchOpen && serial === globalSearchSerial && results.isConnected;
        results.replaceChildren(element(doc, 'p', '', '검색 중…'));
        const bookMatches = bookNames.filter(book => book.toLocaleLowerCase().includes(needle));
        const matches = [];
        let failed = 0;
        let translationFailed = 0;
        const limit = 100;
        // Read on submit only. ST caches original books, and ensureBook caches
        // the translation files; no separate persistent corpus or polling.
        for (const book of bookNames) {
            if (!alive()) return;
            try {
                const [source, translated] = await Promise.allSettled([loadBook(book), loadTranslations(book)]);
                if (!alive()) return;
                if (source.status !== 'fulfilled' || !source.value?.entries) { failed++; continue; }
                if (translated.status !== 'fulfilled' || translated.value === false) translationFailed++;
                for (const entry of Object.values(source.value.entries)) {
                    if (!entry || !/^\d+$/.test(String(entry.uid))) continue;
                    const translation = searchTranslationFor?.(book, entry);
                    if (searchableFields(entry, translation).includes(needle)) {
                        const title = translation?.title || translation?.fields?.comment?.text || entry.comment || '항목 #' + entry.uid;
                        matches.push({ book, uid: String(entry.uid), title });
                    }
                    if (matches.length >= limit) break;
                }
            } catch { failed++; }
            if (matches.length >= limit) break;
        }
        if (!alive()) return;
        results.replaceChildren(element(doc, 'p', '', '책 ' + bookMatches.length + '권 · ' +
            (matches.length >= limit ? '처음 ' : '') + '항목 ' + matches.length + '개' +
            (failed ? ' · 읽지 못한 책 ' + failed + '권' : '') +
            (translationFailed ? ' · 번역 기록 읽기 실패 ' + translationFailed + '권' : '')));
        for (const book of bookMatches.slice(0, limit)) {
            const row = button(doc, 'slb-library-global-result', '', 'select-book');
            row.dataset.book = book;
            row.append(element(doc, 'strong', '', book), element(doc, 'small', '', '책 이름'));
            results.append(row);
        }
        for (const match of matches) {
            const row = button(doc, 'slb-library-global-result', '', 'global-result', match.uid);
            row.dataset.book = match.book;
            row.append(element(doc, 'strong', '', match.title), element(doc, 'small', '', match.book));
            results.append(row);
        }
    }
    async function onClick(event) {
        const target = event.target.closest?.('[data-action]');
        if (!target || !overlay?.contains(target)) return;
        const action = target.dataset.action, uid = target.dataset.uid;
        if (coverEditor && !coverEditor.backdrop.contains(target)) return;
        if (['edit', 'translate', 'advanced'].includes(action)) closeReaderTools();
        if (action === 'page-jump') openPageJump(target);
        else if (action === 'minimize') setMinimized(true);
        else if (action === 'restore') {
            // A drag of the collapsed launcher is not a request to reopen.
            if (ignoreMinimizedClick && event.detail !== 0) ignoreMinimizedClick = false;
            else setMinimized(false);
        }
        else if (action === 'settings') setSettingsOpen(!settingsOpen);
        else if (action === 'return-to-shelf') returnToShelf();
        else if (action === 'global-result') {
            ++globalSearchSerial;
            void openEntry(target.dataset.book, uid).then(opened => {
                if (!opened && globalSearchOpen) notifyStatus('검색 결과의 로어를 열지 못했습니다.', 'warning');
            });
        } else if (action === 'resume-reading') {
            setSettingsOpen(false);
            if (recent) void openEntry(recent.book, recent.uid).then(opened => {
                if (!opened && isOpen()) notifyStatus('마지막으로 읽은 항목을 찾지 못했습니다.', 'warning');
            });
        } else if (action === 'favorite-book') {
            if (saving || !currentBook) return;
            const book = currentBook;
            const next = new Set(favorites);
            if (next.has(book)) next.delete(book); else next.add(book);
            saving = true;
            try {
                await setFavorites([...next]);
                favorites = next;
                target.textContent = favorites.has(book) ? '★ 즐겨찾기 해제' : '☆ 즐겨찾기 추가';
                target.setAttribute('aria-pressed', String(favorites.has(book)));
                const summary = target.closest('.slb-library-book-meta')?.querySelector('summary');
                const mark = summary?.querySelector('.slb-library-favorite-mark');
                if (favorites.has(book) && !mark) summary?.append(element(doc, 'span', 'slb-library-favorite-mark', '★'));
                else if (!favorites.has(book)) mark?.remove();
            } catch (error) { notifyStatus('즐겨찾기 저장 실패: ' + (error?.message || error), 'error'); }
            finally { saving = false; }
        }
        else if (['memory-toc-toggle', 'world-toc-toggle', 'people-toc-toggle'].includes(action)) {
            const isMemory = action === 'memory-toc-toggle';
            const isWorld = action === 'world-toc-toggle';
            if (isMemory) memoryTocCollapsed = !memoryTocCollapsed;
            else if (isWorld) worldTocCollapsed = !worldTocCollapsed;
            else peopleTocCollapsed = !peopleTocCollapsed;
            const collapsed = isMemory ? memoryTocCollapsed
                : isWorld ? worldTocCollapsed : peopleTocCollapsed;
            if (isMemory) {
                const contents = overlay.querySelector('#slb-library-memory-contents');
                if (contents) contents.hidden = collapsed;
            } else if (isWorld) {
                overlay.querySelector('.slb-library-index-layout')
                    ?.classList.toggle('is-index-open', !collapsed);
            } else {
                // Only hide the directory contents, not its inline header.
                // The actual profile/editor remains mounted without rerender.
                const contents = overlay.querySelector('#slb-library-people-contents');
                if (contents) contents.hidden = collapsed;
                overlay.querySelector('.slb-library-people-detail-layout')
                    ?.classList.toggle('is-people-toc-open', !collapsed);
            }
            target.querySelector('.slb-library-toc-chevron').textContent = collapsed ? '▾' : '▴';
            target.setAttribute('aria-label', collapsed ? '목차 펼치기' : '목차 접기');
            target.setAttribute('aria-expanded', String(!collapsed));
        }
        else if (action === 'shelf-search-toggle') {
            if (shelfSearchOpen) { void runGlobalSearch(); return; }
            shelfSearchOpen = true;
            const bar = overlay.querySelector('.slb-library-shelf-toolbar');
            bar?.classList.add('is-search-open');
            target.setAttribute('aria-expanded', 'true');
            bar?.querySelector('#slb-library-shelf-search')?.focus();
        }
        else if (action === 'reader-search-toggle') {
            if (readerSearchOpen) { submitReaderSearch(); return; }
            readerSearchOpen = true;
            const nav = overlay.querySelector('.slb-library-navigation');
            nav.classList.add('is-search-open');
            target.setAttribute('aria-expanded', 'true');
            nav.querySelector('#slb-library-search')?.focus();
        }
        else if (action === 'more-tools') toggleReaderTools(uid);
        else if (action === 'book-tag-suggest') toggleBookTagSuggestion(target.dataset.tag);
        else if (action === 'cover-config') openCoverEditor(target.dataset.book);
        else if (action === 'cover-cancel') dismissCoverEditor();
        else if (action === 'cover-save') void commitCover(false);
        else if (action === 'cover-reset') void commitCover(true);
        else if (action === 'close') close();
        else if (action === 'books') {
            if (!discardOrStay()) return;
            loadVersion += 1;
            ++externalOpenSerial;
            bookList();
        } else if (action === 'shelf-tag') {
            shelfTag = target.dataset.filter || 'all';
            shelfSelectedTags.clear();
            shelfRows = [1, 2, 3].includes(Number(getShelfRows())) ? Number(getShelfRows()) : 3;
            bookList();
        } else if (action === 'shelf-tag-chip') {
            shelfSelectedTags.delete(target.dataset.tag);
            if (!shelfSelectedTags.size) shelfTag = 'all';
            shelfRows = [1, 2, 3].includes(Number(getShelfRows())) ? Number(getShelfRows()) : 3;
            bookList();
        } else if (action === 'shelf-type') {
            shelfType = target.dataset.filter || 'all';
            shelfRows = [1, 2, 3].includes(Number(getShelfRows())) ? Number(getShelfRows()) : 3;
            bookList();
        } else if (action === 'shelf-more') {
            shelfRows += 2;
            bookList();
        } else if (action === 'select-book') {
            // Mobile long-press can synthesize a regular click afterward.
            // Keep the explicit cover menu open instead of opening a book.
            if (coverContextBook === target.dataset.book && target.classList.contains('slb-library-cover-open')) return;
            ++externalOpenSerial;
            void selectBook(target.dataset.book);
        } else if (action === 'book-tag-save') {
            void saveBookTags();
        } else if (action === 'image-pick') {
            pickEntryImage(uid);
        } else if (action === 'image-save') {
            void saveEntryImage(uid);
        } else if (action === 'image-remove') {
            void clearEntryImage(uid);
        } else if (action === 'catalog-back') {
            if (!discardOrStay({ allowTags: true })) return;
            resetEdit();
            selectedUid = null;
            renderBook();
        } else if (/^(catalog-list|memory-list)-(first|prev|next|last)$/.test(action)) {
            if (!discardOrStay({ allowTags: true })) return;
            const direction = action.endsWith('-first') ? 'first'
                : action.endsWith('-last') ? 'last' : action.endsWith('-next') ? 'next' : 'prev';
            const lastPage = pageData(filtered().length, 0).pageCount - 1;
            const jumpTo = current => direction === 'first' ? 0
                : direction === 'last' ? lastPage : current + (direction === 'next' ? 1 : -1);
            if (action.startsWith('catalog-list-')) {
                catalogPage = Math.max(0, Math.min(jumpTo(catalogPage), lastPage));
                // A clean reader always previews a row from the visible page.
                if (['mac', 'blackberry'].includes(libraryTheme())) selectedUid = null;
            } else {
                diaryTocPage = Math.max(0, Math.min(jumpTo(diaryTocPage), lastPage));
            }
            renderBook();
        } else if (action === 'memory-return') {
            changeMemoryView(preferredMemoryView());
        } else if (action === 'memory-open-page') {
            changeMemoryView('page', Number(target.dataset.index));
        } else if (action === 'memory-more' || action === 'memory-more-prev') {
            extendMemoryStream(action === 'memory-more-prev');
        } else if (action === 'diary-entry') {
            if (!discardOrStay({ allowTags: true })) return;
            const nextIndex = Number(target.dataset.index);
            if (!Number.isInteger(nextIndex) || nextIndex < 0 || nextIndex >= filtered().length) return;
            diaryIndex = nextIndex;
            if (nextIndex < memoryStreamStart || nextIndex >= memoryStreamEnd) resetMemoryStream();
            diaryTocPage = Math.floor(nextIndex / libraryPageSize());
            resetEdit();
            renderBook();
            if (memoryView !== 'page') scrollMemoryAnchor();
        } else if (action === 'catalog-prev') shiftCatalog(-1);
        else if (action === 'catalog-next') shiftCatalog(1);
        else if (action === 'catalog-first' || action === 'catalog-last') {
            if (!discardOrStay({ allowTags: true })) return;
            const found = filtered();
            if (!found.length) return;
            const targetIndex = action === 'catalog-first' ? 0 : found.length - 1;
            resetEdit();
            selectedUid = String(found[targetIndex].uid);
            catalogPage = Math.floor(targetIndex / libraryPageSize());
            renderBook();
        } else if (/^diary-(first|prev|next|last)$/.test(action)) {
            if (!discardOrStay({ allowTags: true })) return;
            const found = filtered();
            if (!found.length) return;
            const step = diaryStep();
            const lastSpread = Math.floor((found.length - 1) / step) * step;
            diaryIndex = action === 'diary-first' ? 0
                : action === 'diary-last' ? lastSpread
                : Math.max(0, Math.min(diaryIndex + (action === 'diary-next' ? step : -step), lastSpread));
            diaryTocPage = Math.floor(diaryIndex / libraryPageSize());
            resetEdit();
            renderBook();
        } else if (/^world-(first|prev|next|last)$/.test(action)) {
            if (!discardOrStay({ allowTags: true })) return;
            const lastPage = pageData(filtered().length, 0).pageCount - 1;
            worldTocPage = action === 'world-first' ? 0
                : action === 'world-last' ? lastPage
                : Math.max(0, Math.min(worldTocPage + (action === 'world-next' ? 1 : -1), lastPage));
            renderBook();
        } else if (/^people-(first|prev|next|last)$/.test(action)) {
            if (!discardOrStay({ allowTags: true })) return;
            const lastPage = pageData(filtered().length, 0).pageCount - 1;
            peoplePage = action === 'people-first' ? 0
                : action === 'people-last' ? lastPage
                : Math.max(0, Math.min(peoplePage + (action === 'people-next' ? 1 : -1), lastPage));
            renderBook();
        } else if (action === 'people-back') {
            if (!discardOrStay({ allowTags: true })) return;
            selectedUid = null;
            resetEdit();
            renderBook();
        } else if (action === 'entry') showEntry(uid);
        else if (action === 'toggle-view') toggleView(uid);
        else if (action === 'edit') showEdit(uid);
        else if (action === 'cancel-edit') {
            if (!discardOrStay({ allowTags: true })) return;
            const previousUid = edit?.uid;
            resetEdit();
            if (previousUid) replaceEntryDetail(previousUid);
        } else if (action === 'save-edit') void saveEdit();
        else if (action === 'translate') void runTranslate(uid);
        else if (action === 'advanced') {
            if (!discardOrStay()) return;
            const book = currentBook;
            if (close()) {
                recent = { book, uid: String(uid) };
                setRecent(recent);
                void openAdvanced(book, uid);
            }
        }
    }
    function onChange(event) {
        if (event.target?.id === 'slb-library-shelf-tag-select') {
            const chosen = event.target.value;
            if (chosen.startsWith('tag:')) {
                const tag = chosen.slice(4);
                if (shelfSelectedTags.has(tag)) shelfSelectedTags.delete(tag);
                else shelfSelectedTags.add(tag);
                shelfTag = shelfSelectedTags.size ? 'tags' : 'all';
                shelfRows = [1, 2, 3].includes(Number(getShelfRows())) ? Number(getShelfRows()) : 3;
                bookList();
            }
            return;
        }
        if (event.target?.id === 'slb-library-memory-view') {
            void updateMemoryViewPreference(event.target.value);
            return;
        }
        if (event.target?.id === 'slb-library-shelf-rows') {
            void updateShelfRows(event.target.value);
            return;
        }
        if (event.target?.id === 'slb-library-linked-only') {
            void updateLibraryLinkedOnly(event.target.checked);
            return;
        }
        if (event.target?.id === 'slb-library-cover-file') {
            previewCoverFile(event.target.files?.[0]);
            return;
        }
        if (event.target?.id === 'slb-library-theme-mode') {
            void updateAppearance(event.target.value);
            return;
        }
        if (event.target?.classList?.contains('slb-library-page-size-select')) {
            void updateLibraryPageSize(event.target.value);
            return;
        }
        if (event.target?.classList?.contains('slb-library-order-select')) {
            void updateLibraryListOrder(event.target.value);
            return;
        }
        if (event.target?.classList?.contains('slb-library-image-file')) {
            const uid = event.target.dataset.uid;
            const file = event.target.files?.[0];
            if (!file) return;
            if (!['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(file.type)
                || file.size > 5 * 1024 * 1024 || file.size < 1) {
                notifyStatus('PNG, JPG, WEBP 또는 GIF 형식의 5MB 이하 이미지를 선택하세요.', 'warning');
                return;
            }
            pendingImages.set(String(uid), file);
            replaceEntryDetail(uid);
            return;
        }
        if (event.target?.id !== 'slb-library-book-type') return;
        if (!discardOrStay({ allowTags: true })) {
            event.target.value = getType(currentBook);
            return;
        }
        resetEdit();
        setType(currentBook, event.target.value);
        selectedUid = null;
        worldTocPage = 0;
        peoplePage = 0;
        catalogPage = 0;
        diaryTocPage = 0;
        renderBook();
    }
    function onInput(event) {
        if (event.target?.id === 'slb-library-shelf-search') {
            // Draft text only; no fetch, filter, sort or render while typing.
            shelfQuery = event.target.value;
            return;
        }
        if (event.target?.id === 'slb-library-book-tag-input') {
            tagDraft = event.target.value;
            const save = overlay?.querySelector('[data-action="book-tag-save"]');
            if (save) save.disabled = tagSaving || tagDraft === tagInitial;
            syncTagSuggestionStates();
        }
    }
    function submitReaderSearch() {
        const input = overlay?.querySelector('#slb-library-search');
        if (!input || !currentData || !currentBook || !discardOrStay({ allowTags: true })) return;
        const next = input.value;
        if (next === query && (!next.trim() || !searchIndexDirty)) return;
        resetEdit();
        query = next;
        selectedUid = null;
        catalogPage = 0;
        diaryIndex = 0;
        resetMemoryStream();
        diaryTocPage = 0;
        worldTocPage = 0;
        peoplePage = 0;
        renderBook();
    }
    // Stable, opt-in entry opener for other extensions. Uses the saved WorldInfo
    // book name + UID, never a displayed/translated title or positional index.
    // A missing entry must not leave an empty modal behind.
    async function openEntry(book, uid) {
        const serial = ++externalOpenSerial;
        const name = typeof book === 'string' ? book : '';
        const entryUid = typeof uid === 'string' || typeof uid === 'number' ? String(uid) : '';
        if (!name || !/^\d+$/.test(entryUid) || !listBooks().includes(name)) return false;
        let data;
        try {
            data = isOpen() && currentBook === name && currentData ? currentData : await loadBook(name);
        } catch {
            return false;
        }
        if (serial !== externalOpenSerial || !data?.entries ||
            !Object.values(data.entries).some(entry => String(entry?.uid) === entryUid &&
                typeof entry?.content === 'string')) return false;

        const wasOpen = isOpen();
        if (!wasOpen) open();
        else if (minimized) setMinimized(false);
        if (!isOpen()) return false;
        if (currentBook !== name || !currentData) {
            suppressRecent = true;
            try { await selectBook(name, data); }
            finally { suppressRecent = false; }
            if (serial !== externalOpenSerial || !isOpen() || currentBook !== name || !currentData) {
                if (!wasOpen && serial === externalOpenSerial) close();
                return false;
            }
        } else if (!discardOrStay({ allowTags: true })) {
            return false;
        }
        if (serial !== externalOpenSerial) return false;
        resetEdit();
        closeReaderTools();
        // A previous search or a 5-item page may hide the requested record.
        // Reset view-only filters and navigate to the exact UID in every reader.
        query = '';
        const search = overlay.querySelector('#slb-library-search');
        if (search) search.value = '';
        readerSearchOpen = false;
        overlay.querySelector('.slb-library-navigation')?.classList.remove('is-search-open');
        overlay.querySelector('[data-action="reader-search-toggle"]')?.setAttribute('aria-expanded', 'false');
        const index = filtered().findIndex(entry => String(entry.uid) === entryUid);
        if (index < 0) {
            if (!wasOpen) close();
            return false;
        }
        const page = Math.floor(index / libraryPageSize());
        selectedUid = entryUid;
        catalogPage = diaryTocPage = worldTocPage = peoplePage = page;
        diaryIndex = index;
        resetMemoryStream();
        if (getType(currentBook) === 'memory' && memoryView === 'timeline') memoryView = 'page';
        renderBook();
        overlay.querySelector('.slb-library-detail[data-uid="' + entryUid + '"]')
            ?.scrollIntoView?.({ block: 'nearest', behavior: 'auto' });
        return true;
    }
    function open() {
        if (isOpen()) {
            if (minimized) setMinimized(false);
            else overlay.querySelector('.slb-library-shell')?.focus();
            return;
        }
        minimized = false;
        minimizedLauncherPosition = null;
        ignoreMinimizedClick = false;
        savedScrollPositions = [];
        originalFocus = doc.activeElement;
        bookNames = listBooks();
        favorites = new Set((getFavorites() || []).filter(book => bookNames.includes(book)));
        recent = getRecent();
        bookToneByName = new Map(bookNames.map((book, index) => [book, index % 12]));
        linkedNames = linkedBooks();
        allBooks = !Boolean(getLinkedOnly());
        shelfTag = 'all';
        shelfSelectedTags.clear();
        shelfRows = [1, 2, 3].includes(Number(getShelfRows())) ? Number(getShelfRows()) : 3;
        shelfType = 'all';
        shelfQuery = '';
        shelfSearchOpen = false;
        readerSearchOpen = false;
        worldTocPage = 0;
        peoplePage = 0;
        catalogPage = 0;
        diaryTocPage = 0;
        movedByUser = false;
        diaryIndex = 0;
        memoryView = preferredMemoryView();
        memoryTocCollapsed = memoryView !== 'page';
        resetMemoryStream();
        worldQuery = '';
        peopleQuery = '';
        settingsOpen = false;
        tagSaving = false;
        tagDraft = '';
        tagInitial = '';
        tagPanelExpanded = false;
        coverEditor = null;
        cancelCoverLongPress();
        coverContextBook = '';
        activeToolsUid = null;
        appearanceSaving = false;
        pendingImages.clear();
        currentBook = '';
        currentData = null;
        entryReadViews = new Map();
        selectedUid = null;
        query = '';
        saving = false;
        edit = null;
        ++loadVersion;
        const shell = createShell();
        doc.body.append(overlay);
        // Convert the flex/grid centered initial rectangle to viewport-fixed
        // pixels *before* any drag, avoiding a positioning-mode jump.
        const vp = visibleLibraryViewport();
        const rect = shell.getBoundingClientRect();
        const preferred = getWindowSize(vp.width <= 760);
        placeFloatingShell(shell,
            preferred?.width ?? Math.min(460, vp.width - 20),
            preferred?.height ?? (rect.height || Math.min(785, vp.height - 32)),
            vp.left + vp.width / 2, vp.top + vp.height / 2);
        bindLibraryViewport();
        syncAppearanceControls();
        setSettingsOpen(false);
        doc.addEventListener('keydown', onKeyDown);
        doc.addEventListener('click', onOutsideSearchClick, true);
        bookList();
        shell.focus();
    }
    function refreshTranslations(book) {
        if (isOpen() && book && currentBook === book && currentData) {
            invalidateTranslationSearch(book);
            if (!edit && !saving) renderBook();
        }
    }
    function onExternalWorldUpdate(book, data) {
        if (!isOpen() || book !== currentBook || !data?.entries) return;
        if (edit || saving) {
            notifyStatus('다른 화면에서 로어북이 수정되었습니다. 현재 편집 내용을 확인하세요.', 'warning');
            return;
        }
        const next = Object.values(data.entries).filter(entry => entry && typeof entry.content === 'string');
        // Compare the fields the reader actually uses, not full lore JSON.
        // ST may mutate the same entry object, so retain immutable field snapshots.
        const changed = [];
        const sameStructure = next.length === readerSnapshot.size && next.every((entry, index) => {
            const uid = String(entry.uid);
            const previous = readerSnapshot.get(uid);
            if (!previous || readerSourceOrder[index] !== uid || previous.metadata !== readerMetadata(entry)) return false;
            if (previous.content !== entry.content) changed.push(entry);
            return true;
        });
        currentData = data;
        if (sameStructure) {
            if (!changed.length) return;
            filteredCache = null;
            for (const entry of changed) {
                const uid = String(entry.uid);
                entries[entryNumbers.get(uid) - 1] = entry;
                readerSnapshot.get(uid).content = entry.content;
                if (!searchIndexDirty) indexEntry(entry);
            }
            if (!query.trim()) {
                for (const entry of changed) {
                    replaceEntryDetail(entry.uid);
                    const card = [...overlay.querySelectorAll('.slb-library-catalog-card')]
                        .find(node => node.dataset.uid === String(entry.uid));
                    if (card) {
                        const excerpt = String(entry.content ?? '').replace(/\s+/g, ' ').trim().slice(0, 110);
                        const previous = card.querySelector('.slb-library-card-excerpt');
                        if (excerpt && previous) previous.textContent = excerpt;
                        else if (excerpt) card.append(element(doc, 'span', 'slb-library-card-excerpt', excerpt));
                        else previous?.remove();
                    }
                }
                return;
            }
        } else {
            entries = orderedLoreEntries(data);
            buildSearchIndex();
        }
        renderBook();
    }
    function updateTheme() {
        if (!isOpen()) return;
        const previous = overlay.dataset.libraryTheme;
        syncAppearanceControls();
        if (previous !== overlay.dataset.libraryTheme && !currentBook) { shelfType = 'all'; bookList(); }
    }
    return { open, openEntry, close, isOpen, refreshTranslations, invalidateTranslationSearch, onExternalWorldUpdate, updateTheme };
}
