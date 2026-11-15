// Historial de cambios (auditoría de la lavadora) y "Descargar mis datos" (Excel de respaldo, todos los planes).
// La auditoría la lee el dueño gracias a la política auditoria_dueno del 001 (no hace falta cambiar la base).
import { sb } from "./sb.js";
import { must, PLANES } from "./util.js";
import { state } from "./state.js";
import { cantidadTxt, num, diaTxt, momentoTxt, camposDe, hoy } from "./stock.js";

const TABLAS = {
  aceites: "Aceite", filtros: "Filtro", usos_aceite: "Uso de aceite", usos_filtro: "Uso de filtro",
  lavadoras: "Lavadora", miembros: "Usuario", vehiculos: "Vehículo", cambios: "Cambio de aceite",
};
const ACCIONES = { INSERT: "Creado", UPDATE: "Editado", BORRADO: "Borrado", RESTAURADO: "Restaurado" };
const CAMPOS = {
  nombre: "Nombre", tipo: "Tipo", marca: "Marca", presentacion: "Presentación", referencia: "Código", aplicacion: "Para",
  stock_inicial: "Stock inicial", entradas: "Entradas", minimo: "Avisar en", precio: "Precio", precio_cuarto: "Precio del cuarto",
  cliente: "Cliente", fecha: "Fecha", cantidad: "Cantidad", clase: "Clase", valor: "Valor",
  color_primario: "Color primario", color_acento: "Color de acento", logo_path: "Logo", mano_obra: "Mano de obra",
  plan: "Plan", activa: "Activa", rol: "Rol", marca_vehiculo: "Marca", modelo: "Modelo", total: "Total",
};
const OCULTOS = new Set(["id", "lavadora_id", "created_by", "created_at", "updated_at", "deleted_at", "aceite_id", "filtro_id",
  "cambio_id", "vehiculo_id", "user_id", "extra"]);
const CANTIDADES = new Set(["stock_inicial", "entradas", "minimo", "cantidad"]);

/** Nombres de productos (incluye borrados) para describir los usos. */
export async function nombresProductos() {
  const [a, f] = await Promise.all([
    sb.from("aceites").select("id,nombre,marca,presentacion").limit(5000).then(must),
    sb.from("filtros").select("id,nombre,marca").limit(5000).then(must),
  ]);
  const m = new Map();
  for (const x of a) m.set(x.id, { ...x, kind: "aceites" });
  for (const x of f) m.set(x.id, { ...x, kind: "filtros" });
  return m;
}

/** Página de la auditoría, de la más reciente a la más antigua. */
export async function leerAuditoria(desde = 0, cuantos = 200) {
  return must(await sb.from("auditoria").select("id,tabla,registro_id,accion,antes,despues,email,at")
    .order("at", { ascending: false }).order("id", { ascending: false }).range(desde, desde + cuantos - 1));
}

const valorTxt = (campo, v, fila, productos) => {
  if (v == null || v === "") return "—";
  if (campo === "plan") return PLANES[v] || v;
  if (campo === "activa") return v ? "Sí" : "No";
  if (campo === "fecha") return diaTxt(v);
  if (campo === "logo_path") return "imagen";
  if (CANTIDADES.has(campo)) {
    const prod = fila.aceite_id || fila.filtro_id ? productos.get(fila.aceite_id || fila.filtro_id) : fila;
    const kind = prod?.kind || (fila.aceite_id ? "aceites" : fila.filtro_id ? "filtros" : fila.presentacion !== undefined ? "aceites" : "filtros");
    return cantidadTxt(kind, prod, v);
  }
  if (typeof v === "number") return num(v);
  return String(v);
};

/**
 * Describe una fila de la auditoría: { at, fecha, usuario, que, accion, cambios: [{ campo, antes, despues }] }.
 * Edición: solo los campos que cambiaron. Creación: los datos principales. Borrado/restaurado: sin detalle.
 */
