const {test}=require('node:test');
const assert=require('node:assert/strict');
const {readFileSync}=require('node:fs');
const {join}=require('node:path');
const {JSDOM}=require('jsdom');
const source=readFileSync(join(__dirname,'../index.js'),'utf8');
const css=readFileSync(join(__dirname,'../style.css'),'utf8');
function extract(name){
    const match=source.match(new RegExp('^function '+name+'\\([^]*?^}', 'm'));
    assert.ok(match,'missing production function '+name);
    return match[0];
}
const helpFunctions=[
    'closeLoreInfoTooltip','dismissLoreHelpOnOutside',
    'showLoreInfoTooltip','bindLoreInfoEvents','addLoreInfoIcon'
].map(extract).join('\n');

test('one shared tooltip serves hover, keyboard and touch without changing checkbox values',()=>{
    const dom=new JSDOM('<div id="WorldInfo"><label id="a">Whole Words<input type="checkbox" id="check-a"></label><label id="b">Group Scoring<input type="checkbox" id="check-b"></label></div>',{runScripts:'outside-only',pretendToBeVisual:true});
    const w=dom.window;
    w.eval('let activeLoreHelpIcon=null,activeLoreHelpTooltip=null;\n' +
        'const createElement=(tag,classes)=>{const n=document.createElement(tag);n.className=classes;return n;};\n' +
        helpFunctions +
        '\nwindow.addIcon=addLoreInfoIcon;window.bind=bindLoreInfoEvents;');
    try{
        const first=w.document.getElementById('a');
        const second=w.document.getElementById('b');
        w.addIcon(first,'First hint with usage example');
        w.addIcon(second,'Second hint with usage example');
        w.bind();w.bind();
        const icons=w.document.querySelectorAll('.slb-lore-info-icon');
        assert.equal(icons.length,2);
        assert.equal(icons[0].hasAttribute('title'),false);
        icons[0].dispatchEvent(new w.Event('pointerover',{bubbles:true}));
        assert.equal(w.document.querySelectorAll('#slb-lore-tooltip').length,1);
        assert.match(w.document.getElementById('slb-lore-tooltip').textContent,/First hint/);
        icons[1].dispatchEvent(new w.Event('pointerover',{bubbles:true}));
        assert.equal(w.document.querySelectorAll('#slb-lore-tooltip').length,1,'one tooltip, not one per row');
        assert.match(w.document.getElementById('slb-lore-tooltip').textContent,/Second hint/);
        icons[1].dispatchEvent(new w.MouseEvent('click',{bubbles:true,cancelable:true}));
        assert.equal(w.document.getElementById('check-b').checked,false,'help cannot toggle checkbox');
        assert.equal(icons[1].getAttribute('aria-describedby'),'slb-lore-tooltip');
        icons[1].dispatchEvent(new w.KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}));
        assert.equal(w.document.getElementById('slb-lore-tooltip'),null);
        icons[0].dispatchEvent(new w.MouseEvent('click',{bubbles:true,cancelable:true}));
        assert.equal(w.document.getElementById('check-a').checked,false);
        w.document.body.dispatchEvent(new w.Event('pointerdown',{bubbles:true}));
        assert.equal(w.document.getElementById('slb-lore-tooltip'),null,'outside tap dismisses help');
    }finally{w.close();}
});

test('tab layout uses a single four-way CSS grid without miniature mobile overrides',()=>{
    assert.match(css,/#WorldInfo\.slb-active \.slb-tabbar\s*\{[^}]*grid-template-columns:\s*repeat\(4, minmax\(0, 1fr\)\)/s);
    assert.doesNotMatch(css,/#WorldInfo\.slb-active \.slb-tab\s*\{[^}]*font-size:\s*0\.8em/s);
    assert.match(css,/min-height:\s*34px/);
    assert.doesNotMatch(css,/font-size:\s*clamp\(8px,\s*2\.25vw,\s*11px\)/);
    assert.match(css,/grid-template-columns:\s*repeat\(auto-fit,\s*minmax\(min\(136px,\s*100%\),\s*1fr\)\)/);
});

test('state badge is not menu_button; CSS is transparent while color semantics remain unchanged',()=>{
    assert.match(source,/createElement\('button', 'slb-mobile-entry-state-badge'\)/);
    assert.match(source,/badge\.classList\.remove\('menu_button'\)/);
    const cssBadge=css.match(/#WorldInfo\.slb-active \.slb-mobile-entry-state-badge \{([^}]+)\}/);
    assert.ok(cssBadge);
    assert.match(cssBadge[1],/background:\s*transparent/);
    assert.match(cssBadge[1],/border:\s*0/);
    assert.match(cssBadge[1],/box-shadow:\s*none/);
    assert.match(css,/\[data-state="constant"\][\s\S]*?color: #428bfa/);
    assert.match(css,/\[data-state="normal"\][\s\S]*?color: #29b765/);
});
