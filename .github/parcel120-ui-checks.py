from pathlib import Path
p=Path('source/crowbot-parcel-pals/tests/browser.ts')
s=p.read_text()
old="if(id===1)await page.click('#begin');else await page.click('#nextMission');"
new="if(id===1)await page.click('#begin');else if(await page.locator('#nextMission').isVisible())await page.click('#nextMission');else await page.locator('.missionCard').nth(id-1).click();"
assert old in s
s=s.replace(old,new)
old="await shot('parcel-cruise-paused');"
new="""await shot('parcel-cruise-paused');
       await page.setViewportSize({width:700,height:940});await page.waitForTimeout(180);
       const layout=await page.evaluate(()=>{const r=document.querySelector('#playBoard')!.getBoundingClientRect(),p=document.querySelector('#cruisePanel')!.getBoundingClientRect();return{right:r.right,bottom:r.bottom,footerTop:p.top,footerBottom:p.bottom,w:innerWidth,h:innerHeight,scroll:document.documentElement.scrollWidth};});
       assert.ok(layout.right<=layout.w+1&&layout.bottom<=layout.footerTop+1&&layout.footerBottom<=layout.h+1&&layout.scroll<=layout.w+1,JSON.stringify(layout));
       await shot('parcel-cruise-mobile');await page.setViewportSize({width:1440,height:950});await page.waitForTimeout(100);"""
assert old in s
s=s.replace(old,new)
old="await shot('parcel-cruise-finish');await page.click('#cruiseConfirm');"
new="""await shot('parcel-cruise-finish');
     if(mission===3){await page.setViewportSize({width:700,height:940});await page.waitForTimeout(180);const bottom=await page.locator('#cruiseConfirm').boundingBox();assert.ok(bottom&&bottom.y+bottom.height<=940);await shot('parcel-cruise-mobile-finish');await page.setViewportSize({width:1440,height:950});await page.waitForTimeout(100);}
     await page.click('#cruiseConfirm');"""
assert old in s
p.write_text(s.replace(old,new))
