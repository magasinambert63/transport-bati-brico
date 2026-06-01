
import React,{useMemo,useState}from'react'
import{Upload,FileText,CheckCircle,AlertTriangle,Download,Trash2,Plus,Wand2,ScanText,Loader2,RefreshCw,HelpCircle}from'lucide-react'
import * as pdfjsLib from'pdfjs-dist'
import Tesseract from'tesseract.js'

pdfjsLib.GlobalWorkerOptions.workerSrc=`https://unpkg.com/pdfjs-dist@4.10.38/build/pdf.worker.min.mjs`

const clean=s=>String(s||'').replace(/\s+/g,' ').trim()
const nval=s=>Number(String(s||'').replace(',','.').replace(/[^\d.]/g,'')||0)
const qte=s=>{const m=String(s||'').match(/(\d+(?:[,.]\d+)?)/);return m?Number(m[1].replace(',','.')):0}
const fmt=n=>Number.isInteger(n)?String(n):String(n).replace('.',',')
const units='PCE|PCS|ML|M2|M3|CAR|BTE|BT|ROU|SAC|UN|PAL|PIL|PLA|SEA|KG|L|COL|PAQ'
const adminWords=/(TOTAL|T\.?V\.?A|IBAN|SIRET|SIREN|APE|RCS|PAGE|ADRESSE|CONDITIONS|RÈGLEMENT|REGLEMENT|NET A PAYER|LIVRAISON|EMAIL|COURRIEL|TÉL|TEL|FAX|BANQUE|TVA|MONTANT|ECO CONTRIBUTION|CODE DOUANIER|EAN|CLIENT|FOURNISSEUR|COMMANDE VENTE|CONFIRMATION DE COMMANDE|BNP|BIC|SARL|SAS|CAPITAL|RUE|AVENUE|POITIERS|AMBERT|FRANCE|FRA|N° CLIENT|VOTRE COMMERCIAL|SOPHIE|DOMINIQUE)/i
const articleWords=/(VIS|RONDELLE|ECROU|ÉCROU|POINTE|TUYAU|KIT|MITIGEUR|FLEX|EMB|REDUCTEUR|RÉDUCTEUR|GROUPE|SECURITE|SÉCURITÉ|DETENDEUR|DÉTENDEUR|RACCORD|PLACO|PLAQUE|BA13|ENDUIT|COLLE|ROUE|COURONNE|MORTIER|CIMENT|BOIS|PANNEAU|OSB|MDF|CHEVILLE|BOULON|TUBE|SIPHON|COUDE|MANCHON|EQUERRE|ÉQUERRE|RAL|FORMEL|HOX|PLASTIKA)/i

function normalizeRef(ref){return String(ref||'').toUpperCase().replace(/[^A-Z0-9]/g,'').trim()}
function normalizeUnit(u){
 const x=String(u||'').toUpperCase().trim()
 if(['PCS','UN'].includes(x))return 'PCE'
 if(['BT'].includes(x))return 'BTE'
 return x
}
function isEan(ref){return /^\d{13}$/.test(normalizeRef(ref))}
function isAdminLine(s){return adminWords.test(s)}
function scoreArticle(ref,rest,qty,unit){
 let score=0
 if(ref && /^[A-Z]?\d{5,12}[A-Z0-9]*$/.test(normalizeRef(ref)))score+=2
 if(ref && !isEan(ref))score+=2
 if(articleWords.test(rest))score+=3
 if(qty)score+=2
 if(unit)score+=1
 if(/\d+\s*\/\s*\d+/.test(rest))score+=1
 if(isAdminLine(rest))score-=4
 return score
}
function dedupe(rows){
 const seen=new Set(),out=[]
 for(const r of rows){
  const k=normalizeRef(r.reference)+'|'+(r.quantite||'')+'|'+(r.designation||'').slice(0,30)
  if(!seen.has(k)){seen.add(k);out.push(r)}
 }
 return out
}
function extractQtyUnits(text){
 const found=[]
 const re=new RegExp(`(\\d+(?:[,.]\\d+)?)\\s*(${units})`,'gi')
 let m
 while((m=re.exec(text))!==null){
  found.push({qty:fmt(qte(m[1])),unit:normalizeUnit(m[2]),raw:m[0]})
 }
 return found
}

