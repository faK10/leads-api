const express = require("express");
const cors = require("cors");
const sql = require("mssql");

const app = express();
app.use(cors());
app.use(express.json());

const SERVER = process.env.DB_SERVER || "sql.ar-vida.com.ar";
const USER = process.env.DB_USER;
const PASSWORD = process.env.DB_PASSWORD;
const PORT_DB = parseInt(process.env.DB_PORT || "1433");

const DB_MAP = {
  amm: process.env.DB_AMM || "LEADS_AMM",
  holavet: process.env.DB_HOLAVET || "LEADS_HOLAVET",
  holarene: process.env.DB_HOLARENE || "LEADS_HOLARENE",
};

function makeConfig(database) {
  return {
    server: SERVER, database, user: USER, password: PASSWORD, port: PORT_DB,
    options: { encrypt: true, trustServerCertificate: true, requestTimeout: 30000, connectionTimeout: 15000 },
    pool: { max: 10, min: 0, idleTimeoutMillis: 30000 },
  };
}

const pools = {};
async function getPool(producto) {
  const key = producto.toLowerCase();
  if (!DB_MAP[key]) throw new Error("Producto no válido: " + producto);
  if (!pools[key] || !pools[key].connected) {
    pools[key] = await new sql.ConnectionPool(makeConfig(DB_MAP[key])).connect();
    console.log("✅ Conectado: " + key + " → " + DB_MAP[key]);
  }
  return pools[key];
}

// ── API ENDPOINTS ──

app.get("/api/leads/:producto", async (req, res) => {
  try {
    const pool = await getPool(req.params.producto);
    const request = pool.request();
    let query = `SELECT ID AS id, Fecha_Ingreso_Leads AS fechaIngreso, Nombre AS nombre, Apellido AS apellido,
      Correo_Electronico AS email, Telefono1 AS telefono1, Telefono2 AS telefono2, Campana AS campana,
      Conjunto_Anuncios AS conjuntoAnuncios, Anuncio AS anuncio, Tipo_Telefono AS tipoTelefono,
      Neotel AS neotel, Comentarios AS comentarios FROM Leads_Final WHERE 1=1`;
    const { campana, fechaDesde, fechaHasta, buscar, neotel } = req.query;
    if (campana) { query += " AND Campana = @campana"; request.input("campana", sql.NVarChar, campana); }
    if (fechaDesde) { query += " AND Fecha_Ingreso_Leads >= @fechaDesde"; request.input("fechaDesde", sql.DateTime, new Date(fechaDesde)); }
    if (fechaHasta) { query += " AND Fecha_Ingreso_Leads <= @fechaHasta"; request.input("fechaHasta", sql.DateTime, new Date(fechaHasta + "T23:59:59")); }
    if (buscar) { query += " AND (Nombre LIKE @buscar OR Apellido LIKE @buscar OR Correo_Electronico LIKE @buscar)"; request.input("buscar", sql.NVarChar, "%" + buscar + "%"); }
    if (neotel) { query += " AND LTRIM(RTRIM(Neotel)) = @neotel"; request.input("neotel", sql.Char, neotel); }
    query += " ORDER BY Fecha_Ingreso_Leads DESC";
    const result = await request.query(query);
    const leads = result.recordset.map(r => ({ ...r, fechaIngreso: r.fechaIngreso ? new Date(r.fechaIngreso).toISOString().split("T")[0] : null, neotel: r.neotel ? r.neotel.trim() : null }));
    res.json({ producto: req.params.producto, total: leads.length, leads });
  } catch (err) { console.error("❌", err.message); res.status(500).json({ error: err.message }); }
});

