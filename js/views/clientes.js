// Clientes (Plan Básico): se arman con los usos ya registrados (usos_aceite y usos_filtro). Sin tabla propia.
import { sb } from "../sb.js";
import { h, errMsg } from "../util.js";
import { planIncluye } from "../state.js";
import { pageHead, input, icono, ventanaInfo, loading, errorBox } from "../ui.js";
import { norm, limpiar, cantidadTxt, diaTxt, momentoTxt } from "../stock.js";
import { todo, nombresProductos } from "../respaldo.js";
import { abrirUso } from "./productos.js";
import { cargarCambios, detalleCambio, abrirNuevoCambio } from "./cambios.js";

/**
 * Todos los usos (también los borrados), agrupados por cliente sin mirar mayúsculas ni tildes.
 * [{ nombre, usos: [...], vigentes, ultimo }] del uso más reciente al más antiguo.
 */
async function cargarClientes() {
  const [ua, uf, productos, cambios] = await Promise.all([
    todo(() => sb.from("usos_aceite").select("id,fecha,cliente,cantidad,aceite_id,cambio_id,deleted_at,created_at").order("fecha", { ascending: false })),
    todo(() => sb.from("usos_filtro").select("id,fecha,cliente,cantidad,clase,filtro_id,cambio_id,deleted_at,created_at").order("fecha", { ascending: false })),
    nombresProductos(),
    planIncluye("PRO") ? cargarCambios() : [],
  ]);
  // Un cambio es una sola entrada (con su aceite y filtros); los usos sueltos van uno por uno
  const usos = [
    ...ua.filter((u) => !u.cambio_id).map((u) => ({ ...u, kind: "aceites", prod: productos.get(u.aceite_id) })),
    ...uf.filter((u) => !u.cambio_id).map((u) => ({ ...u, kind: "filtros", prod: productos.get(u.filtro_id) })),
    ...cambios.map((c) => ({ ...c, kind: "cambio", cambio: c })),
  ].sort((a, b) => (b.fecha + b.created_at).localeCompare(a.fecha + a.created_at));

  const grupos = new Map();
  for (const u of usos) {
    const k = norm(limpiar(u.cliente));
    if (!k) continue;
    const g = grupos.get(k) || { formas: new Map(), usos: [] };
    g.usos.push(u);
    g.formas.set(limpiar(u.cliente), (g.formas.get(limpiar(u.cliente)) || 0) + 1);
    grupos.set(k, g);
  }
  return [...grupos.entries()].map(([clave, g]) => {
    const vigentes = g.usos.filter((u) => !u.deleted_at);
    return {
      clave, usos: g.usos, vigentes: vigentes.length, borrados: g.usos.length - vigentes.length,
      nombre: [...g.formas.entries()].sort((a, b) => b[1] - a[1])[0][0],   // la forma más usada
      ultimo: (vigentes[0] || g.usos[0]).fecha,
    };
  }).sort((a, b) => b.ultimo.localeCompare(a.ultimo) || a.nombre.localeCompare(b.nombre, "es"));
}

