
import React,{useEffect,useMemo,useState}from'react'
import{MapPin,Truck,Calculator,Copy,AlertTriangle,CheckCircle,Loader2,Euro,Clock,Route,Printer,Download,Trash2,History,Home,ShieldCheck,Map}from'lucide-react'

const DEPOTS=[
 {id:'ambert',nom:'BATI BRICO Ambert',adresse:'92 Avenue Michel Omerin, 63600 AMBERT',lat:45.5507,lon:3.7419},
 {id:'arlanc',nom:'BATI BRICO Arlanc',adresse:'15 Route de Beurières, 63220 ARLANC',lat:45.4109,lon:3.7254}
]

const ZONES=[
 {zone:'Zone 1',tarif:32,max:32},
 {zone:'Zone 2',tarif:41,max:41},
 {zone:'Zone 3',tarif:51,max:51},
 {zone:'Zone 4',tarif:60,max:60},
 {zone:'Zone 5',tarif:70,max:70},
 {zone:'Zone 6',tarif:80,max:80},
 {zone:'Zone 7',tarif:90,max:90},
 {zone:'Zone 8',tarif:117,max:117}
]

const COST_KM=0.77
const COST_HOUR=16
const LOAD_MIN=30
const UNLOAD_MIN=30
const TVA=0.20
const HISTORY_KEY='bati_brico_transport_history_v21'

function euro(n){return `${Number(n||0).toFixed(2).replace('.',',')} €`}
function km(n){return `${Number(n||0).toFixed(1).replace('.',',')} km`}
function minutesToText(min){
 const h=Math.floor(min/60),m=Math.round(min%60)
 if(h<=0)return `${m} min`
 if(m===0)return `${h} h`
 return `${h} h ${String(m).padStart(2,'0')}`
}
function getZone(cost){
 const found=ZONES.find(z=>cost<=z.max)
 if(found)return found
 return {zone:'Sur devis',tarif:null,max:null}
}
function getProfitStatus(result){
 if(!result?.zone?.tarif)return {label:'Sur devis',className:'red',text:'Coût supérieur au barème : devis conseillé.'}
 const diff=result.zone.tarif-result.cost
 if(diff>=10)return {label:'Rentable',className:'green',text:`Marge de sécurité confortable : ${euro(diff)} HT.`}
 if(diff>=0)return {label:'Limite',className:'orange',text:`Livraison proche de l'équilibre : ${euro(diff)} HT.`}
 return {label:'À perte',className:'red',text:`Déficit estimé : ${euro(diff)} HT.`}
}
function mapUrl(result,geo){
 if(!result||!geo)return ''
 const d=result.depot
 return `https://www.openstreetmap.org/export/embed.html?bbox=${Math.min(d.lon,geo.lon)-0.03}%2C${Math.min(d.lat,geo.lat)-0.03}%2C${Math.max(d.lon,geo.lon)+0.03}%2C${Math.max(d.lat,geo.lat)+0.03}&layer=mapnik&marker=${geo.lat}%2C${geo.lon}`
}
function osmLink(result,geo){
 if(!result||!geo)return '#'
 const d=result.depot
 return `https://www.openstreetmap.org/directions?engine=fossgis_osrm_car&route=${d.lat}%2C${d.lon}%3B${geo.lat}%2C${geo.lon}`
}
function resultText(result,address,client){
 if(!result)return ''
 const tarifHT=result.zone.tarif
 const status=getProfitStatus(result)
 return [
  'ASSISTANT TRANSPORT BATI BRICO',
  '',
  client?`Client / chantier : ${client}`:'',
  `Adresse : ${address}`,
  `Dépôt retenu : ${result.depot.nom}`,
  `Adresse dépôt : ${result.depot.adresse}`,
  `Distance aller : ${km(result.distanceOneWay)}`,
  `Distance retour : ${km(result.distanceOneWay)}`,
  `Distance totale A/R : ${km(result.distanceAR)}`,
  `Temps route A/R : ${minutesToText(result.durationAR)}`,
  `Chargement : ${LOAD_MIN} min`,
  `Déchargement : ${UNLOAD_MIN} min`,
  `Temps total : ${minutesToText(result.totalMinutes)}`,
  `Coût carburant : ${euro(result.fuelCost)} HT`,
  `Coût chauffeur : ${euro(result.driverCost)} HT`,
  `Coût estimé total : ${euro(result.cost)} HT`,
  `Zone conseillée : ${result.zone.zone}`,
  tarifHT?`Tarif : ${euro(tarifHT)} HT / ${euro(tarifHT*(1+TVA))} TTC`:'Tarif : sur devis',
  tarifHT?`Écart estimé : ${euro(tarifHT-result.cost)} HT`:'',
  `Statut : ${status.label}`
 ].filter(Boolean).join('\n')
}
async function geocodeAddress(address){
 const url=`https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=fr&q=${encodeURIComponent(address)}`
 const res=await fetch(url,{headers:{'Accept':'application/json'}})
 if(!res.ok)throw new Error('Erreur géolocalisation')
 const data=await res.json()
 if(!data?.length)throw new Error('Adresse introuvable')
 return {lat:Number(data[0].lat),lon:Number(data[0].lon),display:data[0].display_name}
}
async function routeFromDepot(depot,dest){
 const url=`https://router.project-osrm.org/route/v1/driving/${depot.lon},${depot.lat};${dest.lon},${dest.lat}?overview=false&alternatives=false&steps=false`
 const res=await fetch(url)
 if(!res.ok)throw new Error('Erreur calcul itinéraire')
 const data=await res.json()
 if(data.code!=='Ok'||!data.routes?.length)throw new Error('Aucun itinéraire trouvé')
 const r=data.routes[0]
 const distanceOneWay=r.distance/1000
 const durationOneWay=r.duration/60
 const distanceAR=distanceOneWay*2
 const durationAR=durationOneWay*2
 const totalMinutes=durationAR+LOAD_MIN+UNLOAD_MIN
 const fuelCost=distanceAR*COST_KM
 const driverCost=(totalMinutes/60)*COST_HOUR
 const cost=fuelCost+driverCost
 const zone=getZone(cost)
 return {depot,distanceOneWay,durationOneWay,distanceAR,durationAR,totalMinutes,fuelCost,driverCost,cost,zone}
}