app.get("/api/stats/:producto", async (req, res) => {
  try {
    const pool = await getPool(req.params.producto);
    const request = pool.request();
    let where = "WHERE 1=1";
    const { fechaDesde, fechaHasta } = req.query;
    if (fechaDesde) { where += " AND Fecha_Ingreso_Leads >= @fechaDesde"; request.input("fechaDesde", sql.DateTime, new Date(fechaDesde)); }
    if (fechaHasta) { where += " AND Fecha_Ingreso_Leads <= @fechaHasta"; request.input("fechaHasta", sql.DateTime, new Date(fechaHasta + "T23:59:59")); }
    const query = `SELECT COUNT(*) AS totalLeads, COUNT(DISTINCT Campana) AS totalCampanas, MIN(Fecha_Ingreso_Leads) AS primerLead, MAX(Fecha_Ingreso_Leads) AS ultimoLead FROM Leads_Final ${where};
      SELECT Campana AS campana, COUNT(*) AS cantidad FROM Leads_Final ${where} GROUP BY Campana ORDER BY cantidad DESC;
      SELECT CONVERT(VARCHAR(7), Fecha_Ingreso_Leads, 120) AS mes, COUNT(*) AS cantidad FROM Leads_Final ${where} GROUP BY CONVERT(VARCHAR(7), Fecha_Ingreso_Leads, 120) ORDER BY mes;
      SELECT LTRIM(RTRIM(Neotel)) AS neotel, COUNT(*) AS cantidad FROM Leads_Final ${where} GROUP BY LTRIM(RTRIM(Neotel)) ORDER BY cantidad DESC;`;
    const result = await request.query(query);
    res.json({ producto: req.params.producto, resumen: result.recordsets[0][0], porCampana: result.recordsets[1], porMes: result.recordsets[2], porNeotel: result.recordsets[3] });
  } catch (err) { console.error("❌", err.message); res.status(500).json({ error: err.message }); }
});

app.get("/api/filters/:producto", async (req, res) => {
  try {
    const pool = await getPool(req.params.producto);
    const campanas = await pool.request().query("SELECT DISTINCT Campana AS campana FROM Leads_Final WHERE Campana IS NOT NULL ORDER BY Campana");
    res.json({ producto: req.params.producto, campanas: campanas.recordset.map(r => r.campana) });
  } catch (err) { console.error("❌", err.message); res.status(500).json({ error: err.message }); }
});

// ── DASHBOARD HTML ──

