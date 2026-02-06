const express = require("express");
const cors = require("cors");
const sql = require("mssql");
const path = require("path");

const app = express();
app.use(cors());
app.use(express.json());

// Serve dashboard HTML
app.use(express.static(path.join(__dirname, "public")));

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

var pools = {};
async function getPool(producto) {
  var key = producto.toLowerCase();
  if (!DB_MAP[key]) throw new Error("Producto no válido: " + producto);
  if (!pools[key] || !pools[key].connected) {
    pools[key] = await new sql.ConnectionPool(makeConfig(DB_MAP[key])).connect();
    console.log("✅ Conectado: " + key + " → " + DB_MAP[key]);
  }
  return pools[key];
}

app.get("/api/leads/:producto", async function(req, res) {
  try {
    var pool = await getPool(req.params.producto);
    var request = pool.request();
    var query = "SELECT ID AS id, Fecha_Ingreso_Leads AS fechaIngreso, Nombre AS nombre, Apellido AS apellido, Correo_Electronico AS email, Telefono1 AS telefono1, Telefono2 AS telefono2, Campana AS campana, Conjunto_Anuncios AS conjuntoAnuncios, Anuncio AS anuncio, Tipo_Telefono AS tipoTelefono, Neotel AS neotel, Comentarios AS comentarios FROM Leads_Final WHERE 1=1";
    if (req.query.campana) { query += " AND Campana = @campana"; request.input("campana", sql.NVarChar, req.query.campana); }
    if (req.query.fechaDesde) { query += " AND Fecha_Ingreso_Leads >= @fechaDesde"; request.input("fechaDesde", sql.DateTime, new Date(req.query.fechaDesde)); }
    if (req.query.fechaHasta) { query += " AND Fecha_Ingreso_Leads <= @fechaHasta"; request.input("fechaHasta", sql.DateTime, new Date(req.query.fechaHasta + "T23:59:59")); }
    if (req.query.buscar) { query += " AND (Nombre LIKE @buscar OR Apellido LIKE @buscar OR Correo_Electronico LIKE @buscar)"; request.input("buscar", sql.NVarChar, "%" + req.query.buscar + "%"); }
    if (req.query.neotel) { query += " AND LTRIM(RTRIM(Neotel)) = @neotel"; request.input("neotel", sql.Char, req.query.neotel); }
    query += " ORDER BY Fecha_Ingreso_Leads DESC";
    var result = await request.query(query);
    var leads = result.recordset.map(function(r) {
      return Object.assign({}, r, {
        fechaIngreso: r.fechaIngreso ? new Date(r.fechaIngreso).toISOString().split("T")[0] : null,
        neotel: r.neotel ? r.neotel.trim() : null
      });
    });
    res.json({ producto: req.params.producto, total: leads.length, leads: leads });
  } catch (err) { console.error("❌", err.message); res.status(500).json({ error: err.message }); }
});

app.get("/api/stats/:producto", async function(req, res) {
  try {
    var pool = await getPool(req.params.producto);
    var request = pool.request();
    var where = "WHERE 1=1";
    if (req.query.fechaDesde) { where += " AND Fecha_Ingreso_Leads >= @fechaDesde"; request.input("fechaDesde", sql.DateTime, new Date(req.query.fechaDesde)); }
    if (req.query.fechaHasta) { where += " AND Fecha_Ingreso_Leads <= @fechaHasta"; request.input("fechaHasta", sql.DateTime, new Date(req.query.fechaHasta + "T23:59:59")); }
    var query = "SELECT COUNT(*) AS totalLeads, COUNT(DISTINCT Campana) AS totalCampanas, MIN(Fecha_Ingreso_Leads) AS primerLead, MAX(Fecha_Ingreso_Leads) AS ultimoLead FROM Leads_Final " + where + "; SELECT Campana AS campana, COUNT(*) AS cantidad FROM Leads_Final " + where + " GROUP BY Campana ORDER BY cantidad DESC; SELECT CONVERT(VARCHAR(7), Fecha_Ingreso_Leads, 120) AS mes, COUNT(*) AS cantidad FROM Leads_Final " + where + " GROUP BY CONVERT(VARCHAR(7), Fecha_Ingreso_Leads, 120) ORDER BY mes; SELECT LTRIM(RTRIM(Neotel)) AS neotel, COUNT(*) AS cantidad FROM Leads_Final " + where + " GROUP BY LTRIM(RTRIM(Neotel)) ORDER BY cantidad DESC;";
    var result = await request.query(query);
    res.json({ producto: req.params.producto, resumen: result.recordsets[0][0], porCampana: result.recordsets[1], porMes: result.recordsets[2], porNeotel: result.recordsets[3] });
  } catch (err) { console.error("❌", err.message); res.status(500).json({ error: err.message }); }
});

app.get("/api/filters/:producto", async function(req, res) {
  try {
    var pool = await getPool(req.params.producto);
    var campanas = await pool.request().query("SELECT DISTINCT Campana AS campana FROM Leads_Final WHERE Campana IS NOT NULL ORDER BY Campana");
    res.json({ producto: req.params.producto, campanas: campanas.recordset.map(function(r) { return r.campana; }) });
  } catch (err) { console.error("❌", err.message); res.status(500).json({ error: err.message }); }
});

var PORT = process.env.PORT || 3000;
app.listen(PORT, function() {
  console.log("🚀 Dashboard + API en puerto " + PORT);
  console.log("📊 SQL: " + SERVER);
});
