// Evaluate in an isolated Edge test origin after browser-fixture.js and reload.
(async () => {
  const $ = id => document.getElementById(id);
  const pause = () => new Promise(resolve => requestAnimationFrame(resolve));
  const wait = async predicate => {
    for (let i=0;i<160;i++) { if (predicate()) return; await new Promise(resolve=>setTimeout(resolve,20)); }
    throw Error('performance fixture timed out');
  };
  const open = async name => {
    document.querySelector(`.fileRow[data-path="${name}"]`).click();
    await wait(()=>$('fileTitle').textContent===name);
  };
  await open('医嘱查询.sql');
  const editor=$('editor');
  const savedText=editor.value;
  // 120KB, representative of the files behind the previous performance report.
  editor.value='-- 中文注释 SELECT x\nSELECT patient_id FROM orders;\n'.repeat(2400);
  editor.dispatchEvent(new Event('input',{bubbles:true}));
  await new Promise(resolve=>setTimeout(resolve,180));
  let tabReplacements=0, treeReplacements=0, hiddenFrames=0;
  const observer=new MutationObserver(records=>{
    for(const record of records) {
      if(record.target===$('editorTabs')) tabReplacements++;
      if(record.target===$('fileList')) treeReplacements++;
    }
  });
  observer.observe($('editorTabs'),{childList:true});observer.observe($('fileList'),{childList:true});
  const samples=[];
  for(let i=0;i<60;i++) {
    editor.value+='a';
    editor.setSelectionRange(editor.value.length,editor.value.length);
    const start=performance.now();editor.dispatchEvent(new Event('input',{bubbles:true}));
    samples.push(performance.now()-start);
    await pause();
    if(getComputedStyle($('highlight')).visibility==='hidden') hiddenFrames++;
  }
  await pause();
  const typingTabReplacements=tabReplacements;
  editor.value=savedText;editor.dispatchEvent(new Event('input',{bubbles:true}));
  await open('费用核对.sql');
  for(let i=0;i<16;i++) {
    const name=i%2===0?'医嘱查询.sql':'费用核对.sql';
    [...$('editorTabs').querySelectorAll('.editorTab > button:first-child')].find(b=>b.textContent.includes(name)).click();
    await pause();
  }
  observer.disconnect();samples.sort((a,b)=>a-b);
  return {inputP50ms:+samples[30].toFixed(2),inputP95ms:+samples[57].toFixed(2),typingTabReplacements,tabReplacements,treeReplacements,hiddenHighlightFrames:hiddenFrames};
})()
