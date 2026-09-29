import {USB2000} from './usb2000.mjs?v=20260929-framing';
import {snapshot,plot} from './plot.mjs?v=20260929-images';
const $=id=>document.getElementById(id),instrument=new USB2000();
let data=null,running=false,busy=false,pending=false,usable=false;
let imageIndex=0;
function gallery(){const items=[...$("captures").children];items.forEach((item,i)=>item.hidden=i!==imageIndex);$("image-count").textContent=items.length?`${imageIndex+1} / ${items.length}`:"0 / 0";$("previous").disabled=imageIndex<=0;$("next").disabled=imageIndex>=items.length-1;}
$("previous").onclick=()=>{imageIndex--;gallery();};$("next").onclick=()=>{imageIndex++;gallery();};
function note(text=''){$('warning').textContent=text.message??text;}
function controls(){const connected=!!instrument.device?.opened;
 for(const id of ['apply','live','dark','reference'])$(id).disabled=!connected||busy||pending;
 $('connect').disabled=connected||busy||pending;$('disconnect').disabled=!connected||busy||pending;
 $('capture').disabled=!data||!usable||busy||pending||($('mode').value==='reflectance'&&!data.reflectance);
 $('live').textContent=running?'Pause':'Resume';
 $('calibration').textContent=`Dark: ${instrument.dark?'stored':'not stored'}. Reference: ${instrument.reference?'stored':'not stored'}.`;
}
function draw(){let s=null;if(data&&data[$('mode').value])s=snapshot(data,$('mode').value,$('label').value||'Sample',$('auto').checked);plot($('plot'),s);controls();}
function show(s){data=s;usable=true;$('ms').min=s.min_ms;$('status').textContent=`${s.model} ${s.serial} — ${s.integration_ms} ms`;$('peak').textContent=`Maximum: ${Math.max(...s.raw).toFixed(0)} counts`;note(s.saturated?'Signal saturated. Shorten integration time.':'');draw();}
function fail(e){running=false;usable=false;note(e);controls();}
async function refresh(){if(busy||pending||!instrument.device)return;busy=true;try{show(await instrument.scan());}catch(e){fail(e);}finally{busy=false;controls();}}
async function action(fn){if(pending)return;pending=true;controls();while(busy)await new Promise(r=>setTimeout(r,20));busy=true;try{note();await fn();}catch(e){fail(e);}finally{pending=false;busy=false;controls();}}
function addImage(s){const canvas=document.createElement('canvas');canvas.width=1200;canvas.height=900;plot(canvas,s);
 const url=canvas.toDataURL('image/png'),figure=document.createElement('figure'),img=document.createElement('img'),caption=document.createElement('figcaption'),save=document.createElement('a');
 img.src=url;img.alt=`${s.label}, ${s.ms} ms, ${s.mode==='raw'?'detector counts':'relative reflectance'} versus wavelength`;
 caption.textContent=`${s.label} (${s.ms} ms) `;save.href=url;save.download=(s.label.replace(/[^a-z0-9_-]+/gi,'_')||'spectrum')+'_'+Date.now()+'.png';save.textContent='Save image';caption.append(save);figure.append(img,caption);$('captures').prepend(figure);$('empty').hidden=true;imageIndex=0;gallery();
}
$('connect').onclick=async()=>{if(!navigator.usb){note('Open this page in Chrome or Edge.');return;}
 try{const selected=await navigator.usb.requestDevice({filters:[{vendorId:0x2457,productId:0x1002},{vendorId:0x2457,productId:0x101e}]});await action(async()=>{await instrument.open(selected);$('ms').value=instrument.ms;running=true;show(await instrument.scan());});}catch(e){if(e.name!=='NotFoundError')note(e);}
};
$('disconnect').onclick=()=>action(async()=>{running=false;await instrument.close();data=null;usable=false;$('status').textContent='Not connected';$('peak').textContent='';draw();});
$('live').onclick=()=>{running=!running;controls();};
$('apply').onclick=()=>action(async()=>{await instrument.setExposure(Number($('ms').value));data=null;usable=false;show(await instrument.scan());});
for(const kind of ['dark','reference'])$(kind).onclick=()=>action(async()=>{
 await instrument.capture(kind);
 // Freeze the actual five-scan average, not the next live spectrum.
 const captured={wavelength:instrument.wavelength,raw:instrument[kind],max_counts:instrument.ceiling,integration_ms:instrument.ms,serial:instrument.serial,model:instrument.model,time:new Date().toISOString()};
 addImage(snapshot(captured,'raw',kind==='dark'?'Dark (5-scan average)':'White reference (5-scan average)',$('auto').checked));
 show(await instrument.scan());
});
$('capture').onclick=()=>action(async()=>{if(!data||!usable)throw Error('Acquire a spectrum first.');addImage(snapshot(data,$('mode').value,$('label').value||'Sample',$('auto').checked));});
$('mode').onchange=()=>{if($('mode').value==='reflectance'&&!data?.reflectance)note('Store a dark and reference to display reflectance.');else note();draw();};$('auto').onchange=draw;$('label').oninput=draw;
instrument.onlog=()=>{$('log').textContent=instrument.trace.join('\n');};
navigator.usb?.addEventListener('disconnect',e=>{if(e.device===instrument.device){running=false;instrument.device=null;instrument.dark=instrument.reference=instrument.latest=null;data=null;usable=false;$('status').textContent='Disconnected';$('peak').textContent='';note('Reconnect the spectrometer and retake the dark and reference.');draw();}});
if(!navigator.usb)note('Open this page in Chrome or Edge.');draw();
async function loop(){if(running)await refresh();setTimeout(loop,350);}loop();
