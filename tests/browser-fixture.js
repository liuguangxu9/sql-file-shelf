// Isolated browser test origin only. These files live in OPFS, never user folders.
(async () => {
  const root = await navigator.storage.getDirectory();
  const directory = await root.getDirectoryHandle('SQL 演示工作区', {create:true});
  const other = await root.getDirectoryHandle('第二工作区', {create:true});
  const fixture = [
    [directory,'医嘱查询.sql',"-- 查询住院医嘱\nSELECT order_id, patient_id, order_name\nFROM inpatient_orders\nWHERE status = '有效';\n"],
    [directory,'费用核对.sql',"-- 按患者核对费用\nSELECT patient_id, SUM(amount) AS total\nFROM inpatient_cost\nGROUP BY patient_id;\n"],
    [directory,'参数说明.md','# 查询说明\n所有查询均为示例数据。\n'],
    [other,'GBK测试.sql',new Uint8Array([45,45,32,0xd6,0xd0,0xce,0xc4,13,10,83,69,76,69,67,84,32,49,59,13,10])],
  ];
  for (const [dir,name,content] of fixture) {
    const handle=await dir.getFileHandle(name,{create:true});
    const writer=await handle.createWritable();await writer.write(content);await writer.close();
  }
  const database=await new Promise((resolve,reject)=>{
    const request=indexedDB.open('sql-file-shelf',1);
    request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);
  });
  await new Promise((resolve,reject)=>{
    const tx=database.transaction('settings','readwrite');const store=tx.objectStore('settings');
    store.put([{id:'demo',name:directory.name,handle:directory},{id:'second',name:other.name,handle:other}],'workspaces');
    store.put('demo','activeWorkspaceId');store.put([],'favoriteFiles');store.put([],'recentFiles');
    tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);
  });
  return {seeded:true};
})()
