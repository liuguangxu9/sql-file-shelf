// Isolated OPFS test origin only. Seed fixture, activate v39, set browser offline, reload, then evaluate.
(async()=>{
  const checks=[],assert=(value,label)=>{if(!value)throw Error(label);checks.push(label);};
  assert(navigator.onLine===false,'browser is offline');
  assert(!!document.querySelector('link[href="./workbench.css?v=39"]'),'updated shell loads framework CSS');
  assert(getComputedStyle(document.querySelector('.app')).borderRadius==='12px','framework styling is present offline');
  const cache=await caches.open('sql-file-shelf-v39');
  for(const resource of ['./app.js?v=39','./workbench.css?v=39','./app.css?v=39','./codec-worker.js?v=39'])assert(!!await cache.match(resource),resource+' is precached');
  const root=await navigator.storage.getDirectory(),directory=await root.getDirectoryHandle('SQL 演示工作区');
  const handle=await directory.getFileHandle('离线大文件.sql',{create:true});
  const expected='-- 大文件\n'+'SELECT 1;\r\n'.repeat(30000),writer=await handle.createWritable();await writer.write(expected);await writer.close();
  const $=id=>document.getElementById(id),wait=async predicate=>{for(let i=0;i<500;i++){if(predicate())return;await new Promise(r=>setTimeout(r,20));}throw Error('offline timeout');};
  $('manageWorkspaces').click();[...document.querySelectorAll('#workspaceMenuList button')].find(b=>b.textContent.includes('SQL 演示工作区')).click();
  await wait(()=>$('workspaceName').textContent==='SQL 演示工作区');
  $('refreshFiles').click();await wait(()=>document.querySelector('.fileRow[data-path="离线大文件.sql"]'));
  document.querySelector('.fileRow[data-path="离线大文件.sql"]').click();await wait(()=>$('fileTitle').textContent==='离线大文件.sql');
  assert($('editor').value===expected.replace(/\r\n/g,'\n'),'offline worker decodes a file larger than 256KB with textarea newline normalization');
  assert(document.querySelector('.editorShell').classList.contains('plainEditor'),'large file falls back to responsive plain text');
  return {passed:checks.length,checks};
})()
