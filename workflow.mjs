// View state derives from the active calibration, so exposure changes reset the sequence.
export function workflow(mode, dark, reference, retake=null){
 if(mode!=='reflectance')return {stage:'raw',plotMode:'raw',capture:'Capture spectrum image'};
 if(!dark||retake==='d')return {stage:'d',plotMode:'raw',capture:'Store dark: D',title:'D · Dark',instruction:'Block light entering the fiber, then capture D.'};
 if(!reference||retake==='w')return {stage:'w',plotMode:'raw',capture:'Store reference: W',title:'W · White reference',instruction:'Unblock the fiber and view illuminated white paper, then capture W.'};
 return {stage:'s',plotMode:'reflectance',capture:'Capture final PNG',title:'S · Sample',instruction:'Replace the white paper with your sample. Keep lighting and geometry fixed, then capture the reflectance image.'};
}
