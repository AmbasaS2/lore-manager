import test from 'node:test';
import assert from 'node:assert/strict';
import { withSlothLorebookWriteLane as write } from '../slothWriteLane.js';
const secondModule = await import('../slothWriteLane.js?memory-books');
test('manager and memory writer cooperate on the same book without delaying other books', async()=>{
    let release;
    const gate = new Promise(resolve => { release=resolve; });
    const order=[];
    const first = write('book',async()=>{order.push('first');await gate;throw Error('conflict');});
    const second = secondModule.withSlothLorebookWriteLane('book',()=>order.push('second'));
    await write('different',()=>order.push('different'));
    assert.deepEqual(order,['first','different']);
    release();
    await assert.rejects(first,/conflict/);
    await second;
    assert.deepEqual(order,['first','different','second']);
});

const thirdModule = await import('../slothWriteLane.js?ordering');
test('all three Sloth writers serialize same-book updates and preserve every change', async()=>{
    const events=[], book={entries:{0:{content:'old'}},stlo:{budget:100}};
    let release,started;
    const gate = new Promise(resolve=>{release=resolve;});
    const ready = new Promise(resolve=>{started=resolve;});
    const memory = secondModule.withSlothLorebookWriteLane('shared book',async()=>{
        events.push('memory:start'); started(); await gate;
        book.entries[1]={content:'new memory'}; events.push('memory:end');
    });
    await ready;
    const ordering = thirdModule.withSlothLorebookWriteLane('shared book',()=>{
        events.push('ordering'); assert.equal(book.entries[1].content,'new memory');
        book.stlo.budget=400;
    });
    const manager = write('shared book',()=>{
        events.push('manager'); assert.equal(book.stlo.budget,400);
        book.entries[0].content='edited original';
    });
    await write('unrelated book',()=>events.push('unrelated'));
    assert.deepEqual(events,['memory:start','unrelated']);
    release(); await Promise.all([memory,ordering,manager]);
    assert.deepEqual(events,['memory:start','unrelated','memory:end','ordering','manager']);
    assert.deepEqual(book,{entries:{0:{content:'edited original'},1:{content:'new memory'}},stlo:{budget:400}});
    assert.equal(globalThis[Symbol.for('sloth.worldinfo.write-lanes.v1')].has('shared book'),false);
});
