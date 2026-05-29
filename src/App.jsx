
import React,{useMemo,useState}from'react'
import{Upload,FileText,CheckCircle,AlertTriangle,Download,Trash2,Plus,Wand2,ScanText,Loader2,RefreshCw}from'lucide-react'
import * as pdfjsLib from'pdfjs-dist'
import Tesseract from'tesseract.js'

pdfjsLib.GlobalWorkerOptions.workerSrc=`https://unpkg.com/pdfjs-dist@4.10.38/build/pdf.worker.min.mjs`

const clean=s=>String(s||'').replace(/\s+/g,' ').trim()
const nval=s=>Number(String(s||'').replace(',','.').replace(/[^\d.]/g,'')||0)
const qte=s=>{const m=String(s||'').match(/(\d+(?:[,.]\d+)?)/);return m?Number(m[1].replace(',','.')):0}
const fmt=n=>Number.isInteger(n)?String(n):String(n).replace('.',',')
const units='PCE|PCS|ML|M2|M3|CAR|BTE|BT|ROU|SAC|UN|PAL|PIL|PLA|SEA|KG|L'
const adminWords=/(TOTAL|T\.?V\.?A|IBAN|SIRET|SIREN|APE|RCS|PAGE|ADRESSE|CONDITIONS|RÈGLEMENT|REGLEMENT|NET A PAYER|LIVRAISON|EMAIL|COURRIEL|TÉL|TEL|FAX|BANQUE|TVA|MONTANT|ECO CONTRIBUTION|CODE DOUANIER|EAN|CLIENT|FOURNISSEUR|COMMANDE VENTE|CONFIRMATION DE COMMANDE|BNP|BIC|SARL|SAS|CAPITAL|RUE|AVENUE|POITIERS|AMBERT|FRANCE|FRA|N° CLIENT|VOTRE COMMERCIAL|SOPHIE|DOMINIQUE)/i
const articleWords=/(VIS|RONDELLE|ECROU|ÉCROU|POINTE|TUYAU|KIT|MITIGEUR|FLEX|EMB|REDUCTEUR|RÉDUCTEUR|GROUPE|SECURITE|SÉCURITÉ|DETENDEUR|DÉTENDEUR|RACCORD|PLACO|PLAQUE|BA13|ENDUIT|COLLE|ROUE|COURONNE|MORTIER|CIMENT|BOIS|PANNEAU|OSB|MDF|CHEVILLE|BOULON|TUBE|SIPHON|COUDE|MANCHON|EQUERRE|ÉQUERRE)/i

function isEan(ref){return /^\d{13}$/.test(ref)}
function looksPostalOrAdmin(ref,rest){
 if(/^(0?7\d{7,}|63\d{3}|86\d{3}|42\d{3}|57\d{3}|67\d{3})$/.test(ref) && !articleWords.test(rest))return true
 return false
}
function isBadLine(s){return adminWords.test(s)}
function scoreArticle(ref,rest,qty){
 let score=0
 if(ref && /^[A-Z]?\d{5,12}[A-Z0-9]*$/.test(ref))score+=2
 if(ref && !isEan(ref))score+=2
 if(articleWords.test(rest))score+=3
 if(qty)score+=2
 if(new RegExp(`\\b(${units})\\b`,'i').test(rest))score+=1
 if(/\d+\s*\/\s*\d+/.test(rest))score+=1
 if(isBadLine(rest))score-=4
 if(looksPostalOrAdmin(ref,rest))score-=5
 return score
}
function dedupe(rows){
 const seen=new Set(),out=[]
 for(const r of rows){
  const k=(r.reference||'')+'|'+(r.quantite||'')+'|'+(r.designation||'').slice(0,26)
  if(!seen.has(k)){seen.add(k);out.push(r)}
 }
 return out
}