export function describir(r, productos, campos = {}) {
  const d = r.despues || {}, b = r.antes || {};
  const fila = { ...b, ...d };
  const prod = productos.get(fila.aceite_id || fila.filtro_id);
  let nombre = fila.nombre || "";
  if (r.tabla === "usos_aceite" || r.tabla === "usos_filtro") nombre = `${prod?.nombre || "producto borrado"} · ${fila.cliente || ""}`;
  if (r.tabla === "miembros") nombre = fila.rol === "dueno" ? "Dueño" : "Personal";
  const etiquetasExtra = Object.fromEntries((campos[r.tabla] || []).map((c) => [c.clave, c.etiqueta]));

  const cambios = [];
  if (r.accion === "INSERT" || r.accion === "UPDATE") {
    const claves = new Set([...Object.keys(d), ...Object.keys(r.accion === "UPDATE" ? b : {})]);
    for (const k of claves) {
      if (OCULTOS.has(k) || (r.tabla === "usos_aceite" || r.tabla === "usos_filtro") && k === "cliente" && r.accion === "INSERT") continue;
      if (r.accion === "UPDATE" && JSON.stringify(b[k]) === JSON.stringify(d[k])) continue;
      if (r.accion === "INSERT" && (d[k] == null || d[k] === "" || d[k] === 0) && !CANTIDADES.has(k)) continue;
      cambios.push({ campo: CAMPOS[k] || k, antes: r.accion === "UPDATE" ? valorTxt(k, b[k], b, productos) : null, despues: valorTxt(k, d[k], d, productos) });
    }
    // Campos personalizados (extra)
    const ea = b.extra || {}, ed = d.extra || {};
    for (const k of new Set([...Object.keys(ea), ...Object.keys(ed)])) {
      if (JSON.stringify(ea[k]) === JSON.stringify(ed[k]) && r.accion === "UPDATE") continue;
      if (r.accion === "INSERT" && ed[k] == null) continue;
      const f = (v) => (v == null || v === "" ? "—" : v === true ? "Sí" : v === false ? "No" : String(v));
      cambios.push({ campo: etiquetasExtra[k] || k, antes: r.accion === "UPDATE" ? f(ea[k]) : null, despues: f(ed[k]) });
    }
  }
  return {
    at: r.at, fecha: momentoTxt(r.at), usuario: r.email || "Sistema", accion: ACCIONES[r.accion] || r.accion,
    que: `${TABLAS[r.tabla] || r.tabla}${nombre ? ` «${nombre}»` : ""}`, tabla: r.tabla, cambios,
  };
}

/** Campos personalizados de todas las tablas: { tabla: [{clave, etiqueta, ...}] } */
export async function todosLosCampos() {
  const tablas = ["aceites", "filtros", "usos_aceite", "usos_filtro"];
  const listas = await Promise.all(tablas.map((t) => camposDe(t)));
  return Object.fromEntries(tablas.map((t, i) => [t, listas[i]]));
}

// ---------- Descargar mis datos (Excel) ----------
let xlsxCargando;
function cargarXLSX() {
  if (window.XLSX) return Promise.resolve(window.XLSX);
  xlsxCargando ??= new Promise((ok, mal) => {
    const s = document.createElement("script");
    s.src = "https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js";   // la misma que usa la demo
    s.onload = () => ok(window.XLSX);
    s.onerror = () => { xlsxCargando = null; mal(new Error("No se pudo cargar el generador de Excel. Revisa tu internet.")); };
    document.head.append(s);
  });
  return xlsxCargando;
}

/** Lee todas las filas de una consulta, de 1000 en 1000. */
async function todo(consulta) {
  const filas = [];
  for (let i = 0; ; i += 1000) {
    const parte = must(await consulta().range(i, i + 999));
    filas.push(...parte);
    if (parte.length < 1000) return filas;
  }
}

const estadoFila = (x) => (x.deleted_at ? `Borrado el ${momentoTxt(x.deleted_at)}` : "Vigente");
const conExtra = (obj, campos, extra) => { for (const c of campos) obj[c.etiqueta] = extra?.[c.clave] ?? ""; return obj; };

/**
 * Excel de respaldo con todo lo guardado: lavadora, aceites, filtros, usos (también los borrados, marcados)
 * e historial de cambios. Disponible en todos los planes.
 */
