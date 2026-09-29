export function snapshot(data,mode,label,auto=false){
 const y=data[mode];if(!y)throw Error('Store a dark and reference before capturing reflectance.');
 return {x:[...data.wavelength],y:[...y],mode,label,auto,ceiling:data.max_counts,ms:data.integration_ms,serial:data.serial,model:data.model,time:data.time};
}
export function plot(canvas,s){
 const ctx=canvas.getContext('2d'),W=canvas.width,H=canvas.height;
 ctx.fillStyle='white';ctx.fillRect(0,0,W,H);ctx.fillStyle='#111';ctx.font='22px Arial';
 if(!s){ctx.fillText('No spectrum to display.',85,70);return;}
 const {x,y}=s,finite=y.filter(v=>v!==null&&Number.isFinite(v));
 let lo=0,hi=s.mode==='raw'?s.ceiling:120;
 if(s.auto&&finite.length){lo=Math.min(0,...finite);hi=Math.max(lo+1,...finite);hi+=(hi-lo)*.05;}
 const L=110,R=W-45,T=110,B=H-90,px=v=>L+(v-x[0])/(x.at(-1)-x[0])*(R-L),py=v=>B-(v-lo)/(hi-lo)*(B-T);
 ctx.font='24px Arial';ctx.fillText(s.label,L,38,R-L);ctx.font='18px Arial';
 ctx.fillText(`${s.model} ${s.serial} | ${s.ms} ms | ${new Date(s.time).toLocaleString()}`,L,70,R-L);
 for(let i=0;i<=5;i++){let v=lo+(hi-lo)*i/5,p=py(v);ctx.strokeStyle='#ddd';ctx.beginPath();ctx.moveTo(L,p);ctx.lineTo(R,p);ctx.stroke();ctx.fillStyle='#111';ctx.textAlign='right';ctx.fillText(v.toFixed(0),L-12,p+6);let w=x[0]+(x.at(-1)-x[0])*i/5;ctx.textAlign='center';ctx.fillText(w.toFixed(0),px(w),B+30);}
 ctx.strokeStyle='#555';ctx.strokeRect(L,T,R-L,B-T);ctx.textAlign='center';ctx.fillText('Wavelength (nm)',(L+R)/2,H-24);ctx.save();ctx.translate(28,(T+B)/2);ctx.rotate(-Math.PI/2);ctx.fillText(s.mode==='raw'?'Detector counts':'Relative reflectance (%)',0,0);ctx.restore();
 ctx.save();ctx.beginPath();ctx.rect(L,T,R-L,B-T);ctx.clip();ctx.strokeStyle='#174b83';ctx.lineWidth=1.6;ctx.beginPath();let pen=false;
 y.forEach((v,i)=>{if(v===null||!Number.isFinite(v)){pen=false;return;}if(pen)ctx.lineTo(px(x[i]),py(v));else ctx.moveTo(px(x[i]),py(v));pen=true;});ctx.stroke();ctx.restore();
 ctx.textAlign='left';ctx.fillStyle='#a01818';
 if(!finite.length)ctx.fillText('No valid reflectance values. Check the dark and reference.',L,T+30);
}
