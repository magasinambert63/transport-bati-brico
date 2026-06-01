
import React,{useMemo,useState}from'react'
import{MapPin,Truck,Calculator,Copy,AlertTriangle,CheckCircle,Loader2,Euro,Clock,Route}from'lucide-react'

const DEPOTS=[
 {id:'ambert',nom:'BATI BRICO Ambert',adresse:'92 Avenue Michel Omerin 63600 Ambert',lat:45.5507,lon:3.7419},
 {id:'arlanc',nom:'BATI BRICO Arlanc',adresse:'15 Route de Beurieres 63220 Arlanc',lat:45.4109,lon:3.7254}
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
function buildResultText(result,address){
 if(!result)return ''
 const tarifHT=result.zone.tarif
 return [
  'CALCUL TRANSPORT BATI BRICO',
  '',
  `Adresse : ${address}`,
  `Dépôt retenu : ${result.depot.nom}`,
  `Distance A/R : ${km(result.distanceAR)}`,
  `Temps route A/R : ${minutesToText(result.durationAR)}`,
  `Temps total avec chargement/déchargement : ${minutesToText(result.totalMinutes)}`,
  `Coût estimé : ${euro(result.cost)}`,
  `Zone conseillée : ${result.zone.zone}`,
  tarifHT?`Tarif : ${euro(tarifHT)} HT / ${euro(tarifHT*(1+TVA))} TTC`:'Tarif : sur devis',
  tarifHT?`Écart estimé : ${euro(tarifHT-result.cost)}`:'Écart estimé : non calculé'
 ].join('\n')
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
 const route=data.routes[0]
 const distanceOneWay=route.distance/1000
 const durationOneWay=route.duration/60
 const distanceAR=distanceOneWay*2
 const durationAR=durationOneWay*2
 const totalMinutes=durationAR+LOAD_MIN+UNLOAD_MIN
 const cost=distanceAR*COST_KM+(totalMinutes/60)*COST_HOUR
 const zone=getZone(cost)
 return {depot,distanceOneWay,durationOneWay,distanceAR,durationAR,totalMinutes,cost,zone}
}

export default function App(){
 const[client,setClient]=useState('')
 const[adresse,setAdresse]=useState('')
 const[ville,setVille]=useState('')
 const[cp,setCp]=useState('')
 const[loading,setLoading]=useState(false)
 const[error,setError]=useState('')
 const[result,setResult]=useState(null)
 const[geo,setGeo]=useState(null)
 const[allRoutes,setAllRoutes]=useState([])
 const[copied,setCopied]=useState(false)

 const fullAddress=useMemo(()=>[adresse,cp,ville].filter(Boolean).join(' '),[adresse,cp,ville])

 const calculate=async()=>{
  setError('')
  setResult(null)
  setAllRoutes([])
  setCopied(false)

  if(!fullAddress.trim()){
   setError('Renseigne au minimum une adresse, un code postal ou une commune.')
   return
  }

  setLoading(true)
  try{
   const destination=await geocodeAddress(fullAddress)
   setGeo(destination)
   const routes=await Promise.all(DEPOTS.map(d=>routeFromDepot(d,destination)))
   routes.sort((a,b)=>a.cost-b.cost)
   setAllRoutes(routes)
   setResult(routes[0])
  }catch(e){
   setError(e.message||'Erreur pendant le calcul.')
  }finally{
   setLoading(false)
  }
 }

 const copyResult=async()=>{
  if(!result)return
  const text=[
   client?`Client : ${client}`:'',
   buildResultText(result,geo?.display||fullAddress)
  ].filter(Boolean).join('\n')
  await navigator.clipboard.writeText(text)
  setCopied(true)
 }

 return <div className="app">
  <header>
   <div>
    <h1>BATI BRICO</h1>
    <p>Calculateur Zone Transport — OpenStreetMap / OSRM</p>
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

    <label>Adresse</label>
    <input value={adresse} onChange={e=>setAdresse(e.target.value)} placeholder="Ex : 12 route du Moulin"/>

    <div className="two">
     <div>
      <label>Code postal</label>
      <input value={cp} onChange={e=>setCp(e.target.value)} placeholder="Ex : 63880"/>
     </div>
     <div>
      <label>Ville / commune</label>
      <input value={ville} onChange={e=>setVille(e.target.value)} placeholder="Ex : Olliergues"/>
     </div>
    </div>

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
     Si le coût estimé dépasse 117 € HT : <b>Sur devis</b>.
    </div>
   </section>

   {result&&<section className="card wide result">
    <div className="resultHead">
     <div>
      <h2><CheckCircle/>Résultat transport</h2>
      <p>{geo?.display}</p>
     </div>
     <button onClick={copyResult}><Copy/> {copied?'Copié':'Copier résultat'}</button>
    </div>

    <div className="score">
     <div className="zoneBox">
      <span>Zone conseillée</span>
      <b>{result.zone.zone}</b>
      <small>{result.zone.tarif?`${euro(result.zone.tarif)} HT / ${euro(result.zone.tarif*(1+TVA))} TTC`:'Sur devis'}</small>
     </div>
     <div><Route/><span>Distance A/R</span><b>{km(result.distanceAR)}</b></div>
     <div><Clock/><span>Temps total</span><b>{minutesToText(result.totalMinutes)}</b></div>
     <div><Euro/><span>Coût estimé</span><b>{euro(result.cost)}</b></div>
    </div>

    <div className={result.zone.tarif ? (result.zone.tarif-result.cost>=0?'margin good':'margin bad') : 'margin bad'}>
     {result.zone.tarif
      ? <>Écart estimé : <b>{euro(result.zone.tarif-result.cost)}</b> HT</>
      : <>Coût supérieur au barème : <b>tarif sur devis conseillé</b></>}
    </div>

    <h3>Comparaison des dépôts</h3>
    <table>
     <thead><tr><th>Dépôt</th><th>Distance A/R</th><th>Temps route A/R</th><th>Temps total</th><th>Coût estimé</th></tr></thead>
     <tbody>{allRoutes.map(r=><tr key={r.depot.id} className={r.depot.id===result.depot.id?'selected':''}>
      <td>{r.depot.nom}</td>
      <td>{km(r.distanceAR)}</td>
      <td>{minutesToText(r.durationAR)}</td>
      <td>{minutesToText(r.totalMinutes)}</td>
      <td>{euro(r.cost)}</td>
     </tr>)}</tbody>
    </table>
   </section>}
  </main>
 </div>
}