function extractCommandeBatiBrico(text){
 const flat=clean(text)
 const rows=[]
 const re=/(\b[A-Z]?\d{5,12}[A-Z0-9]*\b)\s*\(Notre réf:?\s*([A-Z0-9]+)\)?\s+(.+?)\s+(\d+(?:[,.]\d+)?)\s*(${units})?\s+(\d+(?:[,.]\d+)?)(?:\s*(${units}))?/gi
 let m
 while((m=re.exec(flat))!==null){
  let designation=clean(m[3]).replace(/Dont Eco.*$/i,'')
  if(!designation||isBadLine(designation))continue
  rows.push({
   id:Date.now()+rows.length,
   reference:m[1],
   refBati:m[2],
   designation,
   quantite:fmt(qte(m[6]||m[4])),
   unite:m[7]||m[5]||'',
   source:clean(m[0]),
   confiance:'Commande BATI'
  })
 }
 return dedupe(rows)
}

function extractArcUniversel(text){
 const normalized=text
  .replace(/\r/g,'\n')
  .replace(/([A-Z]?\d{5,12}[A-Z0-9]*)\s+(?=[A-ZÉÈÀÂÊÎÔÛÇ])/g,'\n$1 ')
  .replace(/(EAN|Code douanier|Total HT|Total TTC|Conditions|Valeur nette)/gi,'\n$1')
 const lines=normalized.split(/\n+/).map(clean).filter(l=>l.length>2)
 let rows=[]

 for(const line of lines){
  if(isBadLine(line))continue
  const mm=line.match(/^([A-Z]?\d{5,12}[A-Z0-9]*)\s+(.+)$/i)
  if(!mm)continue
  const ref=mm[1], rest=mm[2]
  if(isEan(ref))continue

  const nums=[...rest.matchAll(/\b\d+(?:[,.]\d+)?(?:\s*\/\s*\d+(?:[,.]\d+)?)?\b/g)].map(x=>x[0])
  let qty=''
  const slash=nums.find(x=>x.includes('/'))
  if(slash){qty=fmt(Math.max(...slash.split('/').map(nval)))}
  else{
   const unitQty=rest.match(new RegExp(`(\\d+(?:[,.]\\d+)?)\\s*(${units})`,'i'))
   if(unitQty)qty=fmt(qte(unitQty[1]))
   else{
    const simple=nums.find(x=>nval(x)>0&&nval(x)<5000)
    if(simple)qty=fmt(nval(simple))
   }
  }

  const idx=rest.search(/\b\d+(?:[,.]\d+)?(?:\s*\/\s*\d+(?:[,.]\d+)?)?\b/)
  let designation=idx>5?rest.slice(0,idx):rest
  designation=clean(designation.replace(/EAN.*$/i,'').replace(/Code douanier.*$/i,''))
  const score=scoreArticle(ref,designation+' '+rest,qty)
  if(score<4)continue

  rows.push({id:Date.now()+rows.length,reference:ref,refBati:'',designation,quantite:qty,unite:'',source:line,confiance:score>=7?'Forte':'Moyenne'})
 }

 if(rows.length<3){
  for(let i=0;i<lines.length;i++){
   const r=lines[i].match(/^(\d{1,3}\s+)?([A-Z]?\d{5,12}[A-Z0-9]*)$/i)
   if(r&&!isBadLine(lines[i])){
    const ref=r[2]
    if(isEan(ref))continue
    let designation='',qty=''
    for(let j=i+1;j<Math.min(i+5,lines.length);j++){
     if(!isBadLine(lines[j])&&!/^EAN|Code douanier/i.test(lines[j])){designation=lines[j];break}
    }
    for(let j=i+1;j<Math.min(i+9,lines.length);j++){
     const qr=lines[j].match(new RegExp(`(\\d+(?:[,.]\\d+)?)(?:\\s*)(${units})`,'i'))
     if(qr){qty=fmt(qte(qr[1]));break}
    }
    const score=scoreArticle(ref,designation,qty)
    if(designation&&score>=4)rows.push({id:Date.now()+rows.length,reference:ref,refBati:'',designation,quantite:qty,unite:'',source:lines.slice(i,i+5).join(' '),confiance:score>=7?'Forte':'Moyenne'})
   }
  }
 }
 return dedupe(rows)
}