export default function App(){
 const[client,setClient]=useState('')
 const[address,setAddress]=useState('')
 const[loading,setLoading]=useState(false)
 const[error,setError]=useState('')
 const[result,setResult]=useState(null)
 const[geo,setGeo]=useState(null)
 const[allRoutes,setAllRoutes]=useState([])
 const[copied,setCopied]=useState(false)
 const[history,setHistory]=useState([])

 useEffect(()=>{
  try{setHistory(JSON.parse(localStorage.getItem(HISTORY_KEY)||'[]'))}catch(e){setHistory([])}
 },[])

 const status=useMemo(()=>getProfitStatus(result),[result])

 const saveHistory=(item)=>{
  const next=[item,...history.filter(h=>h.id!==item.id)].slice(0,30)
  setHistory(next)
  localStorage.setItem(HISTORY_KEY,JSON.stringify(next))
 }

 const calculate=async()=>{
  setError('')
  setResult(null)
  setAllRoutes([])
  setCopied(false)

  if(!address.trim()){
   setError('Renseigne une adresse complète ou au minimum une commune.')
   return
  }

  setLoading(true)
  try{
   const destination=await geocodeAddress(address)
   setGeo(destination)
   const routes=await Promise.all(DEPOTS.map(d=>routeFromDepot(d,destination)))
   routes.sort((a,b)=>a.cost-b.cost)
   const best=routes[0]
   setAllRoutes(routes)
   setResult(best)
   saveHistory({
    id:Date.now(),
    date:new Date().toLocaleString('fr-FR'),
    client,
    address:destination.display,
    shortAddress:address,
    depot:best.depot.nom,
    zone:best.zone.zone,
    tarif:best.zone.tarif,
    cost:best.cost,
    fuelCost:best.fuelCost,
    driverCost:best.driverCost,
    distanceAR:best.distanceAR,
    durationAR:best.durationAR,
    totalMinutes:best.totalMinutes,
    status:getProfitStatus(best).label
   })
  }catch(e){
   setError(e.message||'Erreur pendant le calcul.')
  }finally{
   setLoading(false)
  }
 }

 const copyResult=async()=>{
  if(!result)return
  await navigator.clipboard.writeText(resultText(result,geo?.display||address,client))
  setCopied(true)
 }

 const exportCSV=()=>{
  const rows=[
   ['Date','Client','Adresse','Dépôt','Zone','Tarif HT','Coût total','Coût carburant','Coût chauffeur','Écart HT','Distance A/R','Temps route A/R','Temps total','Statut'],
   ...history.map(h=>[
    h.date,h.client,h.address,h.depot,h.zone,h.tarif??'Sur devis',h.cost,h.fuelCost,h.driverCost,
    h.tarif?Number(h.tarif-h.cost).toFixed(2):'',
    h.distanceAR.toFixed(1),minutesToText(h.durationAR),minutesToText(h.totalMinutes),h.status
   ])
  ]
  const csv=rows.map(r=>r.map(v=>`"${String(v??'').replaceAll('"','""')}"`).join(';')).join('\n')
  const blob=new Blob([csv],{type:'text/csv;charset=utf-8'})
  const a=document.createElement('a')
  a.href=URL.createObjectURL(blob)
  a.download='historique_transport_bati_brico.csv'
  a.click()
 }

 const clearHistory=()=>{
  if(!confirm('Supprimer tout l’historique local ?'))return
  setHistory([])
  localStorage.removeItem(HISTORY_KEY)
 }

 const loadHistory=(h)=>{
  setClient(h.client||'')
  setAddress(h.shortAddress||h.address||'')
  window.scrollTo({top:0,behavior:'smooth'})
 }

 return <div className="app">
  <header>
   <div>
    <h1>BATI BRICO</h1>
    <p>Assistant Transport V2.1 — zone, coût réel, carte et détail du calcul</p>
   </div>
   <div className="pill">
    <Truck size={22}/>
    <div><span>Coût base</span><b>0,77 €/km + 16 €/h</b></div>
   </div>
  </header>

  <main className="grid">
   <section className="card">
    <h2><MapPin/>Adresse de livraison</h2>

    <label>Nom client / chantier</label>
    <input value={client} onChange={e=>setClient(e.target.value)} placeholder="Ex : Dupont / Chantier Martin"/>

    <label>Adresse complète</label>
    <input value={address} onChange={e=>setAddress(e.target.value)} placeholder="Ex : Place de la mairie 63880 Olliergues"/>

    <button className="primary" onClick={calculate} disabled={loading}>
     {loading?<Loader2 className="spin"/>:<Calculator/>}
     Calculer zone transport
    </button>

    {error&&<div className="error"><AlertTriangle/> {error}</div>}

    <div className="info">
     <b>Temps ajouté automatiquement :</b><br/>
     30 min chargement + 30 min déchargement.
    </div>
   </section>

   <section className="card">
    <h2><Euro/>Barème zones HT</h2>
    <table>
     <thead><tr><th>Zone</th><th>Tarif HT</th><th>TTC</th></tr></thead>
     <tbody>{ZONES.map(z=><tr key={z.zone}><td>{z.zone}</td><td>{euro(z.tarif)}</td><td>{euro(z.tarif*(1+TVA))}</td></tr>)}</tbody>
    </table>
    <div className="info">
     Coût estimé supérieur à 117 € HT : <b>sur devis</b>.
    </div>
   </section>

   {result&&<section className="card wide result printArea">
    <div className="resultHead">
     <div>
      <h2><CheckCircle/>Résultat transport</h2>
      <p>{geo?.display}</p>
     </div>
     <div className="buttons">
      <button onClick={copyResult}><Copy/> {copied?'Copié':'Copier'}</button>
      <button onClick={()=>window.print()}><Printer/> PDF / Imprimer</button>
     </div>
    </div>

    <div className={`statusBox ${status.className}`}>
     <ShieldCheck/>
     <div><b>{status.label}</b><span>{status.text}</span></div>
    </div>

    <div className="score">
     <div className="zoneBox">
      <span>Zone conseillée</span>
      <b>{result.zone.zone}</b>
      <small>{result.zone.tarif?`${euro(result.zone.tarif)} HT / ${euro(result.zone.tarif*(1+TVA))} TTC`:'Sur devis'}</small>
     </div>
     <div><Home/><span>Dépôt retenu</span><b>{result.depot.nom.replace('BATI BRICO ','')}</b><small>{result.depot.adresse}</small></div>
     <div><Route/><span>Distance A/R</span><b>{km(result.distanceAR)}</b><small>Aller {km(result.distanceOneWay)} + retour {km(result.distanceOneWay)}</small></div>
     <div><Clock/><span>Temps total</span><b>{minutesToText(result.totalMinutes)}</b><small>Route {minutesToText(result.durationAR)} + 1 h manutention</small></div>
     <div><Euro/><span>Coût estimé</span><b>{euro(result.cost)}</b><small>HT</small></div>
    </div>

    <div className="details">
     <h3>Détail du calcul</h3>
     <div className="detailGrid">
      <div><span>Carburant</span><b>{km(result.distanceAR)} × 0,77 € = {euro(result.fuelCost)}</b></div>
      <div><span>Chauffeur</span><b>{minutesToText(result.totalMinutes)} × 16 €/h = {euro(result.driverCost)}</b></div>
      <div><span>Coût total</span><b>{euro(result.cost)} HT</b></div>
      <div><span>Écart avec tarif</span><b>{result.zone.tarif?euro(result.zone.tarif-result.cost):'Sur devis'}</b></div>
     </div>
    </div>

    <div className="mapBox noPrint">
     <h3><Map/>Carte</h3>
     <iframe title="Carte transport" src={mapUrl(result,geo)}></iframe>
     <a href={osmLink(result,geo)} target="_blank" rel="noreferrer">Ouvrir l’itinéraire dans OpenStreetMap</a>
    </div>

    <h3>Comparaison des dépôts</h3>
    <table>
     <thead><tr><th>Dépôt</th><th>Adresse dépôt</th><th>Distance A/R</th><th>Temps route A/R</th><th>Temps total</th><th>Coût estimé</th></tr></thead>
     <tbody>{allRoutes.map(r=><tr key={r.depot.id} className={r.depot.id===result.depot.id?'selected':''}>
      <td>{r.depot.nom}</td>
      <td>{r.depot.adresse}</td>
      <td>{km(r.distanceAR)}</td>
      <td>{minutesToText(r.durationAR)}</td>
      <td>{minutesToText(r.totalMinutes)}</td>
      <td>{euro(r.cost)}</td>
     </tr>)}</tbody>
    </table>
   </section>}

   <section className="card wide noPrint">
    <div className="resultHead">
     <h2><History/>Historique local</h2>
     <div className="buttons">
      <button onClick={exportCSV}><Download/> Export CSV</button>
      <button className="danger" onClick={clearHistory}><Trash2/> Vider</button>
     </div>
    </div>
    <table>
     <thead><tr><th>Date</th><th>Client</th><th>Adresse</th><th>Dépôt</th><th>Zone</th><th>Coût</th><th>Statut</th><th></th></tr></thead>
     <tbody>{history.length===0&&<tr><td colSpan="8" className="empty">Aucun calcul enregistré pour le moment.</td></tr>}
      {history.map(h=><tr key={h.id}>
       <td>{h.date}</td><td>{h.client}</td><td>{h.shortAddress||h.address}</td><td>{h.depot.replace('BATI BRICO ','')}</td><td>{h.zone}</td><td>{euro(h.cost)}</td><td>{h.status}</td>
       <td><button className="mini" onClick={()=>loadHistory(h)}>Recharger</button></td>
      </tr>)}
     </tbody>
    </table>
   </section>
  </main>
 </div>
}
