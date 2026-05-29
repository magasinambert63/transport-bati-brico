import React,{useMemo,useState}from'react'
import{Upload,FileText,CheckCircle,AlertTriangle,Download,Trash2,Plus,Wand2,ScanText,Loader2}from'lucide-react'
import * as pdfjsLib from 'pdfjs-dist'
import Tesseract from 'tesseract.js'

pdfjsLib.GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@4.10.38/build/pdf.worker.min.mjs`

function norm(v){return String(v||'').replace(',','.').replace(/[^\d.]/g,'')}
function parseText(text){
 const lines=text.split(/\n+/).map(l=>l.replace(/\s+/g,' ').trim()).filter(l=>l.length>2)
 const header={numeroArc:'',numeroCommande:'',dateArc:'',livraison:''}
 const arts=[]
 for(const line of lines){
  if(!header.numeroCommande&&/(commande|cde|order|votre référence|votre ref)/i.test(line)){const m=line.match(/(?:commande|cde|order|référence|ref)[^\dA-Z]*([A-Z0-9\-\/]{4,})/i);if(m)header.numeroCommande=m[1]}
  if(!header.numeroArc&&/(arc|accusé|accuse|confirmation|ack)/i.test(line)){const m=line.match(/(?:arc|confirmation|ack)[^\dA-Z]*([A-Z0-9\-\/]{4,})/i);if(m)header.numeroArc=m[1]}
  if(!header.dateArc){const m=line.match(/\b(\d{1,2}[\/\-.]\d{1,2}[\/\-.]\d{2,4})\b/);if(m)header.dateArc=m[1]}
  if(!header.livraison&&/(livraison|livré|delivery|délai|delai)/i.test(line)){const m=line.match(/\b(\d{1,2}[\/\-.]\d{1,2}[\/\-.]\d{2,4})\b/);if(m)header.livraison=m[1]}
  const hasRef=/\b[A-Z0-9][A-Z0-9\-\/\.]{3,}\b/i.test(line), hasNum=/\b\d+([,.]\d+)?\b/.test(line)
  const bad=/total|tva|siret|iban|page|transport|conditions|adresse|téléphone|telephone/i.test(line)
  if(hasRef&&hasNum&&line.length>12&&!bad)arts.push(line)
 }
 const rows=arts.map((line,i)=>{
  const tokens=line.split(' ')
  const ref=tokens.find(t=>/^[A-Z0-9][A-Z0-9\-\/\.]{3,}$/i.test(t))||''
  const prices=line.match(/\b\d+[,.]\d{2}\b/g)||[]
  const numbers=line.match(/\b\d+([,.]\d+)?\b/g)||[]
  const prix=prices.length?prices[prices.length-1]:''
  const qty=(numbers.filter(n=>n!==prix).find(n=>Number(norm(n))>0&&Number(norm(n))<100000))||''
  const designation=line.replace(ref,'').replace(prix,'').replace(qty,'').replace(/€|eur|ht|ttc/ig,'').replace(/\s+/g,' ').trim()
  return{id:Date.now()+i,reference:ref,designation,quantite:qty,unite:'',prix,delai:'',source:line,confiance:ref&&qty?'Moyenne':'Faible'}
 })
 return{header,rows,lines}
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
async function extractPdfText(file){
 const buf=await file.arrayBuffer()
 const pdf=await pdfjsLib.getDocument({data:buf}).promise
 let full=''
 for(let i=1;i<=pdf.numPages;i++){
  const page=await pdf.getPage(i)
  const content=await page.getTextContent()
  full+=content.items.map(it=>it.str).join(' ')+'\n'
 }
 return full.trim()
}
async function ocrImage(file,onProgress){
 const res=await Tesseract.recognize(file,'fra+eng',{logger:m=>{if(m.status)onProgress(`${m.status} ${Math.round((m.progress||0)*100)}%`)}})
 return res.data.text
}
const esc=v=>`"${String(v??'').replaceAll('"','""')}"`
export default function App(){
 const[cmdText,setCmdText]=useState(''),[arcText,setArcText]=useState(''),[cmdRows,setCmdRows]=useState([]),[arcRows,setArcRows]=useState([]),[tab,setTab]=useState('import'),[status,setStatus]=useState(''),[loading,setLoading]=useState(false)
 const results=useMemo(()=>compare(cmdRows,arcRows),[cmdRows,arcRows])
 const ok=results.filter(r=>r.status==='OK').length, ec=results.filter(r=>r.status==='ECART').length, al=results.filter(r=>r.status==='ALERTE').length
 const importFile=async(file,target)=>{
  if(!file)return
  setLoading(true);setStatus(`Lecture de ${file.name}...`)
  try{
   let text=''
   if(file.type==='application/pdf'||file.name.toLowerCase().endsWith('.pdf')){
    text=await extractPdfText(file)
    if(!text||text.length<30){setStatus('PDF probablement scanné : utilise une image JPG/PNG ou colle le texte OCR.');}
    else setStatus('Texte PDF extrait automatiquement.')
   }else if(file.type.startsWith('image/')){
    text=await ocrImage(file,setStatus)
    setStatus('OCR image terminé.')
   }else{
    text=await file.text()
    setStatus('Texte importé.')
   }
   if(target==='cmd')setCmdText(text);else setArcText(text)
  }catch(e){setStatus('Extraction impossible : colle le texte OCR manuellement.')}
  setLoading(false)
 }
 const parseCmd=()=>{setCmdRows(parseText(cmdText).rows);setTab('validation')}
 const parseArc=()=>{setArcRows(parseText(arcText).rows);setTab('validation')}
 const upd=(type,id,k,v)=>(type==='cmd'?setCmdRows:setArcRows)(rows=>rows.map(r=>r.id===id?{...r,[k]:v}:r))
 const add=(type)=>(type==='cmd'?setCmdRows:setArcRows)(rows=>[...rows,{id:Date.now(),reference:'',designation:'',quantite:'',unite:'',prix:'',delai:'',source:'',confiance:'Manuel'}])
 const del=(type,id)=>(type==='cmd'?setCmdRows:setArcRows)(rows=>rows.filter(r=>r.id!==id))
 const exportCSV=kind=>{let rows,fn;if(kind==='rapport'){rows=[['Statut','Référence','Désignation','Message','Qté commande','Qté ARC','Prix commande','Prix ARC'],...results.map(r=>[r.status,r.reference,r.designation,r.message,r.cmd?.quantite||'',r.arc?.quantite||'',r.cmd?.prix||'',r.arc?.prix||''])];fn='rapport_controle_arc.csv'}else{const source=kind==='cmd'?cmdRows:arcRows;rows=[['Référence','Désignation','Quantité','Unité','Prix','Délai','Source'],...source.map(r=>[r.reference,r.designation,r.quantite,r.unite,r.prix,r.delai,r.source])];fn=kind==='cmd'?'commande_normalisee.csv':'arc_normalise.csv'}const b=new Blob([rows.map(r=>r.map(esc).join(';')).join('\n')],{type:'text/csv;charset=utf-8'});const a=document.createElement('a');a.href=URL.createObjectURL(b);a.download=fn;a.click()}
 const Editor=({title,type,rows})=><section className="card wide"><div className="head"><h2>{title}</h2><button onClick={()=>add(type)}><Plus size={16}/>Ajouter ligne</button></div><div className="table"><table><thead><tr><th>Référence</th><th>Désignation</th><th>Qté</th><th>Unité</th><th>Prix</th><th>Délai</th><th></th></tr></thead><tbody>{rows.length===0&&<tr><td colSpan="7" className="empty">Aucune ligne</td></tr>}{rows.map(r=><tr key={r.id}><td><input value={r.reference} onChange={e=>upd(type,r.id,'reference',e.target.value)}/></td><td><input value={r.designation} onChange={e=>upd(type,r.id,'designation',e.target.value)}/></td><td><input value={r.quantite} onChange={e=>upd(type,r.id,'quantite',e.target.value)}/></td><td><input value={r.unite} onChange={e=>upd(type,r.id,'unite',e.target.value)}/></td><td><input value={r.prix} onChange={e=>upd(type,r.id,'prix',e.target.value)}/></td><td><input value={r.delai} onChange={e=>upd(type,r.id,'delai',e.target.value)}/></td><td><button className="danger mini" onClick={()=>del(type,r.id)}><Trash2 size={14}/></button></td></tr>)}</tbody></table></div></section>
 return <div className="app"><header><div><h1>BATI BRICO</h1><p>Contrôle ARC fournisseur — PDF + OCR automatique</p></div><div className="status"><span>Contrôle</span><b>{results.length?`${ok} OK / ${ec+al} alertes`:'En attente'}</b></div></header><nav><button className={tab==='import'?'active':''}onClick={()=>setTab('import')}>1. Import</button><button className={tab==='validation'?'active':''}onClick={()=>setTab('validation')}>2. Validation</button><button className={tab==='controle'?'active':''}onClick={()=>setTab('controle')}>3. Contrôle</button></nav>
 {tab==='import'&&<main className="grid"><section className="card"><h2><Upload/>Commande fournisseur</h2><p>PDF texte, TXT/CSV ou image JPG/PNG.</p><input type="file" accept=".pdf,.txt,.csv,image/*" onChange={e=>importFile(e.target.files[0],'cmd')}/><textarea value={cmdText} onChange={e=>setCmdText(e.target.value)} placeholder="Texte commande extrait automatiquement ou collé ici..."/><button onClick={parseCmd}><Wand2 size={16}/>Extraire commande</button></section><section className="card"><h2><FileText/>ARC fournisseur</h2><p>PDF texte, TXT/CSV ou image JPG/PNG.</p><input type="file" accept=".pdf,.txt,.csv,image/*" onChange={e=>importFile(e.target.files[0],'arc')}/><textarea value={arcText} onChange={e=>setArcText(e.target.value)} placeholder="Texte ARC extrait automatiquement ou collé ici..."/><button onClick={parseArc}><Wand2 size={16}/>Extraire ARC</button></section><section className="card wide notice">{loading?<Loader2 className="spin"/>:<ScanText/>}<b>État :</b> {status||'En attente d’import.'}<br/>PDF mail : extraction directe. Image/scanner : OCR intégré. PDF scanné complexe : convertir en image ou coller le texte OCR.</section></main>}
 {tab==='validation'&&<main><div className="actions"><button onClick={()=>exportCSV('cmd')}><Download/>Export commande</button><button onClick={()=>exportCSV('arc')}><Download/>Export ARC</button><button onClick={()=>setTab('controle')}><CheckCircle/>Lancer contrôle</button></div><Editor title={`Commande normalisée (${cmdRows.length})`} type="cmd" rows={cmdRows}/><Editor title={`ARC normalisé (${arcRows.length})`} type="arc" rows={arcRows}/></main>}
 {tab==='controle'&&<main><section className="summary"><div className="ok"><CheckCircle/><b>{ok}</b><span>Conformes</span></div><div className="warn"><AlertTriangle/><b>{ec}</b><span>Écarts</span></div><div className="alert"><AlertTriangle/><b>{al}</b><span>Alertes</span></div></section><div className="actions"><button onClick={()=>exportCSV('rapport')}><Download/>Export rapport CSV</button><button onClick={()=>window.print()}><FileText/>Imprimer</button></div><section className="card wide"><h2>Rapport conformité ARC / Commande</h2><div className="table"><table><thead><tr><th>Statut</th><th>Référence</th><th>Désignation</th><th>Détail</th><th>Qté commande</th><th>Qté ARC</th><th>Prix commande</th><th>Prix ARC</th></tr></thead><tbody>{results.length===0&&<tr><td colSpan="8" className="empty">Aucun contrôle</td></tr>}{results.map((r,i)=><tr key={i} className={r.status.toLowerCase()}><td><b>{r.status}</b></td><td>{r.reference}</td><td>{r.designation}</td><td>{r.message}</td><td>{r.cmd?.quantite||''}</td><td>{r.arc?.quantite||''}</td><td>{r.cmd?.prix||''}</td><td>{r.arc?.prix||''}</td></tr>)}</tbody></table></div></section></main>}</div>
}
