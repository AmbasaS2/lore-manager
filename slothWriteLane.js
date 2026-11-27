// Copyright (C) 2026 AmbasaS2
// SPDX-License-Identifier: AGPL-3.0-only
// Shared, optional same-page protocol. Each extension can run independently.
// Does not claim to lock native writes or a different browser/device.
const laneSymbol = Symbol.for('sloth.worldinfo.write-lanes.v1');
export async function withSlothLorebookWriteLane(name, task) {
    const lanes = globalThis[laneSymbol] ??= new Map();
    const key = String(name);
    const previous = lanes.get(key) || Promise.resolve();
    const run = previous.catch(() => {}).then(task);
    const tail = run.catch(() => {}).finally(() => {
        if (lanes.get(key) === tail) lanes.delete(key);
    });
    lanes.set(key, tail);
    return run;
}
