// UI-only selection helper. This module never saves or changes lorebook links.
export function linkedBooksForCharacter(character, worldSettings, fileName) {
    if (!character) return null;
    const books = new Set();
    const primary = character.data?.extensions?.world;
    if (typeof primary === 'string' && primary.trim()) books.add(primary);
    const entry = Array.isArray(worldSettings?.charLore)
        ? worldSettings.charLore.find(item => item?.name === fileName)
        : null;
    for (const name of Array.isArray(entry?.extraBooks) ? entry.extraBooks : []) {
        if (typeof name === 'string' && name.trim()) books.add(name);
    }
    return books;
}

export function getWorldNameForOption(value, fallbackText, worldNames) {
    if (String(value) === '') return '';
    const index = Number(value);
    return Number.isSafeInteger(index) && index >= 0 && typeof worldNames?.[index] === 'string'
        ? worldNames[index]
        : String(fallbackText ?? '').trim();
}

export function isVisibleWorldOption(value, fallbackText, worldNames, linkedBooks) {
    if (String(value) === '' || linkedBooks === null) return true;
    return linkedBooks.has(getWorldNameForOption(value, fallbackText, worldNames));
}
