
// Independent, on-demand lorebook reader. This module neither watches nor
// reparents SillyTavern's WorldInfo DOM. Original data remains in ST world files.
export const LIBRARY_BOOK_TYPES = Object.freeze({
    general: '일반 · 카드 파일함',
    memory: '기억 · 일기장',
    world: '세계관 · 백과사전',
    people: '인물록 · 연락처 수첩',
});

export function orderedLoreEntries(book) {
    const entries = Object.values(book?.entries || {}).filter(item => item && typeof item.content === 'string');
    // Match saved ST displayIndex (not dates, translated titles or alphabetic
    // guesses). Equal/missing indices retain the source-file order.
    return entries.map((entry, index) => ({ entry, index })).sort((a, b) => {
        const left = Number(a.entry.displayIndex);
        const right = Number(b.entry.displayIndex);
        const leftValid = a.entry.displayIndex !== undefined && Number.isFinite(left);
        const rightValid = b.entry.displayIndex !== undefined && Number.isFinite(right);
        return leftValid && rightValid ? left - right || a.index - b.index : a.index - b.index;
    }).map(item => item.entry);
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

function dateLabel(title) {
    const found = String(title || '').match(/\b(?:19|20)\d{2}[./-](?:0?[1-9]|1[0-2])[./-](?:[0-2]?\d|3[01])\b/);
    return found ? found[0].replace(/[./]/g, '-') : '';
}

export function createStandaloneLibrary({
    document: doc,
    listBooks,
    linkedBooks,
    loadBook,
    saveContent,
    loadTranslations,
    translationFor,
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
    getTheme,
    notify,
}) {
    let overlay = null;
    let originalFocus = null;
    let currentBook = '';
    let currentData = null;
    let entries = [];
    let selectedUid = null;
    let entryReadViews = new Map();
    let entrySingleViews = new Map();
    let query = '';
    let visibleLimit = 24;
    let allBooks = false;
    let loadVersion = 0;
    let edit = null;
    let saving = false;
    let searchIndex = new Map();
    let bookNames = [];
    let linkedNames = null;
    let shelfTag = 'all';
    let shelfLimit = 24;
    let tagSaving = false;
    let tagDraft = '';
    let tagInitial = '';
    let tagPanelExpanded = false;
    // Only the currently opened book can have a pending, explicitly selected
    // image. These File objects are never stored in ST settings.
    const pendingImages = new Map();

    function isOpen() { return Boolean(overlay?.isConnected); }
    function notifyStatus(message, type = 'info') {
        const status = overlay?.querySelector('#slb-library-status');
        if (status) status.textContent = message;
        if (type !== 'info') notify?.(message, type);
    }
    function hasPendingEdit({ allowTags = false } = {}) {
        return Boolean((edit && edit.textarea && edit.textarea.value !== edit.initial)
            || (!allowTags && currentBook && (tagDraft !== tagInitial || pendingImages.size > 0)));
    }
    function discardOrStay({ allowTags = false } = {}) {
        if (saving || tagSaving) {
            notifyStatus('저장 작업이 완료된 후 이동할 수 있습니다.', 'warning');
            return false;
        }
        return !hasPendingEdit({ allowTags }) || doc.defaultView.confirm('저장하지 않은 수정 사항이 있습니다. 변경 내용을 버리고 이동하시겠습니까?');
    }
    function resetEdit() { edit = null; }
    function close() {
        if (!isOpen() || !discardOrStay()) return false;
        loadVersion += 1;
        doc.removeEventListener('keydown', onKeyDown);
        overlay.remove();
        overlay = null;
        resetEdit();
        pendingImages.clear();
        if (originalFocus?.isConnected) originalFocus.focus?.();
        return true;
    }
    function onKeyDown(event) {
        if (event.key === 'Escape' && isOpen()) {
            event.preventDefault();
            close();
        }
    }
    function createShell() {
        overlay = element(doc, 'div', 'slb-library-overlay');
        overlay.id = 'slb-library-overlay';
        const shell = element(doc, 'section', 'slb-library-shell');
        shell.setAttribute('role', 'dialog');
        shell.setAttribute('aria-modal', 'true');
        shell.setAttribute('aria-labelledby', 'slb-library-title');
        shell.tabIndex = -1;
        const top = element(doc, 'header', 'slb-library-top');
        const heading = element(doc, 'div', 'slb-library-heading');
        heading.append(element(doc, 'span', 'slb-library-crest', '✦'),
            element(doc, 'h2', '', 'THE LORE LIBRARY'));
        heading.querySelector('h2').id = 'slb-library-title';
        heading.append(element(doc, 'small', '', '로어북 매니저 · 개인 서재'));
        top.append(heading, button(doc, 'slb-library-close', '×', 'close'));
        const navigation = element(doc, 'div', 'slb-library-navigation');
        const navTop = element(doc, 'div', 'slb-library-nav-top');
        navTop.append(button(doc, '', '‹ 서재 목록', 'books'),
            element(doc, 'span', 'slb-library-current', '연결된 로어북을 선택하세요.'));
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
        filters.append(typeLabel, select);
        const search = element(doc, 'input', '');
        search.id = 'slb-library-search';
        search.type = 'search';
        search.autocomplete = 'off';
        search.placeholder = '제목·키워드·내용 검색';
        search.setAttribute('aria-label', '로어북 내 검색');
        const navTools = element(doc, 'div', 'slb-library-nav-tools');
        navTools.append(filters, search);
        navigation.append(navTop, navTools);
        const body = element(doc, 'main', 'slb-library-body');
        const footer = element(doc, 'footer', 'slb-library-footer');
        const status = element(doc, 'span', '', '기존 로어북 원문과 번역 데이터를 사용합니다.');
        status.id = 'slb-library-status';
        footer.append(status, element(doc, 'small', '', '저장은 직접 확정 · AI 자동 실행 없음'));
        shell.append(top, navigation, body, footer);
        overlay.append(shell);
        overlay.addEventListener('click', event => {
            if (event.target === overlay) close();
        });
        overlay.addEventListener('click', onClick);
        overlay.addEventListener('change', onChange);
        overlay.addEventListener('input', onInput);
        return shell;
    }
    function bookTags(book) {
        return normalizeLibraryTags(getTags(book));
    }
    function spineTone(book) {
        // Stable book-color variation without fetching or hashing any content.
        let hash = 0;
        for (const character of book) hash = (hash * 33 + character.codePointAt(0)) >>> 0;
        return hash % 7;
    }
    function bookList() {
        if (!isOpen()) return;
        resetEdit();
        currentBook = '';
        pendingImages.clear();
        currentData = null;
        selectedUid = null;
        const nav = overlay.querySelector('.slb-library-navigation');
        nav.classList.remove('slb-library-has-book');
        nav.querySelector('.slb-library-current').textContent = '로어북 서가';
        const body = overlay.querySelector('.slb-library-body');
        body.replaceChildren();
        body.dataset.type = 'books';

        // No linked books: keep the whole library visible even if linked-only
        // is checked. SillyTavern provides null when no character is selected.
        const hasLinks = linkedNames instanceof Set && linkedNames.size > 0;
        const linked = uniqueLibraryBooks(bookNames, linkedNames).filter(book =>
            allBooks || !hasLinks || book.linked);
        const tagMap = typeof getTagMap === 'function' ? getTagMap() : null;
        const tagsFor = book => tagMap && typeof tagMap === 'object'
            ? normalizeLibraryTags(Object.hasOwn(tagMap, book) ? tagMap[book] : []) : bookTags(book);
        // The shelf uses book names and locally saved tag labels only.
        // It never loads each book just to render or filter the spines.
        const knownTags = [];
        const seenTags = new Set();
        for (const book of linked) {
            for (const tag of tagsFor(book.name)) {
                if (!seenTags.has(tag)) { seenTags.add(tag); knownTags.push(tag); }
            }
        }
        const head = element(doc, 'div', 'slb-library-books-head');
        const control = element(doc, 'label', 'slb-library-linked-control');
        const checkbox = element(doc, 'input', 'slb-library-linked-checkbox');
        checkbox.type = 'checkbox';
        checkbox.id = 'slb-library-linked-only';
        checkbox.checked = !allBooks;
        control.append(checkbox, element(doc, 'span', '', '현재 캐릭터에 연결된 책만 보기'));
        const hint = element(doc, 'small', 'slb-library-linked-hint',
            '연동된 로어북이 없으면 모든 책이 보여집니다');
        head.append(control, hint);
        const tagbar = element(doc, 'nav', 'slb-library-tagbar');
        tagbar.setAttribute('aria-label', '로어북 태그');
        for (const [key, name] of [
            ['all', '전체'], ['untagged', '미분류'], ...knownTags.map(tag => ['tag:' + tag, tag]),
        ]) {
            const choice = button(doc, 'slb-library-tag-tab' + (shelfTag === key ? ' is-active' : ''), name, 'shelf-tag');
            choice.dataset.filter = key;
            choice.setAttribute('aria-pressed', String(shelfTag === key));
            tagbar.append(choice);
        }
        const candidates = linked.filter(book => {
            const tags = tagsFor(book.name);
            if (shelfTag === 'untagged') return !tags.length;
            if (shelfTag.startsWith('tag:')) return tags.includes(shelfTag.slice(4));
            return true;
        });
        const typeMap = typeof getTypeMap === 'function' ? getTypeMap() : null;
        const shelf = element(doc, 'div', 'slb-library-bookshelf');
        const scroll = element(doc, 'div', 'slb-library-books-scroll');
        scroll.setAttribute('role', 'region');
        scroll.setAttribute('aria-label', '책등 목록');
        scroll.tabIndex = 0;
        const spines = element(doc, 'div', 'slb-library-book-spines');
        const shown = candidates.slice(0, shelfLimit);
        for (const [index, item] of shown.entries()) {
            const savedType = typeMap && typeof typeMap === 'object'
                ? (Object.hasOwn(typeMap, item.name) ? typeMap[item.name] : 'general')
                : getType(item.name);
            const type = Object.hasOwn(LIBRARY_BOOK_TYPES, savedType) ? savedType : 'general';
            const spine = button(doc, 'slb-library-book-spine slb-library-spine-tone-' + spineTone(item.name)
                + ' slb-library-spine-type-' + type, '', 'select-book');
            spine.dataset.book = item.name;
            spine.dataset.bookType = type;
            spine.title = item.name;
            spine.setAttribute('aria-label', item.name + ' · 로어북 열기');
            const adornment = { general: '▱', memory: '❦', world: '✣', people: '◈' };
            spine.append(element(doc, 'span', 'slb-library-spine-ornament', adornment[type]));
            const name = element(doc, 'span', 'slb-library-spine-title', item.name);
            name.lang = /[가-힣]/.test(item.name) ? 'ko' : 'en';
            spine.append(name);
            spine.append(element(doc, 'span', 'slb-library-spine-bottom',
                type === 'people' ? 'A–Z' : String(index + 1).padStart(2, '0')));
            spines.append(spine);
        }
        if (!shown.length) {
            spines.append(element(doc, 'p', 'slb-library-shelf-empty',
                linked.length === 0
                    ? (allBooks ? '저장된 로어북이 없습니다.' : '연결된 로어북이 없습니다. 모든 로어북 보기를 선택하세요.')
                    : '이 분류에 해당하는 로어북이 없습니다.'));
        }
        scroll.append(spines);
        shelf.append(scroll, element(doc, 'div', 'slb-library-wood-plank'));
        body.append(head, tagbar, shelf);
        const summary = element(doc, 'div', 'slb-library-shelf-summary');
        summary.append(element(doc, 'span', '', candidates.length + '권 중 ' + shown.length + '권 표시'));
        if (candidates.length > shown.length) {
            const more = button(doc, 'slb-library-shelf-more', '', 'shelf-more');
            more.append(element(doc, 'span', 'slb-library-more-caption', '책 더 보기'),
                element(doc, 'small', 'slb-library-more-remaining',
                    (candidates.length - shown.length) + '권 남음'));
            summary.append(more);
        }
        body.append(summary);
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
        row.append(summary, field);
        return row;
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
    async function selectBook(book) {
        if (!bookNames.includes(book) || !discardOrStay()) return;
        resetEdit();
        const version = ++loadVersion;
        currentBook = book;
        pendingImages.clear();
        tagPanelExpanded = false;
        tagInitial = bookTags(book).join(', ');
        tagDraft = tagInitial;
        currentData = null;
        entries = [];
        selectedUid = null;
        searchIndex = new Map();
        query = '';
        visibleLimit = getType(book) === 'memory' ? 12 : 24;
        entryReadViews = new Map();
        entrySingleViews = new Map();
        const body = overlay?.querySelector('.slb-library-body');
        if (!body) return;
        overlay.querySelector('.slb-library-navigation').classList.add('slb-library-has-book');
        overlay.querySelector('.slb-library-current').textContent = book;
        overlay.querySelector('#slb-library-search').value = '';
        overlay.querySelector('#slb-library-book-type').value = getType(book) || 'general';
        body.replaceChildren(element(doc, 'p', 'slb-library-loading', '책과 번역 기록을 여는 중…'));
        body.dataset.type = 'loading';
        notifyStatus('선택한 로어북 파일을 불러오는 중입니다.');
        try {
            // Translation loading does not trigger an AI call or retranslate.
            const [data] = await Promise.all([loadBook(book), loadTranslations(book)]);
            if (!isOpen() || version !== loadVersion || currentBook !== book) return;
            if (!data?.entries) throw new Error('로어북 데이터가 비어 있거나 올바르지 않습니다.');
            currentData = data;
            entries = orderedLoreEntries(data);
            buildSearchIndex();
            renderBook();
            notifyStatus(entries.length + '개 항목 · 원본 순서 유지');
        } catch (error) {
            if (!isOpen() || version !== loadVersion) return;
            body.replaceChildren(element(doc, 'p', 'slb-library-empty', '로어북 불러오기 실패: ' + (error.message || error)));
            notifyStatus('로어북 불러오기 실패 · 원본은 변경되지 않았습니다.', 'error');
        }
    }
    function buildSearchIndex() {
        searchIndex = new Map();
        for (const entry of entries) {
            searchIndex.set(String(entry.uid), [
                entry.comment || '',
                ...(Array.isArray(entry.key) ? entry.key : []),
                ...(Array.isArray(entry.keysecondary) ? entry.keysecondary : []),
                entry.content || '',
            ].join(' ').toLocaleLowerCase());
        }
    }
    function filtered() {
        const needle = query.toLocaleLowerCase().trim();
        if (!needle) return entries;
        return entries.filter(item => searchIndex.get(String(item.uid))?.includes(needle));
    }
    function titleOf(entry) {
        const name = String(entry.comment || '').trim();
        const translation = translationFor(currentBook, entry);
        return translation?.title?.trim() || name || '항목 #' + entry.uid;
    }
    function renderBook() {
        if (!currentData || !isOpen()) return;
        const type = getType(currentBook) || 'general';
        const body = overlay.querySelector('.slb-library-body');
        body.dataset.type = type;
        body.replaceChildren();
        const found = filtered();
        const intro = element(doc, 'div', 'slb-library-section-head');
        intro.append(element(doc, 'span', '', LIBRARY_BOOK_TYPES[type]));
        intro.append(element(doc, 'small', '', found.length + '개 항목 · 저장된 순서'));
        body.append(intro, renderBookTagPanel());
        if (!found.length) {
            body.append(element(doc, 'p', 'slb-library-empty', '검색 결과가 없습니다.'));
            return;
        }
        if (type === 'memory') renderDiary(body, found);
        else if (type === 'world') renderIndex(body, found, 'world');
        else if (type === 'people') renderIndex(body, found, 'people');
        else renderCatalog(body, found);
    }
    function renderCatalog(body, found) {
        const grid = element(doc, 'div', 'slb-library-catalog');
        for (const entry of found.slice(0, visibleLimit)) {
            const uid = String(entry.uid);
            const node = button(doc, 'slb-library-catalog-card', '', 'entry', uid);
            if (uid === selectedUid) node.classList.add('is-selected');
            node.append(element(doc, 'small', 'slb-library-card-index', 'FILE / ' + (entry.displayIndex ?? entry.uid)));
            node.append(element(doc, 'strong', '', titleOf(entry)));
            const snippet = String(entry.content || '').replace(/\s+/g, ' ').slice(0, 125);
            node.append(element(doc, 'p', '', snippet || '내용 없음'));
            node.append(element(doc, 'span', 'slb-library-card-hint', uid === selectedUid ? '접기 −' : '펼치기 +'));
            grid.append(node);
            if (uid === selectedUid) grid.append(renderDetail(entry, 'general'));
        }
        body.append(grid);
        if (found.length > visibleLimit) body.append(button(doc, 'slb-library-more', '카드 더 보기 (' + (found.length - visibleLimit) + '개 남음)', 'more'));
    }
    function renderDiary(body, found) {
        const journal = element(doc, 'div', 'slb-library-journal');
        const shown = found.slice(0, visibleLimit);
        for (const entry of shown) {
            const page = element(doc, 'article', 'slb-library-diary-page');
            page.dataset.uid = String(entry.uid);
            const head = element(doc, 'header', 'slb-library-diary-heading');
            head.append(element(doc, 'span', 'slb-library-diary-date', dateLabel(entry.comment) || 'UNDATED'));
            head.append(element(doc, 'h3', '', titleOf(entry)));
            page.append(head);
            page.append(renderDetail(entry, 'memory'));
            journal.append(page);
        }
        body.append(journal);
        if (found.length > visibleLimit) body.append(button(doc, 'slb-library-more', '다음 기록 계속 읽기 (' + (found.length - visibleLimit) + '개)', 'more'));
    }
    function renderIndex(body, found, type) {
        const layout = element(doc, 'div', 'slb-library-index-layout');
        const index = element(doc, 'nav', 'slb-library-index');
        index.setAttribute('aria-label', type === 'people' ? '인물 이름 목록' : '세계관 목차');
        index.append(element(doc, 'span', 'slb-library-index-heading', type === 'people' ? 'PERSONS' : 'CONTENTS'));
        const length = Math.min(visibleLimit, found.length);
        for (const entry of found.slice(0, length)) {
            const uid = String(entry.uid);
            const item = button(doc, 'slb-library-index-item', '', 'entry', uid);
            if (selectedUid === uid) item.classList.add('is-selected');
            item.append(element(doc, 'span', 'slb-library-index-initial',
                type === 'people' ? (titleOf(entry).trim()[0] || '•') : '§'));
            item.append(element(doc, 'span', '', titleOf(entry)));
            index.append(item);
        }
        if (found.length > visibleLimit) index.append(button(doc, 'slb-library-more', '목차 더 보기', 'more'));
        const paper = element(doc, 'div', 'slb-library-index-paper');
        const selected = found.find(item => String(item.uid) === selectedUid);
        if (selected) paper.append(renderDetail(selected, type));
        else paper.append(element(doc, 'p', 'slb-library-empty', type === 'people'
            ? '이름을 선택하면 인물 카드가 표시됩니다.' : '목차에서 항목을 선택하면 본문이 표시됩니다.'));
        layout.append(index, paper);
        body.append(layout);
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
            ? '원문 · ' + lang : translated ? '번역 · ' + lang : '번역 없음 · 원문 표시'));
        section.append(element(doc, 'div', 'slb-library-prose', format === 'source'
            ? (source || '원문이 비어 있습니다.') : (translated || source || '내용 없음')));
        if (format === 'translated' && info.stale) section.append(element(doc, 'small', 'slb-library-stale', '원문 변경 이전에 저장된 번역입니다. 필요한 경우 다시 번역하세요.'));
        return section;
    }
    function renderDetail(entry, type) {
        const uid = String(entry.uid);
        const article = element(doc, 'article', 'slb-library-detail slb-library-detail-' + type);
        article.dataset.uid = uid;
        if (type !== 'memory') {
            const header = element(doc, 'header', 'slb-library-detail-head');
            header.append(element(doc, 'small', '', type === 'people' ? 'CONTACT RECORD' : type === 'world' ? 'ENCYCLOPEDIA' : 'ARCHIVE FILE'));
            header.append(element(doc, 'h3', '', titleOf(entry)));
            if (type === 'people') header.prepend(element(doc, 'span', 'slb-library-avatar', (titleOf(entry).trim()[0] || '?').toUpperCase()));
            article.append(header);
        }
        const view = entryReadViews.get(uid) || 'translated';
        const lastSingle = entrySingleViews.get(uid) || 'translated';
        const tools = element(doc, 'div', 'slb-library-reader-tools');
        const toggle = button(doc, 'slb-library-view-toggle', view === 'translated' ? '원문 보기' : '번역 보기', 'toggle-view', uid);
        if (view === 'both') toggle.textContent = lastSingle === 'translated' ? '원문 보기' : '번역 보기';
        tools.append(toggle, button(doc, view === 'both' ? 'is-active' : '', '나란히', 'both', uid));
        const editorTools = element(doc, 'div', 'slb-library-editor-tools');
        editorTools.append(button(doc, '', '원문 수정', 'edit-source', uid));
        const info = translationFor(currentBook, entry) || {};
        editorTools.append(button(doc, '', info.text ? '번역 수정' : '번역 작성', 'edit-translated', uid));
        editorTools.append(button(doc, '', 'AI 번역', 'translate', uid));
        editorTools.append(button(doc, 'slb-library-advanced', '⚙ 발동 설정', 'advanced', uid));
        tools.append(editorTools);
        article.append(tools);
        // An entry's optional picture is display metadata, not injected lore
        // content. It is constructed only for an opened detail, never the shelf.
        const imagePath = safeLibraryImagePath(getEntryImage(currentBook, entry));
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
        const media = element(doc, 'div', 'slb-library-entry-image-controls');
        const fileInput = element(doc, 'input', 'slb-library-image-file');
        fileInput.type = 'file';
        fileInput.accept = 'image/png,image/jpeg,image/webp,image/gif';
        fileInput.dataset.uid = uid;
        fileInput.hidden = true;
        fileInput.setAttribute('aria-label', '로어 이미지 파일 선택');
        media.append(fileInput, button(doc, 'slb-library-image-pick',
            imagePath ? '이미지 교체' : '이미지 추가', 'image-pick', uid));
        const selectedImage = pendingImages.get(uid);
        if (selectedImage) {
            media.append(element(doc, 'small', 'slb-library-image-file-name', selectedImage.name));
            media.append(button(doc, 'slb-library-image-save', '이미지 저장', 'image-save', uid));
        }
        if (imagePath) media.append(button(doc, 'slb-library-image-remove', '이미지 연결 해제', 'image-remove', uid));
        article.append(media);
        const pages = element(doc, 'div', view === 'both' ? 'slb-library-pages slb-library-split' : 'slb-library-pages');
        if (view === 'both') pages.append(contentText(entry, 'source'), contentText(entry, 'translated'));
        else pages.append(contentText(entry, view));
        article.append(pages);
        if (edit && edit.uid === uid) {
            const editor = element(doc, 'section', 'slb-library-edit-panel');
            editor.append(element(doc, 'label', '', edit.kind === 'source' ? '원문 수정 · 저장 전에는 실제 로어북에 반영되지 않습니다.' : '번역 수정 · 실리태번 원문은 변경되지 않습니다.'));
            const input = element(doc, 'textarea', 'slb-library-editor-text');
            input.rows = 10;
            input.value = edit.initial;
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
        if (current && entry) current.replaceWith(renderDetail(entry, getType(currentBook) || 'general'));
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
        selectedUid = selectedUid === String(uid) && getType(currentBook) === 'general' ? null : String(uid);
        renderBook();
        const selected = overlay?.querySelector('.slb-library-detail[data-uid="' + String(uid).replace(/[^a-zA-Z0-9_-]/g, '') + '"]');
        if (selected) selected.scrollIntoView?.({ block: 'nearest', behavior: 'auto' });
    }
    function showEdit(uid, kind) {
        if (!discardOrStay({ allowTags: true })) return;
        const entry = entries.find(item => String(item.uid) === String(uid));
        if (!entry) return;
        const current = translationFor(currentBook, entry) || {};
        edit = {
            uid: String(uid),
            kind,
            initial: kind === 'source' ? String(entry.content || '') : String(current.text || ''),
            textarea: null,
        };
        if (getType(currentBook) !== 'memory') selectedUid = String(uid);
        renderBook();
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
            renderBook();
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
            }
            resetEdit();
            renderBook();
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
        saving = true;
        notifyStatus('AI 번역 중…');
        try {
            await translateOne(currentBook, entry);
            entryReadViews.set(String(uid), 'translated');
            entrySingleViews.set(String(uid), 'translated');
            renderBook();
            notifyStatus('AI 번역이 저장되었습니다.', 'success');
        } catch (error) {
            notifyStatus('AI 번역 실패: ' + (error.message || error), 'error');
        } finally {
            saving = false;
        }
    }
    function toggleView(uid) {
        if (!discardOrStay({ allowTags: true })) return;
        resetEdit();
        const current = entryReadViews.get(String(uid)) || 'translated';
        const previous = current === 'both' ? (entrySingleViews.get(String(uid)) || 'translated') : current;
        const next = previous === 'source' ? 'translated' : 'source';
        entryReadViews.set(String(uid), next);
        entrySingleViews.set(String(uid), next);
        renderBook();
    }
    function toggleBoth(uid) {
        if (!discardOrStay({ allowTags: true })) return;
        resetEdit();
        const current = entryReadViews.get(String(uid)) || 'translated';
        if (current === 'both') {
            entryReadViews.set(String(uid), entrySingleViews.get(String(uid)) || 'translated');
        } else {
            entrySingleViews.set(String(uid), current);
            entryReadViews.set(String(uid), 'both');
        }
        renderBook();
    }
    async function onClick(event) {
        const target = event.target.closest?.('[data-action]');
        if (!target || !overlay?.contains(target)) return;
        const action = target.dataset.action, uid = target.dataset.uid;
        if (action === 'close') close();
        else if (action === 'books') {
            if (!discardOrStay()) return;
            loadVersion += 1;
            bookList();
        } else if (action === 'shelf-tag') {
            shelfTag = target.dataset.filter || 'all';
            shelfLimit = 24;
            bookList();
        } else if (action === 'shelf-more') {
            shelfLimit += 24;
            bookList();
        } else if (action === 'select-book') {
            void selectBook(target.dataset.book);
        } else if (action === 'book-tag-save') {
            void saveBookTags();
        } else if (action === 'image-pick') {
            pickEntryImage(uid);
        } else if (action === 'image-save') {
            void saveEntryImage(uid);
        } else if (action === 'image-remove') {
            void clearEntryImage(uid);
        } else if (action === 'entry') showEntry(uid);
        else if (action === 'more') {
            visibleLimit += getType(currentBook) === 'memory' ? 12 : 24;
            renderBook();
        } else if (action === 'toggle-view') toggleView(uid);
        else if (action === 'both') toggleBoth(uid);
        else if (action === 'edit-source' || action === 'edit-translated') showEdit(uid, action === 'edit-source' ? 'source' : 'translated');
        else if (action === 'cancel-edit') {
            if (!discardOrStay({ allowTags: true })) return;
            resetEdit();
            renderBook();
        } else if (action === 'save-edit') void saveEdit();
        else if (action === 'translate') void runTranslate(uid);
        else if (action === 'advanced') {
            if (!discardOrStay()) return;
            const book = currentBook;
            if (close()) void openAdvanced(book, uid);
        }
    }
    function onChange(event) {
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
        if (event.target?.id === 'slb-library-linked-only') {
            allBooks = !event.target.checked;
            shelfLimit = 24;
            shelfTag = 'all';
            bookList();
            return;
        }
        if (event.target?.id !== 'slb-library-book-type') return;
        if (!discardOrStay({ allowTags: true })) {
            event.target.value = getType(currentBook);
            return;
        }
        resetEdit();
        setType(currentBook, event.target.value);
        visibleLimit = event.target.value === 'memory' ? 12 : 24;
        selectedUid = null;
        renderBook();
    }
    function onInput(event) {
        if (event.target?.id === 'slb-library-book-tag-input') {
            tagDraft = event.target.value;
            const save = overlay?.querySelector('[data-action="book-tag-save"]');
            if (save) save.disabled = tagSaving || tagDraft === tagInitial;
            return;
        }
        if (event.target?.id !== 'slb-library-search') return;
        if (!discardOrStay({ allowTags: true })) {
            event.target.value = query;
            return;
        }
        resetEdit();
        query = event.target.value;
        visibleLimit = getType(currentBook) === 'memory' ? 12 : 24;
        selectedUid = null;
        renderBook();
    }
    function open() {
        if (isOpen()) {
            overlay.querySelector('.slb-library-shell')?.focus();
            return;
        }
        originalFocus = doc.activeElement;
        bookNames = listBooks();
        linkedNames = linkedBooks();
        allBooks = false;
        shelfTag = 'all';
        shelfLimit = 24;
        tagSaving = false;
        tagDraft = '';
        tagInitial = '';
        tagPanelExpanded = false;
        pendingImages.clear();
        currentBook = '';
        currentData = null;
        entryReadViews = new Map();
        entrySingleViews = new Map();
        selectedUid = null;
        query = '';
        saving = false;
        edit = null;
        ++loadVersion;
        const shell = createShell();
        overlay.dataset.theme = getTheme?.() || 'antique';
        doc.body.append(overlay);
        doc.addEventListener('keydown', onKeyDown);
        bookList();
        shell.focus();
    }
    function refreshTranslations(book) {
        if (isOpen() && book && currentBook === book && currentData && !edit && !saving) renderBook();
    }
    function onExternalWorldUpdate(book, data) {
        if (!isOpen() || book !== currentBook || !data?.entries) return;
        if (edit || saving) {
            notifyStatus('다른 화면에서 로어북이 수정되었습니다. 현재 편집 내용을 확인하세요.', 'warning');
            return;
        }
        currentData = data;
        entries = orderedLoreEntries(data);
        buildSearchIndex();
        renderBook();
    }
    function updateTheme() {
        if (isOpen()) overlay.dataset.theme = getTheme?.() || 'antique';
    }
    return { open, close, isOpen, refreshTranslations, onExternalWorldUpdate, updateTheme };
}
