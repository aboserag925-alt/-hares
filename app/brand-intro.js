(function(){
  'use strict';
  var reduce=window.matchMedia&&window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var scriptUrl=document.currentScript&&document.currentScript.src;
  var key='haress-brand-intro-seen';
  try{if(reduce||sessionStorage.getItem(key)==='1')return;sessionStorage.setItem(key,'1');}catch(_){if(reduce)return;}
  function show(){
    if(!document.body||document.querySelector('.haress-intro'))return;
    var logoUrl=new URL('../assets/brand-mark-light.svg',scriptUrl||location.href).href;
    var layer=document.createElement('div');
    layer.className='haress-intro';
    layer.setAttribute('role','presentation');
    layer.innerHTML='<div class="haress-intro__content"><span class="haress-intro__halo" aria-hidden="true"></span><img class="haress-intro__logo" alt="" src="'+logoUrl+'"><div class="haress-intro__name">حارس</div><div class="haress-intro__tag">لأن المعرفة أمانة</div><span class="haress-intro__rule" aria-hidden="true"></span></div>';
    document.body.appendChild(layer);
    window.setTimeout(function(){layer.classList.add('is-leaving');},1450);
    window.setTimeout(function(){if(layer.parentNode)layer.parentNode.removeChild(layer);},2100);
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',show,{once:true});else show();
})();