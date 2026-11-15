// Cambios (Plan Profesional): Autos y Motos, por tipo de cambio. Se guardan con registrar_cambio_pro() (007),
// que descuenta el stock y calcula el valor en la base. Se borran con borrar('cambios') (el stock vuelve; nada se elimina).
import { sb } from "../sb.js";
import { h, must, errMsg, money, waLink } from "../util.js";
import { state, esDueno, planIncluye } from "../state.js";
import { field, input, userError, ventana, icono, loading, errorBox, waIcon } from "../ui.js";
import {
  cantidadTxt, campoCantidad, valorAceite, porCuartos, equivalenciaTxt, r2, hoy, diaTxt, momentoTxt, norm, limpiar,
  canonico, mayusculas, cargarSugerencias, inputSugerido,
} from "../stock.js";
import { cargarProductos } from "./productos.js";
import { todo, nombresProductos } from "../respaldo.js";

export const TIPOS_CAMBIO = ["Aceite de motor", "Caja", "Transmisión", "Refrigerante", "Filtros"];
const USO_DEL_TIPO = { "Aceite de motor": "motor", Caja: "caja", "Transmisión": "transmision", Refrigerante: "refrigerante" };
const SEGMENTOS = [["auto", "Autos"], ["moto", "Motos"]];

const etiquetaAceite = (a) => [a.nombre, `quedan ${cantidadTxt("aceites", a, a.actual)}`, money(a.precio) + (porCuartos(a) ? " el galón" : "")].join(" · ");
const etiquetaFiltro = (f) => [f.nombre, f.referencia && `código ${f.referencia}`, f.rosca && `rosca ${f.rosca}`, `quedan ${cantidadTxt("filtros", f, f.actual)}`, money(f.precio)].filter(Boolean).join(" · ");

/** Cambios con sus usos (aceite y filtros), del más reciente al más antiguo. Incluye los borrados (marcados). */
export async function cargarCambios() {
  const [cambios, ua, uf, productos] = await Promise.all([
    todo(() => sb.from("cambios").select("id,fecha,cliente,placa,modelo,tipo,segmento,mano_obra,total,created_at,deleted_at")
      .order("fecha", { ascending: false }).order("created_at", { ascending: false })),
    todo(() => sb.from("usos_aceite").select("id,cambio_id,aceite_id,cantidad,valor").not("cambio_id", "is", null)),
    todo(() => sb.from("usos_filtro").select("id,cambio_id,filtro_id,cantidad,valor,clase").not("cambio_id", "is", null)),
    nombresProductos(),
  ]);
  const por = new Map(cambios.map((c) => [c.id, { ...c, aceites: [], filtros: [] }]));
  for (const u of ua) por.get(u.cambio_id)?.aceites.push({ ...u, prod: productos.get(u.aceite_id) });
  for (const u of uf) por.get(u.cambio_id)?.filtros.push({ ...u, prod: productos.get(u.filtro_id) });
  return [...por.values()];
}

/** Detalle de un cambio (para la lista de Cambios y el historial del cliente). */
export function detalleCambio(c, { conCliente = true } = {}) {
  return h("div", { class: "cambio-det" },
    h("div", { class: "audit-cab" },
      h("span", { class: "chip tipo" }, c.tipo), h("span", { class: "chip tipo" }, c.segmento === "moto" ? "Moto" : "Auto"),
      c.deleted_at && h("span", { class: "chip bad" }, `Borrado el ${momentoTxt(c.deleted_at)}`)),
    conCliente && h("b", { class: "cambio-cli" }, c.cliente),
    h("p", { class: "note" }, [diaTxt(c.fecha), c.placa, c.modelo].filter(Boolean).join(" · ")),
    h("ul", { class: "cambio-items" },
      c.aceites.map((u) => h("li", {}, h("span", {}, u.prod?.nombre || "Aceite borrado", " — ", cantidadTxt("aceites", u.prod, u.cantidad)), h("b", {}, money(u.valor)))),
      c.filtros.map((u) => h("li", {}, h("span", {}, u.prod?.nombre || "Filtro borrado", Number(u.cantidad) > 1 ? ` × ${Number(u.cantidad)}` : "", u.clase ? ` (${u.clase})` : ""), h("b", {}, money(u.valor)))),
      h("li", {}, h("span", {}, "Mano de obra"), h("b", {}, money(c.mano_obra))),
      h("li", { class: "cambio-total" }, h("span", {}, "Total"), h("b", {}, money(c.total)))));
}

