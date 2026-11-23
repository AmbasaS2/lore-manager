/**
 * Reuse a very small number of complete, already-visited native WorldInfo
 * pages without asking SillyTavern to build those entries a second time.
 *
 * It is deliberately an adapter to the existing pagination.js 2.6 hooks,
 * not a replacement for ST's pagination, source editing, sort, or saving.
 * New pages retain the ST callback and all of its native initialization.
 *
 * `detach` (not remove/clone) preserves native jQuery and external extension
 * handlers. Evicted/cancelled cached DOM is cleaned with jQuery.remove().
 */

/**
 * @param {{
 *  pagination: any, list: any, jQuery: any, book: string,
 *  isAllowed: () => boolean,
 *  signature: () => string,
 *  maxPages?: number, maxRows?: number
 * }} options
 * @returns {{ dispose: () => void, invalidate: () => void, book: string, list: Element } | null}
 */
export function attachNativePageCache({
    pagination, list, jQuery, book, isAllowed, signature,
    maxPages = 2, maxRows = 50,
}) {
    const plugin = pagination?.data?.('pagination');
    const listNode = list?.[0];
    if (!book || !listNode || !plugin?.initialized || !plugin?.model
        || typeof pagination.addHook !== 'function' || typeof isAllowed !== 'function'
        || typeof signature !== 'function' || typeof jQuery !== 'function'
        || !Number.isInteger(maxPages) || maxPages < 1
        || !Number.isInteger(maxRows) || maxRows < 1) return null;

    if (plugin.slbPageCache?.book === book && plugin.slbPageCache.list === listNode
        && !plugin.slbPageCache.disposed) return plugin.slbPageCache;

    plugin.slbPageCache?.dispose?.();
    // A third-party pagination hook may depend on the native callback being
    // invoked exactly once. Do not intercept that extension's page changes.
    if (plugin.hooks?.beforePaging?.length) return null;
    const cached = new Map();
    const cacheStamp = signature();
    let restoring = false;
    let disposed = false;
    let dirty = false;
    const sizeAtInstall = Number(plugin.model.pageSize);
    const countAtInstall = Number(plugin.model.totalNumber);

    function dropNodes(nodes) {
        // ST's clearEntryList() destroys Select2 on evicted native forms.
        // Follow that cleanup only when a detached page is truly discarded;
        // retaining pages must NOT destroy handlers or duplicate controls.
        nodes.find('select').each(function () {
            const select = jQuery(this);
            if (select.data('select2') && typeof select.select2 === 'function') {
                try { select.select2('destroy'); } catch {}
            }
        });
        nodes.find('.inline-drawer').off('inline-drawer-toggle');
        nodes.remove();
    }
    function cleanCache() {
        for (const { nodes } of cached.values()) dropNodes(nodes);
        cached.clear();
    }
    function invalidate() {
        cleanCache();
        dirty = false;
    }
    function dispose() {
        if (disposed) return;
        disposed = true;
        cleanCache();
        // pagination.js has no removeHook API; remove ONLY our own callback
        // from its documented plugin data, not other extensions' hooks.
        // Without this, repeated edits/saves could accumulate no-op closures.
        const hooks = plugin.hooks?.beforePaging;
        if (Array.isArray(hooks)) {
            const index = hooks.indexOf(onBeforePaging);
            if (index >= 0) hooks.splice(index, 1);
        }
        if (plugin.slbPageCache === session) delete plugin.slbPageCache;
    }
    function currentPageFitsData() {
        const rows = list.children('.world_entry');
        const items = plugin.currentPageData;
        if (!Array.isArray(items) || !rows.length || rows.length !== items.length
            || rows.length > maxRows) return false;
        return rows.toArray().every((row, index) => {
            const uid = row.dataset?.uid ?? row.getAttribute('uid');
            return String(uid) === String(items[index]?.uid)
                && row.dataset.slbDisplayReady === 'true'
                && row.dataset.slbHeaderEnhanced;
        });
    }
    function stash(page) {
        const nodes = list.children().detach();
        cached.delete(page);
        cached.set(page, { nodes });
        while (cached.size > maxPages) {
            const oldest = cached.keys().next().value;
            dropNodes(cached.get(oldest).nodes);
            cached.delete(oldest);
        }
    }
    const session = {
        book, list: listNode, paginationData: plugin,
        get disposed() { return disposed; },
        dispose, invalidate,
        markDirty() { dirty = true; cleanCache(); },
        get cachedPageCount() { return cached.size; },
    };
    plugin.slbPageCache = session;
    function onBeforePaging(pageNumber) {
        if (disposed || restoring) return true;
        if (pagination.data('pagination') !== plugin) {
            dispose();
            return true;
        }
        if (plugin.hooks?.beforePaging?.length > 1) {
            invalidate();
            return true;
        }
        const next = Number(pageNumber);
        const current = Number(plugin.model.pageNumber);
        let sameContext = false;
        try {
            sameContext = isAllowed()
                && signature() === cacheStamp
                && Number(plugin.model.pageSize) === sizeAtInstall
                && Number(plugin.model.totalNumber) === countAtInstall
                && !dirty;
        } catch {
            // An extension may replace a settings element during a click.
            // Never block SillyTavern's native rendering in that case.
            sameContext = false;
        }
        if (!sameContext || !Number.isInteger(current) || !Number.isInteger(next)
            || next === current || next < 1 || !currentPageFitsData()) {
            invalidate();
            return true; // Native rendering when context changed or page isn't ready.
        }
        // Before ST's callback clears every option/editor, detach native rows
        // so its clearEntryList() finds an empty list and cannot destroy them.
        const target = cached.get(next);
        if (target) cached.delete(next);
        stash(current);
        if (!target) return true; // First visit: ST owns full page generation.

        // pagination.js supports a custom callback argument for go(). This
        // updates its current page, controls and currentPageData while *only*
        // the cached DOM is restored. The native render callback is skipped.
        restoring = true;
        try {
            let restored = false;
            // pagination.js' jQuery string wrapper drops a third callback
            // argument. Pass [page, callback] through the existing plugin
            // event instead so the ST render callback is really skipped.
            pagination.trigger('__pagination-go', [next, () => {
                // The current page was already safely detached above.
                list.append(target.nodes);
                restored = true;
                // Do not re-enhance/replace native editor fields or handlers.
            }]);
            // An incompatible pagination.js plugin must not leave the current
            // list empty or suppress SillyTavern's native page rendering.
            if (!restored || Number(plugin.model.pageNumber) !== next) {
                dropNodes(target.nodes);
                invalidate();
                return true;
            }
        } catch (error) {
            // Fall back visibly to the original page instead of leaving the
            // entire manager empty if a future pagination API is incompatible.
            const old = cached.get(current);
            if (old) {
                cached.delete(current);
                list.append(old.nodes);
            }
            dropNodes(target.nodes);
            invalidate();
            throw error; // No silent success on a broken native paging API.
        } finally {
            restoring = false;
        }
        return false; // Cancel the outer native render; the inner go is complete.
    }
    pagination.addHook('beforePaging', onBeforePaging);
    return session;
}
