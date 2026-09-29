// Legacy USB2000 only (2457:1002). Protocol reference: python-seabreeze 2.11.0.
// Sends initialize, exposure, trigger, EEPROM-read, and spectrum-read commands only.
export function decodeSpectrum(bytes) {
  if (bytes.length !== 4097) throw Error(`Incomplete spectrum: ${bytes.length}/4097 bytes`);
  return Array.from({length:2048}, (_,i)=>{
    const base=Math.floor(i/64)*128, offset=i%64;
    return bytes[base+offset] | ((bytes[base+64+offset]&15)<<8);
  });
}
export function reflectance(raw,dark,reference) {
  if (!dark || !reference) return null;
  const den=reference.map((v,i)=>v-dark[i]);
  const floor=Math.max(10,.01*Math.max(...den));
  return raw.map((v,i)=>den[i]>floor && v<4095 && reference[i]<4095 && dark[i]<4095 ? 100*(v-dark[i])/den[i]:null);
}
export class USB2000 {
  constructor(){this.device=null;this.ms=10;this.dark=null;this.reference=null;this.latest=null;this.trace=[];}
  log(s){this.trace.push(`${new Date().toISOString()} ${s}`);this.trace=this.trace.slice(-60);this.onlog?.(s);}
  async deadline(p){let timer;try{return await Promise.race([p,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('USB transfer timed out. Disconnect, unplug/replug the instrument, then connect again.')),5000+this.ms);})]);}catch(e){this.failed=true;throw e;}finally{clearTimeout(timer);}}
  async write(bytes){if(this.failed)throw Error('USB connection needs reconnecting.');let r=await this.deadline(this.device.transferOut(2,new Uint8Array(bytes)));if(r.status!=='ok'||r.bytesWritten!==bytes.length)throw Error('USB write failed: '+r.status);}
  async read(endpoint,length){let r=await this.deadline(this.device.transferIn(endpoint,length));if(r.status!=='ok'||!r.data)throw Error('USB read failed: '+r.status);return new Uint8Array(r.data.buffer,r.data.byteOffset,r.data.byteLength);}
  async slot(n){await this.write([5,n]);const b=await this.read(7,64);if(b.length<3||b[0]!==5||b[1]!==n)throw Error(`Invalid calibration response for slot ${n}`);let end=b.indexOf(0,2);return new TextDecoder().decode(b.slice(2,end<0?b.length:end)).trim();}
  async open(device){
    this.device=device;this.failed=false;this.dark=this.reference=this.latest=null;
    try{
      if(device.vendorId!==0x2457||device.productId!==0x1002)throw Error('This version supports the original USB2000 only.');
      this.log('Opening '+device.productName);await device.open();
      if(!device.configuration)await device.selectConfiguration(1);
      const match=device.configuration.interfaces.flatMap(i=>i.alternates.map(a=>({i,a}))).find(({a})=>[ [2,'out'],[2,'in'],[7,'in'] ].every(([n,d])=>a.endpoints.some(e=>e.endpointNumber===n&&e.direction===d)));
      if(!match)throw Error('Expected USB2000 endpoints were not found.');
      this.iface=match.i.interfaceNumber;await device.claimInterface(this.iface);
      if(match.i.alternate.alternateSetting!==match.a.alternateSetting)await device.selectAlternateInterface(this.iface,match.a.alternateSetting);
      this.log('USB interface claimed');await this.write([1]);await new Promise(r=>setTimeout(r,100));
      this.serial=await this.slot(0);const coeff=[];
      for(let n=1;n<=4;n++){const text=await this.slot(n);if(!text)throw Error('Missing wavelength calibration');const v=Number(text);if(!Number.isFinite(v))throw Error('Invalid wavelength calibration');coeff.push(v);}
      this.coefficients=coeff;this.wavelength=Array.from({length:2048},(_,i)=>coeff.reduce((s,c,n)=>s+c*i**n,0));
      if(this.wavelength.some((v,i)=>!Number.isFinite(v)||(i&&v<=this.wavelength[i-1])))throw Error('Wavelength calibration is not increasing.');
      await this.write([10,0,0]);await this.setExposure(this.ms);
      this.log(`Ready: ${this.serial}, ${this.wavelength[0].toFixed(2)}–${this.wavelength.at(-1).toFixed(2)} nm`);
    }catch(e){this.log('Connection failed: '+e.message);await this.close();throw e;}
  }
  async close(){const d=this.device;this.device=null;this.dark=this.reference=this.latest=null;if(d?.opened){try{if(this.iface!==undefined)await d.releaseInterface(this.iface);}catch{}try{await d.close();}catch{}}}
  async setExposure(ms){if(!Number.isInteger(ms)||ms<3||ms>2000)throw Error('Use a whole-number integration time from 3 to 2000 ms.');await this.write([2,ms&255,(ms>>>8)&255,0,0]);this.ms=ms;this.dark=this.reference=this.latest=null;await this.scan();this.latest=null;}
  async scan(){
    if(!this.device?.opened)throw Error('Connect the spectrometer first.');
    await this.write([9]);let parts=[],total=0;
    while(total<4097){const b=await this.read(2,Math.ceil((4097-total)/64)*64);if(!b.length||total+b.length>4097)throw Error('Unexpected spectrum packet length. Reconnect the instrument.');parts.push(b);total+=b.length;}
    const all=new Uint8Array(4097);let pos=0;for(const b of parts){all.set(b,pos);pos+=b.length;}
    const raw=decodeSpectrum(all);
    this.latest={model:'USB2000',serial:this.serial,wavelength:this.wavelength,raw,reflectance:reflectance(raw,this.dark,this.reference),integration_ms:this.ms,min_ms:3,max_counts:4095,dark:!!this.dark,reference:!!this.reference,saturated:raw.some(v=>v>=4095),time:new Date().toISOString()};return this.latest;
  }
  async capture(kind){if(!['dark','reference'].includes(kind))throw Error('Invalid capture');await this.scan();let sum=Array(2048).fill(0);for(let n=0;n<5;n++){const s=await this.scan();if(s.saturated)throw Error('Capture clipped. Shorten exposure and retake dark/reference.');s.raw.forEach((v,i)=>sum[i]+=v/5);}this[kind]=sum;}
  csv(label){const s=this.latest;if(!s)throw Error('Acquire a spectrum first.');const rr=reflectance(s.raw,this.dark,this.reference);const cell=v=>'"'+String(v??'').replaceAll('"','""')+'"';return [
    ['# USB2000 WebUSB',s.time],['# serial',this.serial,'integration_ms',this.ms],['# sample',label],['# wavelength coefficients',...this.coefficients],
    ['# corrections','raw counts; no automatic dark-count or nonlinearity correction'],
    ['wavelength_nm','raw_counts','dark_counts','reference_counts','relative_reflectance_percent'],
    ...s.wavelength.map((w,i)=>[w,s.raw[i],this.dark?.[i],this.reference?.[i],rr?.[i]])
  ].map(row=>row.map(cell).join(',')).join('\r\n');}
}
