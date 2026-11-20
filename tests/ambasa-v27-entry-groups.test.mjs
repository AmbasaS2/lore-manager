import test from 'node:test';
import assert from 'node:assert/strict';
import {
    planLoreEntryGroups, buildLoreEntryGroupPrompt,
    parseLoreEntryGroupResponse, translateLoreEntryGroup,
} from '../lore-entry-batch.js';

const example = (i, options = {}) => ({
    id:String(i),targetLanguage:options.language || 'Korean',
    fields:options.fields || ['content'],
    sources:{content:options.text || ('Remus and Catherine visited room '+i+'.'),
        comment:'1981/10/18 | The Corridor',key:'Remus, Catherine',keysecondary:''},
});
const sampleAnswer = prompt => {
    const input=JSON.parse(prompt.split('=== SOURCE ENTRY JSON ===\n')[1]);
    const entries={};
    for(const [id,item] of Object.entries(input.entries)){
        entries[id]={sourceTag:item.sourceTag};
        for(const [field,text] of Object.entries(item.fields)){
            entries[id][field]=text.replace('Remus and Catherine visited room','리무스와 캐서린은 방에 갔다')
                .replace('The Corridor','복도').replace('Remus, Catherine','리무스, 캐서린');
        }
    }
    return {entries};
};

test('32 short items => ten triples and one pair; 33 => eleven triples; 34 => eleven triples plus one',()=>{
    for(const [size,expected] of [[32,[...Array(10).fill(3),2]],[33,Array(11).fill(3)],[34,[...Array(11).fill(3),1]]]){
        const entries=Array.from({length:size},(_,i)=>example(i));
        const groups=planLoreEntryGroups(entries);
        assert.deepEqual(groups.map(group=>group.length),expected);
        assert.deepEqual(groups.flat().map(item=>item.id),entries.map(item=>item.id));
    }
});

test('long items remain alone and low token budget produces smaller groups',()=>{
    const items=[example(0),example(1,{text:'Long paragraph. '.repeat(600)}),example(2),example(3)];
    assert.deepEqual(planLoreEntryGroups(items).map(g=>g.map(i=>i.id)),[['0'],['1'],['2','3']]);
    const small=Array.from({length:9},(_,i)=>example(i,{text:'Paragraph '.repeat(100)}));
    const groups=planLoreEntryGroups(small,{maxCombinedChars:1500});
    assert.equal(groups.length,9);
    assert.ok(groups.every(g=>g.length===1));
});

test('different target languages never share an AI call',()=>{
    const items=[example(1),example(2,{language:'English'}),example(3,{language:'English'}),example(4)];
    assert.deepEqual(planLoreEntryGroups(items).map(g=>g.map(i=>i.id)),[['1'],['2','3'],['4']]);
});

test('two or three items including metadata share one request and return exact ID+field values',async()=>{
    const items=[example('A',{fields:['content','comment','key']}),example('B',{fields:['content','keysecondary']})];
    const request=[];
    const translations=await translateLoreEntryGroup({
        items,targetLanguage:'Korean',instructions:'Keep character traits and relationship.',
        request:async prompt=>{request.push(prompt);return JSON.stringify(sampleAnswer(prompt))},
        fallback:()=>{throw Error('unexpected recovery request')},
    });
    assert.equal(request.length,1);
    assert.match(request[0],/DIFFERENT lorebook entries/);
    assert.match(request[0],/Keep character traits and relationship/);
    assert.equal(translations.A.error,null);
    assert.equal(translations.B.error,null);
    assert.match(translations.A.results.content,/리무스와 캐서린/);
    assert.equal(translations.A.results.comment,'1981/10/18 | 복도');
    assert.equal(translations.A.results.key,'리무스, 캐서린');
    assert.ok(!Object.hasOwn(translations.A.results,'keysecondary'));
    assert.equal(translations.B.results.keysecondary,undefined);
    assert.equal(Object.keys(translations.B.results).length,1);
});

