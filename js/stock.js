// Aceites y filtros: configuración, cantidades (galones y cuartos), memoria al escribir y campos personalizados.
import { sb } from "./sb.js";
import { h, must } from "./util.js";
import { field, input } from "./ui.js";

// ---------- Qué tiene cada tipo de producto ----------
export const TIPOS_ACEITE = ["Mineral", "Semisintético", "Sintético", "Diésel", "Transmisión automática", "Caja / diferencial", "Hidráulico", "Frenos", "Refrigerante"];
export const TIPOS_FILTRO = ["Aceite", "Aire", "Combustible", "Cabina", "Transmisión", "Aire comprimido"];
export const PRESENTACIONES = ["Galón", "Cuarto", "Litro", "Caneca 5 gal", "Tanque 55 gal"];

export const KINDS = {
  aceites: {
    tabla: "aceites", vista: "stock_aceites", usos: "usos_aceite", fk: "aceite_id", tipoUso: "aceite",
    titulo: "Aceites", uno: "aceite", Uno: "Aceite", nuevo: "Nuevo aceite", icono: "aceite",
    vacio: "Todavía no tienes aceites. Agrega el primero con su stock inicial.",
    buscarPh: "Buscar: 20W-50, sintético, Mobil…",
    texto: ["nombre", "tipo", "marca", "presentacion"],
    sugerencias: ["nombre", "tipo", "marca", "presentacion"],
    tiposBase: TIPOS_ACEITE,
  },
  filtros: {
    tabla: "filtros", vista: "stock_filtros", usos: "usos_filtro", fk: "filtro_id", tipoUso: "filtro",
    titulo: "Filtros", uno: "filtro", Uno: "Filtro", nuevo: "Nuevo filtro", icono: "filtro",
    vacio: "Todavía no tienes filtros. Agrega el primero con su stock inicial.",
    buscarPh: "Buscar: código, aire, Toyota…",
    texto: ["nombre", "tipo", "marca", "referencia", "aplicacion"],
    sugerencias: ["nombre", "tipo", "marca", "referencia", "aplicacion"],
    tiposBase: TIPOS_FILTRO,
  },
};

// ---------- Cantidades ----------
/** Aceite que se cuenta en galones (1 cuarto = 0,25). Igual que valor_aceite() en la base. */
export const enGalones = (p) => !!p && /gal/i.test(p.presentacion || "") && !/caneca|tanque|balde/i.test(p.presentacion || "");

export function galCuartos(q) {
  let g = Math.floor(q + 1e-9), c = Math.round((q - g) * 4);
  if (c === 4) { g++; c = 0; }
  return [g, c];
}

const fmtNum = new Intl.NumberFormat("es-EC", { maximumFractionDigits: 2 });
export const num = (n) => fmtNum.format(Number(n) || 0);
export const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

/** "5 galones y 2 cuartos", "14 litros", "3 unidades". */
export function cantidadTxt(kind, p, q) {
  q = Number(q) || 0;
  if (kind === "aceites" && enGalones(p)) {
    const neg = q < 0; const [g, c] = galCuartos(Math.abs(q));
    const t = (g || !c ? `${g} ${g === 1 ? "galón" : "galones"}` : "") + (c ? `${g ? " y " : ""}${c} ${c === 1 ? "cuarto" : "cuartos"}` : "");
    return neg ? `−${t}` : t;
  }
  if (kind === "filtros") return `${num(q)} ${q === 1 ? "unidad" : "unidades"}`;
  const u = (p?.presentacion || "unidad").toLowerCase();
  return `${num(q)} ${q === 1 ? u : plural(u)}`;
}
const plural = (u) => (/[aeiouáéíóú]$/.test(u) ? u + "s" : /\d|gal$/.test(u) ? u : u + "es");

/**
 * Campos de cantidad: galones + cuartos (aceite en galón) o un solo número.
 * Devuelve { el, leer, set(p) } — set cambia el formato si cambia el producto o la presentación.
 */
