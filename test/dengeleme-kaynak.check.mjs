import { getTargets, setTargets } from '../server/dengeleme-kaynak.js';
let ok=0,bad=0; const a=(n,c)=>{c?ok++:bad++;console.log(c?'OK  ':'FAIL',n)};
a('başlangıçta boş', JSON.stringify(getTargets())==='{"classTargets":{},"symbolTargets":{}}');
const t=setTargets({classTargets:{stock:60,gold:40},symbolTargets:{thyao:{cls:'stock',pct:50}}});
a('kaydedilir, sembol büyük harfe çevrilir', t.classTargets.stock===60 && t.symbolTargets.THYAO.pct===50);
let e; try{setTargets({classTargets:{stock:150}})}catch(x){e=x}
a('geçersiz hedef reddedilir', /0–100/.test(e?.message));
a('geçersiz kayıt öncekini bozmaz', getTargets().classTargets.stock===60);
a('bütün olarak değiştirir', Object.keys(setTargets({classTargets:{fund:10}}).classTargets).join()==='fund' && Object.keys(getTargets().symbolTargets).length===0);
let e2; try{setTargets({classTargets:{cash:10}},{cashTracking:false})}catch(x){e2=x}
a('nakit takibi kapalıyken cash reddedilir', !!e2);
console.log(ok+' geçti, '+bad+' başarısız'); process.exit(bad?1:0);
