import { getTargets, setTargets, saveTargets, compute } from '../server/dengeleme-kaynak.js';
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
const rej = async (b) => { try { await saveTargets(b); return false; } catch (x) { return /./.test(x.message); } };
a('PUT gövdesi null/dizi/{} reddedilir, hedefler silinmez', await rej(null) && await rej([]) && await rej({}) && Object.keys(getTargets().classTargets).length > 0);
a('gövdede classTargets/symbolTargets düz nesne olmalı', await rej({ classTargets: null, symbolTargets: {} }) && await rej({ classTargets: {}, symbolTargets: [{ cls: 'stock', pct: 1 }] }));
a('açıkça boş hedefler kabul edilir (bilinçli silme)', (await saveTargets({ classTargets: {}, symbolTargets: {} })).classTargets && Object.keys(getTargets().classTargets).length === 0);
// Nakit takibi kapanınca kayıtlı cash hedefi sekmeyi kilitlememeli
setTargets({ classTargets: { stock: 60, cash: 40 } }, { cashTracking: true });
let cr, ce; try { cr = await compute({}); } catch (x) { ce = x; }
a('kayıtlı cash hedefi + nakit takibi kapalı: compute hata vermez', !ce && cr, ce?.message);
a('cash hedefi yok sayıldı uyarısı verilir', cr?.warnings.some((w) => /nakit hedefi yok sayıldı/.test(w)), JSON.stringify(cr?.warnings));
console.log(ok+' geçti, '+bad+' başarısız'); process.exit(bad?1:0);