app.get("/", (req, res) => {
  res.send(`<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Leads Dashboard</title>
<link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>📊</text></svg>">
<link href="https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;500;600;700;800&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
<script src="https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.1/chart.umd.min.js"><\/script>
<style>
:root{--bg:#06090f;--card:#111a2e;--border:#1b2845;--text:#e8ecf4;--muted:#8896b0;--dim:#566580;--blue:#3b82f6;--green:#10b981;--yellow:#f59e0b;--red:#ef4444;--purple:#8b5cf6;--cyan:#06b6d4;--pink:#ec4899}
*{margin:0;padding:0;box-sizing:border-box}
body{background:var(--bg);color:var(--text);font-family:'Outfit',sans-serif;min-height:100vh}
.hdr{padding:28px 36px 0;display:flex;justify-content:space-between;align-items:flex-start}
.hdr h1{font-size:28px;font-weight:800;letter-spacing:-0.03em;background:linear-gradient(135deg,var(--text),var(--muted));-webkit-background-clip:text;-webkit-text-fill-color:transparent}
.hdr .sub{color:var(--dim);font-size:13px;margin-top:4px}
.hdr-r{display:flex;gap:10px;align-items:center}
.bdg{padding:5px 12px;border-radius:8px;font-size:11px;font-weight:500}
.bdg-ok{background:rgba(16,185,129,.1);color:var(--green);border:1px solid rgba(16,185,129,.2)}
.bdg-err{background:rgba(239,68,68,.1);color:var(--red);border:1px solid rgba(239,68,68,.2)}
.bdg-ld{background:rgba(59,130,246,.1);color:var(--blue);border:1px solid rgba(59,130,246,.2)}
.btn{padding:6px 14px;border-radius:8px;border:1px solid var(--border);background:0;color:var(--muted);font-size:12px;cursor:pointer;font-family:'Outfit';transition:.2s}
.btn:hover{border-color:var(--muted);color:var(--text)}
.tabs{padding:20px 36px 0;display:flex;gap:6px}
.tab{padding:12px 28px;border-radius:12px 12px 0 0;border:1px solid var(--border);border-bottom:1px solid var(--border);background:0;color:var(--dim);font-size:14px;font-weight:500;cursor:pointer;font-family:'Outfit';transition:.25s}
.tab.a-amm{border-color:var(--blue);border-bottom:2px solid var(--blue);color:var(--blue);font-weight:700;background:linear-gradient(180deg,rgba(59,130,246,.07),transparent)}
.tab.a-holavet{border-color:var(--green);border-bottom:2px solid var(--green);color:var(--green);font-weight:700;background:linear-gradient(180deg,rgba(16,185,129,.07),transparent)}
.tab.a-holarene{border-color:var(--yellow);border-bottom:2px solid var(--yellow);color:var(--yellow);font-weight:700;background:linear-gradient(180deg,rgba(245,158,11,.07),transparent)}
.tab .ct{margin-left:8px;font-size:11px;opacity:.7;font-weight:400}
.tf{flex:1;border-bottom:1px solid var(--border)}
.cnt{padding:24px 36px 36px}
.kpis{display:grid;grid-template-columns:repeat(4,1fr);gap:16px;margin-bottom:24px}
.kpi{background:var(--card);border:1px solid var(--border);border-radius:14px;padding:22px 26px;position:relative;overflow:hidden}
.kpi .br{position:absolute;top:0;left:0;right:0;height:2px}
.kpi .lb{color:var(--dim);font-size:11px;font-weight:600;letter-spacing:.08em;text-transform:uppercase}
.kpi .vl{color:var(--text);font-size:34px;font-weight:800;margin:6px 0 2px;letter-spacing:-0.03em}
.kpi .sb{color:var(--dim);font-size:12px}
.flt{background:var(--card);border:1px solid var(--border);border-radius:14px;padding:16px 22px;margin-bottom:24px;display:flex;flex-wrap:wrap;gap:10px;align-items:center}
.flt label{color:var(--dim);font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.08em}
select,.si,input[type=date]{background:#080d18;border:1px solid var(--border);border-radius:8px;padding:7px 12px;color:var(--text);font-size:12px;font-family:'Outfit';cursor:pointer;outline:0}
select:focus,.si:focus,input[type=date]:focus{border-color:var(--blue)}
.si{width:170px}.sp{flex:1}
.bc{padding:7px 14px;border-radius:8px;border:1px solid rgba(239,68,68,.25);background:rgba(239,68,68,.06);color:var(--red);font-size:11px;font-weight:600;cursor:pointer;font-family:'Outfit'}
.chts{display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:24px}
.cc{background:var(--card);border:1px solid var(--border);border-radius:14px;padding:24px}
.cc h3{color:var(--text);font-size:15px;font-weight:600;margin-bottom:4px}
.cc .cs{color:var(--dim);font-size:12px;margin-bottom:18px}
.cw{position:relative;height:280px}
.tw{background:var(--card);border:1px solid var(--border);border-radius:14px;overflow:hidden}
.th{padding:18px 22px;border-bottom:1px solid var(--border);display:flex;justify-content:space-between;align-items:center}
.th h3{font-size:15px;font-weight:600}.th .inf{color:var(--dim);font-size:12px;margin-top:3px}
.ts{overflow-x:auto}
table{width:100%;border-collapse:collapse}
th{padding:12px 14px;text-align:left;color:var(--dim);font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;cursor:pointer;user-select:none;white-space:nowrap;border-bottom:1px solid var(--border)}
th:hover{color:var(--muted)}
td{padding:11px 14px;font-size:12px;color:var(--muted);border-bottom:1px solid var(--border)}
tr:hover td{background:#162032}
.tn{font-size:13px;font-weight:500;color:var(--text)}
.tm{font-family:'JetBrains Mono',monospace;white-space:nowrap}
.tt{max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.neo{display:inline-block;padding:3px 10px;border-radius:6px;font-size:11px;font-weight:600}
.neo-s{background:rgba(16,185,129,.08);color:var(--green);border:1px solid rgba(16,185,129,.15)}
.neo-n{background:rgba(239,68,68,.08);color:var(--red);border:1px solid rgba(239,68,68,.15)}
.neo-x{background:rgba(86,101,128,.08);color:var(--dim);border:1px solid rgba(86,101,128,.15)}
.pg{display:flex;justify-content:center;gap:6px;padding:14px 22px;border-top:1px solid var(--border)}
.pb{width:32px;height:32px;border-radius:8px;border:1px solid var(--border);background:0;color:var(--dim);font-size:12px;cursor:pointer;font-family:'Outfit';transition:.2s}
.pn{padding:6px 14px;border-radius:8px;border:1px solid var(--border);background:0;font-size:12px;cursor:pointer;font-family:'Outfit';color:var(--text)}
.pn:disabled{color:var(--dim);cursor:default}
.ld{text-align:center;padding:80px;color:var(--muted)}.ld p{font-size:18px}.ld .s{font-size:13px;color:var(--dim);margin-top:8px}
.ft{text-align:center;color:var(--dim);font-size:11px;margin-top:20px;padding-bottom:24px}
@media(max-width:900px){.kpis,.chts{grid-template-columns:1fr}.hdr,.tabs,.cnt{padding-left:16px;padding-right:16px}}
</style>
</head>
<body>
<div class="hdr"><div><h1>Leads Dashboard</h1><p class="sub">Datos en vivo · sql.ar-vida.com.ar</p></div>
<div class="hdr-r"><button class="btn" onclick="refreshData()">↻ Actualizar</button><span id="lu" style="color:var(--dim);font-size:11px"></span><span class="bdg" id="sb">●</span></div></div>
<div class="tabs" id="tabs"></div>
<div class="cnt" id="mc"><div class="ld"><p>⏳ Cargando...</p><p class="s">Conectando a la base de datos</p></div></div>
<script>
const P=[{key:"amm",label:"AMM",color:"#3b82f6"},{key:"holavet",label:"HOLAVET",color:"#10b981"},{key:"holarene",label:"HOLARENE ODT",color:"#f59e0b"}];
const CC=["#3b82f6","#10b981","#f59e0b","#ef4444","#8b5cf6","#ec4899","#06b6d4","#84cc16","#f97316","#14b8a6"];
let S={tab:0,data:{},f:{campana:"Todas",neotel:"Todos",df:"",dt:"",q:""},sort:{field:"fechaIngreso",dir:"desc"},pg:1,pp:15,ch:{}};

async function fetchL(k,force){
  if(S.data[k]&&!force)return S.data[k];
  try{setSt("ld");const r=await fetch("/api/leads/"+k);if(!r.ok)throw new Error("HTTP "+r.status);
  const j=await r.json();S.data[k]=j.leads||[];setSt("ok");document.getElementById("lu").textContent=new Date().toLocaleTimeString("es-AR");return S.data[k];
  }catch(e){setSt("err");throw e;}}

function setSt(s){const b=document.getElementById("sb");
  if(s==="ok"){b.className="bdg bdg-ok";b.textContent="● Conectado";}
  else if(s==="err"){b.className="bdg bdg-err";b.textContent="● Error";}
  else{b.className="bdg bdg-ld";b.textContent="● Cargando...";}}

function rTabs(){document.getElementById("tabs").innerHTML=P.map((p,i)=>{
  const c=S.tab===i?"tab a-"+p.key:"tab";const n=S.data[p.key]?'<span class="ct">('+S.data[p.key].length.toLocaleString("es-AR")+')</span>':"";
  return '<button class="'+c+'" onclick="sTab('+i+')">'+p.label+n+'</button>';}).join("")+'<div class="tf"></div>';}

async function sTab(i){S.tab=i;S.f={campana:"Todas",neotel:"Todos",df:"",dt:"",q:""};S.pg=1;rTabs();await rAll();}

function gF(){const l=S.data[P[S.tab].key]||[];let r=[...l];const f=S.f;
  if(f.campana!=="Todas")r=r.filter(x=>x.campana===f.campana);
  if(f.neotel!=="Todos")r=r.filter(x=>f.neotel==="Sí"?x.neotel==="S":x.neotel==="N");
  if(f.df)r=r.filter(x=>x.fechaIngreso>=f.df);if(f.dt)r=r.filter(x=>x.fechaIngreso<=f.dt);
  if(f.q){const t=f.q.toLowerCase();r=r.filter(x=>(x.nombre+" "+x.apellido).toLowerCase().includes(t)||(x.email||"").toLowerCase().includes(t)||(x.campana||"").toLowerCase().includes(t));}
  const{field:sf,dir:sd}=S.sort;r.sort((a,b)=>{const va=a[sf]??"",vb=b[sf]??"";const c=typeof va==="string"?va.localeCompare(vb):va-vb;return sd==="asc"?c:-c;});return r;}

function sortBy(f){if(S.sort.field===f)S.sort.dir=S.sort.dir==="asc"?"desc":"asc";else{S.sort.field=f;S.sort.dir="desc";}rTbl();}

async function rAll(){
  const p=P[S.tab],mc=document.getElementById("mc");
  try{const leads=await fetchL(p.key);rTabs();const fl=gF();
  const camps=[...new Set(leads.map(l=>l.campana).filter(Boolean))].sort();
  const ns=fl.filter(l=>l.neotel==="S").length;const ul=leads.length?leads[0]?.fechaIngreso||"—":"—";
  const hf=S.f.campana!=="Todas"||S.f.neotel!=="Todos"||S.f.df||S.f.dt||S.f.q;

  mc.innerHTML='<div class="kpis">'+
  '<div class="kpi"><div class="br" style="background:linear-gradient(90deg,'+p.color+',transparent)"></div><p class="lb">Total Leads</p><p class="vl" id="k0">'+fl.length.toLocaleString("es-AR")+'</p><p class="sb" id="ks0">'+(fl.length!==leads.length?"de "+leads.length.toLocaleString("es-AR")+" totales":"en la base")+'</p></div>'+
  '<div class="kpi"><div class="br" style="background:linear-gradient(90deg,#8b5cf6,transparent)"></div><p class="lb">Campañas</p><p class="vl">'+camps.length+'</p><p class="sb">campañas únicas</p></div>'+
  '<div class="kpi"><div class="br" style="background:linear-gradient(90deg,#10b981,transparent)"></div><p class="lb">Neotel Sí</p><p class="vl" id="k2">'+ns.toLocaleString("es-AR")+'</p><p class="sb" id="ks2">'+(fl.length?((ns/fl.length)*100).toFixed(1):0)+'% del total</p></div>'+
  '<div class="kpi"><div class="br" style="background:linear-gradient(90deg,#06b6d4,transparent)"></div><p class="lb">Último Lead</p><p class="vl" style="font-size:22px">'+ul+'</p><p class="sb">fecha más reciente</p></div></div>'+

  '<div class="flt"><label>Filtros</label>'+
  '<select id="fC" onchange="aF(\\'campana\\',this.value)"><option value="Todas">Todas las campañas</option>'+camps.map(c=>'<option value="'+c+'"'+(S.f.campana===c?" selected":"")+'>'+c+'</option>').join("")+'</select>'+
  '<select id="fN" onchange="aF(\\'neotel\\',this.value)"><option value="Todos"'+(S.f.neotel==="Todos"?" selected":"")+'>Neotel: Todos</option><option value="Sí"'+(S.f.neotel==="Sí"?" selected":"")+'>Neotel: Sí</option><option value="No"'+(S.f.neotel==="No"?" selected":"")+'>Neotel: No</option></select>'+
  '<div class="sp"></div><input class="si" type="text" placeholder="🔍 Buscar..." value="'+S.f.q+'" oninput="aF(\\'q\\',this.value)">'+
  '<input type="date" value="'+S.f.df+'" onchange="aF(\\'df\\',this.value)"><span style="color:var(--dim);font-size:12px">→</span>'+
  '<input type="date" value="'+S.f.dt+'" onchange="aF(\\'dt\\',this.value)">'+
  (hf?'<button class="bc" onclick="cF()">✕ Limpiar</button>':'')+'</div>'+

  '<div class="chts"><div class="cc"><h3>Leads por Campaña</h3><p class="cs">Top campañas por volumen</p><div class="cw"><canvas id="c1"></canvas></div></div>'+
  '<div class="cc"><h3>Evolución Mensual</h3><p class="cs">Leads por mes</p><div class="cw"><canvas id="c2"></canvas></div></div>'+
  '<div class="cc"><h3>Conjunto de Anuncios</h3><p class="cs">Top ad sets</p><div class="cw"><canvas id="c3"></canvas></div></div>'+
  '<div class="cc"><h3>Neotel</h3><p class="cs">Distribución</p><div class="cw"><canvas id="c4"></canvas></div></div></div>'+

  '<div class="tw"><div class="th"><div><h3>Detalle — '+p.label+'</h3><p class="inf" id="ti"></p></div></div>'+
  '<div class="ts"><table><thead><tr id="thd"></tr></thead><tbody id="tbd"></tbody></table></div><div class="pg" id="pgn"></div></div>'+
  '<p class="ft">Leads Dashboard · '+p.label+' · Datos en vivo · Auto-refresh 5 min</p>';

  rCh(fl,p);rTbl();
  }catch(e){mc.innerHTML='<div class="ld"><p style="color:var(--red)">❌ '+e.message+'</p><button class="btn" style="margin-top:16px" onclick="rAll()">Reintentar</button><p class="s" style="margin-top:12px">La API puede tardar ~30s en despertar si estuvo inactiva</p></div>';}}

function aF(k,v){S.f[k]=v;S.pg=1;const fl=gF();rCh(fl,P[S.tab]);rTbl();
  const l=S.data[P[S.tab].key]||[];const e0=document.getElementById("k0");if(e0)e0.textContent=fl.length.toLocaleString("es-AR");
  const s0=document.getElementById("ks0");if(s0)s0.textContent=fl.length!==l.length?"de "+l.length.toLocaleString("es-AR")+" totales":"en la base";
  const ns=fl.filter(x=>x.neotel==="S").length;const e2=document.getElementById("k2");if(e2)e2.textContent=ns.toLocaleString("es-AR");
  const s2=document.getElementById("ks2");if(s2)s2.textContent=(fl.length?((ns/fl.length)*100).toFixed(1):0)+"% del total";}

function cF(){S.f={campana:"Todas",neotel:"Todos",df:"",dt:"",q:""};S.pg=1;rAll();}

function rCh(fl,p){Object.values(S.ch).forEach(c=>c.destroy());S.ch={};
  const co={responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false}},
    scales:{x:{ticks:{color:"#566580",font:{size:10,family:"Outfit"}},grid:{color:"#1b284530"}},y:{ticks:{color:"#566580",font:{size:10,family:"Outfit"}},grid:{color:"#1b284530"}}}};

  const cm={};fl.forEach(l=>{if(l.campana)cm[l.campana]=(cm[l.campana]||0)+1;});
  const cd=Object.entries(cm).sort((a,b)=>b[1]-a[1]).slice(0,10);
  const x1=document.getElementById("c1");
  if(x1)S.ch.c1=new Chart(x1,{type:"bar",data:{labels:cd.map(d=>d[0].length>30?d[0].slice(0,30)+"…":d[0]),datasets:[{data:cd.map(d=>d[1]),backgroundColor:cd.map((_,i)=>CC[i%CC.length]),borderRadius:6,maxBarThickness:24}]},options:{...co,indexAxis:"y"}});

  const tm={};fl.forEach(l=>{const m=l.fechaIngreso?.slice(0,7);if(m)tm[m]=(tm[m]||0)+1;});
  const td=Object.entries(tm).sort((a,b)=>a[0].localeCompare(b[0]));
  const x2=document.getElementById("c2");
  if(x2)S.ch.c2=new Chart(x2,{type:"line",data:{labels:td.map(d=>d[0]),datasets:[{data:td.map(d=>d[1]),borderColor:p.color,backgroundColor:p.color+"25",fill:true,tension:.3,pointRadius:4,pointBackgroundColor:p.color}]},options:co});

  const am={};fl.forEach(l=>{if(l.conjuntoAnuncios)am[l.conjuntoAnuncios]=(am[l.conjuntoAnuncios]||0)+1;});
  const ad=Object.entries(am).sort((a,b)=>b[1]-a[1]).slice(0,8);
  const x3=document.getElementById("c3");
  if(x3)S.ch.c3=new Chart(x3,{type:"bar",data:{labels:ad.map(d=>d[0].length>25?d[0].slice(0,25)+"…":d[0]),datasets:[{data:ad.map(d=>d[1]),backgroundColor:ad.map((_,i)=>CC[i%CC.length]),borderRadius:6,maxBarThickness:36}]},options:{...co,scales:{...co.scales,x:{...co.scales.x,ticks:{...co.scales.x.ticks,maxRotation:20}}}}});

  const nm={"Sí":0,"No":0,"Sin dato":0};fl.forEach(l=>{if(l.neotel==="S")nm["Sí"]++;else if(l.neotel==="N")nm["No"]++;else nm["Sin dato"]++;});
  const nd=Object.entries(nm).filter(d=>d[1]>0);const nc=nd.map(d=>d[0]==="Sí"?"#10b981":d[0]==="No"?"#ef4444":"#566580");
  const x4=document.getElementById("c4");
  if(x4)S.ch.c4=new Chart(x4,{type:"doughnut",data:{labels:nd.map(d=>d[0]),datasets:[{data:nd.map(d=>d[1]),backgroundColor:nc,borderWidth:0,spacing:4}]},options:{responsive:true,maintainAspectRatio:false,cutout:"60%",plugins:{legend:{position:"bottom",labels:{color:"#8896b0",font:{family:"Outfit",size:12},padding:16}}}}});}

function rTbl(){const fl=gF();const tp=Math.ceil(fl.length/S.pp);const st=(S.pg-1)*S.pp;const rw=fl.slice(st,st+S.pp);
  const cls=[{k:"fechaIngreso",l:"Fecha"},{k:"nombre",l:"Nombre"},{k:"email",l:"Email"},{k:"telefono1",l:"Teléfono"},{k:"campana",l:"Campaña"},{k:"conjuntoAnuncios",l:"Ad Set"},{k:"anuncio",l:"Anuncio"},{k:"neotel",l:"Neotel"}];
  const aw=f=>S.sort.field===f?(S.sort.dir==="asc"?" ▲":" ▼"):' <span style="opacity:.25">▼</span>';
  const hd=document.getElementById("thd");if(hd)hd.innerHTML=cls.map(c=>'<th onclick="sortBy(\''+c.k+'\')">'+c.l+aw(c.k)+'</th>').join("");
  const ti=document.getElementById("ti");if(ti)ti.textContent=fl.length.toLocaleString("es-AR")+" resultados · Página "+S.pg+"/"+(tp||1);
  const bd=document.getElementById("tbd");
  if(bd){if(!rw.length){bd.innerHTML='<tr><td colspan="8" style="padding:40px;text-align:center;color:var(--dim)">No se encontraron leads</td></tr>';}
  else{bd.innerHTML=rw.map(l=>{const n=l.neotel==="S"?'<span class="neo neo-s">Sí</span>':l.neotel==="N"?'<span class="neo neo-n">No</span>':'<span class="neo neo-x">—</span>';
  return '<tr><td class="tm">'+(l.fechaIngreso||"")+'</td><td class="tn">'+(l.nombre||"")+" "+(l.apellido||"")+'</td><td class="tt">'+(l.email||"")+'</td><td class="tm">'+(l.telefono1||"")+'</td><td class="tt">'+(l.campana||"")+'</td><td class="tt" style="max-width:140px;color:var(--dim)">'+(l.conjuntoAnuncios||"")+'</td><td class="tt" style="max-width:140px;color:var(--dim)">'+(l.anuncio||"")+'</td><td>'+n+'</td></tr>';}).join("");}}
  const pg=document.getElementById("pgn");if(!pg)return;if(tp<=1){pg.innerHTML="";return;}
  const pc=P[S.tab].color;let h='<button class="pn" '+(S.pg===1?"disabled":"")+" onclick=\"gP("+(S.pg-1)+')\" style="color:'+(S.pg===1?"var(--dim)":"var(--text)")+'">← Ant</button>';
  let sp=Math.max(1,S.pg-3),ep=Math.min(tp,sp+6);if(ep-sp<6)sp=Math.max(1,ep-6);
  for(let i=sp;i<=ep;i++){const a=i===S.pg;h+='<button class="pb" style="border-color:'+(a?pc:"var(--border)")+";background:"+(a?pc+"18":"transparent")+";color:"+(a?pc:"var(--dim)")+";font-weight:"+(a?700:400)+'" onclick="gP('+i+')">'+i+"</button>";}
  h+='<button class="pn" '+(S.pg===tp?"disabled":"")+" onclick=\"gP("+(S.pg+1)+')\" style="color:'+(S.pg===tp?"var(--dim)":"var(--text)")+'">Sig →</button>';pg.innerHTML=h;}

function gP(p){S.pg=p;rTbl();}
async function refreshData(){await fetchL(P[S.tab].key,true);rTabs();rAll();}

rTabs();rAll();
setInterval(()=>{fetchL(P[S.tab].key,true).then(()=>{rTabs();rAll();});},5*60*1000);
<\/script>
</body></html>`);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log("🚀 Leads Dashboard + API en puerto " + PORT);
  console.log("📊 SQL: " + SERVER);
  console.log("📁 Bases: " + Object.values(DB_MAP).join(", "));
});