// ---------- Pantalla ----------
export async function render(box) {
  if (!planIncluye("PRO")) {
    const msg = `Hola Karen, tengo el Sistema para Lavadoras (lavadora "${state.lavadora.nombre}") y quiero el plan Profesional para registrar cambios de aceite.`;
    box.append(h("div", { class: "page-head" }, h("h1", {}, "Cambios")),
      h("div", { class: "card stack" }, h("p", {}, "El cambio de aceite completo (aceite, filtros, mano de obra y total a cobrar) está en el plan Profesional."),
        h("div", { class: "actions" }, h("a", { class: "btn whatsapp", href: waLink(msg), target: "_blank", rel: "noopener" }, waIcon(), "Mejorar plan"))));
    return;
  }
  const sub = location.hash.replace(/^#/, "").split("/")[1];
  let segmento = sub === "motos" ? "moto" : "auto";
  let cambios = [];

  const segEl = h("div", { class: "subtabs", role: "tablist", "aria-label": "Autos o motos" });
  const buscar = input({ type: "search", placeholder: "Buscar: cliente, placa o fecha (15/11)", "aria-label": "Buscar cambios" });
  const fechaIn = input({ type: "date", "aria-label": "Fecha", max: hoy() });
  const borradosChk = h("input", { type: "checkbox" });
  const info = h("p", { class: "note", "aria-live": "polite" });
  const cont = h("div", { class: "cambios-lista" }, loading());

  box.append(
    h("div", { class: "page-head head-row" },
      h("div", {}, h("h1", {}, "Cambios"), h("p", {}, "Aceite, filtros y mano de obra en un solo paso; el stock se descuenta solo.")),
      h("button", { class: "btn accent", type: "button", onclick: () => abrirNuevoCambio({ segmento, onDone: cargar }) }, icono("mas"), "Nuevo cambio")),
    segEl,
    h("div", { class: "filtros-bar cambios" },
      h("label", { class: "buscar" }, icono("buscar"), buscar), fechaIn,
      h("label", { class: "check" }, borradosChk, h("span", {}, "Ver borrados"))),
    info, cont);

  const pintarSeg = () => segEl.replaceChildren(...SEGMENTOS.map(([k, n]) => {
    const cuantos = cambios.filter((c) => c.segmento === k && !c.deleted_at).length;
    return h("button", { type: "button", role: "tab", "aria-selected": String(k === segmento), onclick: () => { segmento = k; pintarSeg(); pintar(); } },
      n, h("span", { class: "count" }, cuantos));
  }));

  const pintar = () => {
    const q = norm(limpiar(buscar.value)), f = fechaIn.value;
    const vis = cambios.filter((c) => c.segmento === segmento && (borradosChk.checked || !c.deleted_at) &&
      (!f || c.fecha === f) &&
      (!q || norm([c.cliente, c.placa, c.modelo, diaTxt(c.fecha), c.tipo].join(" ")).includes(q)));
    const total = cambios.filter((c) => c.segmento === segmento && !c.deleted_at).length;
    info.textContent = total ? `${vis.length === total ? total : `${vis.length} de ${total}`} cambios` : "";
    if (!vis.length) return cont.replaceChildren(h("div", { class: "card state" },
      total ? "Ningún cambio coincide con la búsqueda." : `Todavía no hay cambios de ${segmento === "moto" ? "motos" : "autos"}.`));
    cont.replaceChildren(...vis.map((c) => h("article", { class: `card cambio${c.deleted_at ? " borrado" : ""}` },
      detalleCambio(c),
      esDueno() && !c.deleted_at && h("div", { class: "actions" },
        h("button", { class: "btn danger sm", type: "button", onclick: () => ventana({
          titulo: "Borrar cambio", boton: "Borrar", peligro: true,
          texto: `${c.cliente} · ${diaTxt(c.fecha)} · ${c.tipo}. El aceite y los filtros vuelven al stock. El cambio queda en el historial marcado como borrado.`,
          onSubmit: async () => { must(await sb.rpc("borrar", { p_tabla: "cambios", p_id: c.id })); await cargar(); return "Cambio borrado: el stock se devolvió"; },
        }) }, "Borrar")))));
  };

  async function cargar() {
    try { cambios = await cargarCambios(); pintarSeg(); pintar(); }
    catch (e) { cont.replaceChildren(errorBox(errMsg(e))); }
  }
  buscar.addEventListener("input", pintar);
  fechaIn.addEventListener("change", pintar);
  borradosChk.addEventListener("change", pintar);
  await cargar();
}

// ---------- Nuevo cambio ----------
/** Buscador de productos: escribe y elige de la lista. leer() devuelve el producto elegido o null. */
function buscadorProducto(nombre, productos, etiqueta, props = {}) {
  // Se compara con el mismo limpiar() en los dos lados (el formato de moneda puede traer espacios especiales)
  const etiquetas = new Map(productos.map((p) => [norm(limpiar(etiqueta(p))), p]));
  const w = inputSugerido({ name: nombre, placeholder: "Escribe marca, SAE o código…", ...props }, productos.map(etiqueta));
  const el = w.querySelector("input");
  return { w, el, leer: () => etiquetas.get(norm(limpiar(el.value))) || null,
    poner: (p) => { el.value = p ? etiqueta(p) : ""; el.dispatchEvent(new Event("change")); } };
}

export async function abrirNuevoCambio({ segmento = "auto", cliente = "", onDone } = {}) {
  const [S, aceites, filtros, previos] = await Promise.all([
    cargarSugerencias(), cargarProductos("aceites"), cargarProductos("filtros"),
    sb.from("cambios").select("modelo,placa,cliente").is("deleted_at", null).order("created_at", { ascending: false }).limit(1000).then(must),
  ]);
  const vehiculos = [...new Map(previos.filter((c) => c.modelo).map((c) => [norm(c.modelo), c.modelo])).values()];
  const placas = [...new Map(previos.filter((c) => c.placa).map((c) => [c.placa, c.placa])).values()];
  const conStock = (l) => l.filter((p) => Number(p.actual) > 0);

  let seg = segmento;
  const segEl = h("div", { class: "seg", role: "radiogroup", "aria-label": "Auto o moto" });
  const pintarSeg = () => segEl.replaceChildren(...SEGMENTOS.map(([k, n]) =>
    h("button", { type: "button", role: "radio", "aria-checked": String(k === seg), onclick: () => { seg = k; pintarSeg(); } }, n.slice(0, -1))));
  pintarSeg();

  const tipoSel = h("select", { class: "input", name: "tipo", required: true }, TIPOS_CAMBIO.map((t) => h("option", { value: t }, t)));
  const placaW = inputSugerido({ name: "placa", maxlength: 20, placeholder: "ABC-1234", style: { textTransform: "uppercase" } }, placas);
  const manoObra = input({ name: "mano_obra", type: "number", min: 0, step: "0.01", inputmode: "decimal", value: Number(state.lavadora.mano_obra) || 0 });
  const totalEl = h("b", { class: "total-num" }, money(0));
  const detTotal = h("p", { class: "note" });

  // Aceite: los del uso del tipo de cambio primero
  const aceiteBox = h("div", { class: "stack" });
  let aceiteSel = null;
  // La cantidad se arma una sola vez; solo cambia de formato (galones ↔ envases) si cambia la presentación
  const cant = campoCantidad("aceites", { presentacion: "Galón" }, 1, { label: "Cantidad" });
  const cantBox = h("div", {}, cant.el);
  cant.el.addEventListener("input", () => sumar()); cant.el.addEventListener("change", () => sumar());
  const equiv = h("small", { class: "note" });
  const pintarAceite = () => {
    const uso = USO_DEL_TIPO[tipoSel.value];
    const lista = conStock(aceites).sort((a, b) => (norm(b.uso) === uso) - (norm(a.uso) === uso) || a.nombre.localeCompare(b.nombre, "es", { numeric: true }));
    const antes = aceiteSel?.leer();
    aceiteSel = buscadorProducto("aceite", lista, etiquetaAceite);
    aceiteSel.el.addEventListener("change", alElegirAceite);
    aceiteSel.el.addEventListener("input", alElegirAceite);
    aceiteBox.replaceChildren(field("Aceite *", aceiteSel.w, lista.length ? null : "No hay aceites con stock."), h("div", { class: "cols" }, cantBox, h("div", { class: "field" }, equiv)));
    if (antes && lista.includes(antes)) aceiteSel.poner(antes);
    alElegirAceite();
    aceiteBox.hidden = tipoSel.value === "Filtros";
  };
  function alElegirAceite() {
    cant.set(aceiteSel.leer() || { presentacion: "Galón" });
    sumar();
  }

  // Filtros: varias filas (buscador + cantidad + clase)
  const filtrosLista = h("div", { class: "stack" });
  const filas = [];
  const agregarFila = () => {
    const b = buscadorProducto(`filtro_${filas.length}`, conStock(filtros), etiquetaFiltro, { placeholder: "Código, rosca o marca…" });
    const cantF = input({ type: "number", min: 1, step: 1, value: 1, inputmode: "numeric", "aria-label": "Cantidad" });
    const clase = h("select", { class: "input", "aria-label": "Clase" }, ["", "Original", "Compatible", "Otro"].map((c) => h("option", { value: c }, c || "Clase…")));
    const fila = { b, cantF, clase };
    const quitar = h("button", { class: "btn ghost sm", type: "button", "aria-label": "Quitar filtro", onclick: () => {
      filas.splice(filas.indexOf(fila), 1); el.remove(); sumar(); } }, "✕");
    const el = h("div", { class: "fila-filtro" }, b.w, h("div", { class: "fila-filtro-der" }, cantF, clase, quitar));
    for (const x of [b.el, cantF]) { x.addEventListener("input", sumar); x.addEventListener("change", sumar); }
    filas.push(fila); filtrosLista.append(el); sumar();
    if (!matchMedia("(pointer: coarse)").matches) b.el.focus();
  };

  function sumar() {
    const a = tipoSel.value === "Filtros" ? null : aceiteSel?.leer();
    const q = cant?.leer() || 0;
    const vA = a ? valorAceite(a, q) : 0;
    const vF = filas.reduce((s, f) => { const p = f.b.leer(); return s + (p ? r2((Number(p.precio) || 0) * (Number(f.cantF.value) || 0)) : 0); }, 0);
    const mo = Number(manoObra.value) || 0;
    totalEl.textContent = money(vA + vF + mo);
    detTotal.textContent = `Aceite ${money(vA)} · Filtros ${money(vF)} · Mano de obra ${money(mo)}`;
    equiv.textContent = a ? [`Disponible: ${cantidadTxt("aceites", a, a.actual)}`, equivalenciaTxt(a, q)].filter(Boolean).join(" · ") : "";
  }
  manoObra.addEventListener("input", sumar);
  tipoSel.addEventListener("change", () => { pintarAceite(); if (tipoSel.value === "Filtros" && !filas.length) agregarFila(); });
  pintarAceite();

  const fecha = input({ type: "date", name: "fecha", value: hoy(), max: hoy(), required: true });
  ventana({
    titulo: "Nuevo cambio", boton: "Guardar cambio", clase: "modal-ancho",
    campos: [
      segEl,
      h("div", { class: "cols" }, field("Cliente *", inputSugerido({ name: "cliente", required: true, maxlength: 120, value: cliente, placeholder: "Nombre del cliente" }, S.clientes)),
        field("Fecha *", fecha)),
      h("div", { class: "cols" }, field("Placa", placaW), field("Vehículo", inputSugerido({ name: "vehiculo", maxlength: 60, placeholder: "Ej.: Chevrolet Aveo" }, vehiculos))),
      field("Tipo de cambio *", tipoSel),
      aceiteBox,
      h("div", { class: "field" }, h("span", { class: "field-label" }, "Filtros"), filtrosLista,
        h("button", { class: "btn sm", type: "button", onclick: agregarFila, style: { alignSelf: "flex-start" } }, icono("mas"), "Agregar filtro")),
      field("Mano de obra (USD)", manoObra),
      h("div", { class: "total-box" }, h("span", {}, "Total"), totalEl), detTotal,
    ],
    onSubmit: async (fd) => {
      const cli = canonico(fd.get("cliente"), S.clientes);
      if (!cli) throw userError("Escribe el nombre del cliente.");
      const tipo = tipoSel.value;
      const a = tipo === "Filtros" ? null : aceiteSel.leer();
      if (tipo !== "Filtros" && !a) throw userError("Elige el aceite de la lista.");
      const q = a ? cant.leer() : 0;
      if (a && !(q > 0)) throw userError("La cantidad de aceite debe ser mayor a 0.");
      if (a && q > Number(a.actual) + 1e-9) throw userError(`No alcanza: quedan ${cantidadTxt("aceites", a, a.actual)}.`);
      const items = [];
      for (const f of filas) {
        const p = f.b.leer();
        if (!p && !limpiar(f.b.el.value)) continue;   // fila vacía
        if (!p) throw userError("Elige cada filtro de la lista.");
        const n = Number(f.cantF.value);
        if (!Number.isInteger(n) || n <= 0) throw userError("La cantidad de cada filtro debe ser un número entero mayor a 0.");
        items.push({ id: p.id, cantidad: n, clase: f.clase.value });
      }
      if (tipo === "Filtros" && !items.length) throw userError("Elige al menos un filtro.");
      const r = must(await sb.rpc("registrar_cambio_pro", {
        p_fecha: fd.get("fecha") || hoy(), p_cliente: cli, p_segmento: seg, p_tipo: tipo,
        p_placa: limpiar(fd.get("placa")).toUpperCase(), p_vehiculo: mayusculas(fd.get("vehiculo")),
        p_aceite_id: a?.id || null, p_cantidad: q, p_filtros: items, p_mano_obra: r2(Number(manoObra.value) || 0), p_extra: {},
      }));
      await onDone?.();
      return r.avisos?.length ? [`Cambio guardado: ${money(r.total)}. ⚠ Stock bajo: ${r.avisos.join("; ")}`, "warn"] : `Cambio guardado: total ${money(r.total)}`;
    },
  });
}