export function campoCantidad(kind, p, valor, { label = "Cantidad", name = "cantidad", min = 0, requerido = true } = {}) {
  const el = h("div", { class: "field" });
  let leer = () => 0, modo = null;
  const pintar = (prod, v) => {
    modo = kind === "aceites" && enGalones(prod) ? "gal" : `u:${(prod?.presentacion || "").toLowerCase()}`;
    if (modo === "gal") {
      const [g, c] = galCuartos(Math.max(0, Number(v) || 0));
      const gi = input({ type: "number", name: `${name}_g`, min: 0, step: 1, inputmode: "numeric", value: g, required: requerido, "aria-label": `${label}: galones` });
      const ci = h("select", { class: "input", name: `${name}_c`, "aria-label": `${label}: cuartos` },
        [0, 1, 2, 3].map((n) => h("option", { value: n, selected: n === c }, `${n} ${n === 1 ? "cuarto" : "cuartos"}`)));
      el.replaceChildren(h("span", { class: "field-label" }, label),
        h("div", { class: "qty" }, h("label", { class: "qty-g" }, gi, h("span", {}, "galones")), ci));
      leer = () => (Number(gi.value) || 0) + (Number(ci.value) || 0) / 4;
    } else {
      const unidad = kind === "filtros" ? "unidades" : (prod?.presentacion || "unidades").toLowerCase();
      const ni = input({ type: "number", name, min, step: "any", inputmode: "decimal", value: v ?? "", required: requerido });
      el.replaceChildren(h("span", { class: "field-label" }, `${label} (${unidad})`), ni);
      leer = () => Number(ni.value) || 0;
    }
  };
  pintar(p, valor);
  // set: solo se vuelve a armar si cambia el formato (galones ↔ unidades); así no se pierde el foco al escribir
  const set = (prod) => {
    const nuevo = kind === "aceites" && enGalones(prod) ? "gal" : `u:${(prod?.presentacion || "").toLowerCase()}`;
    if (nuevo !== modo) pintar(prod, leer());
  };
  return { el, leer: () => r2(leer()), set };
}