function normalizeRef(ref){
 return String(ref||'')
  .toUpperCase()
  .replace(/[^A-Z0-9]/g,'')
  .trim()
}

function compareRows(cmd,arc){
 const out=[],used=new Set()
 for(const c of cmd){
  const refCmd=normalizeRef(c.reference)
  const idx=arc.findIndex((a,i)=>!used.has(i)&&normalizeRef(a.reference)===refCmd)
  if(idx<0){
   out.push({status:'MANQUANT',reference:c.reference,refBati:c.refBati,designation:c.designation,message:'Article commandé absent de l’ARC / confirmation',cmd:c,arc:null})
   continue
  }
  used.add(idx)
  const a=arc[idx],cq=qte(c.quantite),aq=qte(a.quantite)
  const ok=!cq||!aq||Math.abs(cq-aq)<0.001
  out.push({status:ok?'OK':'ECART QTE',reference:c.reference,refBati:c.refBati,designation:c.designation||a.designation,message:ok?'Conforme':`Quantité commande ${c.quantite} / ARC ${a.quantite}`,cmd:c,arc:a})
 }
 arc.forEach((a,i)=>{
  if(!used.has(i)&&normalizeRef(a.reference)){
   out.push({status:'SUPPLEMENTAIRE',reference:a.reference,refBati:'',designation:a.designation,message:'Article présent sur ARC mais absent de la commande',cmd:null,arc:a})
  }
 })
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
async function ocrPdfPages(file,onProgress){
 const buf=await file.arrayBuffer()
 const pdf=await pdfjsLib.getDocument({data:buf}).promise
 let full=''
 for(let i=1;i<=pdf.numPages;i++){
  onProgress(`OCR page ${i}/${pdf.numPages}`)
  const page=await pdf.getPage(i)
  const viewport=page.getViewport({scale:2})
  const canvas=document.createElement('canvas')
  const ctx=canvas.getContext('2d')
  canvas.width=viewport.width
  canvas.height=viewport.height
  await page.render({canvasContext:ctx,viewport}).promise
  const res=await Tesseract.recognize(canvas,'fra+eng',{logger:m=>{if(m.status)onProgress(`OCR page ${i}/${pdf.numPages} — ${m.status} ${Math.round((m.progress||0)*100)}%`)}})
  full+=res.data.text+'\n'
 }
 return full
}
async function ocrImage(file,onProgress){
 const res=await Tesseract.recognize(file,'fra+eng',{logger:m=>{if(m.status)onProgress(`${m.status} ${Math.round((m.progress||0)*100)}%`)}})
 return res.data.text
}
const esc=v=>`"${String(v??'').replaceAll('"','""')}"`

export default function App(){
 const[cmdText,setCmdText]=useState(''),[arcText,setArcText]=useState('')
 const[cmdRows,setCmdRows]=useState([]),[arcRows,setArcRows]=useState([])
 const[tab,setTab]=useState('import'),[status,setStatus]=useState(''),[loading,setLoading]=useState(false)
 const results=useMemo(()=>compareRows(cmdRows,arcRows),[cmdRows,arcRows])
 const ok=results.filter(r=>r.status==='OK').length,ec=results.filter(r=>r.status==='ECART QTE').length,man=results.filter(r=>r.status==='MANQUANT').length,sup=results.filter(r=>r.status==='SUPPLEMENTAIRE').length

 const importFile=async(file,target)=>{
  if(!file)return
  setLoading(true);setStatus(`Lecture de ${file.name}...`)
  try{
   let text=''
   if(file.type==='application/pdf'||file.name.toLowerCase().endsWith('.pdf')){
    text=await extractPdfText(file)
    if(!text||text.length<50){setStatus('PDF scanné détecté : OCR automatique page par page...');text=await ocrPdfPages(file,setStatus)}
    else setStatus('Texte PDF extrait automatiquement.')
   }else if(file.type.startsWith('image/')){
    text=await ocrImage(file,setStatus);setStatus('OCR image terminé.')
   }else{text=await file.text();setStatus('Texte importé.')}
   target==='cmd'?setCmdText(text):setArcText(text)
  }catch(e){setStatus('Extraction impossible : colle le texte OCR manuellement.')}
  setLoading(false)
 }
 const parseCmd=()=>{const r=extractCommandeBatiBrico(cmdText);setCmdRows(r);setStatus(`${r.length} ligne(s) commande BATI BRICO détectée(s).`);setTab('validation')}
 const parseArc=()=>{const r=extractArcUniversel(arcText);setArcRows(r);setStatus(`${r.length} ligne(s) ARC / confirmation détectée(s).`);setTab('validation')}
 const parseBoth=()=>{const c=extractCommandeBatiBrico(cmdText),a=extractArcUniversel(arcText);setCmdRows(c);setArcRows(a);setStatus(`${c.length} ligne(s) commande et ${a.length} ligne(s) ARC détectée(s).`);setTab('controle')}

 const upd=(type,id,k,v)=>(type==='cmd'?setCmdRows:setArcRows)(rows=>rows.map(r=>r.id===id?{...r,[k]:v}:r))
 const add=(type)=>(type==='cmd'?setCmdRows:setArcRows)(rows=>[...rows,{id:Date.now(),reference:'',refBati:'',designation:'',quantite:'',unite:'',source:'',confiance:'Manuel'}])
 const del=(type,id)=>(type==='cmd'?setCmdRows:setArcRows)(rows=>rows.filter(r=>r.id!==id))
 const exportCSV=kind=>{
  let rows,fn
  if(kind==='rapport'){rows=[['Statut','Réf fournisseur','Réf BATI','Désignation','Message','Qté commande','Qté ARC'],...results.map(r=>[r.status,r.reference,r.refBati,r.designation,r.message,r.cmd?.quantite||'',r.arc?.quantite||''])];fn='rapport_controle_arc_bati_brico.csv'}
  else{const s=kind==='cmd'?cmdRows:arcRows;rows=[['Réf fournisseur','Réf BATI','Désignation','Quantité','Unité','Confiance','Source'],...s.map(r=>[r.reference,r.refBati,r.designation,r.quantite,r.unite,r.confiance,r.source])];fn=kind==='cmd'?'commande_bati_brico_normalisee.csv':'arc_fournisseur_normalise.csv'}
  const b=new Blob([rows.map(r=>r.map(esc).join(';')).join('\n')],{type:'text/csv;charset=utf-8'})
  const a=document.createElement('a');a.href=URL.createObjectURL(b);a.download=fn;a.click()
 }

 const Editor=({title,type,rows})=><section className="card wide"><div className="head"><h2>{title}</h2><button onClick={()=>add(type)}><Plus size={16}/>Ajouter ligne</button></div><div className="table"><table><thead><tr><th>Réf fournisseur</th><th>Réf BATI</th><th>Désignation</th><th>Qté</th><th>Unité</th><th>Confiance</th><th></th></tr></thead><tbody>{rows.length===0&&<tr><td colSpan="7" className="empty">Aucune ligne détectée</td></tr>}{rows.map(r=><tr key={r.id}><td><input value={r.reference} onChange={e=>upd(type,r.id,'reference',e.target.value)}/></td><td><input value={r.refBati||''} onChange={e=>upd(type,r.id,'refBati',e.target.value)}/></td><td><input value={r.designation} onChange={e=>upd(type,r.id,'designation',e.target.value)}/></td><td><input value={r.quantite} onChange={e=>upd(type,r.id,'quantite',e.target.value)}/></td><td><input value={r.unite||''} onChange={e=>upd(type,r.id,'unite',e.target.value)}/></td><td>{r.confiance}</td><td><button className="danger mini" onClick={()=>del(type,r.id)}><Trash2 size={14}/></button></td></tr>)}</tbody></table></div></section>

 return <div className="app">
  <header><div><h1>BATI BRICO</h1><p>Contrôle ARC fournisseur V3.1 — comparaison renforcée</p></div><div className="status"><span>Contrôle</span><b>{results.length?`${ok} OK / ${ec+man+sup} alerte(s)`:'En attente'}</b></div></header>
  <nav><button className={tab==='import'?'active':''}onClick={()=>setTab('import')}>1. Import</button><button className={tab==='validation'?'active':''}onClick={()=>setTab('validation')}>2. Validation</button><button className={tab==='controle'?'active':''}onClick={()=>setTab('controle')}>3. Contrôle</button></nav>
  {tab==='import'&&<main className="grid"><section className="card"><h2><Upload/>Commande BATI BRICO</h2><p>Commande fournisseur BATI BRICO, format connu.</p><input type="file" accept=".pdf,.txt,.csv,image/*" onChange={e=>importFile(e.target.files[0],'cmd')}/><textarea value={cmdText} onChange={e=>setCmdText(e.target.value)} placeholder="Texte commande extrait automatiquement ou collé ici..."/><button onClick={parseCmd}><Wand2 size={16}/>Extraire commande BATI</button></section><section className="card"><h2><FileText/>ARC / confirmation fournisseur</h2><p>PDF, scan, image ou confirmation fournisseur.</p><input type="file" accept=".pdf,.txt,.csv,image/*" onChange={e=>importFile(e.target.files[0],'arc')}/><textarea value={arcText} onChange={e=>setArcText(e.target.value)} placeholder="Texte ARC extrait automatiquement ou collé ici..."/><button onClick={parseArc}><Wand2 size={16}/>Extraire ARC</button></section><section className="card wide notice">{loading?<Loader2 className="spin"/>:<ScanText/>}<b>État :</b> {status||'En attente d’import.'}<br/>V3.1 : filtre article intelligent + comparaison références renforcée, suppression EAN/codes postaux/infos administratives, OCR PDF scanné page par page.<br/><button className="compare" onClick={parseBoth}><RefreshCw size={16}/>Extraire les 2 documents et comparer</button></section></main>}
  {tab==='validation'&&<main><div className="actions"><button onClick={()=>exportCSV('cmd')}><Download/>Export commande</button><button onClick={()=>exportCSV('arc')}><Download/>Export ARC</button><button onClick={()=>setTab('controle')}><CheckCircle/>Comparer</button></div><Editor title={`Commande BATI BRICO normalisée (${cmdRows.length})`} type="cmd" rows={cmdRows}/><Editor title={`ARC / confirmation fournisseur normalisé (${arcRows.length})`} type="arc" rows={arcRows}/></main>}
  {tab==='controle'&&<main><section className="summary"><div className="ok"><CheckCircle/><b>{ok}</b><span>Conformes</span></div><div className="warn"><AlertTriangle/><b>{ec}</b><span>Écarts quantité</span></div><div className="alert"><AlertTriangle/><b>{man}</b><span>Manquants</span></div><div className="extra"><AlertTriangle/><b>{sup}</b><span>Supplémentaires</span></div></section><div className="actions"><button onClick={()=>exportCSV('rapport')}><Download/>Export rapport CSV</button><button onClick={()=>window.print()}><FileText/>Imprimer</button></div><section className="card wide"><h2>Rapport conformité ARC / Commande</h2><div className="table"><table><thead><tr><th>Statut</th><th>Réf fournisseur</th><th>Réf BATI</th><th>Désignation</th><th>Détail</th><th>Qté commande</th><th>Qté ARC</th></tr></thead><tbody>{results.length===0&&<tr><td colSpan="7" className="empty">Aucun contrôle</td></tr>}{results.map((r,i)=><tr key={i} className={r.status.toLowerCase().replace(' ','-')}><td><b>{r.status}</b></td><td>{r.reference}</td><td>{r.refBati}</td><td>{r.designation}</td><td>{r.message}</td><td>{r.cmd?.quantite||''}</td><td>{r.arc?.quantite||''}</td></tr>)}</tbody></table></div></section></main>}
 </div>
}
