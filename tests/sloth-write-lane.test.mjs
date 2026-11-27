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
