from pathlib import Path
root=Path('source/crowbot-parcel-pals')
p=root/'static/index.html'
s=p.read_text(); old='<button id="fullscreen" class="quiet">⛶ Fullscreen</button>'; new='<button id="playToolsOpen" class="quiet">Robot help</button>'+old
if 'id="playToolsOpen"' not in s:
    assert old in s;s=s.replace(old,new,1);p.write_text(s)
p=root/'src/main.ts';s=p.read_text()
old="  click('toolsOpen',()=>{$('tools').classList.remove('hidden');$('toolsClose').focus();});click('toolsClose',()=>{$('tools').classList.add('hidden');$('toolsOpen').focus();});"
new="""  const openTools=async():Promise<void>=>{
    if(document.fullscreenElement===$('playScreen'))await document.exitFullscreen();
    $('tools').classList.remove('hidden');$('toolsClose').focus();
  };
  click('toolsOpen',openTools);click('playToolsOpen',openTools);
  click('toolsClose',()=>{$('tools').classList.add('hidden');$(screen==='play'?'playToolsOpen':'toolsOpen').focus();});"""
if old in s:s=s.replace(old,new,1);p.write_text(s)
else:assert "click('playToolsOpen',openTools)" in s
p=root/'tests/browser.ts';s=p.read_text();old="await page.click('#toolsOpen');await page.keyboard.press('ArrowUp');";new="await page.click('#playToolsOpen');await page.keyboard.press('ArrowUp');"
if old in s:s=s.replace(old,new,1);p.write_text(s)
else:assert new in s