function extractCommandeBatiBrico(text){
 const flat=clean(text)
 const rows=[]

 // Format réel BATI BRICO :
 // 3171076 (Notre réf: 0725303 ECROU 6 PANS ... 1,000 CAR 2,000PCE 5,50 11,00 ...
 const articleStart=/\b[A-Z]?\d{5,12}[A-Z0-9]*\s+\(Notre réf:/gi
 const starts=[]
 let sm
 while((sm=articleStart.exec(flat))!==null){starts.push(sm.index)}
 starts.push(flat.length)

 for(let i=0;i<starts.length-1;i++){
  const chunk=flat.slice(starts[i],starts[i+1]).trim()
  const head=chunk.match(/^([A-Z]?\d{5,12}[A-Z0-9]*)\s+\(Notre réf:\s*([A-Z0-9]+)\s+(.+)$/i)
  if(!head)continue

  const ref=head[1]
  const refBati=head[2]
  let rest=head[3]

  if(isEan(ref))continue

  const qMatches=extractQtyUnits(rest)
  if(qMatches.length<2)continue

  const qCond=qMatches[0]
  const qCmd=qMatches[1]

  const firstQtyIndex=rest.search(new RegExp(`\\d+(?:[,.]\\d+)?\\s*(${units})`,'i'))
  let designation=firstQtyIndex>0?rest.slice(0,firstQtyIndex):rest
  designation=clean(
    designation
      .replace(/Dont Eco.*$/i,'')
      .replace(/POIDS TOTAL.*$/i,'')
      .replace(/ADRESSE DE LIVRAISON.*$/i,'')
  )

  if(!designation || isAdminLine(designation))continue

  rows.push({
   id:Date.now()+rows.length,
   reference:ref,
   refBati,
   designation,
   quantite:qCmd.qty,
   unite:qCmd.unit,
   conditionnement:`${qCond.raw} / ${qCmd.raw}`,
   source:chunk,
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
  if(isAdminLine(line))continue
  const mm=line.match(/^([A-Z]?\d{5,12}[A-Z0-9]*)\s+(.+)$/i)
  if(!mm)continue
  const ref=mm[1], rest=mm[2]
  if(isEan(ref))continue

  let qty='',unit='',conditionnement=''
  const quantities=extractQtyUnits(rest)
  const slash=rest.match(/\b(\d+(?:[,.]\d+)?)\s*\/\s*(\d+(?:[,.]\d+)?)\b/)
  if(slash){
   qty=fmt(Math.max(qte(slash[1]),qte(slash[2])))
   conditionnement=slash[0]
  }else if(quantities.length){
   const q=quantities[quantities.length-1]
   qty=q.qty;unit=q.unit;conditionnement=quantities.map(x=>x.raw).join(' / ')
  }else{
   const nums=[...rest.matchAll(/\b\d+(?:[,.]\d+)?\b/g)].map(x=>x[0]).filter(x=>nval(x)>0&&nval(x)<5000)
   if(nums.length)qty=fmt(nval(nums[0]))
  }

  const idx=rest.search(/\b\d+(?:[,.]\d+)?(?:\s*\/\s*\d+(?:[,.]\d+)?)?\b/)
  let designation=idx>5?rest.slice(0,idx):rest
  designation=clean(designation.replace(/EAN.*$/i,'').replace(/Code douanier.*$/i,''))
  const score=scoreArticle(ref,designation+' '+rest,qty,unit)
  if(score<4)continue

  rows.push({id:Date.now()+rows.length,reference:ref,refBati:'',designation,quantite:qty,unite:unit,conditionnement,source:line,confiance:score>=7?'Forte':'Moyenne'})
 }

 return dedupe(rows)
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
  const a=arc[idx]
  const cq=qte(c.quantite), aq=qte(a.quantite)
  const cu=normalizeUnit(c.unite), au=normalizeUnit(a.unite)

  let status='OK', message='Conforme'
  if(cq && aq && Math.abs(cq-aq)>=0.001){
   if(cu && au && cu===au){
    status='ECART QTE'
    message=`Même unité ${cu} : commande ${c.quantite} / ARC ${a.quantite}`
   }else{
    status='A VERIFIER'
    message=`Référence trouvée, quantité/conditionnement à vérifier : commande ${c.quantite} ${cu||''} / ARC ${a.quantite} ${au||''}`
   }
  }else if(cu && au && cu!==au){
   status='A VERIFIER'
   message=`Référence et quantité proches, mais unité différente : commande ${cu} / ARC ${au}`
  }

  out.push({status,reference:c.reference,refBati:c.refBati,designation:c.designation||a.designation,message,cmd:c,arc:a})
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
 const ok=results.filter(r=>r.status==='OK').length
 const ec=results.filter(r=>r.status==='ECART QTE').length
 const verif=results.filter(r=>r.status==='A VERIFIER').length
 const man=results.filter(r=>r.status==='MANQUANT').length
 const sup=results.filter(r=>r.status==='SUPPLEMENTAIRE').length

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
 const add=(type)=>(type==='cmd'?setCmdRows:setArcRows)(rows=>[...rows,{id:Date.now(),reference:'',refBati:'',designation:'',quantite:'',unite:'',conditionnement:'',source:'',confiance:'Manuel'}])
 const del=(type,id)=>(type==='cmd'?setCmdRows:setArcRows)(rows=>rows.filter(r=>r.id!==id))
 const exportCSV=kind=>{
  let rows,fn
  if(kind==='rapport'){rows=[['Statut','Réf fournisseur','Réf BATI','Désignation','Message','Qté commande','Unité commande','Qté ARC','Unité ARC'],...results.map(r=>[r.status,r.reference,r.refBati,r.designation,r.message,r.cmd?.quantite||'',r.cmd?.unite||'',r.arc?.quantite||'',r.arc?.unite||''])];fn='rapport_controle_arc_bati_brico.csv'}
  else{const s=kind==='cmd'?cmdRows:arcRows;rows=[['Réf fournisseur','Réf BATI','Désignation','Quantité','Unité','Conditionnement','Confiance','Source'],...s.map(r=>[r.reference,r.refBati,r.designation,r.quantite,r.unite,r.conditionnement,r.confiance,r.source])];fn=kind==='cmd'?'commande_bati_brico_normalisee.csv':'arc_fournisseur_normalise.csv'}
  const b=new Blob([rows.map(r=>r.map(esc).join(';')).join('\n')],{type:'text/csv;charset=utf-8'})
  const a=document.createElement('a');a.href=URL.createObjectURL(b);a.download=fn;a.click()
 }

 const Editor=({title,type,rows})=><section className="card wide"><div className="head"><h2>{title}</h2><button onClick={()=>add(type)}><Plus size={16}/>Ajouter ligne</button></div><div className="table"><table><thead><tr><th>Réf fournisseur</th><th>Réf BATI</th><th>Désignation</th><th>Qté</th><th>Unité</th><th>Conditionnement</th><th>Confiance</th><th></th></tr></thead><tbody>{rows.length===0&&<tr><td colSpan="8" className="empty">Aucune ligne détectée</td></tr>}{rows.map(r=><tr key={r.id}><td><input value={r.reference} onChange={e=>upd(type,r.id,'reference',e.target.value)}/></td><td><input value={r.refBati||''} onChange={e=>upd(type,r.id,'refBati',e.target.value)}/></td><td><input value={r.designation} onChange={e=>upd(type,r.id,'designation',e.target.value)}/></td><td><input value={r.quantite} onChange={e=>upd(type,r.id,'quantite',e.target.value)}/></td><td><input value={r.unite||''} onChange={e=>upd(type,r.id,'unite',e.target.value)}/></td><td><input value={r.conditionnement||''} onChange={e=>upd(type,r.id,'conditionnement',e.target.value)}/></td><td>{r.confiance}</td><td><button className="danger mini" onClick={()=>del(type,r.id)}><Trash2 size={14}/></button></td></tr>)}</tbody></table></div></section>

 return <div className="app">
  <header><div><h1>BATI BRICO</h1><p>Contrôle ARC fournisseur V4.2 — moteur commande BATI corrigé</p></div><div className="status"><span>Contrôle</span><b>{results.length?`${ok} OK / ${verif} à vérifier / ${ec+man+sup} alerte(s)`:'En attente'}</b></div></header>
  <nav><button className={tab==='import'?'active':''}onClick={()=>setTab('import')}>1. Import</button><button className={tab==='validation'?'active':''}onClick={()=>setTab('validation')}>2. Validation</button><button className={tab==='controle'?'active':''}onClick={()=>setTab('controle')}>3. Contrôle</button></nav>
  {tab==='import'&&<main className="grid"><section className="card"><h2><Upload/>Commande BATI BRICO</h2><p>Commande fournisseur BATI BRICO, format connu.</p><input type="file" accept=".pdf,.txt,.csv,image/*" onChange={e=>importFile(e.target.files[0],'cmd')}/><textarea value={cmdText} onChange={e=>setCmdText(e.target.value)} placeholder="Texte commande extrait automatiquement ou collé ici..."/><button onClick={parseCmd}><Wand2 size={16}/>Extraire commande BATI</button></section><section className="card"><h2><FileText/>ARC / confirmation fournisseur</h2><p>PDF, scan, image ou confirmation fournisseur.</p><input type="file" accept=".pdf,.txt,.csv,image/*" onChange={e=>importFile(e.target.files[0],'arc')}/><textarea value={arcText} onChange={e=>setArcText(e.target.value)} placeholder="Texte ARC extrait automatiquement ou collé ici..."/><button onClick={parseArc}><Wand2 size={16}/>Extraire ARC</button></section><section className="card wide notice">{loading?<Loader2 className="spin"/>:<ScanText/>}<b>État :</b> {status||'En attente d’import.'}<br/>V4.2 : extraction commande BATI BRICO corrigée à partir du format réel.<br/><button className="compare" onClick={parseBoth}><RefreshCw size={16}/>Extraire les 2 documents et comparer</button></section></main>}
  {tab==='validation'&&<main><div className="actions"><button onClick={()=>exportCSV('cmd')}><Download/>Export commande</button><button onClick={()=>exportCSV('arc')}><Download/>Export ARC</button><button onClick={()=>setTab('controle')}><CheckCircle/>Comparer</button></div><Editor title={`Commande BATI BRICO normalisée (${cmdRows.length})`} type="cmd" rows={cmdRows}/><Editor title={`ARC / confirmation fournisseur normalisé (${arcRows.length})`} type="arc" rows={arcRows}/></main>}
  {tab==='controle'&&<main><section className="summary"><div className="ok"><CheckCircle/><b>{ok}</b><span>Conformes</span></div><div className="check"><HelpCircle/><b>{verif}</b><span>À vérifier</span></div><div className="warn"><AlertTriangle/><b>{ec}</b><span>Écarts quantité</span></div><div className="alert"><AlertTriangle/><b>{man}</b><span>Manquants</span></div><div className="extra"><AlertTriangle/><b>{sup}</b><span>Supplémentaires</span></div></section><div className="actions"><button onClick={()=>exportCSV('rapport')}><Download/>Export rapport CSV</button><button onClick={()=>window.print()}><FileText/>Imprimer</button></div><section className="card wide"><h2>Rapport conformité ARC / Commande</h2><div className="table"><table><thead><tr><th>Statut</th><th>Réf fournisseur</th><th>Réf BATI</th><th>Désignation</th><th>Détail</th><th>Qté commande</th><th>Unité cmd</th><th>Qté ARC</th><th>Unité ARC</th></tr></thead><tbody>{results.length===0&&<tr><td colSpan="9" className="empty">Aucun contrôle</td></tr>}{results.map((r,i)=><tr key={i} className={r.status.toLowerCase().replaceAll(' ','-')}><td><b>{r.status}</b></td><td>{r.reference}</td><td>{r.refBati}</td><td>{r.designation}</td><td>{r.message}</td><td>{r.cmd?.quantite||''}</td><td>{r.cmd?.unite||''}</td><td>{r.arc?.quantite||''}</td><td>{r.arc?.unite||''}</td></tr>)}</tbody></table></div></section></main>}
 </div>
}