// ---------- Fechas ----------
export const hoy = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Guayaquil" }).format(new Date());
const fmtDia = new Intl.DateTimeFormat("es-EC", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "UTC" });
export const diaTxt = (iso) => fmtDia.format(new Date(iso + "T00:00:00Z"));
const fmtMomento = new Intl.DateTimeFormat("es-EC", { timeZone: "America/Guayaquil", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
export const momentoTxt = (iso) => fmtMomento.format(new Date(iso));

// ---------- Búsqueda (sin mayúsculas ni tildes) ----------
export const norm = (s) => String(s ?? "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

// ---------- Textos: limpiar y memoria al escribir ----------
/** Quita espacios al inicio, al final y repetidos. */
export const limpiar = (s) => String(s ?? "").replace(/\s+/g, " ").trim();

/**
 * Valores ya usados en la lavadora (sin repetir por mayúsculas), del más usado al menos usado.
 * La forma que se muestra es la más frecuente ("Mobil" gana a "mobil").
 */
function unicos(valores) {
  const grupos = new Map();
  for (const v0 of valores) {
    const v = limpiar(v0);
    if (!v) continue;
    const k = v.toLowerCase();
    const g = grupos.get(k) || { n: 0, formas: new Map() };
    g.n++; g.formas.set(v, (g.formas.get(v) || 0) + 1);
    grupos.set(k, g);
  }
  return [...grupos.values()].sort((a, b) => b.n - a.n)
    .map((g) => [...g.formas.entries()].sort((a, b) => b[1] - a[1])[0][0]);
}

/** Si ya existe el mismo texto con otras mayúsculas, se usa el que existe (no se duplica "Mobil" y "mobil"). */
export function canonico(valor, conocidos = []) {
  const v = limpiar(valor);
  if (!v) return "";
  return conocidos.find((c) => c.toLowerCase() === v.toLowerCase()) || v;
}

/** Sugerencias de la lavadora (de Supabase): { aceites: {marca: [...], ...}, filtros: {...}, clientes: [...] } */
export async function cargarSugerencias() {
  const [a, f, ua, uf] = await Promise.all([
    sb.from("aceites").select("nombre,tipo,marca,presentacion").is("deleted_at", null).limit(2000),
    sb.from("filtros").select("nombre,tipo,marca,referencia,aplicacion").is("deleted_at", null).limit(2000),
    sb.from("usos_aceite").select("cliente").is("deleted_at", null).order("created_at", { ascending: false }).limit(2000),
    sb.from("usos_filtro").select("cliente").is("deleted_at", null).order("created_at", { ascending: false }).limit(2000),
  ]);
  const col = (rows, c) => unicos((rows || []).map((r) => r[c]));
  const S = { aceites: {}, filtros: {} };
  for (const c of KINDS.aceites.sugerencias) S.aceites[c] = col(must(a), c);
  for (const c of KINDS.filtros.sugerencias) S.filtros[c] = col(must(f), c);
  // Valores de siempre al final, para que también se sugieran desde el primer producto
  S.aceites.tipo = unicos([...S.aceites.tipo, ...TIPOS_ACEITE]);
  S.aceites.presentacion = unicos([...S.aceites.presentacion, ...PRESENTACIONES]);
  S.filtros.tipo = unicos([...S.filtros.tipo, ...TIPOS_FILTRO]);
  S.clientes = unicos([...(must(ua) || []).map((r) => r.cliente), ...(must(uf) || []).map((r) => r.cliente)]);
  // Todas las marcas (aceites y filtros) sirven para los dos
  S.marcas = unicos([...S.aceites.marca, ...S.filtros.marca]);
  return S;
}

let dlSeq = 0;
/** Campo de texto con memoria: sugiere los valores ya usados mientras se escribe. */
export function inputSugerido(props, valores = []) {
  const id = `dl-${++dlSeq}`;
  const dl = h("datalist", { id }, valores.slice(0, 300).map((v) => h("option", { value: v })));
  const el = input({ autocomplete: "off", spellcheck: "false", ...props, list: id });
  return h("span", { class: "sugerido" }, el, dl);
}

// ---------- Campos personalizados (extra) ----------
/** Campos activos de la lavadora para una tabla, en su orden. */
export async function camposDe(tabla) {
  const { data, error } = await sb.from("campos_personalizados").select("clave,etiqueta,tipo,opciones,obligatorio,orden")
    .eq("tabla", tabla).eq("activo", true).order("orden");
  if (error) return [];   // si no se pueden leer, el formulario sigue sin ellos
  return data;
}

/** Controles de los campos personalizados; leer(form) devuelve el objeto extra. */
export function camposExtra(campos, valores = {}) {
  const nodos = campos.map((c) => {
    const name = `extra__${c.clave}`, v = valores?.[c.clave];
    let ctrl;
    if (c.tipo === "lista") ctrl = h("select", { class: "input", name, required: c.obligatorio },
      h("option", { value: "" }, "—"), c.opciones.map((o) => h("option", { value: o, selected: o === v }, o)));
    else if (c.tipo === "si_no") ctrl = h("select", { class: "input", name, required: c.obligatorio },
      h("option", { value: "" }, "—"), h("option", { value: "true", selected: v === true }, "Sí"), h("option", { value: "false", selected: v === false }, "No"));
    else ctrl = input({ name, required: c.obligatorio, value: v ?? "",
      type: c.tipo === "numero" ? "number" : c.tipo === "fecha" ? "date" : "text",
      step: c.tipo === "numero" ? "any" : null, maxlength: c.tipo === "texto" ? 500 : null });
    return field(c.etiqueta + (c.obligatorio ? " *" : ""), ctrl);
  });
  const leer = (fd) => {
    const extra = {};
    for (const c of campos) {
      const raw = limpiar(fd.get(`extra__${c.clave}`));
      if (raw === "") { if (valores && c.clave in valores) extra[c.clave] = null; continue; }
      extra[c.clave] = c.tipo === "numero" ? Number(raw) : c.tipo === "si_no" ? raw === "true" : raw;
    }
    return extra;
  };
  return { nodos, leer };
}

/** Texto de los campos personalizados de un registro (para mostrar en tarjetas e historial). */
export function extraTxt(campos, extra) {
  return campos.filter((c) => extra?.[c.clave] != null && extra[c.clave] !== "")
    .map((c) => `${c.etiqueta}: ${c.tipo === "si_no" ? (extra[c.clave] ? "Sí" : "No") : c.tipo === "fecha" ? diaTxt(extra[c.clave]) : extra[c.clave]}`);
}
