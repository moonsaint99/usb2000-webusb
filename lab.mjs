import {USB2000} from './usb2000.mjs?v=20260929-framing';
import {workflow} from './workflow.mjs?v=20260929-guided';
import {snapshot,plot} from './plot.mjs?v=20260929-images';
const minimumMs=()=>instrument.device?.opened?instrument.minMs:1;
const sliderMs=position=>Math.round(minimumMs()*(500/minimumMs())**(Number(position)/1000));
const sliderPosition=ms=>Math.round(1000*Math.log(ms/minimumMs())/Math.log(500/minimumMs()));
const $=id=>document.getElementById(id),instrument=new USB2000();
let data=null,running=false,busy=false,pending=false,usable=false;
let darkImage=null,referenceImage=null,retake=null;
const view=()=>workflow($('mode').value,instrument.dark,instrument.reference,retake);
function updateIntegration(ms=sliderMs($('ms').value)){
 const minimum=minimumMs();
 const selected=Math.max(minimum,Math.min(500,ms));
 if(selected!==ms)$('ms').value=sliderPosition(selected);
 $('ms-value').textContent=`${selected} ms`;
 $('ms').setAttribute('aria-valuetext',`${selected} milliseconds`);
 $('ms').title=`${minimum}–500 ms, logarithmic scale`;
 return selected;
}
$('ms').oninput=()=>updateIntegration();
let imageIndex=0;
function gallery(){const items=[...$("captures").children];items.forEach((item,i)=>item.hidden=i!==imageIndex);$("image-count").textContent=items.length?`${imageIndex+1} / ${items.length}`:"0 / 0";$("previous").disabled=imageIndex<=0;$("next").disabled=imageIndex>=items.length-1;}
$("previous").onclick=()=>{imageIndex--;gallery();};$("next").onclick=()=>{imageIndex++;gallery();};
function note(text=''){$('warning').textContent=text.message??text;}
function controls(){const connected=!!instrument.device?.opened;
 for(const id of ['live','restart'])$(id).disabled=!connected||busy||pending;
 $('ms').disabled=!connected||pending;
 $('connect').disabled=connected||busy||pending;$('disconnect').disabled=!connected||busy||pending;
 const state=view();
 for(const [key,stored] of [['d',instrument.dark],['w',instrument.reference]]){
  $('retake-'+key).hidden=!stored;
  $('retake-'+key).disabled=busy||pending||!connected;
 }
 $('cancel-retake').hidden=!retake;
 $('cancel-retake').disabled=busy||pending;
 $('mode').disabled=pending;
 $('capture').disabled=!data||!usable||busy||pending||(state.stage==='s'&&!data.reflectance);
 $('capture').textContent=state.capture;
 $('restart').disabled=!connected||busy||pending||(!instrument.dark&&!instrument.reference);
 $('reference-guide').hidden=$('spectrum-steps').hidden=state.stage==='raw';
 if(state.stage!=='raw'){$('stage-title').textContent=state.title;$('stage-instruction').textContent=state.instruction;}
 $('live').textContent=running?'Pause':'Resume';
 $('calibration').textContent=`D: ${instrument.dark?'stored':'not stored'}. W: ${instrument.reference?'stored':'not stored'}.`;
}
function draw(){
 const state=view(),label=$('label').value||'Sample',auto=$('auto').checked;
 let large=null;if(data&&data[state.plotMode])large=snapshot(data,state.plotMode,state.stage==='d'?'D · Dark':state.stage==='w'?'W · White reference':label,auto);
 plot($('plot'),large);
 if(state.stage!=='raw'){
  const live=data?snapshot(data,'raw',state.stage==='d'?'D · Dark':state.stage==='w'?'W · White reference':'S · '+label,auto):null;
  for(const [key,stored] of [['d',instrument.dark?darkImage:null],['w',instrument.reference?referenceImage:null],['s',null]]){
   const active=key===state.stage,locked=!active&&!stored;
   $('step-'+key).className='spectrum-step'+(active?' active':locked?' locked':'');
   $('state-'+key).textContent=active?(running?'Live':'Paused'):stored?'Stored':'Waiting';
   plot($('plot-'+key),active?live:stored);
  }
 }
 controls();
}
function show(s){data=s;usable=true;$('status').textContent=`${s.model} ${s.serial} — ${s.integration_ms} ms`;$('peak').textContent=`Maximum: ${Math.max(...s.raw).toFixed(0)} counts`;note(s.saturated?'Signal saturated. Shorten integration time.':'');draw();}
function fail(e){running=false;usable=false;note(e);controls();}
async function refresh(){if(busy||pending||!instrument.device)return;busy=true;try{show(await instrument.scan());}catch(e){fail(e);}finally{busy=false;controls();}}
async function action(fn){if(pending)return;pending=true;controls();while(busy)await new Promise(r=>setTimeout(r,20));busy=true;try{note();await fn();}catch(e){fail(e);}finally{pending=false;busy=false;controls();}}
function addImage(s){const canvas=document.createElement('canvas');canvas.width=1200;canvas.height=900;plot(canvas,s);
 const url=canvas.toDataURL('image/png'),figure=document.createElement('figure'),img=document.createElement('img'),caption=document.createElement('figcaption'),save=document.createElement('a');
 img.src=url;img.alt=`${s.label}, ${s.ms} ms, ${s.mode==='raw'?'detector counts':'relative reflectance'} versus wavelength`;
 caption.textContent=`${s.label} (${s.ms} ms) `;save.href=url;save.download=(s.label.replace(/[^a-z0-9_-]+/gi,'_')||'spectrum')+'_'+Date.now()+'.png';save.textContent='Save image';caption.append(save);figure.append(img,caption);$('captures').prepend(figure);$('empty').hidden=true;imageIndex=0;gallery();
}
$('connect').onclick=async()=>{if(!navigator.usb){note('Open this page in Chrome or Edge.');return;}
 try{const selected=await navigator.usb.requestDevice({filters:[{vendorId:0x2457,productId:0x1002},{vendorId:0x2457,productId:0x101e}]});await action(async()=>{retake=null;await instrument.open(selected);$('ms').value=sliderPosition(instrument.ms);updateIntegration(instrument.ms);running=true;show(await instrument.scan());});}catch(e){if(e.name!=='NotFoundError')note(e);}
};
$('disconnect').onclick=()=>action(async()=>{running=false;retake=null;await instrument.close();$('ms').value=sliderPosition(10);updateIntegration();data=null;usable=false;$('status').textContent='Not connected';$('peak').textContent='';draw();});
$('live').onclick=()=>{running=!running;draw();};
$('ms').onchange=()=>{
 const ms=updateIntegration();
 if(!instrument.device?.opened||ms===instrument.ms)return;
 // The change event commits on release; input only updates the displayed value.
 return action(async()=>{await instrument.setExposure(ms);retake=null;data=null;usable=false;show(await instrument.scan());});
};
for(const key of ['d','w'])$('retake-'+key).onclick=()=>{retake=key;running=true;note();draw();};
$('cancel-retake').onclick=()=>{retake=null;draw();};
$('restart').onclick=()=>action(async()=>{
 instrument.dark=instrument.reference=null;darkImage=referenceImage=null;retake=null;
 data=null;usable=false;running=true;show(await instrument.scan());
});
$('capture').onclick=()=>action(async()=>{
 if(!data||!usable)throw Error('Acquire a spectrum first.');
 const state=view();
 if(state.stage==='d'||state.stage==='w'){
  const kind=state.stage==='d'?'dark':'reference';
  await instrument.capture(kind);
  const captured={wavelength:instrument.wavelength,raw:instrument[kind],max_counts:instrument.ceiling,integration_ms:instrument.ms,serial:instrument.serial,model:instrument.model,time:new Date().toISOString()};
  const saved=snapshot(captured,'raw',state.stage==='d'?'D · Dark (5-scan average)':'W · White reference (5-scan average)',$('auto').checked);
  if(state.stage==='d')darkImage=saved;else referenceImage=saved;
  addImage(saved);retake=null;running=true;show(await instrument.scan());
 }else{
  addImage(snapshot(data,state.plotMode,$('label').value||'Sample',$('auto').checked));
 }
});
$('mode').onchange=()=>{retake=null;note();if(instrument.device?.opened)running=true;draw();};$('auto').onchange=draw;$('label').oninput=draw;
instrument.onlog=()=>{$('log').textContent=instrument.trace.join('\n');};
navigator.usb?.addEventListener('disconnect',e=>{if(e.device===instrument.device){running=false;retake=null;instrument.device=null;$('ms').value=sliderPosition(10);updateIntegration();instrument.dark=instrument.reference=instrument.latest=null;data=null;usable=false;$('status').textContent='Disconnected';$('peak').textContent='';note('Reconnect the spectrometer and retake the dark and reference.');draw();}});
if(!navigator.usb)note('Open this page in Chrome or Edge.');draw();
async function loop(){if(running)await refresh();setTimeout(loop,350);}loop();