export async function render(box) {
  const buscar = input({ type: "search", placeholder: "Buscar cliente por nombre", "aria-label": "Buscar cliente" });
  const info = h("p", { class: "note", "aria-live": "polite" });
  const cont = h("div", { class: "cli-lista" }, loading());
  box.append(
    h("div", { class: "page-head head-row" },
      h("div", {}, h("h1", {}, "Clientes"), h("p", {}, "Los clientes salen de los usos registrados.")),
      h("button", { class: "btn accent", type: "button", onclick: () => abrirUso({ kind: null, recargar: cargar }, null) }, icono("uso"), "Registrar uso")),
    h("label", { class: "buscar cli-buscar" }, icono("buscar"), buscar), info, cont);

  let clientes = [];
  const pintar = () => {
    const q = norm(limpiar(buscar.value));
    const vis = q ? clientes.filter((c) => c.clave.includes(q)) : clientes;
    info.textContent = !clientes.length ? "" : q ? `${vis.length} de ${clientes.length} clientes` : `${clientes.length} clientes`;
    if (!clientes.length) return cont.replaceChildren(h("div", { class: "card state" }, "Todavía no hay clientes. Aparecen al registrar el primer uso."));
    if (!vis.length) return cont.replaceChildren(h("div", { class: "card state" }, "Ningún cliente coincide con la búsqueda."));
    cont.replaceChildren(...vis.map((c) => h("button", { class: "card cli", type: "button", onclick: () => abrirCliente(c, cargar) },
      h("span", { class: "cli-ini", "aria-hidden": "true" }, c.nombre.trim()[0]?.toUpperCase() || "?"),
      h("span", { class: "cli-txt" }, h("b", {}, c.nombre),
        h("small", {}, `Último: ${diaTxt(c.ultimo)} · ${c.vigentes} ${c.vigentes === 1 ? "registro" : "registros"}`,
          c.borrados ? ` (${c.borrados} borrado${c.borrados === 1 ? "" : "s"})` : "")),
      h("span", { class: "cli-flecha", "aria-hidden": "true" }, "›"))));
  };
  async function cargar() {
    try { clientes = await cargarClientes(); pintar(); }
    catch (e) { cont.replaceChildren(errorBox(errMsg(e))); }
  }
  buscar.addEventListener("input", pintar);
  await cargar();
}

/** Historial del cliente (aceite y filtros, más reciente primero) y "Registrar uso" con su nombre. */
function abrirCliente(c, recargarLista) {
  const cuerpo = h("div", { class: "stack" });
  let ventanaCli;
  const pintar = (cli) => {
    cuerpo.replaceChildren(
      h("p", { class: "note" }, `${cli.vigentes} ${cli.vigentes === 1 ? "registro" : "registros"} (usos y cambios)`,
        cli.borrados ? ` · ${cli.borrados} borrado${cli.borrados === 1 ? "" : "s"}` : "", ` · último el ${diaTxt(cli.ultimo)}`),
      h("button", { class: "btn primary", type: "button", onclick: () => abrirUso({ kind: null, recargar: async () => {
        await recargarLista();
        const nuevos = await cargarClientes();
        const act = nuevos.find((x) => x.clave === cli.clave);
        if (act && ventanaCli?.dlg.isConnected) pintar(act);
      } }, null, { cliente: cli.nombre }) }, icono("uso"), "Registrar uso"),
      planIncluye("PRO") && h("button", { class: "btn accent", type: "button", onclick: () => abrirNuevoCambio({ cliente: cli.nombre, onDone: async () => {
        await recargarLista();
        const act = (await cargarClientes()).find((x) => x.clave === cli.clave);
        if (act && ventanaCli?.dlg.isConnected) pintar(act);
      } }) }, icono("mas"), "Nuevo cambio"),
      h("ul", { class: "hist" }, cli.usos.map((u) => u.kind === "cambio"
        ? h("li", { class: `hist-fila hist-cambio${u.deleted_at ? " borrado" : ""}` }, h("div", { class: "cambio-en-cliente" }, h("b", {}, "Cambio"), detalleCambio(u.cambio, { conCliente: false })))
        : h("li", { class: `hist-fila${u.deleted_at ? " borrado" : ""}` },
        h("div", {},
          h("b", {}, u.prod?.nombre || "Producto borrado"),
          h("div", { class: "note" }, `${diaTxt(u.fecha)} · ${u.kind === "aceites" ? "Aceite" : "Filtro"}`,
            u.prod?.marca ? ` · ${u.prod.marca}` : "", u.clase ? ` · ${u.clase}` : ""),
          u.deleted_at && h("div", { class: "chip bad" }, `Borrado el ${momentoTxt(u.deleted_at)}`)),
        h("div", { class: "hist-der" }, h("b", { class: u.deleted_at ? "" : "menos" }, cantidadTxt(u.kind, u.prod, u.cantidad)))))),
    );
  };
  pintar(c);
  ventanaCli = ventanaInfo({ titulo: c.nombre, contenido: cuerpo, clase: "modal-ancho" });
}
