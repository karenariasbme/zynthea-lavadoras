// Aceites y Filtros (Plan Básico): lista con buscador, agregar/editar, agregar stock, registrar uso e historial.
// Todo pasa por lo que ya existe en la base: vistas stock_*, registrar_uso(), borrar() y la auditoría.
import { sb } from "../sb.js";
import { h, must, val, toast, errMsg, money } from "../util.js";
import { state, esDueno, planIncluye } from "../state.js";
import { pageHead, field, input, userError, ventana, ventanaInfo, icono, loading, errorBox } from "../ui.js";
import {
  KINDS, PRESENTACIONES, TIPOS_ACEITE, TIPOS_FILTRO, enGalones, porCuartos, galonesDe, galonesTxt, equivalenciaTxt,
  cantidadTxt, campoCantidad, r2, hoy, diaTxt, momentoTxt, norm, limpiar, canonico,
  cargarSugerencias, inputSugerido, camposDe, camposExtra, extraTxt,
} from "../stock.js";

// ---------- Datos ----------
export async function cargarProductos(kind) {
  return must(await sb.from(KINDS[kind].vista).select("*").order("nombre"));
}

/** "agotado" | "bajo" | "ok" (bajo: quedan igual o menos que el mínimo, como en registrar_uso). */
export function estado(p) {
  const a = Number(p.actual) || 0;
  if (a <= 0) return "agotado";
  if (a <= (Number(p.minimo) || 0)) return "bajo";
  return "ok";
}
const ORDEN_ESTADO = { agotado: 0, bajo: 1, ok: 2 };
export const chipEstado = (e) => e === "agotado" ? h("span", { class: "chip bad" }, "Agotado")
  : e === "bajo" ? h("span", { class: "chip warn" }, "Stock bajo") : h("span", { class: "chip ok" }, "En stock");

// ---------- Pantalla ----------
const opciones = (sel, valores, todos) => {
  const actual = sel.value;
  sel.replaceChildren(h("option", { value: "" }, todos), ...valores.map(([k, v]) => h("option", { value: k }, v)));
  sel.value = valores.some(([k]) => k === actual) ? actual : "";
};
/** Valores distintos de una columna (sin mayúsculas ni tildes), ordenados: [[clave, texto]] */
const distintos = (lista, col) => {
  const m = new Map();
  for (const p of lista) { const v = limpiar(p[col]); if (v && !m.has(norm(v))) m.set(norm(v), v); }
  return [...m.entries()].sort((a, b) => a[1].localeCompare(b[1], "es", { numeric: true }));
};

