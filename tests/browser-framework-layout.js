// Isolated OPFS test origin, after fixture and at least one opened file.
(async()=>{
  const $=id=>document.getElementById(id),checks=[],assert=(value,label)=>{if(!value)throw Error(label);checks.push(label);};
  const wait=async predicate=>{for(let i=0;i<100;i++){if(predicate())return;await new Promise(r=>setTimeout(r,20));}throw Error('layout timeout');};
  document.querySelectorAll('[popover]').forEach(menu=>{if(menu.matches(':popover-open'))menu.hidePopover();});
  assert(document.documentElement.scrollWidth<=innerWidth,'page has no horizontal overflow');
  assert(getComputedStyle(document.querySelector('.app')).borderRadius==='12px','shell has four rounded corners');
  assert($('workspaceLocation').tabIndex===0 && $('workspaceLocation').title,'known path is available to keyboard and hover');
  if(matchMedia('(max-width:650px)').matches){
    if($('toggleNavigation').getAttribute('aria-expanded')==='true')$('toggleNavigation').click();
    assert(getComputedStyle(document.querySelector('.editorPanel')).display!=='none','narrow screen can show content');
    assert(getComputedStyle(document.querySelector('.navigation')).display==='none','narrow screen hides navigation in content mode');
    const save=$('save').getBoundingClientRect();assert(save.left>=0&&save.right<=innerWidth,'save remains inside narrow content');
  }else{
    if($('toggleNavigation').getAttribute('aria-expanded')==='false')$('toggleNavigation').click();
    const bar=$('navigationSplitter'),before=Number(bar.getAttribute('aria-valuenow'));
    bar.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowRight',bubbles:true}));
    assert(Number(bar.getAttribute('aria-valuenow'))===before+10,'splitter supports keyboard resizing');
    await wait(()=>bar.getAttribute('aria-valuenow')===String(before+10));
  }
  if(matchMedia('(max-width:650px)').matches && $('toggleNavigation').getAttribute('aria-expanded')==='false')$('toggleNavigation').click();
  $('fileSortButton').click();await new Promise(r=>setTimeout(r,30));
  assert($('fileSortMenu').matches(':popover-open'),'sort menu enters top layer');
  const menuBox=$('fileSortMenu').getBoundingClientRect();assert(menuBox.left>=0&&menuBox.right<=innerWidth&&menuBox.bottom<=innerHeight,'menu is contained in viewport');
  $('fileSortMenu').dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));
  assert(!$('fileSortMenu').matches(':popover-open')&&document.activeElement===$('fileSortButton'),'menu Escape returns focus');
  if(matchMedia('(max-width:650px)').matches && $('toggleNavigation').getAttribute('aria-expanded')==='true')$('toggleNavigation').click();
  $('encodingButton').click();await new Promise(r=>setTimeout(r,30));assert($('encodingMenu').matches(':popover-open'),'encoding menu uses shared popover');
  $('encodingMenu').dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));
  return {passed:checks.length,checks};
})()
