// Evaluate after browser-fixture.js + reload, in an isolated browser test origin.
(async()=>{
  const $=id=>document.getElementById(id), checks=[];
  const assert=(value,label)=>{if(!value)throw Error(label);checks.push(label);};
  const wait=async predicate=>{
    for(let i=0;i<200;i++){if(predicate())return;await new Promise(resolve=>setTimeout(resolve,20));}
    throw Error('local revision test timed out');
  };
  const file=path=>[...document.querySelectorAll('.fileRow')].find(row=>row.dataset.path===path);
  const folder=path=>[...document.querySelectorAll('.folderRow')].find(row=>row.dataset.path===path);
  const edit=text=>{const editor=$('editor');editor.value=text;editor.dispatchEvent(new Event('input',{bubbles:true}));};
  const root=await navigator.storage.getDirectory();
  const home=await root.getDirectoryHandle('SQL 演示工作区');
  const suffix=Date.now(), before=`待改名-${suffix}`, after=`已改名-${suffix}`;
  const old=await home.getDirectoryHandle(before,{create:true});
  const sub=await old.getDirectoryHandle('子目录',{create:true});
  await sub.getDirectoryHandle('空目录',{create:true});
  const neighbor=await home.getDirectoryHandle(`${before}-相邻`,{create:true});
  const collision=await home.getDirectoryHandle(`同名-${suffix}`,{create:true});
  for(const [directory,name,text] of [[old,'a.sql','-- 注释\nSELECT 1;\n'],[sub,'b.sql','SELECT 2;\n'],[old,'附件.bin',new Uint8Array([0,255,1])],[neighbor,'neighbor.sql','SELECT 3;']]){
    const handle=await directory.getFileHandle(name,{create:true});const writer=await handle.createWritable();await writer.write(text);await writer.close();
  }
  const originalPicker=window.showDirectoryPicker;
  window.showDirectoryPicker=async()=>old;
  $('manageWorkspaces').click();$('addWorkspace').click();
  await wait(()=>$('manageWorkspaces').textContent.includes(before));
  assert(!$('workspaceDialog').open,'adding an overlapping workspace closes manager');
  window.showDirectoryPicker=originalPicker;
  await wait(()=>file('a.sql'));
  file('a.sql').click();await wait(()=>$('fileTitle').textContent==='a.sql');
  edit('SELECT 777;\n');
  $('manageWorkspaces').click();
  [...document.querySelectorAll('#workspaceList .workspace button')].find(b=>b.textContent.includes('SQL 演示工作区')).click();
  await wait(()=>$('manageWorkspaces').textContent.includes('SQL 演示工作区') && !$('workspaceDialog').open);
  $('refreshFiles').click();await wait(()=>folder(before));
  folder(before).querySelector('.folderPick').click();await wait(()=>file(`${before}/a.sql`));
  file(`${before}/a.sql`).click();await wait(()=>$('filePath').title===`SQL 演示工作区 / ${before}/a.sql`);
  edit('-- 注释\nSELECT 100;\n');
  if(!$('favoriteFile').textContent.includes('已收藏'))$('favoriteFile').click();
  folder(`${before}/子目录`).querySelector('.folderPick').click();await wait(()=>file(`${before}/子目录/b.sql`));
  file(`${before}/子目录/b.sql`).click();await wait(()=>$('fileTitle').textContent==='b.sql');
  edit('SELECT 200;\n');
  folder(before).querySelector('.folderRename').click();
  await wait(()=>document.querySelector('input[aria-label="新目录名称"]'));
  let input=document.querySelector('input[aria-label="新目录名称"]');input.value=`同名-${suffix}`;
  input.closest('dialog').querySelector('.primary').click();await wait(()=>$('status').textContent.includes('已存在') && !document.querySelector('main').inert);
  assert(!!folder(before) && $('status').textContent.includes('已存在'),'rename collision keeps source and reports failure');
  folder(before).querySelector('.folderRename').click();
  await wait(()=>document.querySelector('input[aria-label="新目录名称"]'));
  input=document.querySelector('input[aria-label="新目录名称"]');input.value=after;
  input.closest('dialog').querySelector('.primary').click();await wait(()=>folder(after) && !document.querySelector('main').inert);
  assert(!folder(before),'renamed directory replaces old tree entry');
  assert($('editor').value==='SELECT 200;\n' && $('filePath').textContent.includes(after),'active dirty tab follows renamed subdirectory');
  const moved=await home.getDirectoryHandle(after);
  const bin=new Uint8Array(await (await (await moved.getFileHandle('附件.bin')).getFile()).arrayBuffer());
  assert(bin.join(',')==='0,255,1','unsupported binary file copied byte-for-byte');
  assert(!!await (await moved.getDirectoryHandle('子目录')).getDirectoryHandle('空目录'),'empty nested folder preserved');
  let oldExists=true;try{await home.getDirectoryHandle(before);}catch(e){if(e.name==='NotFoundError')oldExists=false;else throw e;}
  assert(!oldExists,'source removed only after checked migration');
  assert(!!await neighbor.getFileHandle('neighbor.sql'),'same-prefix sibling untouched');
  [...$('editorTabs').querySelectorAll('.editorTab > button:first-child')].find(b=>b.title.startsWith('SQL 演示工作区 / ') && b.textContent.includes('a.sql')).click();
  assert($('editor').value==='-- 注释\nSELECT 100;\n' && $('filePath').textContent.includes(after),'inactive dirty tab follows renamed directory');
  $('save').click();await wait(()=>!document.querySelector('main').inert);
  assert((await (await (await moved.getFileHandle('a.sql')).getFile()).text()).includes('100'),'save uses handle under new directory');
  document.querySelector('[data-view="favorites"]').click();
  assert($('collectionList').textContent.includes(after) && !$('collectionList').textContent.includes(before+'/'),'favorite path remapped');
  document.querySelector('[data-view="recent"]').click();
  assert($('collectionList').textContent.includes(after),'recent path remapped');
  const nestedTab=[...$('editorTabs').querySelectorAll('.editorTab > button:first-child')].find(b=>b.title.startsWith(after+' / '));
  assert(!!nestedTab,'overlapping workspace name and tab rebound to renamed root');
  nestedTab.click();assert($('editor').value==='SELECT 777;\n','overlapping workspace retains dirty draft');
  $('save').click();await wait(()=>!document.querySelector('main').inert || document.querySelector('.conflictDialog[open]'));
  // The disk was changed through the parent tab, so choose overwrite only in this isolated fixture.
  if(document.querySelector('.conflictDialog[open]')) {
    [...document.querySelector('.conflictDialog').querySelectorAll('button')].find(b=>b.textContent.includes('覆盖')).click();
    await wait(()=>!document.querySelector('main').inert);
  }

  document.querySelector('[data-view="files"]').click();
  const initial=$('toggleNavigation').getAttribute('aria-expanded');
  $('toggleNavigation').click();
  assert(!$('toggleNavigation').textContent.trim() && $('toggleNavigation').title.includes('显示') && $('toggleNavigation').getAttribute('aria-expanded')==='false','directory toggle clearly describes next action');
  $('toggleNavigation').click();assert($('toggleNavigation').getAttribute('aria-expanded')===initial,'directory toggle restores panel');
  // Successful new-folder authorization closes manager, without opening any user directory.
  const picker=window.showDirectoryPicker;
  const added=await root.getDirectoryHandle(`新工作区-${suffix}`,{create:true});
  window.showDirectoryPicker=async()=>added;
  $('manageWorkspaces').click();$('addWorkspace').click();
  await wait(()=>$('manageWorkspaces').textContent.includes(added.name));
  assert(!$('workspaceDialog').open,'new workspace closes manager');
  window.showDirectoryPicker=picker;
  // Denied access keeps manager open; a granted recovery closes it.
  const proto=FileSystemDirectoryHandle.prototype;
  const query=proto.queryPermission, request=proto.requestPermission;let grant=false;
  proto.queryPermission=async function(options){return this.name===added.name ? (grant?'granted':'denied') : query.call(this,options);};
  proto.requestPermission=async function(options){if(this.name===added.name){grant=true;return 'granted';}return request.call(this,options);};
  try {
    $('manageWorkspaces').click();
    [...document.querySelectorAll('#workspaceList .workspace button')].find(b=>b.textContent.includes(added.name)).click();
    await wait(()=>$('workspaceList').querySelector('.grant'));
    assert($('workspaceDialog').open,'denied workspace keeps manager open for recovery');
    $('workspaceList').querySelector('.grant').click();
    await wait(()=>!$('workspaceDialog').open);
    assert(grant,'grant recovery closes manager');
  } finally {proto.queryPermission=query;proto.requestPermission=request;}
  return {passed:checks.length,checks};
})()