export async function render(box, kind) {
  const K = KINDS[kind];
  const sub = location.hash.replace(/^#/, "").split("/")[1];
  let lista = [], S = null;
  const [campos, camposUso] = await Promise.all([camposDe(K.tabla), camposDe(K.usos)]);
  const ctx = { kind, campos, camposUso, get S() { return S; }, get lista() { return lista; }, recargar: () => cargar() };

  // Pestañas: Aceites por presentación; Filtros "Todos" / "Buscar por rosca"
  const TABS = kind === "aceites"
    ? [["", "Todos"], ...PRESENTACIONES.map((x) => [norm(x.nombre), x.tab])]
    : [["", "Todos"], ["rosca", "Buscar por rosca"]];
  let tab = "";
  const tabsEl = h("div", { class: "subtabs", role: "tablist", "aria-label": kind === "aceites" ? "Presentaciones" : "Vista" });

  const buscar = input({ type: "search", placeholder: K.buscarPh, "aria-label": `Buscar ${K.titulo.toLowerCase()}` });
  const marcaSel = h("select", { class: "input", "aria-label": "Marca" });
  const saeSel = h("select", { class: "input", "aria-label": "SAE / viscosidad" });
  const tipoSel = h("select", { class: "input", "aria-label": "Tipo" });
  const usoSel = h("select", { class: "input", "aria-label": "Uso" });
  const bajoChk = h("input", { type: "checkbox", checked: sub === "bajo" });
  const roscaBox = h("div", { class: "rosca-box", hidden: true });
  let roscaIn = null;
  const contador = h("p", { class: "note", "aria-live": "polite" });
  const cont = h("div", { class: "prod-lista" }, loading());

  box.append(
    h("div", { class: "page-head head-row" },
      h("div", {}, h("h1", {}, K.titulo), h("p", {}, kind === "aceites"
        ? "Stock por envase y su equivalencia en galones. Se resta solo al registrar un uso o un cambio."
        : "El stock se resta solo al registrar un uso o un cambio.")),
      h("button", { class: "btn accent", type: "button", onclick: () => abrirEditor(ctx, null) }, icono("mas"), K.nuevo)),
    tabsEl,
    roscaBox,
    h("div", { class: `filtros-bar ${kind}` },
      h("label", { class: "buscar" }, icono("buscar"), buscar),
      marcaSel, kind === "aceites" && saeSel, tipoSel, kind === "aceites" && usoSel,
      h("label", { class: "check" }, bajoChk, h("span", {}, "Solo stock bajo"))),
    contador, cont);

  const pintarTabs = () => {
    tabsEl.replaceChildren(...TABS.map(([k, n]) => {
      const cuantos = k && k !== "rosca" ? lista.filter((p) => norm(limpiar(p.presentacion)) === k).length : null;
      return h("button", { type: "button", role: "tab", "aria-selected": String(k === tab), onclick: () => { tab = k; pintarTabs(); pintar(); } },
        n, cuantos != null && h("span", { class: "count" }, cuantos));
    }));
    roscaBox.hidden = tab !== "rosca";
  };

  const pintar = () => {
    const q = norm(buscar.value.trim());
    const rq = tab === "rosca" ? norm(limpiar(roscaIn?.value)) : "";
    const vis = lista.filter((p) =>
      (kind !== "aceites" || !tab || norm(limpiar(p.presentacion)) === tab) &&
      (tab !== "rosca" || (rq && norm(limpiar(p.rosca)).includes(rq))) &&
      (!q || K.texto.some((c) => norm(p[c]).includes(q))) &&
      (!marcaSel.value || norm(limpiar(p.marca)) === marcaSel.value) &&
      (kind !== "aceites" || !saeSel.value || norm(limpiar(p.sae)) === saeSel.value) &&
      (!tipoSel.value || norm(limpiar(p.tipo)) === tipoSel.value) &&
      (kind !== "aceites" || !usoSel.value || norm(limpiar(p.uso)) === usoSel.value) &&
      (!bajoChk.checked || estado(p) !== "ok"));
    const bajos = lista.filter((p) => estado(p) !== "ok").length;
    contador.textContent = !lista.length ? "" : tab === "rosca" && !rq ? "Elige o escribe una rosca para ver sus filtros." :
      `${vis.length === lista.length ? lista.length : `${vis.length} de ${lista.length}`} ${K.titulo.toLowerCase()}` +
      (bajos ? ` · ${bajos} con stock bajo o agotado${bajos === 1 ? "" : "s"}` : "");
    if (!lista.length) return cont.replaceChildren(h("div", { class: "card state" }, K.vacio,
      h("button", { class: "btn accent", type: "button", onclick: () => abrirEditor(ctx, null) }, icono("mas"), K.nuevo)));
    if (tab === "rosca" && !rq) return cont.replaceChildren();
    if (!vis.length) return cont.replaceChildren(h("div", { class: "card state" }, "Ningún producto coincide con la búsqueda.",
      h("button", { class: "link", type: "button", onclick: () => {
        buscar.value = ""; for (const s of [marcaSel, saeSel, tipoSel, usoSel]) s.value = ""; bajoChk.checked = false;
        if (roscaIn) roscaIn.value = ""; pintarFiltros(); pintar();
      } }, "Quitar filtros")));
    cont.replaceChildren(...vis.map((p) => tarjeta(ctx, p)));
  };

  // Marca primero; el SAE solo ofrece las viscosidades de esa marca
  const pintarFiltros = () => {
    opciones(marcaSel, distintos(lista, "marca"), "Todas las marcas");
    if (kind === "aceites") {
      opciones(saeSel, distintos(lista.filter((p) => !marcaSel.value || norm(limpiar(p.marca)) === marcaSel.value), "sae"), "Todos los SAE");
      opciones(usoSel, distintos(lista, "uso"), "Todos los usos");
    }
    opciones(tipoSel, distintos(lista, "tipo"), "Todos los tipos");
  };

  async function cargar() {
    try {
      [lista, S] = await Promise.all([cargarProductos(kind), cargarSugerencias()]);
      lista.sort((a, b) => ORDEN_ESTADO[estado(a)] - ORDEN_ESTADO[estado(b)] || a.nombre.localeCompare(b.nombre, "es", { numeric: true }));
      if (kind === "filtros" && !roscaIn) {
        const w = inputSugerido({ placeholder: "Rosca: 3/4-16, M20x1.5…", "aria-label": "Rosca" }, S.filtros.rosca);
        roscaIn = w.querySelector("input");
        roscaIn.addEventListener("input", pintar);
        roscaBox.append(field("Rosca", w, "Elige una de la lista o escríbela: salen todos los filtros con esa rosca."));
      }
      pintarTabs();
      pintarFiltros();
      pintar();
    } catch (e) {
      cont.replaceChildren(errorBox(errMsg(e)));
    }
  }
  buscar.addEventListener("input", pintar);
  marcaSel.addEventListener("change", () => { pintarFiltros(); pintar(); });
  for (const s of [saeSel, tipoSel, usoSel]) s.addEventListener("change", pintar);
  bajoChk.addEventListener("change", pintar);
  await cargar();
  if (sub === "nuevo") abrirEditor(ctx, null);
  if (sub === "rosca" && kind === "filtros") { tab = "rosca"; pintarTabs(); pintar(); }
}

/** Precios de venta y compra (desde el plan Estándar). */
function preciosTxt(kind, p) {
  if (!planIncluye("EST")) return null;
  const venta = Number(p.precio) || 0, compra = Number(p.precio_compra) || 0;
  if (!venta && !compra) return h("p", { class: "prod-precio muted" }, "Sin precio");
  const pc = kind === "aceites" && porCuartos(p) ? (Number(p.precio_cuarto) || venta / 4) : null;
  return h("p", { class: "prod-precio" },
    "Venta ", h("b", {}, money(venta)), pc != null ? [" · cuarto ", h("b", {}, money(pc))] : "",
    compra ? h("span", { class: "muted" }, ` · Compra ${money(compra)}`) : "");
}

function tarjeta(ctx, p) {
  const { kind } = ctx;
  const e = estado(p);
  const actual = Number(p.actual) || 0, minimo = Number(p.minimo) || 0;
  const pct = Math.max(0, Math.min(100, minimo > 0 ? (actual / (minimo * 2)) * 100 : actual > 0 ? 100 : 0));
  const extras = extraTxt(ctx.campos, p.extra);
  const etiquetas = kind === "aceites"
    ? [p.tipo, p.uso, p.presentacion]
    : [p.tipo, p.rosca && `Rosca ${p.rosca}`, p.aplicacion];
  const equiv = kind === "aceites" ? equivalenciaTxt(p, actual) : "";
  return h("article", { class: `card prod ${e}` },
    h("div", { class: "prod-top" }, h("h3", {}, tituloProducto(kind, p)), chipEstado(e)),
    h("p", { class: "chips" }, etiquetas.filter(Boolean).map((t) => h("span", { class: "chip tipo" }, t))),
    h("div", { class: "prod-stock" },
      h("b", {}, cantidadTxt(kind, p, actual)),
      equiv && h("span", { class: "equiv" }, equiv),
      h("span", {}, minimo > 0 ? `avisar en ${cantidadTxt(kind, p, minimo)}` : "sin aviso de stock bajo")),
    h("div", { class: "barra", "aria-hidden": "true" }, h("i", { style: { width: `${pct}%` } })),
    preciosTxt(kind, p),
    extras.length > 0 && h("p", { class: "prod-det" }, extras.join(" · ")),
    h("div", { class: "prod-acciones" },
      h("button", { class: "btn primary sm", type: "button", disabled: actual <= 0, onclick: () => abrirUso(ctx, p) }, "Registrar uso"),
      h("button", { class: "btn sm", type: "button", onclick: () => abrirEntrada(ctx, p) }, "Agregar stock"),
      h("button", { class: "btn sm", type: "button", onclick: () => abrirHistorial(ctx, p) }, "Historial"),
      h("button", { class: "btn sm", type: "button", onclick: () => abrirEditor(ctx, p) }, "Editar")));
}

/** Título que se muestra: aceite "Marca SAE"; filtro "Marca Código". */
export function tituloProducto(kind, p) {
  const t = (kind === "aceites" ? [p.marca, p.sae] : [p.marca, p.referencia]).map(limpiar).filter(Boolean).join(" ");
  return t || p.nombre || "";
}
/** Nombre guardado en la base (no se pide): "Marca SAE Presentación" / "Marca Código". */
export function nombreAuto(kind, d) {
  const partes = kind === "aceites" ? [d.marca, d.sae, d.presentacion] : [d.marca, d.referencia || (d.tipo && `filtro de ${d.tipo.toLowerCase()}`)];
  return partes.map(limpiar).filter(Boolean).join(" ").slice(0, 120);
}

// ---------- Agregar / editar ----------
/** Lista fija + el valor actual si es otro (datos anteriores no se pierden al editar). */
const selectLista = (name, lista, actual, vacio) => {
  const vals = [...lista];
  if (actual && !vals.some((v) => norm(v) === norm(actual))) vals.push(actual);
  return h("select", { class: "input", name },
    h("option", { value: "" }, vacio), vals.map((v) => h("option", { value: v, selected: norm(v) === norm(actual || "") }, v)));
};
const precioInput = (name, valor, deshabilitado) =>
  input({ name, type: "number", min: 0, step: "0.01", inputmode: "decimal", value: Number(valor) ? valor : "", placeholder: "0,00", disabled: deshabilitado });

export async function abrirEditor(ctx, p) {
  const { kind } = ctx, K = KINDS[kind];
  const S = ctx.S || await cargarSugerencias();
  const campos = ctx.campos || await camposDe(K.tabla);
  const dueno = esDueno();
  const nuevo = !p;
  const conPrecios = planIncluye("EST");
  const usado = nuevo ? 0 : r2(Number(p.stock_inicial) + Number(p.entradas) - Number(p.actual));

  const sug = (name, label, valores, props = {}) =>
    field(label, inputSugerido({ name, value: p?.[name] ?? "", maxlength: 120, ...props }, valores));
  const presSel = kind === "aceites" ? selectLista("presentacion", PRESENTACIONES.map((x) => x.nombre), p?.presentacion || "Galón", "Elige…") : null;
  if (presSel) presSel.required = true;
  const prodActual = () => ({ presentacion: presSel ? presSel.value : "" });
  const base = p || { presentacion: "Galón" };
  const inicial = campoCantidad(kind, base, nuevo ? "" : p.stock_inicial, { label: "Stock inicial", name: "stock_inicial" });
  const minimo = campoCantidad(kind, base, nuevo ? "" : p.minimo, { label: "Avisar cuando queden", name: "minimo", requerido: false });
  const equivNota = h("small", { class: "note" });
  const precioCuartoField = kind === "aceites" ? field("Venta por cuarto (USD)", precioInput("precio_cuarto", p?.precio_cuarto, !dueno), "Vacío = venta del galón ÷ 4.") : null;
  const alCambiarPres = () => {
    inicial.set(prodActual()); minimo.set(prodActual());
    const g = galonesDe(prodActual());
    equivNota.textContent = porCuartos(prodActual()) ? "El galón se cuenta y se vende por cuartos." : g ? `1 unidad = ${galonesTxt(g)}. Se vende cerrada.` : "";
    if (precioCuartoField) precioCuartoField.hidden = !porCuartos(prodActual());
  };
  presSel?.addEventListener("change", alCambiarPres);
  if (!dueno && !nuevo) inicial.el.querySelectorAll("input,select").forEach((x) => { x.disabled = true; });
  const ex = camposExtra(campos, p?.extra);

  // Orden pedido. Aceite: Marca, SAE, Tipo, Uso, Presentación, stock, aviso, compra, venta.
  // Filtro: Marca, Código, Rosca, Tipo, Para qué vehículos, stock, aviso, compra, venta.
  const campos_ = kind === "aceites" ? [
    h("div", { class: "cols" }, sug("marca", "Marca *", S.marcas, { required: true }), sug("sae", "SAE / viscosidad", S.aceites.sae, { placeholder: "Ej.: 20W-50" })),
    h("div", { class: "cols" }, field("Tipo", selectLista("tipo", TIPOS_ACEITE, p?.tipo, "—")), sug("uso", "Uso", S.aceites.uso, { placeholder: "Motor, Caja…" })),
    field("Presentación *", presSel, equivNota),
    h("div", { class: "cols" }, inicial.el, minimo.el),
  ] : [
    h("div", { class: "cols" }, sug("marca", "Marca *", S.marcas, { required: true }), sug("referencia", "Código / referencia", S.filtros.referencia, { placeholder: "Ej.: 0986AF0051" })),
    h("div", { class: "cols" }, sug("rosca", "Rosca", S.filtros.rosca, { placeholder: "Ej.: 3/4-16" }), field("Tipo", selectLista("tipo", TIPOS_FILTRO, p?.tipo, "—"))),
    sug("aplicacion", "Para qué vehículos", S.filtros.aplicacion, { placeholder: "Ej.: Toyota Hilux / Isuzu" }),
    h("div", { class: "cols" }, inicial.el, minimo.el),
  ];
  campos_.push(
    conPrecios && h("div", { class: "cols" },
      field("Precio de compra (USD)", precioInput("precio_compra", p?.precio_compra, !dueno)),
      field(kind === "aceites" ? "Precio de venta por envase (USD)" : "Precio de venta (USD)", precioInput("precio", p?.precio, !dueno))),
    conPrecios && precioCuartoField,
    !nuevo && h("p", { class: "note" },
      `Entradas: ${cantidadTxt(kind, p, p.entradas)} · Usado: ${cantidadTxt(kind, p, usado)} · Stock actual: ${cantidadTxt(kind, p, p.actual)}`),
    ex.nodos,
  );
  alCambiarPres();

  const borrarBtn = !nuevo && dueno && h("button", { class: "btn danger", type: "button", onclick: () => confirmarBorrar(ctx, p, () => editor.cerrar()) }, "Borrar");
  const editor = ventana({
    titulo: nuevo ? K.nuevo : `Editar ${K.uno}`, boton: nuevo ? "Agregar" : "Guardar", campos: campos_, izquierda: borrarBtn, clase: "modal-ancho",
    onSubmit: async (fd) => {
      const marca = canonico(fd.get("marca"), S.marcas);
      if (!marca) throw userError("Escribe la marca.");
      const datos = {
        marca,
        tipo: canonico(fd.get("tipo"), K.tiposBase),
        minimo: minimo.leer(),
        extra: ex.leer(fd),
      };
      if (kind === "aceites") {
        datos.sae = canonico(fd.get("sae"), [], false);          // se respeta lo escrito ("5W-30")
        datos.uso = canonico(fd.get("uso"), S.aceites.uso);
        datos.presentacion = canonico(fd.get("presentacion"), PRESENTACIONES.map((x) => x.nombre));
        if (!datos.presentacion) throw userError("Elige la presentación.");
        datos.galones_unidad = galonesDe({ presentacion: datos.presentacion });
      } else {
        datos.rosca = canonico(fd.get("rosca"), [], false);      // tal cual ("3/4-16")
        datos.referencia = canonico(fd.get("referencia"), [], false);
        datos.aplicacion = canonico(fd.get("aplicacion"), [], false);
      }
      // El nombre no se pide ni se muestra: se guarda armado (Marca SAE Presentación / Marca Código) para lo que ya lo usa
      datos.nombre = nombreAuto(kind, datos);
      // Sin duplicados (sin mirar mayúsculas ni tildes). Aceite: marca, SAE, tipo, uso y presentación.
      // Filtro: marca y código (sin código: marca, rosca, tipo y vehículos).
      const clave = (x) => (kind === "aceites"
        ? [x.marca, x.sae, x.tipo, x.uso, x.presentacion]
        : x.referencia ? [x.marca, x.referencia] : [x.marca, x.rosca, x.tipo, x.aplicacion]).map((v) => norm(limpiar(v))).join("|");
      const lista = ctx.lista?.length ? ctx.lista : await cargarProductos(kind);
      const repetido = lista.find((x) => x.id !== p?.id && clave(x) === clave(datos));
      if (repetido) throw userError(`Ya existe «${tituloProducto(kind, repetido)}»${kind === "aceites" ? ` (${[repetido.tipo, repetido.uso, repetido.presentacion].filter(Boolean).join(" · ")})` : ""}. Para sumar unidades usa "Agregar stock".`);
      if (nuevo || dueno) {
        datos.stock_inicial = inicial.leer();
        if (datos.stock_inicial < 0) throw userError("El stock inicial no puede ser negativo.");
        if (!nuevo && datos.stock_inicial + Number(p.entradas) - usado < 0)
          throw userError(`Con ese stock inicial el stock quedaría en negativo: ya se usaron ${cantidadTxt(kind, p, usado)}.`);
      }
      if (conPrecios && dueno) {
        const pr = (n) => { const v = Number(fd.get(n)); if (v < 0) throw userError("Los precios no pueden ser negativos."); return r2(v || 0); };
        datos.precio_compra = pr("precio_compra");
        datos.precio = pr("precio");
        if (kind === "aceites") datos.precio_cuarto = porCuartos(datos) ? pr("precio_cuarto") : 0;
      }
      if (nuevo) must(await sb.from(K.tabla).insert(datos).select("id").single());
      else must(await sb.from(K.tabla).update(datos).eq("id", p.id).select("id").single());
      await ctx.recargar?.();
      return nuevo ? `${K.Uno} agregado: ${tituloProducto(kind, datos)}` : "Cambios guardados";
    },
  });
}

function confirmarBorrar(ctx, p, despues) {
  const K = KINDS[ctx.kind];
  ventana({
    titulo: `Borrar ${K.uno}`, boton: "Borrar", peligro: true,
    texto: `${p.nombre}. Desaparece de la lista; si tiene usos registrados, primero hay que borrarlos desde el Historial.`,
    onSubmit: async () => {
      must(await sb.rpc("borrar", { p_tabla: K.tabla, p_id: p.id }));
      despues?.();
      await ctx.recargar?.();
      return `${K.Uno} borrado: ${p.nombre}`;
    },
  });
}

// ---------- Agregar stock (entradas) ----------
// Plan Básico: un solo usuario. Se guarda "entradas + cantidad" solo si nadie la cambió desde que se leyó
// (si cambió, se vuelve a leer y se reintenta). La auditoría registra el antes y el después.
// Para Premium (varios usuarios) se reemplazará por una función en la base (ver docs/plan.md, paso 8).
export function abrirEntrada(ctx, p) {
  const { kind } = ctx, K = KINDS[kind];
  const cant = campoCantidad(kind, p, kind === "aceites" && enGalones(p) ? 0 : "", { label: "Cantidad que llegó" });
  ventana({
    titulo: "Agregar stock", texto: `${p.nombre} · ahora hay ${cantidadTxt(kind, p, p.actual)}.`,
    boton: "Agregar", campos: [cant.el],
    onSubmit: async () => {
      const q = cant.leer();
      if (!(q > 0)) throw userError("Escribe una cantidad mayor a 0.");
      for (let intento = 0; intento < 3; intento++) {
        const { entradas } = must(await sb.from(K.tabla).select("entradas").eq("id", p.id).single());
        const nuevas = r2(Number(entradas) + q);
        const filas = must(await sb.from(K.tabla).update({ entradas: nuevas }).eq("id", p.id).eq("entradas", entradas).select("id"));
        if (filas.length) {
          await ctx.recargar?.();
          return `Stock agregado: +${cantidadTxt(kind, p, q)} de ${p.nombre}`;
        }
      }
      throw userError("El stock cambió mientras guardabas. Vuelve a intentarlo.");
    },
  });
}

// ---------- Registrar uso ----------
/**
 * Registra aceite o filtros usados con registrar_uso(). Si p es null, se elige el producto en la ventana;
 * si además ctx.kind es null (desde Inicio), también se elige si es aceite o filtro.
 */
export async function abrirUso(ctx, p, { cliente = "" } = {}) {
  const elegirTipo = !ctx.kind;
  let kind = ctx.kind || "aceites";
  const S = ctx.S || await cargarSugerencias();
  const listas = {}, camposUso = {};
  const cargarKind = async (k) => {
    if (!listas[k]) {
      [listas[k], camposUso[k]] = await Promise.all([
        ctx.kind === k && ctx.lista?.length ? ctx.lista : cargarProductos(k),
        ctx.kind === k && ctx.camposUso ? ctx.camposUso : camposDe(KINDS[k].usos)]);
    }
  };
  await cargarKind(kind);

  let prod = p;
  const tipoBox = h("div", { class: "seg", role: "radiogroup", "aria-label": "¿Qué usaste?" });
  const prodSel = h("select", { class: "input", name: "producto", required: true });
  const prodField = field("Producto *", prodSel);
  const disp = h("p", { class: "note" });
  const cantBox = h("div");
  const claseField = field("Clase", h("select", { class: "input", name: "clase" },
    ["", "Original", "Compatible", "Otro"].map((c) => h("option", { value: c }, c || "—"))));
  const extraBox = h("div", { class: "stack" });
  let cant, ex;

  const pintarProducto = () => {
    prod = listas[kind].find((x) => x.id === prodSel.value) || (p && !elegirTipo ? p : null);
    disp.textContent = prod ? `Disponible: ${cantidadTxt(kind, prod, prod.actual)}` : "";
    cant = campoCantidad(kind, prod, 1, { label: "Cantidad usada" });
    cantBox.replaceChildren(cant.el);
  };
  const pintarKind = () => {
    const disponibles = listas[kind].filter((x) => Number(x.actual) > 0 || x.id === p?.id);
    prodSel.replaceChildren(h("option", { value: "" }, disponibles.length ? "Elige…" : `No hay ${KINDS[kind].titulo.toLowerCase()} con stock`),
      ...disponibles.map((x) => h("option", { value: x.id, selected: x.id === p?.id },
        [x.nombre, `quedan ${cantidadTxt(kind, x, x.actual)}`].filter(Boolean).join(" · "))));
    claseField.hidden = kind !== "filtros";
    ex = camposExtra(camposUso[kind] || []);
    extraBox.replaceChildren(...ex.nodos);
    pintarProducto();
  };
  if (elegirTipo) {
    for (const k of ["aceites", "filtros"]) {
      const b = h("button", { type: "button", role: "radio", "aria-checked": String(k === kind), onclick: async () => {
        kind = k; await cargarKind(k);
        tipoBox.querySelectorAll("button").forEach((x) => x.setAttribute("aria-checked", String(x === b)));
        pintarKind();
      } }, icono(KINDS[k].icono), k === "aceites" ? "Aceite" : "Filtro");
      tipoBox.append(b);
    }
  }
  prodSel.addEventListener("change", pintarProducto);
  pintarKind();

  const fecha = input({ type: "date", name: "fecha", value: hoy(), max: hoy(), required: true });
  ventana({
    titulo: "Registrar uso", boton: "Registrar", clase: "modal-ancho",
    texto: p && !elegirTipo ? null : "Elige el producto: el stock se resta solo.",
    campos: [
      elegirTipo && tipoBox,
      p && !elegirTipo ? h("p", { class: "uso-prod" }, h("b", {}, p.nombre)) : prodField,
      p && !elegirTipo && h("div", { hidden: true }, prodSel),
      disp,
      h("div", { class: "cols" }, field("Fecha *", fecha), field("Cliente *", inputSugerido({ name: "cliente", required: true, maxlength: 120, placeholder: "Nombre del cliente", value: cliente }, S.clientes))),
      h("div", { class: "cols" }, cantBox, claseField),
      extraBox,
    ],
    onSubmit: async (fd) => {
      if (!prod) throw userError("Elige el producto.");
      const cliente = canonico(fd.get("cliente"), S.clientes);
      if (!cliente) throw userError("Escribe el nombre del cliente.");
      const q = cant.leer();
      if (!(q > 0)) throw userError("La cantidad debe ser mayor a 0.");
      if (q > Number(prod.actual) + 1e-9) throw userError(`No alcanza: quedan ${cantidadTxt(kind, prod, prod.actual)}.`);
      const item = { id: prod.id, cantidad: q };
      if (kind === "filtros") item.clase = val(fd, "clase") || "";
      const r = must(await sb.rpc("registrar_uso", {
        p_tipo: KINDS[kind].tipoUso, p_fecha: fd.get("fecha") || hoy(), p_cliente: cliente, p_vehiculo_id: null,
        p_items: [item], p_extra: ex.leer(fd),
      }));
      await ctx.recargar?.();
      const queda = r2(Number(prod.actual) - q);
      const valor = planIncluye("EST") ? ` · ${money(r.total)}` : "";
      return r.avisos?.length
        ? [`Registrado${valor}. ⚠ Stock bajo: quedan ${cantidadTxt(kind, prod, queda)} de ${prod.nombre}`, "warn"]
        : `Registrado: ${cantidadTxt(kind, prod, q)} de ${prod.nombre} para ${cliente}${valor}`;
    },
  });
}

// ---------- Historial por producto ----------
export async function abrirHistorial(ctx, p) {
  const { kind } = ctx, K = KINDS[kind];
  const dueno = esDueno();
  const cuerpo = h("div", { class: "stack" }, loading());
  const info = ventanaInfo({ titulo: `Historial · ${p.nombre}`, contenido: cuerpo, clase: "modal-ancho" });

  const pintar = async () => {
    try {
      const [usos, aud, prodActual] = await Promise.all([
        sb.from(K.usos).select(`id,fecha,cliente,cantidad,${kind === "filtros" ? "clase," : ""}cambio_id,extra,created_at`).eq(K.fk, p.id).is("deleted_at", null)
          .order("fecha", { ascending: false }).order("created_at", { ascending: false }).limit(300).then(must),
        sb.from("auditoria").select("accion,antes,despues,email,at").eq("tabla", K.tabla).eq("registro_id", p.id)
          .order("at", { ascending: false }).limit(300).then(must),
        sb.from(K.vista).select("*").eq("id", p.id).maybeSingle().then(must),
      ]);
      const q = prodActual || p;
      const usado = r2(Number(q.stock_inicial) + Number(q.entradas) - Number(q.actual));
      const camposUso = ctx.camposUso || [];

      // Entradas y cambios de stock inicial, desde la auditoría
      const movs = [];
      for (const a of aud) {
        const d = a.despues || {}, b = a.antes || {};
        if (a.accion === "INSERT") movs.push({ at: a.at, email: a.email, txt: `Creado con stock inicial de ${cantidadTxt(kind, d, d.stock_inicial)}` });
        if (a.accion !== "UPDATE") continue;
        const de = r2(Number(d.entradas) - Number(b.entradas));
        if (de) movs.push({ at: a.at, email: a.email, txt: `${de > 0 ? "Entrada: +" : "Ajuste de entradas: "}${cantidadTxt(kind, d, de)}`, tipo: de > 0 ? "ok" : "warn" });
        const di = r2(Number(d.stock_inicial) - Number(b.stock_inicial));
        if (di) movs.push({ at: a.at, email: a.email, txt: `Stock inicial: ${cantidadTxt(kind, b, b.stock_inicial)} → ${cantidadTxt(kind, d, d.stock_inicial)}`, tipo: "warn" });
      }

      const filaUso = (u) => {
        const acc = h("span", { class: "hist-acc" });
        const normal = () => acc.replaceChildren(dueno && !u.cambio_id
          ? h("button", { class: "link danger-link", type: "button", onclick: confirmar }, "Borrar") : "");
        function confirmar() {
          acc.replaceChildren(h("span", { class: "note" }, "¿Borrar? "),
            h("button", { class: "link danger-link", type: "button", onclick: async () => {
              try {
                must(await sb.rpc("borrar", { p_tabla: K.usos, p_id: u.id }));
                toast("Uso borrado: el stock se devolvió");
                await ctx.recargar?.();
                await pintar();
              } catch (e) { toast(errMsg(e), "error"); normal(); }
            } }, "Sí"), " · ",
            h("button", { class: "link", type: "button", onclick: normal }, "No"));
        }
        normal();
        const ext = extraTxt(camposUso, u.extra);
        return h("li", { class: "hist-fila" },
          h("div", {}, h("b", {}, u.cliente), h("span", { class: "note" }, ` · ${diaTxt(u.fecha)}`),
            (u.clase || ext.length || u.cambio_id) ? h("div", { class: "note" }, [u.cambio_id && "Parte de un cambio", u.clase, ...ext].filter(Boolean).join(" · ")) : null),
          h("div", { class: "hist-der" }, h("b", { class: "menos" }, "−", cantidadTxt(kind, q, u.cantidad)), acc));
      };

      // replaceChildren no aplana listas ni ignora false: se filtra antes
      cuerpo.replaceChildren(...[
        h("dl", { class: "hist-resumen" },
          h("div", {}, h("dt", {}, "Stock actual"), h("dd", {}, cantidadTxt(kind, q, q.actual))),
          h("div", {}, h("dt", {}, "Stock inicial"), h("dd", {}, cantidadTxt(kind, q, q.stock_inicial))),
          h("div", {}, h("dt", {}, "Entradas"), h("dd", {}, cantidadTxt(kind, q, q.entradas))),
          h("div", {}, h("dt", {}, "Usado"), h("dd", {}, cantidadTxt(kind, q, usado)))),
        h("h3", {}, `Usos (${usos.length})`),
        usos.length ? h("ul", { class: "hist" }, usos.map(filaUso)) : h("p", { class: "note" }, "Todavía no hay usos registrados."),
        dueno && h("h3", {}, "Entradas y cambios de stock"),
        dueno && (movs.length ? h("ul", { class: "hist" }, movs.map((m) => h("li", { class: "hist-fila" },
          h("div", {}, h("b", {}, m.txt), h("div", { class: "note" }, momentoTxt(m.at), m.email ? ` · ${m.email}` : ""))))) :
          h("p", { class: "note" }, "Sin movimientos registrados.")),
      ].filter(Boolean));
    } catch (e) {
      cuerpo.replaceChildren(errorBox(errMsg(e)));
    }
  };
  await pintar();
  return info;
}
