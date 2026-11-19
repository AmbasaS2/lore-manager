const {test}=require('node:test');
const assert=require('node:assert/strict');
const {readFileSync}=require('node:fs');
const {join}=require('node:path');
const css=readFileSync(join(__dirname,'../style.css'),'utf8');
test('pagination row does not grow its search control when page label expands',()=>{
 assert.match(css, /@media \(max-width: 600px\)/);
 assert.match(css, /#WorldInfo\.slb-active #world_popup > \.flex-container:has\(#world_info_pagination\)/);
 assert.match(css, /#WorldInfo\.slb-active #slb-search-sort\s*\{[^}]*flex:\s*0 1 82px/s);
 assert.match(css, /#WorldInfo\.slb-active #world_info_pagination\s*\{[^}]*flex:\s*0 0 auto/s);
});
test('normal and narrow views preserve native sort/search/pagination nodes and bindings',()=>{
 const src=readFileSync(join(__dirname,'../native-controls.js'),'utf8');
 assert.match(src, /search\.before\(group\)/);
 assert.match(src, /group\.append\(search\)/);
 assert.match(src, /control\.append\(sort\)/);
 const runtime=readFileSync(join(__dirname,'../index.js'),'utf8');
 assert.match(runtime,/document\.getElementById\('world_refresh'\)/);
});
