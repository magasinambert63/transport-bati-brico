import React,{useMemo,useState}from'react'
import{Upload,FileText,Search,CheckCircle,AlertTriangle,Download,Trash2,Plus,Wand2}from'lucide-react'

function norm(v){return String(v||'').replace(',','.').replace(/[^\d.]/g,'')}
function parseText(text){
 const lines=text.split(/\n+/).map(l=>l.replace(/\s+/g,' ').trim()).filter(l=>l.length>2)
 const header={fournisseur:'',numeroArc:'',numeroCommande:'',dateArc:'',livraison:''}
 const arts=[]
 for(const line of lines){
  if(!header.numeroCommande&&/(commande|cde|order)/i.test(line)){const m=line.match(/(?:commande|cde|order)[^\dA-Z]*([A-Z0-9\-\/]{4,})/i);if(m)header.numeroCommande=m[1]}
  if(!header.numeroArc&&/(arc|accusé|accuse|confirmation|ack)/i.test(line)){const m=line.match(/(?:arc|confirmation|ack)[^\dA-Z]*([A-Z0-9\-\/]{4,})/i);if(m)header.numeroArc=m[1]}
  if(!header.dateArc){const m=line.match(/\b(\d{1,2}[\/\-.]\d{1,2}[\/\-.]\d{2,4})\b/);if(m)header.dateArc=m[1]}
  const hasRef=/\b[A-Z0-9][A-Z0-9\-\/\.]{3,}\b/i.test(line), hasNum=/\b\d+([,.]\d+)?\b/.test(line)
  if(hasRef&&hasNum&&line.length>12)arts.push(line)
 }
 const rows=arts.map((line,i)=>{
  const tokens=line.split(' ')
  const ref=tokens.find(t=>/^[A-Z0-9][A-Z0-9\-\/\.]{3,}$/i.test(t))||''
  const prices=line.match(/\b\d+[,.]\d{2}\b/g)||[]
  const numbers=line.match(/\b\d+([,.]\d+)?\b/g)||[]
  const prix=prices.length?prices[prices.length-1]:''
  const qty=(numbers.filter(n=>n!==prix).find(n=>Number(norm(n))>0&&Number(norm(n))<100000))||''
  const designation=line.replace(ref,'').replace(prix,'').replace(qty,'').replace(/€|eur/ig,'').replace(/\s+/g,' ').trim()
  return{id:Date.now()+i,reference:ref,designation,quantite:qty,unite:'',prix,delai:'',source:line,confiance:ref&&qty?'Moyenne':'Faible'}
 })
 return{header,rows}
}
function compare(cmd,arc){
 const out=[]
 for(const c of cmd){
  const a=arc.find(x=>x.reference&&c.reference&&x.reference.toLowerCase()===c.reference.toLowerCase())
  if(!a){out.push({status:'ALERTE',reference:c.reference,designation:c.designation,message:'Absent de l’ARC',cmd:c,arc:null});continue}
  const cq=Number(norm(c.quantite)),aq=Number(norm(a.quantite)),cp=Number(norm(c.prix)),ap=Number(norm(a.prix))
  const qtyOk=!cq||!aq||cq===aq, prixOk=!cp||!ap||Math.abs(cp-ap)<.01
  out.push({status:qtyOk&&prixOk?'OK':'ECART',reference:c.reference,designation:c.designation||a.designation,message:qtyOk&&prixOk?'Conforme':[!qtyOk?`Qté ${c.quantite} / ${a.quantite}`:'',!prixOk?`Prix ${c.prix} / ${a.prix}`:''].filter(Boolean).join(' — '),cmd:c,arc:a})
 }
 for(const a of arc){if(!cmd.find(c=>c.reference&&a.reference&&c.reference.toLowerCase()===a.reference.toLowerCase()))out.push({status:'ALERTE',reference:a.reference,designation:a.designation,message:'Présent sur ARC mais absent commande',cmd:null,arc:a})}
 return out
}
const esc=v=>`"${String(v??'').replaceAll('"','""')}"`
export default function App(){
 const[cmdText,setCmdText]=useState(''),[arcText,setArcText]=useState(''),[cmdRows,setCmdRows]=useState([]),[arcRows,setArcRows]=useState([]),[tab,setTab]=useState('import')
 const results=useMemo(()=>compare(cmdRows,arcRows),[cmdRows,arcRows])
 const ok=results.filter(r=>r.status==='OK').length, ec=results.filter(r=>r.status==='ECART').length, al=results.filter(r=>r.status==='ALERTE').length
 const parseCmd=()=>{setCmdRows(parseText(cmdText).rows);setTab('validation')}
 const parseArc=()=>{setArcRows(parseText(arcText).rows);setTab('validation')}
 const readFile=(file,target)=>{if(!file)return;const r=new FileReader();r.onload=e=>target==='cmd'?setCmdText(e.target.result):setArcText(e.target.result);r.readAsText(file)}
 const upd=(type,id,k,v)=>(type==='cmd'?setCmdRows:setArcRows)(rows=>rows.map(r=>r.id===id?{...r,[k]:v}:r))
 const add=(type)=>(type==='cmd'?setCmdRows:setArcRows)(rows=>[...rows,{id:Date.now(),reference:'',designation:'',quantite:'',unite:'',prix:'',delai:'',source:'',confiance:'Manuel'}])
 const del=(type,id)=>(type==='cmd'?setCmdRows:setArcRows)(rows=>rows.filter(r=>r.id!==id))
 const exportCSV=kind=>{let rows,fn;if(kind==='rapport'){rows=[['Statut','Référence','Désignation','Message','Qté commande','Qté ARC','Prix commande','Prix ARC'],...results.map(r=>[r.status,r.reference,r.designation,r.message,r.cmd?.quantite||'',r.arc?.quantite||'',r.cmd?.prix||'',r.arc?.prix||''])];fn='rapport_controle_arc.csv'}else{const source=kind==='cmd'?cmdRows:arcRows;rows=[['Référence','Désignation','Quantité','Unité','Prix','Délai','Source'],...source.map(r=>[r.reference,r.designation,r.quantite,r.unite,r.prix,r.delai,r.source])];fn=kind==='cmd'?'commande_normalisee.csv':'arc_normalise.csv'}const b=new Blob([rows.map(r=>r.map(esc).join(';')).join('\n')],{type:'text/csv;charset=utf-8'});const a=document.createElement('a');a.href=URL.createObjectURL(b);a.download=fn;a.click()}
 const Editor=({title,type,rows})=><section className="card wide"><div className="head"><h2>{title}</h2><button onClick={()=>add(type)}><Plus size={16}/>Ajouter ligne</button></div><div className="table"><table><thead><tr><th>Référence</th><th>Désignation</th><th>Qté</th><th>Unité</th><th>Prix</th><th>Délai</th><th></th></tr></thead><tbody>{rows.length===0&&<tr><td colSpan="7" className="empty">Aucune ligne</td></tr>}{rows.map(r=><tr key={r.id}><td><input value={r.reference} onChange={e=>upd(type,r.id,'reference',e.target.value)}/></td><td><input value={r.designation} onChange={e=>upd(type,r.id,'designation',e.target.value)}/></td><td><input value={r.quantite} onChange={e=>upd(type,r.id,'quantite',e.target.value)}/></td><td><input value={r.unite} onChange={e=>upd(type,r.id,'unite',e.target.value)}/></td><td><input value={r.prix} onChange={e=>upd(type,r.id,'prix',e.target.value)}/></td><td><input value={r.delai} onChange={e=>upd(type,r.id,'delai',e.target.value)}/></td><td><button className="danger mini" onClick={()=>del(type,r.id)}><Trash2 size={14}/></button></td></tr>)}</tbody></table></div></section>
 return <div className="app"><header><div><h1>BATI BRICO</h1><p>Contrôle ARC fournisseur — normalisation universelle</p></div><div className="status"><span>Contrôle</span><b>{results.length?`${ok} OK / ${ec+al} alertes`:'En attente'}</b></div></header><nav><button className={tab==='import'?'active':''} onClick={()=>setTab('import')}>1. Import</button><button className={tab==='validation'?'active':''} onClick={()=>setTab('validation')}>2. Validation</button><button className={tab==='controle'?'active':''} onClick={()=>setTab('controle')}>3. Contrôle</button></nav>
 {tab==='import'&&<main className="grid"><section className="card"><h2><Upload size={20}/> Commande fournisseur</h2><p>Colle le texte OCR, ou importe un fichier TXT/CSV.</p><input type="file" accept=".txt,.csv" onChange={e=>readFile(e.target.files[0],'cmd')}/><textarea value={cmdText} onChange={e=>setCmdText(e.target.value)} placeholder="Texte de la commande..."/><button onClick={parseCmd}><Wand2 size={16}/>Extraire commande</button></section><section className="card"><h2><FileText size={20}/> ARC fournisseur</h2><p>Colle le texte OCR, ou importe un fichier TXT/CSV.</p><input type="file" accept=".txt,.csv" onChange={e=>readFile(e.target.files[0],'arc')}/><textarea value={arcText} onChange={e=>setArcText(e.target.value)} placeholder="Texte de l’ARC..."/><button onClick={parseArc}><Wand2 size={16}/>Extraire ARC</button></section><section className="card wide notice"><b>V1 gratuite :</b> le moteur normalise tous les fournisseurs dans le même tableau. Pour les scans PDF/images, utilise l’OCR de ton scanner/copieur puis colle le texte ici.</section></main>}
 {tab==='validation'&&<main><div className="actions"><button onClick={()=>exportCSV('cmd')}><Download size={16}/>Export commande</button><button onClick={()=>exportCSV('arc')}><Download size={16}/>Export ARC</button><button onClick={()=>setTab('controle')}><CheckCircle size={16}/>Lancer contrôle</button></div><Editor title={`Commande normalisée (${cmdRows.length})`} type="cmd" rows={cmdRows}/><Editor title={`ARC normalisé (${arcRows.length})`} type="arc" rows={arcRows}/></main>}
 {tab==='controle'&&<main><section className="summary"><div className="ok"><CheckCircle/><b>{ok}</b><span>Conformes</span></div><div className="warn"><AlertTriangle/><b>{ec}</b><span>Écarts</span></div><div className="alert"><AlertTriangle/><b>{al}</b><span>Alertes</span></div></section><div className="actions"><button onClick={()=>exportCSV('rapport')}><Download size={16}/>Export rapport CSV</button><button onClick={()=>window.print()}><FileText size={16}/>Imprimer</button></div><section className="card wide"><h2>Rapport conformité ARC / Commande</h2><div className="table"><table><thead><tr><th>Statut</th><th>Référence</th><th>Désignation</th><th>Détail</th><th>Qté commande</th><th>Qté ARC</th><th>Prix commande</th><th>Prix ARC</th></tr></thead><tbody>{results.length===0&&<tr><td colSpan="8" className="empty">Aucun contrôle</td></tr>}{results.map((r,i)=><tr key={i} className={r.status.toLowerCase()}><td><b>{r.status}</b></td><td>{r.reference}</td><td>{r.designation}</td><td>{r.message}</td><td>{r.cmd?.quantite||''}</td><td>{r.arc?.quantite||''}</td><td>{r.cmd?.prix||''}</td><td>{r.arc?.prix||''}</td></tr>)}</tbody></table></div></section></main>}</div>
}
