const test = require('node:test');
const assert = require('node:assert/strict');
const { renameDirectory, renamedPath } = require('../src/folder-operations');

function directory(name='root', calls=[]) {
  const items=new Map();
  const missing=()=>Object.assign(new Error('Missing'),{name:'NotFoundError'});
  return { kind:'directory',name,items,calls,
    async *entries() { yield* [...items]; },
    async *values() { yield* items.values(); },
    async getDirectoryHandle(child, options={}) {
      if (!items.has(child)) { if(!options.create) throw missing(); items.set(child,directory(child,calls)); }
      if(items.get(child).kind!=='directory') throw new Error('TypeMismatchError');
      return items.get(child);
    },
    async getFileHandle(child, options={}) {
      if(!items.has(child)) {
        if(!options.create) throw missing();
        items.set(child,{kind:'file',name:child,bytes:new Uint8Array(),
          async getFile() { const bytes=this.bytes.slice();return {arrayBuffer:async()=>bytes.buffer}; },
          async createWritable() {
            const file=this;let pending;
            return {async write(bytes){pending=new Uint8Array(bytes);},async close(){file.bytes=pending;}};
          }});
      }
      if(items.get(child).kind!=='file') throw new Error('TypeMismatchError');
      return items.get(child);
    },
    async removeEntry(child, options) {
      calls.push({child,options});const item=items.get(child);
      if(item?.kind==='directory' && item.items.size) throw new Error('Not empty');
      items.delete(child);
    },
  };
}
async function fixture() {
  const root=directory(), source=await root.getDirectoryHandle('old',{create:true});
  const sql=await source.getFileHandle('a.sql',{create:true});sql.bytes=new Uint8Array([0xd6,0xd0,13,10]);
  const nested=await source.getDirectoryHandle('nested',{create:true});
  const binary=await nested.getFileHandle('all.bin',{create:true});binary.bytes=new Uint8Array([0,255,1]);
  await nested.getDirectoryHandle('empty',{create:true});
  return {root,source,sql,binary};
}
test('directory rename preserves binary files, encoding bytes, nested and empty folders without recursive deletion',async()=>{
  const {root}=await fixture();await renameDirectory(root,'old','new');
  assert.equal(root.items.has('old'),false);
  const result=root.items.get('new');
  assert.deepEqual(result.items.get('a.sql').bytes,new Uint8Array([0xd6,0xd0,13,10]));
  assert.deepEqual(result.items.get('nested').items.get('all.bin').bytes,new Uint8Array([0,255,1]));
  assert.equal(result.items.get('nested').items.get('empty').items.size,0);
  assert.ok(root.calls.every(call=>!call.options?.recursive));
});
test('directory rename rejects file/directory collisions, case-only conflicts and invalid sibling names',async()=>{
  const {root,source}=await fixture();
  await root.getFileHandle('occupied',{create:true});
  for(const name of ['occupied','OLD']) await assert.rejects(renameDirectory(root,'old',name),/已存在/);
  for(const name of ['../other','C:\\other','..','CON','trailing.','a\0b'])
    await assert.rejects(renameDirectory(root,'old',name),/目录名/);
  assert.equal(root.items.get('old'),source);assert.equal(root.calls.length,0);
});
test('copy verification failure leaves every original file untouched',async()=>{
  const {root,source}=await fixture();const get=root.getDirectoryHandle.bind(root);
  root.getDirectoryHandle=async(name,options)=>{
    const dir=await get(name,options);
    if(name==='new') {
      const getFile=dir.getFileHandle.bind(dir);
      dir.getFileHandle=async(...args)=>{
        const file=await getFile(...args);file.createWritable=async()=>({async write(){},async close(){file.bytes=new Uint8Array([9]);}});return file;
      };
    }
    return dir;
  };
  await assert.rejects(renameDirectory(root,'old','new'),/校验失败/);
  assert.equal(root.items.get('old'),source);assert.equal(root.calls.length,0);
});
test('changes or new content during copy abort before removing originals',async()=>{
  for(const change of ['edit','new']) {
    const {root,source,sql}=await fixture();
    await assert.rejects(renameDirectory(root,'old','new',()=>{
      if(change==='edit') sql.bytes=new Uint8Array([7,8]);
      else source.items.set('arrived.txt',{kind:'file',name:'arrived.txt'});
    }),/发生变化|新内容/);
    assert.equal(root.calls.length,0);assert.equal(root.items.get('old'),source);
  }
});
test('interrupted source removal keeps a complete destination and leaves remaining originals',async()=>{
  const {root,source}=await fixture();
  const nested=source.items.get('nested');nested.removeEntry=async()=>{throw Error('access denied');};
  await assert.rejects(renameDirectory(root,'old','new'),/access denied/);
  assert.ok(root.items.get('new').items.get('a.sql'));
  assert.ok(root.items.get('new').items.get('nested').items.get('all.bin'));
  assert.ok(source.items.get('nested').items.get('all.bin'));
});
test('path remap is scoped to the renamed directory, never a same-prefix sibling',()=>{
  assert.equal(renamedPath('a/b.sql','a','c'),'c/b.sql');
  assert.equal(renamedPath('a','a','c'),'c');
  assert.equal(renamedPath('ab/b.sql','a','c'),'ab/b.sql');
});