export async function descargarMisDatos() {
  const XLSX = await cargarXLSX();
  const conPrecios = ["EST", "PRO", "PRE"].includes(state.lavadora.plan);
  const [aceites, filtros, stockA, stockF, usosA, usosF, campos, productos] = await Promise.all([
    todo(() => sb.from("aceites").select("*").order("nombre")),
    todo(() => sb.from("filtros").select("*").order("nombre")),
    todo(() => sb.from("stock_aceites").select("id,actual")),
    todo(() => sb.from("stock_filtros").select("id,actual")),
    todo(() => sb.from("usos_aceite").select("*").order("fecha", { ascending: false })),
    todo(() => sb.from("usos_filtro").select("*").order("fecha", { ascending: false })),
    todosLosCampos(),
    nombresProductos(),
  ]);
  const aud = await todo(() => sb.from("auditoria").select("id,tabla,registro_id,accion,antes,despues,email,at")
    .order("at", { ascending: false }).order("id", { ascending: false }));
  const actual = new Map([...stockA, ...stockF].map((x) => [x.id, x.actual]));
  const l = state.lavadora;

  const hojas = {
    Lavadora: [{ Lavadora: l.nombre, Plan: PLANES[l.plan], Correo: state.email, "Mano de obra": Number(l.mano_obra),
                 "Respaldo descargado": momentoTxt(new Date().toISOString()) }],
    Aceites: aceites.map((a) => conExtra({
      Nombre: a.nombre, Tipo: a.tipo, Marca: a.marca, Presentación: a.presentacion,
      "Stock actual": a.deleted_at ? "" : Number(actual.get(a.id) ?? 0), "Stock actual (texto)": a.deleted_at ? "" : cantidadTxt("aceites", a, actual.get(a.id)),
      "Stock inicial": Number(a.stock_inicial), Entradas: Number(a.entradas), "Avisar en": Number(a.minimo),
      ...(conPrecios ? { Precio: Number(a.precio), "Precio del cuarto": Number(a.precio_cuarto) } : {}),
      Estado: estadoFila(a), Creado: momentoTxt(a.created_at),
    }, campos.aceites, a.extra)),
    Filtros: filtros.map((f) => conExtra({
      Nombre: f.nombre, Tipo: f.tipo, Marca: f.marca, Código: f.referencia, Para: f.aplicacion,
      "Stock actual": f.deleted_at ? "" : Number(actual.get(f.id) ?? 0),
      "Stock inicial": Number(f.stock_inicial), Entradas: Number(f.entradas), "Avisar en": Number(f.minimo),
      ...(conPrecios ? { Precio: Number(f.precio) } : {}),
      Estado: estadoFila(f), Creado: momentoTxt(f.created_at),
    }, campos.filtros, f.extra)),
    "Usos de aceite": usosA.map((u) => { const p = productos.get(u.aceite_id); return conExtra({
      Fecha: diaTxt(u.fecha), Cliente: u.cliente, Aceite: p?.nombre || "", Marca: p?.marca || "",
      Cantidad: Number(u.cantidad), "Cantidad (texto)": cantidadTxt("aceites", p, u.cantidad),
      ...(conPrecios ? { Valor: Number(u.valor) } : {}),
      Estado: estadoFila(u), Registrado: momentoTxt(u.created_at),
    }, campos.usos_aceite, u.extra); }),
    "Usos de filtros": usosF.map((u) => { const p = productos.get(u.filtro_id); return conExtra({
      Fecha: diaTxt(u.fecha), Cliente: u.cliente, Filtro: p?.nombre || "", Marca: p?.marca || "", Clase: u.clase,
      Cantidad: Number(u.cantidad), ...(conPrecios ? { Valor: Number(u.valor) } : {}),
      Estado: estadoFila(u), Registrado: momentoTxt(u.created_at),
    }, campos.usos_filtro, u.extra); }),
    "Historial de cambios": aud.map((r) => {
      const x = describir(r, productos, campos);
      return { Fecha: x.fecha, Usuario: x.usuario, Acción: x.accion, Qué: x.que,
               Cambios: x.cambios.map((c) => (c.antes == null ? `${c.campo}: ${c.despues}` : `${c.campo}: ${c.antes} → ${c.despues}`)).join("; ") };
    }),
  };

  const wb = XLSX.utils.book_new();
  for (const [nombre, filas] of Object.entries(hojas)) {
    const ws = XLSX.utils.json_to_sheet(filas.length ? filas : [{ "": "Sin datos" }]);
    const cols = Object.keys(filas[0] || { "": "" });
    ws["!cols"] = cols.map((c) => ({ wch: Math.min(60, Math.max(c.length, ...filas.slice(0, 200).map((f) => String(f[c] ?? "").length)) + 2) }));
    XLSX.utils.book_append_sheet(wb, ws, nombre);
  }
  const archivo = `Respaldo_${l.nombre.replace(/[^\p{L}\p{N}]+/gu, "_").replace(/^_|_$/g, "")}_${hoy()}.xlsx`;
  XLSX.writeFile(wb, archivo);
  return { archivo, filas: Object.fromEntries(Object.entries(hojas).map(([k, v]) => [k, v.length])) };
}
