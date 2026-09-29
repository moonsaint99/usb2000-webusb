// USB2000 (2457:1002) and USB2000+ (2457:101e). Protocol reference: python-seabreeze 2.11.0.
// Sends initialize, exposure, trigger, EEPROM-read, and spectrum-read commands only.
// Some legacy units leave a standalone 0x69 terminator after an interrupted read.
// Never count it as pixel data: that shifts every pixel and produces false spikes.
export async function readSpectrumFrame(read,packet=64) {
  const all=new Uint8Array(4097);let total=0,orphanMarkers=0;
  while(total<4097){
    const b=await read(Math.ceil((4097-total)/packet)*packet);
    if(total===0&&b.length===1&&b[0]===0x69){
      if(++orphanMarkers>2)throw Error('Too many leftover frame markers. Unplug and reconnect the instrument.');
      continue;
    }
    if(!b.length||total+b.length>4097)throw Error(`Invalid spectrum packet (${b.length} bytes after ${total}). Unplug and reconnect the instrument.`);
    all.set(b,total);total+=b.length;
  }
  if(all[4096]!==0x69)throw Error('Spectrum boundary marker missing. Unplug and reconnect the instrument.');
  return all;
}
export function decodeSpectrum(bytes) {
  if (bytes.length !== 4097) throw Error(`Incomplete spectrum: ${bytes.length}/4097 bytes`);
  return Array.from({length:2048}, (_,i)=>{
    const base=Math.floor(i/64)*128, offset=i%64;
    return bytes[base+offset] | ((bytes[base+64+offset]&15)<<8);
  });
}
export function decodePlusSpectrum(bytes) {
  if(bytes.length!==4097)throw Error(`Incomplete USB2000+ spectrum: ${bytes.length}/4097 bytes`);
  return Array.from({length:2048},(_,i)=>bytes[2*i]|(bytes[2*i+1]<<8));
}
export function reflectance(raw,dark,reference,ceiling=4095) {
  if (!dark || !reference) return null;
  const den=reference.map((v,i)=>v-dark[i]);
  const floor=Math.max(10,.01*Math.max(...den));
  return raw.map((v,i)=>den[i]>floor && v<ceiling && reference[i]<ceiling && dark[i]<ceiling ? 100*(v-dark[i])/den[i]:null);
}
export class USB2000 {
  constructor(){this.model='USB2000';this.out=2;this.info=7;this.specEndpoint=2;this.packet=64;this.minMs=3;this.ceiling=4095;this.plus=false;this.device=null;this.ms=10;this.dark=null;this.reference=null;this.latest=null;this.trace=[];}
  log(s){this.trace.push(`${new Date().toISOString()} ${s}`);this.trace=this.trace.slice(-60);this.onlog?.(s);}
  async deadline(p){let timer;try{return await Promise.race([p,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('USB transfer timed out. Disconnect, unplug/replug the instrument, then connect again.')),5000+this.ms);})]);}catch(e){this.failed=true;throw e;}finally{clearTimeout(timer);}}
  async write(bytes){if(this.failed)throw Error('USB connection needs reconnecting.');let r=await this.deadline(this.device.transferOut(this.out,new Uint8Array(bytes)));if(r.status!=='ok'||r.bytesWritten!==bytes.length)throw Error('USB write failed: '+r.status);}
  async read(endpoint,length){let r=await this.deadline(this.device.transferIn(endpoint,length));if(r.status!=='ok'||!r.data)throw Error('USB read failed: '+r.status);return new Uint8Array(r.data.buffer,r.data.byteOffset,r.data.byteLength);}
  async rawSlot(n){await this.write([5,n]);const b=await this.read(this.info,64);if(b.length<3||b[0]!==5||b[1]!==n)throw Error(`Invalid calibration response for slot ${n}`);return b;}
  async slot(n){const b=await this.rawSlot(n);let end=b.indexOf(0,2);return new TextDecoder().decode(b.slice(2,end<0?b.length:end)).trim();}
  async open(device){
    this.device=device;this.failed=false;this.dark=this.reference=this.latest=null;
    try{
      if(device.vendorId!==0x2457||![0x1002,0x101e].includes(device.productId))throw Error('Select a USB2000 or USB2000+.');
      this.plus=device.productId===0x101e;this.model=this.plus?'USB2000+':'USB2000';this.out=this.plus?1:2;this.info=this.plus?1:7;this.minMs=this.plus?1:3;this.ceiling=this.plus?65535:4095;this.specEndpoint=2;this.packet=64;
      this.log('Opening '+device.productName);await device.open();
      if(!device.configuration)await device.selectConfiguration(1);
      const match=device.configuration.interfaces.flatMap(i=>i.alternates.map(a=>({i,a}))).find(({a})=>[ [this.out,'out'],[2,'in'],[this.info,'in'] ].every(([n,d])=>a.endpoints.some(e=>e.endpointNumber===n&&e.direction===d)));
      if(!match)throw Error('Expected USB2000 endpoints were not found.');
      this.iface=match.i.interfaceNumber;await device.claimInterface(this.iface);
      if(match.i.alternate.alternateSetting!==match.a.alternateSetting)await device.selectAlternateInterface(this.iface,match.a.alternateSetting);
      this.log('USB interface claimed');await this.write([1]);await new Promise(r=>setTimeout(r,100));
      if(this.plus){
        await this.write([254]);const status=await this.read(this.info,64);
        if(status.length<16||![0,128].includes(status[14]))throw Error('Unrecognized USB2000+ USB speed status.');
        this.specEndpoint=status[14]===128?2:this.info;
        this.packet=match.a.endpoints.find(e=>e.endpointNumber===this.specEndpoint&&e.direction==='in').packetSize;
        const sat=await this.rawSlot(17);if(sat.length<8)throw Error('Incomplete saturation calibration');
        const value=sat[6]|(sat[7]<<8);if(value>0)this.ceiling=value;
        this.log(`USB2000+ raw-count saturation threshold: ${this.ceiling}`);
      }
      this.serial=await this.slot(0);const coeff=[];
      for(let n=1;n<=4;n++){const text=await this.slot(n);if(!text)throw Error('Missing wavelength calibration');const v=Number(text);this.log(`Calibration slot ${n}: ${JSON.stringify(text)}`);if(!Number.isFinite(v))throw Error(`Invalid wavelength calibration in slot ${n}: ${JSON.stringify(text)}`);coeff.push(v);}
      this.coefficients=coeff;this.wavelength=Array.from({length:2048},(_,i)=>coeff.reduce((s,c,n)=>s+c*i**n,0));
      if(this.wavelength.some((v,i)=>!Number.isFinite(v)||(i&&v<=this.wavelength[i-1])))throw Error('Wavelength calibration is not increasing.');
      await this.write([10,0,0]);await this.setExposure(Math.max(this.minMs,this.ms));
      this.log(`Ready: ${this.serial}, ${this.wavelength[0].toFixed(2)}–${this.wavelength.at(-1).toFixed(2)} nm`);
    }catch(e){this.log('Connection failed: '+e.message);await this.close();throw e;}
  }
  async close(){const d=this.device;this.device=null;this.dark=this.reference=this.latest=null;if(d?.opened){try{if(this.iface!==undefined)await d.releaseInterface(this.iface);}catch{}try{await d.close();}catch{}}}
  async setExposure(ms){if(!Number.isInteger(ms)||ms<this.minMs||ms>2000)throw Error(`Use a whole-number integration time from ${this.minMs} to 2000 ms.`);const units=this.plus?ms*1000:ms;await this.write([2,units&255,(units>>>8)&255,(units>>>16)&255,(units>>>24)&255]);this.ms=ms;this.dark=this.reference=this.latest=null;await this.scan();this.latest=null;}
  async scan(){
    if(!this.device?.opened)throw Error('Connect the spectrometer first.');
    let all;
    try {
      await this.write([9]);all=await readSpectrumFrame(length=>this.read(this.specEndpoint,length),this.packet);
    } catch(e) {this.failed=true;this.log('Spectrum rejected: '+e.message);throw e;}
    const raw=this.plus?decodePlusSpectrum(all):decodeSpectrum(all);
    this.latest={model:this.model,serial:this.serial,wavelength:this.wavelength,raw,reflectance:reflectance(raw,this.dark,this.reference,this.ceiling),integration_ms:this.ms,min_ms:this.minMs,max_counts:this.ceiling,dark:!!this.dark,reference:!!this.reference,saturated:raw.some(v=>v>=this.ceiling),time:new Date().toISOString()};return this.latest;
  }
  async capture(kind){if(!['dark','reference'].includes(kind))throw Error('Invalid capture');await this.scan();let sum=Array(2048).fill(0);for(let n=0;n<5;n++){const s=await this.scan();if(s.saturated)throw Error('Capture clipped. Shorten exposure and retake dark/reference.');s.raw.forEach((v,i)=>sum[i]+=v/5);}this[kind]=sum;}
  csv(label){const s=this.latest;if(!s)throw Error('Acquire a spectrum first.');const rr=reflectance(s.raw,this.dark,this.reference,this.ceiling);const cell=v=>'"'+String(v??'').replaceAll('"','""')+'"';return [
    ['# WebUSB spectrum',this.model,s.time],['# serial',this.serial,'integration_ms',this.ms],['# sample',label],['# wavelength coefficients',...this.coefficients],
    ['# raw saturation threshold',this.ceiling],['# corrections','raw ADC counts; no saturation normalization, automatic dark-count or nonlinearity correction'],
    ['wavelength_nm','raw_counts','dark_counts','reference_counts','relative_reflectance_percent'],
    ...s.wavelength.map((w,i)=>[w,s.raw[i],this.dark?.[i],this.reference?.[i],rr?.[i]])
  ].map(row=>row.map(cell).join(',')).join('\r\n');}
}