test('bad source tag and swapped IDs are never accidentally accepted',async()=>{
    const items=[example(0),example(1),example(2)];
    const prompts=[];
    const out=await translateLoreEntryGroup({items,
        request:async prompt=>{
            prompts.push(prompt);
            const s=sampleAnswer(prompt);
            s.entries['0'].sourceTag=s.entries['1'].sourceTag;
            delete s.entries['2'];
            return JSON.stringify({entries:s.entries});
        },
        fallback:async item=>({content:'Fallback '+item.sources.content}),
    });
    assert.equal(prompts.length,1);
    assert.equal(out['0'].results.content,'Fallback '+items[0].sources.content);
    assert.match(out['1'].results.content,/리무스와 캐서린/);
    assert.equal(out['2'].results.content,'Fallback '+items[2].sources.content);
});

test('only damaged keyword field falls back; valid content and other entry stay intact',async()=>{
    const items=[example(0,{fields:['content','key','comment']}),example(1,{fields:['content']})];
    const fallbackCalls=[];
    const result=await translateLoreEntryGroup({items,
        request:async prompt=>{
            const s=sampleAnswer(prompt);
            s.entries['0'].key='리무스 하나'; // source has two keywords
            return JSON.stringify(s);
        },
        fallback:async(item,fields)=>{
            fallbackCalls.push([item.id,fields]);
            return {key:'리무스, 캐서린'};
        },
    });
    assert.deepEqual(fallbackCalls,[['0',['key']]]);
    assert.equal(result['0'].results.key,'리무스, 캐서린');
    assert.match(result['0'].results.content,/리무스와 캐서린/);
    assert.equal(result['0'].results.comment,'1981/10/18 | 복도');
    assert.match(result['1'].results.content,/리무스와 캐서린/);
});

test('failed partial recovery cannot erase other successfully translated entry',async()=>{
    const items=[example(0),example(1),example(2)];
    const result=await translateLoreEntryGroup({items,
        request:async prompt=>{
            const s=sampleAnswer(prompt);
            delete s.entries['1'];
            return JSON.stringify(s);
        },
        fallback:async()=>{throw Error('connection offline')},
    });
    assert.equal(result['0'].error,null);
    assert.equal(result['2'].error,null);
    assert.match(result['0'].results.content,/리무스와 캐서린/);
    assert.equal(result['1'].results.content,undefined);
    assert.match(result['1'].error.message,/connection offline/);
});

test('abort before and after request discards stale entire group without fallback',async()=>{
    const controller=new AbortController();
    const items=[example(0),example(1)];
    controller.abort();
    let calls=0;
    await assert.rejects(translateLoreEntryGroup({
        items,signal:controller.signal,request:async()=>{calls++;return ''},fallback:async()=>{},
    }));
    assert.equal(calls,0);
    const second=new AbortController();
    await assert.rejects(translateLoreEntryGroup({
        items,signal:second.signal,request:async prompt=>{
            second.abort();
            return JSON.stringify(sampleAnswer(prompt));
        },fallback:async()=>{calls++},
    }));
    assert.equal(calls,0);
});

test('unparseable output only retries requested fields; does not map by response order',async()=>{
    const items=[example(0,{fields:['content','comment']}),example(1,{fields:['content']})];
    let groupRequests=0, fallbackRequests=0;
    const out=await translateLoreEntryGroup({items,
        request:async()=>{groupRequests++;return 'Not a JSON response'},
        fallback:async(item,fields)=>{
            fallbackRequests++;
            return Object.fromEntries(fields.map(field=>[field, item.sources[field]]));
        },
    });
    assert.equal(groupRequests,1);
    assert.equal(fallbackRequests,2);
    assert.equal(out['0'].results.content,items[0].sources.content);
    assert.equal(out['0'].results.comment,items[0].sources.comment);
    assert.equal(out['1'].results.content,items[1].sources.content);
});
