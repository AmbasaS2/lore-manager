/**
 * Prepare a tiny number of native rows before the existing enhancement
 * requestAnimationFrame. This is display-only and must never cache/reinsert
 * DOM nodes that SillyTavern has removed through clearEntryList().
 *
 * Only direct additions of currently attached native rows are eligible.
 * The caller must already have verified a stable, same-book, standard reader.
 * All other rows continue through the original enhancement queue.
 */
export function prepareFirstNativePageHeaders(mutations, list, {
    enhance,
    isReady,
    now,
    maxRows = 2,
    budgetMs = 8,
}) {
    if (!list || typeof enhance !== 'function' || typeof isReady !== 'function'
        || typeof now !== 'function' || maxRows < 1 || budgetMs < 0) return 0;
    const started = now();
    let done = 0;
    for (const mutation of mutations) {
        if (mutation?.type !== 'childList' || mutation.target !== list) continue;
        for (const row of mutation.addedNodes || []) {
            if (!row?.matches?.('.world_entry') || row.parentElement !== list || !row.isConnected
                || row.dataset?.slbDisplayReady === 'true') continue;
            // Header hydration is inexpensive compared with a full opened
            // editor, and existing ready markers let enhanceAll skip it later.
            try {
                enhance(row);
                if (isReady(row)) row.dataset.slbDisplayReady = 'true';
            } catch {
                // Leave this native row for the established error-handling and
                // bounded retry path. Never hide or delete it here.
            }
            done++;
            if (done >= maxRows || now() - started >= budgetMs) return done;
        }
    }
    return done;
}
