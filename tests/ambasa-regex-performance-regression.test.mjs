import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { performance } from 'node:perf_hooks';

// Evaluate only the real functions under test, without booting SillyTavern.
const main = readFileSync(new URL('../index.js', import.meta.url), 'utf8');
const batch = readFileSync(new URL('../lore-translation-batch.js', import.meta.url), 'utf8');
const sliceFunction = (src, start, end) => {
    const a = src.indexOf(start);
    const b = src.indexOf(end, a);
    assert.ok(a >= 0 && b > a, start + ' must be present');
    return src.slice(a, b).trim();
};
const cleanAIText = vm.runInNewContext('(' +
    sliceFunction(main, 'function cleanAIText(value) {', '\nfunction getResponseText(') + ')');
const helperStart = main.indexOf('const STRUCTURE_SYMBOL_CHARACTER =');
assert.ok(helperStart >= 0, 'linear symbolic-wrapper matcher must be present');
const helperEnd = main.indexOf('function getStructureLineDescriptor(', helperStart);
assert.ok(helperEnd > helperStart);
const matchSymbolWrapper = vm.runInNewContext(main.slice(helperStart, helperEnd) +
    '\nmatchStructureSymbolicWrapper');
const parseJSONCandidate = vm.runInNewContext('(' +
    sliceFunction(batch, 'function parseJSONCandidate(value) {',
        '\nexport function parseLoreFieldBatchResponse(') + ')');

const triple = String.fromCharCode(96).repeat(3);

function legacyClean(value) {
    let text = String(value ?? '').trim();
    const match = text.match(/^\x60{3}(?:\w+)?\s*([\s\S]*?)\s*\x60{3}$/);
    if (match) text = match[1].trim();
    return text;
}
const legacyWrapper = /^([\p{P}\p{S}]+)\s*(\S(?:[\s\S]*?\S)?)\s*([\p{P}\p{S}]+)$/u;
function legacyBatch(value) {
    const text = String(value ?? '').trim();
    const stripped = text.startsWith(triple)
        ? text.replace(/^\x60{3}(?:json)?\s*\n?/i, '')
              .replace(/\n?\s*\x60{3}$/, '').trim()
        : text;
    let parsed;
    try { parsed = JSON.parse(stripped); }
    catch {
        const first = stripped.indexOf('{');
        const last = stripped.lastIndexOf('}');
        if (first < 0 || last <= first) return null;
        try { parsed = JSON.parse(stripped.slice(first, last + 1)); }
        catch { return null; }
    }
    return !parsed || typeof parsed !== 'object' || Array.isArray(parsed) ? null : parsed;
}
const captures = match => match ? [match[1], match[2], match[3]] : null;

test('fenced AI text and JSON replies preserve valid and malformed outputs', () => {
    const cases = [
        'plain prose',
        triple + 'json\n{"a":"한글"}\n' + triple,
        triple + 'yaml\n- list\n' + triple,
        triple + ' hello ' + triple,
        triple + '\n' + triple,
        triple,
        triple + '   \n',
        triple + 'json\n{"item":"valid"}',
        'Prefix\n' + triple + '{"key":"value"}' + triple,
        '🙂 ' + triple + '\n{"key":1}\n' + triple,
        triple + ' \r\n' + triple + triple,
        '{"a":"b"}',
        '[1,2,3]',
        'noise before {"a":1} noise after'
    ];
    for (const value of cases) {
        assert.equal(cleanAIText(value), legacyClean(value), 'AI source ' + JSON.stringify(value));
        assert.equal(JSON.stringify(parseJSONCandidate(value)),
            JSON.stringify(legacyBatch(value)), 'batch JSON ' + JSON.stringify(value));
    }
});

test('structure symbol matcher preserves exact group captures, including Unicode', () => {
    const inputs = [
        '!!!', '!!a', '!a!', '!a??', '!a \n ?', '!!📍', '🧭hello🧭',
        '「こんにちは」', '((topic))', '【title】', '💛title💛',
        '! '.repeat(4) + '📍', '----x', '👉📚', '?\\n>—📍。'
    ];
    for (const input of inputs) {
        assert.deepEqual(captures(matchSymbolWrapper(input.trim())),
            captures(legacyWrapper.exec(input.trim())), JSON.stringify(input));
    }
    // Every short combination in this alphabet, not only typical UI examples.
    const letters = ['!', '?', 'a', ' ', '\n', '💛'];
    for (let length = 0; length <= 6; length++) {
        const combinations = letters.length ** length;
        for (let n = 0; n < combinations; n++) {
            let current = n;
            let input = '';
            for (let j = 0; j < length; j++) {
                input += letters[current % letters.length];
                current = Math.floor(current / letters.length);
            }
            const text = input.trim();
            assert.deepEqual(captures(matchSymbolWrapper(text)),
                captures(legacyWrapper.exec(text)), 'combination ' + length + ':' + n);
        }
    }
});

test('all three parsers match legacy output on 100k deterministic varied strings', () => {
    const chars = [' ', '\t', '\n', '\r', 'A', 'Z', '1', '_', '?', '!', '(', ')',
        '。', '📍', '한', '💛', 'x', '{', '}', ':', '<', '>', '\u00A0'];
    let seed = 20261123;
    const random = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);
    for (let i = 0; i < 100_000; i++) {
        let input = '';
        const count = Math.floor(random() * 105);
        for (let j = 0; j < count; j++) input += chars[Math.floor(random() * chars.length)];
        if (i % 3 === 0) input = triple + input + triple;
        else if (i % 3 === 1) input = triple + input;
        else input += '?';
        assert.equal(cleanAIText(input), legacyClean(input), 'clean sample ' + i);
        const text = input.trim();
        assert.deepEqual(captures(matchSymbolWrapper(text)),
            captures(legacyWrapper.exec(text)), 'structure sample ' + i);
        if (i % 10 === 0) {
            assert.equal(JSON.stringify(parseJSONCandidate(input)),
                JSON.stringify(legacyBatch(input)), 'batch sample ' + i);
        }
    }
});

test('malformed large responses no longer cause catastrophic matching', () => {
    const examples = [
        ['code fence', () => cleanAIText(triple + ' '.repeat(20_000) + 'X')],
        ['symbol wrapper', () => matchSymbolWrapper('!'.repeat(20_000) + 'X')],
        ['JSON fence', () => parseJSONCandidate(triple + 'json\n{' + ' '.repeat(30_000) + 'X')]
    ];
    for (const [label, run] of examples) {
        const started = performance.now();
        run();
        const elapsed = performance.now() - started;
        assert.ok(elapsed < 500, label + ' took ' + elapsed.toFixed(1) + 'ms');
    }
});
