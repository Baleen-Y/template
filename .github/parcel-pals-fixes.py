from pathlib import Path
root=Path('source/crowbot-parcel-pals')
def change(path,old,new):
    p=root/path; text=p.read_text()
    if old in text:
        assert text.count(old)==1, (path,'ambiguous match')
        p.write_text(text.replace(old,new))
    else:
        assert new in text, (path,'match not found')
change('tests/browser.ts',
"await page.click('#exitPlay');await waitScreen('setup');await page.check('#startReady');await page.click('#start');",
"await page.click('#exitPlay');await waitScreen('setup');await upload();await page.check('#startReady');await page.click('#start');")
change('static/style.css',
'grid-template-columns:repeat(var(--cols),minmax(0,1fr));gap:6px;',
'grid-template-columns:repeat(var(--cols),minmax(0,1fr));grid-template-rows:repeat(var(--rows),minmax(0,1fr));gap:6px;')
change('static/style.css',
'.playMap>.routeBoard{max-width:min(100%,calc((100dvh - 220px)*1.2));width:100%;flex:1;min-height:0;max-height:calc(100dvh - 230px)}',
'.playMap>.routeBoard{width:min(100%,calc((100dvh - 230px) * var(--cols) / var(--rows)));flex:0 0 auto;min-height:0;max-height:calc(100dvh - 230px)}')
change('static/style.css',
'max-width:400px;aspect-ratio:1/1;flex:none',
'max-width:400px;aspect-ratio:var(--cols)/var(--rows);flex:none')
change('static/style.css',
'.artLabel{position:absolute;bottom:10px;right:18px;',
'.artLabel{position:absolute;bottom:22px;left:25%;right:25%;text-align:center;')
change('tests/browser.ts',
"if(mission===1){await page.evaluate(()=>{document.querySelector<HTMLElement>('#playScreen')!.requestFullscreen=()=>Promise.reject(new Error('Denied'));});",
"const cellSizes=await page.locator('#playBoard .tile').evaluateAll((nodes:any[])=>nodes.map(n=>({width:n.getBoundingClientRect().width,height:n.getBoundingClientRect().height})));assert.ok(cellSizes.every((s:any)=>Math.abs(s.width-s.height)<3),'Floor map uses equal square cells');\n   if(mission===1){await page.evaluate(()=>{document.querySelector<HTMLElement>('#playScreen')!.requestFullscreen=()=>Promise.reject(new Error('Denied'));});")
