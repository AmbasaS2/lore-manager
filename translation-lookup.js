// Ephemeral lookup only. Stored translations, keys, and save format stay unchanged.
// The first matching record is kept, exactly as Object.values(...).find did.
export function createTranslationFallbackLookup() {
    const indexes = new WeakMap();
    const toKey = (uid, sourceHash, language) =>
        JSON.stringify([String(uid), sourceHash, language]);

    return {
        find(records, uid, sourceHash, language) {
            if (!records || typeof records !== 'object') return null;
            let index = indexes.get(records);
            if (!index) {
                index = new Map();
                for (const record of Object.values(records)) {
                    if (!record || typeof record.sourceHash !== 'string' ||
                        typeof record.language !== 'string') continue;
                    const key = toKey(record.uid, record.sourceHash, record.language);
                    if (!index.has(key)) index.set(key, record);
                }
                indexes.set(records, index);
            }
            return index.get(toKey(uid, sourceHash, language)) ?? null;
        },
        invalidate(records) {
            if (records && typeof records === 'object') indexes.delete(records);
        },
    };
}
