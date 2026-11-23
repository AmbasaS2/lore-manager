
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

function faIcon(doc, icon) {
    const node = element(doc, 'i', 'fa-solid fa-' + icon);
    node.setAttribute('aria-hidden', 'true');
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
    getBookCover = () => '',
    getBookCoverMap = null,
    uploadBookCover = async () => {},
    removeBookCover = async () => {},
    getTheme = () => 'antique',
    setTheme = async () => {},
    getCleanVariant = () => 'mac',
    setCleanVariant = async () => {},
    getLinkedOnly = () => true,
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
    let visibleLimit = 24;
    let allBooks = false;
    let loadVersion = 0;
    let edit = null;
    let saving = false;
    let searchIndex = new Map();
    let bookNames = [];
    let bookToneByName = new Map();
    let linkedNames = null;
    let shelfTag = 'all';
    let shelfRows = 2;
    let shelfQuery = '';
    let diaryIndex = 0;
    let worldQuery = '';
    let peopleQuery = '';
    let worldIndexOpen = false;
    let settingsOpen = false;
    let resizeCleanup = null;
    let viewportCleanup = null;
    let floatingSize = null;
    let tagSaving = false;
    let tagDraft = '';
    let tagInitial = '';
    let tagPanelExpanded = false;
    let coverEditor = null;
    let activeToolsUid = null;
    let appearanceSaving = false;
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
        if (saving || tagSaving || appearanceSaving || coverEditor?.saving) {
            notifyStatus('저장 작업이 완료된 후 이동할 수 있습니다.', 'warning');
            return false;
        }
        return !hasPendingEdit({ allowTags }) || doc.defaultView.confirm('저장하지 않은 수정 사항이 있습니다. 변경 내용을 버리고 이동하시겠습니까?');
    }
    function resetEdit() { edit = null; }
    function close() {
        if (coverEditor) return dismissCoverEditor();
        closeReaderTools();
        if (!isOpen() || !discardOrStay()) return false;
        loadVersion += 1;
        resizeCleanup?.();
        resizeCleanup = null;
        viewportCleanup?.();
        viewportCleanup = null;
        floatingSize = null;
        doc.removeEventListener('keydown', onKeyDown);
        overlay.remove();
        overlay = null;
        resetEdit();
        pendingImages.clear();
        if (originalFocus?.isConnected) originalFocus.focus?.();
        return true;
    }
    function onKeyDown(event) {
        if (event.key !== 'Escape' || !isOpen()) return;
        event.preventDefault();
        if (coverEditor) dismissCoverEditor();
        else if (activeToolsUid !== null) closeReaderTools();
        else if (settingsOpen) setSettingsOpen(false);
        else close();
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
        shell.setAttribute('aria-modal', 'true');
        shell.setAttribute('aria-labelledby', 'slb-library-title');
        shell.tabIndex = -1;
        const top = element(doc, 'header', 'slb-library-top');
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
        const closeButton = button(doc, 'slb-library-close', '', 'close');
        closeButton.append(faIcon(doc, 'xmark'));
        closeButton.setAttribute('aria-label', '서재 닫기');
        headerActions.append(settingsButton, closeButton);
        top.append(heading, headerActions);
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
        search.placeholder = '내용 검색';
        search.setAttribute('aria-label', '로어북 내 검색');
        const navTools = element(doc, 'div', 'slb-library-nav-tools');
        navTools.append(filters, search);
        const appearance = element(doc, 'div', 'slb-library-appearance');
        const appearanceLabel = element(doc, 'label', '', '서재 테마');
        appearanceLabel.htmlFor = 'slb-library-theme-mode';
        const themeMode = element(doc, 'select', 'slb-library-theme-select');
        themeMode.id = 'slb-library-theme-mode';
        for (const [value, title] of [['antique', '클래식 아카이브'], ['clean', '클린 디지털']]) {
            const option = element(doc, 'option', '', title);
            option.value = value;
            themeMode.append(option);
        }
        const variantLabel = element(doc, 'label', 'slb-library-variant-wrap');
        const variantText = element(doc, 'span', '', '클린 디자인');
        const variant = element(doc, 'select', 'slb-library-theme-select');
        variant.id = 'slb-library-clean-variant';
        for (const [value, title] of [['mac', 'MacBook형'], ['blackberry', 'BlackBerry형']]) {
            const option = element(doc, 'option', '', title);
            option.value = value;
            variant.append(option);
        }
        variantLabel.append(variantText, variant);
        appearance.append(appearanceLabel, themeMode, variantLabel);
        const settingsPanel = element(doc, 'aside', 'slb-library-settings-panel');
        settingsPanel.id = 'slb-library-settings-panel';
        settingsPanel.hidden = true;
        const settingsHeading = element(doc, 'strong', 'slb-library-settings-title', '서재 설정');
        const linkedLabel = element(doc, 'label', 'slb-library-linked-setting');
        const linkedCheck = element(doc, 'input');
        linkedCheck.type = 'checkbox';
        linkedCheck.id = 'slb-library-linked-only';
        linkedLabel.append(linkedCheck, element(doc, 'span', '',
            '현재 캐릭터에 연결된 책만 보기'));
        const linkedHint = element(doc, 'small', 'slb-library-linked-hint',
            '연결된 로어북이 없으면 모든 책이 표시됩니다.');
        settingsPanel.append(settingsHeading, appearance, linkedLabel, linkedHint);
        navigation.append(navTop, navTools);
        const body = element(doc, 'main', 'slb-library-body');
        const footer = element(doc, 'footer', 'slb-library-footer');
        const status = element(doc, 'span', '', '기존 로어북 원문과 번역 데이터를 사용합니다.');
        status.id = 'slb-library-status';
        footer.append(status);
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
        shell.append(top, settingsPanel, navigation, body, footer, resizeGrip);
        overlay.append(shell);
        resizeGrip.addEventListener('pointerdown', beginResize);
        resizeGrip.addEventListener('keydown', onResizeKeyDown);
        overlay.addEventListener('click', event => {
            if (settingsOpen && !event.target.closest('.slb-library-settings-panel, [data-action="settings"]')) setSettingsOpen(false);
            if (activeToolsUid !== null && !event.target.closest('.slb-library-tools-popover, [data-action="more-tools"]')) closeReaderTools();
            if (event.target === overlay) close();
        });
        overlay.addEventListener('click', onClick);
        overlay.addEventListener('change', onChange);
        overlay.addEventListener('input', onInput);
        return shell;
    }

    function setSettingsOpen(value) {
        if (!overlay) return;
        settingsOpen = Boolean(value);
        const panel = overlay.querySelector('#slb-library-settings-panel');
        if (panel) panel.hidden = !settingsOpen;
        const opener = overlay.querySelector('[data-action="settings"]');
        if (opener) opener.setAttribute('aria-expanded', String(settingsOpen));
    }
    function refreshAfterResize() {
        if (!isOpen()) return;
        if (!currentBook) { bookList(); return; }
        // Only the journal depends on the reader's actual width for its
        // record count. Reuse the loaded entries, never reload or auto-save.
        // Do not replace an editor/unfinished upload in progress.
        if (currentData && getType(currentBook) === 'memory'
            && !edit && !tagSaving && !saving && !pendingImages.size) {
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
    function placeOnViewportChange() {
        if (!isOpen() || !floatingSize) return;
        const shell = overlay.querySelector('.slb-library-shell');
        if (!shell) return;
        const vp = visibleLibraryViewport();
        placeFloatingShell(shell, floatingSize.width, floatingSize.height,
            vp.left + vp.width / 2, vp.top + vp.height / 2);
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
        // The initial fixed coordinates exactly preserve the current rectangle.
        placeFloatingShell(shell, width, height, centerX, centerY);
        const grip = event.currentTarget;
        const win = doc.defaultView;
        const onMove = move => {
            if (move.pointerId !== event.pointerId) return;
            placeFloatingShell(shell,
                width + 2 * (move.clientX - startX),
                height + 2 * (move.clientY - startY),
                centerX, centerY);
        };
        const stop = move => {
            if (move && move.pointerId !== event.pointerId) return;
            resizeCleanup?.();
            resizeCleanup = null;
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
        coverEditor = { book, backdrop, preview, file: null, previewUrl: null, focus: doc.activeElement, saving: false };
        overlay.append(backdrop);
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
        const theme = getTheme() === 'clean' ? 'clean' : 'antique';
        const variant = getCleanVariant() === 'blackberry' ? 'blackberry' : 'mac';
        overlay.dataset.theme = theme;
        overlay.dataset.variant = variant;
        const modeSelect = overlay.querySelector('#slb-library-theme-mode');
        const variantSelect = overlay.querySelector('#slb-library-clean-variant');
        if (modeSelect) modeSelect.value = theme;
        if (variantSelect) variantSelect.value = variant;
        const linkedCheck = overlay.querySelector('#slb-library-linked-only');
        if (linkedCheck) linkedCheck.checked = Boolean(getLinkedOnly());
        const variantRow = overlay.querySelector('.slb-library-variant-wrap');
        if (variantRow) variantRow.hidden = theme !== 'clean';
    }
    async function updateAppearance(kind, value) {
        if (!isOpen() || appearanceSaving || coverEditor) return;
        if (!discardOrStay()) { syncAppearanceControls(); return; }
        if (kind === 'theme' && !['antique', 'clean'].includes(value)) return;
        if (kind === 'variant' && !['mac', 'blackberry'].includes(value)) return;
        const prev = kind === 'theme' ? getTheme() : getCleanVariant();
        if (value === prev) { syncAppearanceControls(); return; }
        appearanceSaving = true;
        const controls = overlay.querySelectorAll('.slb-library-appearance select');
        for (const input of controls) input.disabled = true;
        try {
            if (kind === 'theme') await setTheme(value);
            else await setCleanVariant(value);
            syncAppearanceControls();
            if (!currentBook) bookList();
            else if (currentData) renderBook();
            notifyStatus('서재 디자인 설정이 저장되었습니다.', 'success');
        } catch (error) {
            syncAppearanceControls();
            notifyStatus('서재 디자인 저장 실패: ' + (error?.message || error), 'error');
        } finally {
            appearanceSaving = false;
            for (const input of controls) input.disabled = false;
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
            shelfRows = 2;
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
    function shelfColumns(body, digital) {
        // Shelf geometry is read once on explicit entry/search/more/resize-end.
        // The same count is used for both DOM limit and CSS grid columns.
        const shellWidth = overlay?.querySelector('.slb-library-shell')?.clientWidth
            || Math.min(doc.defaultView.innerWidth || 1024, 1000);
        const width = body.clientWidth || Math.max(260, shellWidth - 32);
        if (digital) {
            // Narrow windows: 360px -> 3 covers, 440px -> 4.
            // Three columns remain usable in the smallest mobile modal.
            return Math.max(3, Math.min(6, Math.floor((shellWidth - 14) / 96)));
        }
        return Math.max(3, Math.min(14, Math.floor((width - 28 + 4) / 47)));
    }
    function bookList({ restoreSearchFocus = false } = {}) {
        if (!isOpen()) return;
        const body = overlay.querySelector('.slb-library-body');
        const oldScroll = body.dataset.type === 'books' ? body.scrollTop : 0;
        const searchSelection = restoreSearchFocus
            ? overlay.querySelector('#slb-library-shelf-search')?.selectionStart : null;
        resetEdit();
        closeReaderTools();
        currentBook = '';
        pendingImages.clear();
        currentData = null;
        selectedUid = null;
        const nav = overlay.querySelector('.slb-library-navigation');
        nav.classList.remove('slb-library-has-book');
        nav.querySelector('.slb-library-current').textContent = '로어북 서가';
        body.replaceChildren();
        body.dataset.type = 'books';

        const hasLinks = linkedNames instanceof Set && linkedNames.size > 0;
        const linked = uniqueLibraryBooks(bookNames, linkedNames).filter(book =>
            allBooks || !hasLinks || book.linked);
        const tagMap = typeof getTagMap === 'function' ? getTagMap() : null;
        const tagsFor = book => tagMap && typeof tagMap === 'object'
            ? normalizeLibraryTags(Object.hasOwn(tagMap, book) ? tagMap[book] : []) : bookTags(book);
        const knownTags = [];
        const seenTags = new Set();
        for (const item of linked) {
            for (const tag of tagsFor(item.name)) {
                if (!seenTags.has(tag)) { seenTags.add(tag); knownTags.push(tag); }
            }
        }
        const head = element(doc, 'div', 'slb-library-books-head');
        const titleSearch = element(doc, 'input', 'slb-library-shelf-search');
        titleSearch.id = 'slb-library-shelf-search';
        titleSearch.type = 'search';
        titleSearch.autocomplete = 'off';
        titleSearch.placeholder = '⌕  로어북 제목 검색';
        titleSearch.setAttribute('aria-label', '로어북 제목 검색');
        titleSearch.value = shelfQuery;
        head.append(titleSearch);

        const tagbar = element(doc, 'nav', 'slb-library-tagbar');
        tagbar.setAttribute('aria-label', '로어북 태그');
        for (const [key, name] of [['all', '전체'], ['untagged', '미분류']]) {
            const choice = button(doc, 'slb-library-tag-tab' + (shelfTag === key ? ' is-active' : ''), name, 'shelf-tag');
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
        tagSelect.value = shelfTag.startsWith('tag:') && knownTags.includes(shelfTag.slice(4))
            ? shelfTag : '';
        tagbar.append(tagSelect);
        const needle = shelfQuery.toLocaleLowerCase().trim();
        const candidates = linked.filter(book => {
            const tags = tagsFor(book.name);
            if (needle && !book.name.toLocaleLowerCase().includes(needle)) return false;
            if (shelfTag === 'untagged') return !tags.length;
            if (shelfTag.startsWith('tag:')) return tags.includes(shelfTag.slice(4));
            return true;
        });
        const typeMap = typeof getTypeMap === 'function' ? getTypeMap() : null;
        const digital = getTheme() === 'clean';
        const shelf = element(doc, 'div', 'slb-library-bookshelf' + (digital ? ' slb-library-digital-bookshelf' : ''));
        const scroll = element(doc, 'div', 'slb-library-books-scroll');
        scroll.setAttribute('role', 'region');
        scroll.setAttribute('aria-label', digital ? '책 표지 목록' : '책등 목록');
        scroll.tabIndex = 0;
        const spines = element(doc, 'div', digital ? 'slb-library-cover-grid' : 'slb-library-book-spines');
        const coverMap = digital && typeof getBookCoverMap === 'function' ? getBookCoverMap() : null;
        const rowWidth = shelfColumns(body, digital);
        spines.style.setProperty('--slb-shelf-columns', String(rowWidth));
        const maxVisible = shelfRows * rowWidth;
        const shown = candidates.slice(0, maxVisible);
        for (const [index, item] of shown.entries()) {
            const savedType = typeMap && typeof typeMap === 'object'
                ? (Object.hasOwn(typeMap, item.name) ? typeMap[item.name] : 'general')
                : getType(item.name);
            const type = Object.hasOwn(LIBRARY_BOOK_TYPES, savedType) ? savedType : 'general';
            if (digital) {
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
                const configure = button(doc, 'slb-library-cover-config', imagePath ? '표지 교체' : '표지 설정', 'cover-config');
                configure.dataset.book = item.name;
                configure.setAttribute('aria-label', item.name + ' · 표지 설정');
                entry.append(opener, configure);
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
        if (digital) shelf.append(scroll);
        else shelf.append(scroll, element(doc, 'div', 'slb-library-wood-plank'));
        body.append(head, tagbar, shelf);
        const summary = element(doc, 'div', 'slb-library-shelf-summary');
        summary.append(element(doc, 'span', '', candidates.length + '권 중 ' + shown.length + '권 표시'));
        if (candidates.length > shown.length) {
            const more = button(doc, 'slb-library-shelf-more', '', 'shelf-more');
            more.append(element(doc, 'span', 'slb-library-more-caption',
                '더 보기 (' + (candidates.length - shown.length) + ')'));
            summary.append(more);
        }
        body.append(summary);
        body.scrollTop = oldScroll;
        if (restoreSearchFocus) {
            const replacement = overlay.querySelector('#slb-library-shelf-search');
            replacement?.focus?.();
            if (searchSelection !== null) replacement?.setSelectionRange?.(searchSelection, searchSelection);
        }
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
        closeReaderTools();
        const version = ++loadVersion;
        currentBook = book;
        pendingImages.clear();
        tagPanelExpanded = false;
        tagInitial = bookTags(book).join(', ');
        tagDraft = tagInitial;
        currentData = null;
        entries = [];
        selectedUid = null;
        diaryIndex = 0;
        worldQuery = '';
        peopleQuery = '';
        worldIndexOpen = false;
        searchIndex = new Map();
        query = '';
        visibleLimit = getType(book) === 'memory' ? 12 : 24;
        entryReadViews = new Map();
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
            notifyStatus(entries.length + '개 항목');
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
    function cleanReaderChrome(type) {
        const title = { general: '일반', memory: '기억', world: '세계관', people: '인물록' }[type];
        const chrome = element(doc, 'div', 'slb-library-clean-chrome');
        const dots = element(doc, 'span', 'slb-library-window-dots');
        dots.setAttribute('aria-hidden', 'true');
        dots.append(element(doc, 'i'), element(doc, 'i'), element(doc, 'i'));
        chrome.append(dots, element(doc, 'strong', '', title));
        return chrome;
    }
    function cleanReaderSidebar(type) {
        const aside = element(doc, 'aside', 'slb-library-clean-sidebar');
        aside.append(element(doc, 'small', 'slb-library-sidebar-kicker', 'COLLECTIONS'));
        for (const [key, name] of [
            ['general','일반'], ['memory','기억'], ['world','세계관'], ['people','인물록'],
        ]) {
            const label = element(doc, 'div', 'slb-library-sidebar-item' + (key === type ? ' is-active' : ''),
                { general:'▤ ',memory:'▧ ',world:'✣ ',people:'◈ ' }[key] + name);
            aside.append(label);
        }
        aside.append(element(doc, 'small', 'slb-library-sidebar-kicker', 'PERSONAL COLLECTION'));
        return aside;
    }
    function blackBerryKeys() {
        const keyboard = element(doc, 'div', 'slb-library-device-keyboard');
        keyboard.setAttribute('aria-hidden', 'true');
        const nav = element(doc, 'div', 'slb-library-device-controls', '⌕        ‹        ▢        ☰        ↩');
        keyboard.append(nav);
        for (const line of ['QWERTYUIOP','ASDFGHJKL','ZXCVBNM']) {
            const row = element(doc, 'div', 'slb-library-device-key-row');
            for (const char of line) row.append(element(doc, 'span', '', char));
            keyboard.append(row);
        }
        return keyboard;
    }
    function readerContainer(body, type) {
        const clean = getTheme() === 'clean';
        const variant = getCleanVariant() === 'blackberry' ? 'blackberry' : 'mac';
        const frame = element(doc, 'section', 'slb-library-reader-frame '
            + (clean ? 'slb-library-reader-clean slb-library-reader-' + variant : 'slb-library-reader-classic'));
        frame.dataset.bookType = type;
        const inner = element(doc, 'div', 'slb-library-reader-inner');
        if (clean) {
            frame.append(cleanReaderChrome(type));
            const workspace = element(doc, 'div', 'slb-library-clean-workspace');
            workspace.append(cleanReaderSidebar(type), inner);
            frame.append(workspace);
            if (variant === 'blackberry') frame.append(blackBerryKeys());
        } else {
            const banner = element(doc, 'div', 'slb-library-classic-banner');
            const heading = {
                general: 'CATALOGUE · DRAWER 01',
                memory: 'PERSONAL JOURNAL · VOL. II',
                world: 'ENCYCLOPAEDIA · VOL. III',
                people: 'PERSONAL REGISTER · VOL. IV',
            }[type];
            banner.append(element(doc, 'span', '', heading),
                element(doc, 'span', '', type === 'people' ? 'CONFIDENTIAL' : 'PRIVATE COLLECTION'));
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
        body.replaceChildren();
        const found = filtered();
        const inner = readerContainer(body, type);
        // Keep the original book setting editor and tag metadata independent
        // from the physical presentation used for each reading mode.
        inner.append(renderBookTagPanel());
        if (!(type === 'general' && getTheme() !== 'clean'
            && selectedUid && found.some(item => String(item.uid) === selectedUid))) {
            const intro = element(doc, 'div', 'slb-library-section-head');
            intro.append(element(doc, 'small', '', found.length + '개 항목'));
            inner.append(intro);
        }
        if (!found.length) {
            inner.append(element(doc, 'p', 'slb-library-empty', '검색 결과가 없습니다.'));
            return;
        }
        if (type === 'memory') renderDiary(inner, found);
        else if (type === 'world') renderIndex(inner, found, 'world');
        else if (type === 'people') renderPeople(inner, found);
        else if (getTheme() === 'clean') renderCleanCatalog(inner, found);
        else renderCatalog(inner, found);
    }
    function renderCatalog(body, found) {
        const selectedIndex = found.findIndex(item => String(item.uid) === selectedUid);
        if (selectedIndex >= 0) {
            const nav = element(doc, 'div', 'slb-library-catalog-detail-nav');
            nav.append(button(doc, '', '‹ 카드함', 'catalog-back'));
            nav.append(element(doc, 'span', 'slb-library-catalog-position',
                String(selectedIndex + 1).padStart(2, '0') + ' / ' + String(found.length).padStart(2, '0')));
            body.append(nav, renderDetail(found[selectedIndex], 'general'));
            const pager = element(doc, 'div', 'slb-library-catalog-pager');
            const prev = button(doc, '', '‹ 이전', 'catalog-prev');
            prev.disabled = selectedIndex === 0;
            const next = button(doc, '', '다음 ›', 'catalog-next');
            next.disabled = selectedIndex === found.length - 1;
            pager.append(prev, element(doc, 'small', '', 'RECORD'), next);
            body.append(pager);
            return;
        }
        const frame = element(doc, 'div', 'slb-library-catalog-frame');
        const stack = element(doc, 'div', 'slb-library-catalog');
        for (const entry of found.slice(0, visibleLimit)) {
            const uid = String(entry.uid);
            const item = button(doc, 'slb-library-catalog-card', '', 'entry', uid);
            item.append(element(doc, 'strong', '', titleOf(entry)));
            stack.append(item);
        }
        frame.append(stack);
        body.append(frame);
        if (found.length > visibleLimit) body.append(button(doc, 'slb-library-more',
            '카드 더 보기 (' + (found.length - visibleLimit) + '개)', 'more'));
    }
    function renderCleanCatalog(body, found) {
        const list = element(doc, 'div', 'slb-library-clean-list');
        const chosen = found.find(item => String(item.uid) === selectedUid) || found[0];
        selectedUid = String(chosen.uid);
        for (const item of found.slice(0, visibleLimit)) {
            const row = button(doc, 'slb-library-clean-list-row' +
                (String(item.uid) === String(chosen.uid) ? ' is-active' : ''), '', 'entry', String(item.uid));
            row.append(element(doc, 'span', 'slb-library-clean-list-icon', '▤'),
                element(doc, 'strong', '', titleOf(item)),
                element(doc, 'span', 'slb-library-clean-list-chevron', '›'));
            list.append(row);
        }
        body.append(list);
        if (found.length > visibleLimit) body.append(button(doc, 'slb-library-more',
            '기록 더 보기 (' + (found.length - visibleLimit) + '개)', 'more'));
        const preview = element(doc, 'div', 'slb-library-clean-preview');
        preview.append(element(doc, 'small', '', 'SELECTED RECORD'));
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
    function renderDiary(body, found) {
        diaryIndex = Math.min(Math.max(0, diaryIndex), found.length - 1);
        const heading = element(doc, 'div', 'slb-library-record-index');
        const label = element(doc, 'label', '', '기록 목차');
        label.htmlFor = 'slb-library-diary-select';
        const select = element(doc, 'select', '');
        select.id = 'slb-library-diary-select';
        select.setAttribute('aria-label', '기억 기록 목차');
        for (const [i, item] of found.entries()) {
            const option = element(doc, 'option', '', String(i + 1).padStart(2, '0') + ' · ' + titleOf(item));
            option.value = String(i);
            select.append(option);
        }
        select.value = String(diaryIndex);
        heading.append(label, select);
        body.append(heading);
        const journal = element(doc, 'div', 'slb-library-journal');
        const numberOfPages = diaryStep();
        for (const [offset, entry] of found.slice(diaryIndex, diaryIndex + numberOfPages).entries()) {
            const page = element(doc, 'article', 'slb-library-diary-page');
            page.dataset.uid = String(entry.uid);
            const head = element(doc, 'header', 'slb-library-diary-heading');
            const date = dateLabel(entry.comment);
            if (date) head.append(element(doc, 'span', 'slb-library-diary-date', date));
            head.append(element(doc, 'h3', '', titleOf(entry)));
            page.append(head, renderDetail(entry, 'memory'));
            page.append(element(doc, 'small', 'slb-library-diary-page-number',
                String(diaryIndex + offset + 1).padStart(2, '0') + ' / ' + String(found.length).padStart(2, '0')));
            journal.append(page);
        }
        body.append(journal);
        const pager = element(doc, 'nav', 'slb-library-diary-pager');
        const previous = button(doc, '', '‹ 이전 페이지', 'diary-prev');
        previous.disabled = diaryIndex === 0;
        const next = button(doc, '', '다음 페이지 ›', 'diary-next');
        next.disabled = diaryIndex + diaryStep() >= found.length;
        pager.append(previous, element(doc, 'span', '', String(diaryIndex + 1).padStart(2, '0')
            + '–' + String(Math.min(found.length, diaryIndex + numberOfPages)).padStart(2, '0')
            + ' / ' + String(found.length).padStart(2, '0')), next);
        body.append(pager);
    }
    function renderIndex(body, found, type) {
        // World reference retains a separate, vertically scrolling TOC.
        // Contacts use renderPeople and never share this layout.
        const chosen = found.find(item => String(item.uid) === selectedUid) || found[0];
        if (!selectedUid) selectedUid = String(chosen.uid);
        const layout = element(doc, 'div', 'slb-library-index-layout');
        layout.classList.toggle('is-index-open', worldIndexOpen);
        const menu = button(doc, 'slb-library-world-menu', '목차', 'world-menu');
        menu.setAttribute('aria-expanded', String(worldIndexOpen));
        body.append(menu);
        const index = element(doc, 'nav', 'slb-library-index');
        index.setAttribute('aria-label', '세계관 목차');
        index.append(element(doc, 'span', 'slb-library-index-heading', '목차 · CONTENTS'));
        const search = element(doc, 'input', 'slb-library-world-search');
        search.id = 'slb-library-world-search';
        search.type = 'search';
        search.placeholder = '항목 검색';
        search.setAttribute('aria-label', '세계관 항목 검색');
        search.value = worldQuery;
        index.append(search);
        const needle = worldQuery.toLocaleLowerCase().trim();
        const indexed = needle ? found.filter(entry => titleOf(entry).toLocaleLowerCase().includes(needle)) : found;
        for (const [position, entry] of indexed.slice(0, visibleLimit).entries()) {
            const uid = String(entry.uid);
            const item = button(doc, 'slb-library-index-item', '', 'entry', uid);
            if (String(chosen.uid) === uid) item.classList.add('is-selected');
            const originalPosition = found.indexOf(entry) + 1;
            item.append(element(doc, 'span', 'slb-library-index-initial',
                String(originalPosition).padStart(2,'0')));
            item.append(element(doc, 'span', '', titleOf(entry)));
            index.append(item);
        }
        if (indexed.length > visibleLimit) index.append(button(doc, 'slb-library-more', '목차 더 보기', 'more'));
        const paper = element(doc, 'div', 'slb-library-index-paper');
        paper.append(renderDetail(chosen, type));
        layout.append(index, paper);
        body.append(layout);
    }
    function renderPeople(body, found) {
        const selected = found.find(entry => String(entry.uid) === selectedUid);
        if (selected) {
            const detailPage = element(doc, 'div', 'slb-library-person-profile');
            detailPage.append(button(doc, 'slb-library-person-back', '‹ 이름 목록으로', 'people-back'));
            detailPage.append(renderDetail(selected, 'people'));
            body.append(detailPage);
            return;
        }
        const directory = element(doc, 'div', 'slb-library-person-directory');
        directory.append(element(doc, 'small', '', 'PERSONAL INDEX'));
        const search = element(doc, 'input', 'slb-library-people-search');
        search.type = 'search';
        search.id = 'slb-library-people-search';
        search.setAttribute('aria-label', '이름 검색');
        search.placeholder = '⌕  이름 검색';
        search.value = peopleQuery;
        directory.append(search);
        const candidates = peopleQuery.trim() ? found.filter(e =>
            titleOf(e).toLocaleLowerCase().includes(peopleQuery.toLocaleLowerCase().trim())) : found;
        const names = element(doc, 'div', 'slb-library-people-list');
        for (const item of candidates.slice(0, visibleLimit)) {
            const row = button(doc, 'slb-library-person-row', '', 'entry', String(item.uid));
            row.append(element(doc, 'span', 'slb-library-person-initial', titleOf(item).slice(0,1) || '•'),
                element(doc, 'strong', '', titleOf(item)),
                element(doc, 'span', '', '›'));
            names.append(row);
        }
        if (!candidates.length) names.append(element(doc, 'p', 'slb-library-empty', '검색 결과가 없습니다.'));
        directory.append(names);
        if (candidates.length > visibleLimit) directory.append(button(doc, 'slb-library-more',
            '인물 더 보기 (' + (candidates.length - visibleLimit) + '명)', 'more'));
        body.append(directory);
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
        section.append(element(doc, 'div', 'slb-library-prose', format === 'source'
            ? (source || '원문이 비어 있습니다.') : (translated || '저장된 번역본이 없습니다. 수정 버튼으로 번역문을 작성할 수 있습니다.')));
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
        menu.append(button(doc, '', '태그 편집', 'tag-edit', uid));
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
        worldIndexOpen = false;
        renderBook();
        const selected = overlay?.querySelector('.slb-library-detail[data-uid="' + String(uid).replace(/[^a-zA-Z0-9_-]/g, '') + '"]');
        if (selected) selected.scrollIntoView?.({ block: 'nearest', behavior: 'auto' });
    }
    function showEdit(uid) {
        if (!discardOrStay({ allowTags: true })) return;
        const entry = entries.find(item => String(item.uid) === String(uid));
        if (!entry) return;
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
        const entry = entries.find(item => String(item.uid) === String(uid));
        if (!entry) return;
        resetEdit();
        const current = entryReadViews.get(String(uid))
            || (String(translationFor(currentBook, entry)?.text || '') ? 'translated' : 'source');
        entryReadViews.set(String(uid), current === 'source' ? 'translated' : 'source');
        renderBook();
    }
    async function onClick(event) {
        const target = event.target.closest?.('[data-action]');
        if (!target || !overlay?.contains(target)) return;
        const action = target.dataset.action, uid = target.dataset.uid;
        if (coverEditor && !coverEditor.backdrop.contains(target)) return;
        if (['edit', 'translate', 'advanced'].includes(action)) closeReaderTools();
        if (action === 'settings') setSettingsOpen(!settingsOpen);
        else if (action === 'more-tools') toggleReaderTools(uid);
        else if (action === 'tag-edit') {
            closeReaderTools();
            tagPanelExpanded = true;
            const tagPanel = overlay.querySelector('.slb-library-book-meta');
            if (tagPanel) {
                tagPanel.open = true;
                tagPanel.querySelector('#slb-library-book-tag-input')?.focus();
            }
        }
        else if (action === 'cover-config') openCoverEditor(target.dataset.book);
        else if (action === 'cover-cancel') dismissCoverEditor();
        else if (action === 'cover-save') void commitCover(false);
        else if (action === 'cover-reset') void commitCover(true);
        else if (action === 'close') close();
        else if (action === 'books') {
            if (!discardOrStay()) return;
            loadVersion += 1;
            bookList();
        } else if (action === 'shelf-tag') {
            shelfTag = target.dataset.filter || 'all';
            shelfRows = 2;
            bookList();
        } else if (action === 'shelf-more') {
            shelfRows += 2;
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
        } else if (action === 'catalog-back') {
            if (!discardOrStay({ allowTags: true })) return;
            resetEdit();
            selectedUid = null;
            renderBook();
        } else if (action === 'catalog-prev') shiftCatalog(-1);
        else if (action === 'catalog-next') shiftCatalog(1);
        else if (action === 'diary-prev' || action === 'diary-next') {
            if (!discardOrStay({ allowTags: true })) return;
            const found = filtered();
            diaryIndex = Math.min(Math.max(0,
                diaryIndex + (action === 'diary-next' ? diaryStep() : -diaryStep())), found.length - 1);
            resetEdit();
            renderBook();
        } else if (action === 'world-menu') {
            worldIndexOpen = !worldIndexOpen;
            renderBook();
        } else if (action === 'people-back') {
            if (!discardOrStay({ allowTags: true })) return;
            selectedUid = null;
            resetEdit();
            renderBook();
        } else if (action === 'entry') showEntry(uid);
        else if (action === 'more') {
            visibleLimit += getType(currentBook) === 'memory' ? 12 : 24;
            renderBook();
        } else if (action === 'toggle-view') toggleView(uid);
        else if (action === 'edit') showEdit(uid);
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
        if (event.target?.id === 'slb-library-shelf-tag-select') {
            shelfTag = event.target.value || 'all';
            shelfRows = 2;
            bookList();
            return;
        }
        if (event.target?.id === 'slb-library-diary-select') {
            if (!discardOrStay({ allowTags: true })) {
                event.target.value = String(diaryIndex);
                return;
            }
            diaryIndex = Number(event.target.value) || 0;
            resetEdit();
            renderBook();
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
            void updateAppearance('theme', event.target.value);
            return;
        }
        if (event.target?.id === 'slb-library-clean-variant') {
            void updateAppearance('variant', event.target.value);
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
        visibleLimit = event.target.value === 'memory' ? 12 : 24;
        selectedUid = null;
        renderBook();
    }
    function onInput(event) {
        for (const [selector, key] of [
            ['slb-library-world-search', 'world'],
            ['slb-library-people-search', 'people'],
        ]) {
            if (event.target?.id !== selector) continue;
            const input = event.target;
            const position = input.selectionStart;
            if (key === 'world') worldQuery = input.value;
            else peopleQuery = input.value;
            renderBook();
            const replacement = overlay?.querySelector('#' + selector);
            replacement?.focus?.();
            if (position != null) replacement?.setSelectionRange?.(position, position);
            return;
        }
        if (event.target?.id === 'slb-library-shelf-search') {
            shelfQuery = event.target.value;
            shelfRows = 2;
            bookList({ restoreSearchFocus: true });
            return;
        }
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
        bookToneByName = new Map(bookNames.map((book, index) => [book, index % 12]));
        linkedNames = linkedBooks();
        allBooks = !Boolean(getLinkedOnly());
        shelfTag = 'all';
        shelfRows = 2;
        shelfQuery = '';
        diaryIndex = 0;
        worldQuery = '';
        peopleQuery = '';
        worldIndexOpen = false;
        settingsOpen = false;
        tagSaving = false;
        tagDraft = '';
        tagInitial = '';
        tagPanelExpanded = false;
        coverEditor = null;
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
        placeFloatingShell(shell,
            rect.width || Math.min(1000, vp.width - 32),
            rect.height || Math.min(785, vp.height - 32),
            vp.left + vp.width / 2, vp.top + vp.height / 2);
        bindLibraryViewport();
        syncAppearanceControls();
        setSettingsOpen(false);
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
        if (!isOpen()) return;
        const previous = overlay.dataset.theme;
        syncAppearanceControls();
        if (previous !== overlay.dataset.theme && !currentBook) bookList();
    }
    return { open, close, isOpen, refreshTranslations, onExternalWorldUpdate, updateTheme };
}
