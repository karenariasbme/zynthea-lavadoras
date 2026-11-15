// Aceites y Filtros (Plan Básico): lista con buscador, agregar/editar, agregar stock, registrar uso e historial.
// Todo pasa por lo que ya existe en la base: vistas stock_*, registrar_uso(), borrar() y la auditoría.
import { sb } from "../sb.js";
import { h, must, val, toast, errMsg } from "../util.js";
import { state, esDueno } from "../state.js";
import { pageHead, field, input, userError, ventana, ventanaInfo, icono, loading, errorBox } from "../ui.js";
import {
  KINDS, enGalones, cantidadTxt, campoCantidad, r2, hoy, diaTxt, momentoTxt, norm, limpiar, canonico,
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

const detalle = (kind, p) => kind === "aceites"
  ? [p.marca, p.presentacion].filter(Boolean).join(" · ")
  : [p.marca, p.referencia && `Código ${p.referencia}`].filter(Boolean).join(" · ");

// ---------- Pantalla ----------
export async function render(box, kind) {
  const K = KINDS[kind];
  const sub = location.hash.replace(/^#/, "").split("/")[1];
  let lista = [], S = null;
  const [campos, camposUso] = await Promise.all([camposDe(K.tabla), camposDe(K.usos)]);
  const ctx = { kind, campos, camposUso, get S() { return S; }, get lista() { return lista; }, recargar: () => cargar() };

  const buscar = input({ type: "search", placeholder: K.buscarPh, "aria-label": `Buscar ${K.titulo.toLowerCase()}` });
  const marcaSel = h("select", { class: "input", "aria-label": "Filtrar por marca" });
  const bajoChk = h("input", { type: "checkbox", checked: sub === "bajo" });
  const contador = h("p", { class: "note", "aria-live": "polite" });
  const cont = h("div", { class: "prod-lista" }, loading());

  box.append(
    h("div", { class: "page-head head-row" },
      h("div", {}, h("h1", {}, K.titulo), h("p", {}, "El stock se resta solo cada vez que registras un uso.")),
      h("button", { class: "btn accent", type: "button", onclick: () => abrirEditor(ctx, null) }, icono("mas"), K.nuevo)),
    h("div", { class: "filtros-bar" },
      h("label", { class: "buscar" }, icono("buscar"), buscar),
      marcaSel,
      h("label", { class: "check" }, bajoChk, h("span", {}, "Solo stock bajo"))),
    contador, cont);

  const pintar = () => {
    const q = norm(buscar.value.trim()), m = marcaSel.value, soloBajo = bajoChk.checked;
    const vis = lista.filter((p) =>
      (!q || K.texto.some((c) => norm(p[c]).includes(q))) &&
      (!m || limpiar(p.marca).toLowerCase() === m) &&
      (!soloBajo || estado(p) !== "ok"));
    const bajos = lista.filter((p) => estado(p) !== "ok").length;
    contador.textContent = !lista.length ? "" :
      `${vis.length === lista.length ? lista.length : `${vis.length} de ${lista.length}`} ${K.titulo.toLowerCase()}` +
      (bajos ? ` · ${bajos} con stock bajo o agotado${bajos === 1 ? "" : "s"}` : "");
    if (!lista.length) return cont.replaceChildren(h("div", { class: "card state" }, K.vacio,
      h("button", { class: "btn accent", type: "button", onclick: () => abrirEditor(ctx, null) }, icono("mas"), K.nuevo)));
    if (!vis.length) return cont.replaceChildren(h("div", { class: "card state" }, "Ningún producto coincide con la búsqueda.",
      h("button", { class: "link", type: "button", onclick: () => { buscar.value = ""; marcaSel.value = ""; bajoChk.checked = false; pintar(); } }, "Quitar filtros")));
    cont.replaceChildren(...vis.map((p) => tarjeta(ctx, p)));
  };

  const pintarMarcas = () => {
    const actual = marcaSel.value;
    const marcas = new Map();
    for (const p of lista) { const v = limpiar(p.marca); if (v && !marcas.has(v.toLowerCase())) marcas.set(v.toLowerCase(), v); }
    marcaSel.replaceChildren(h("option", { value: "" }, "Todas las marcas"),
      ...[...marcas.entries()].sort((a, b) => a[1].localeCompare(b[1], "es")).map(([k, v]) => h("option", { value: k }, v)));
    marcaSel.value = marcas.has(actual) ? actual : "";
  };

  async function cargar() {
    try {
      [lista, S] = await Promise.all([cargarProductos(kind), cargarSugerencias()]);
      lista.sort((a, b) => ORDEN_ESTADO[estado(a)] - ORDEN_ESTADO[estado(b)] || a.nombre.localeCompare(b.nombre, "es"));
      pintarMarcas();
      pintar();
    } catch (e) {
      cont.replaceChildren(errorBox(errMsg(e)));
    }
  }
  buscar.addEventListener("input", pintar);
  marcaSel.addEventListener("change", pintar);
  bajoChk.addEventListener("change", pintar);
  await cargar();
  if (sub === "nuevo") abrirEditor(ctx, null);
}

function tarjeta(ctx, p) {
  const { kind } = ctx;
  const e = estado(p);
  const actual = Number(p.actual) || 0, minimo = Number(p.minimo) || 0;
  const pct = Math.max(0, Math.min(100, minimo > 0 ? (actual / (minimo * 2)) * 100 : actual > 0 ? 100 : 0));
  const extras = extraTxt(ctx.campos, p.extra);
  return h("article", { class: `card prod ${e}` },
    h("div", { class: "prod-top" }, p.tipo ? h("span", { class: "chip tipo" }, p.tipo) : h("span"), chipEstado(e)),
    h("h3", {}, p.nombre),
    detalle(kind, p) && h("p", { class: "prod-det" }, detalle(kind, p)),
    kind === "filtros" && p.aplicacion && h("p", { class: "prod-det" }, "Para: ", p.aplicacion),
    h("div", { class: "prod-stock" },
      h("b", {}, cantidadTxt(kind, p, actual)),
      h("span", {}, minimo > 0 ? `avisar en ${cantidadTxt(kind, p, minimo)}` : "sin aviso de stock bajo")),
    h("div", { class: "barra", "aria-hidden": "true" }, h("i", { style: { width: `${pct}%` } })),
    extras.length > 0 && h("p", { class: "prod-det" }, extras.join(" · ")),
    h("div", { class: "prod-acciones" },
      h("button", { class: "btn primary sm", type: "button", disabled: actual <= 0, onclick: () => abrirUso(ctx, p) }, "Registrar uso"),
      h("button", { class: "btn sm", type: "button", onclick: () => abrirEntrada(ctx, p) }, "Agregar stock"),
      h("button", { class: "btn sm", type: "button", onclick: () => abrirHistorial(ctx, p) }, "Historial"),
      h("button", { class: "btn sm", type: "button", onclick: () => abrirEditor(ctx, p) }, "Editar")));
}

// ---------- Agregar / editar ----------
export async function abrirEditor(ctx, p) {
  const { kind } = ctx, K = KINDS[kind];
  const S = ctx.S || await cargarSugerencias();
  const campos = ctx.campos || await camposDe(K.tabla);
  const dueno = esDueno();
  const nuevo = !p;
  const usado = nuevo ? 0 : r2(Number(p.stock_inicial) + Number(p.entradas) - Number(p.actual));

  const sug = (name, label, valores, props = {}) =>
    field(label, inputSugerido({ name, value: p?.[name] ?? "", maxlength: 120, ...props }, valores));
  const pres = kind === "aceites" ? inputSugerido({ name: "presentacion", value: p?.presentacion ?? "Galón", maxlength: 60, required: true }, S.aceites.presentacion) : null;
  const prodActual = () => ({ presentacion: pres ? limpiar(pres.querySelector("input").value) : "" });
  const inicial = campoCantidad(kind, p || { presentacion: "Galón" }, nuevo ? "" : p.stock_inicial, { label: "Stock inicial", name: "stock_inicial" });
  const minimo = campoCantidad(kind, p || { presentacion: "Galón" }, nuevo ? "" : p.minimo, { label: "Avisar cuando queden", name: "minimo", requerido: false });
  if (pres) pres.querySelector("input").addEventListener("input", () => { inicial.set(prodActual()); minimo.set(prodActual()); });
  if (!dueno && !nuevo) inicial.el.querySelectorAll("input,select").forEach((x) => { x.disabled = true; });
  const ex = camposExtra(campos, p?.extra);

  const campos_ = [
    sug("nombre", "Nombre *", S[kind].nombre, { required: true, placeholder: kind === "aceites" ? "Ej.: Aceite 20W-50" : "Ej.: Filtro de aceite" }),
    h("div", { class: "cols" }, sug("tipo", "Tipo", S[kind].tipo), sug("marca", "Marca", S.marcas)),
    kind === "aceites" && field("Presentación *", pres, "Galón: el stock se cuenta en galones y cuartos."),
    kind === "filtros" && h("div", { class: "cols" }, sug("referencia", "Código / referencia", S.filtros.referencia),
      sug("aplicacion", "Para qué vehículos", S.filtros.aplicacion, { placeholder: "Ej.: Toyota / Isuzu" })),
    h("div", { class: "cols" }, inicial.el, minimo.el),
    !nuevo && h("p", { class: "note" },
      `Entradas: ${cantidadTxt(kind, p, p.entradas)} · Usado: ${cantidadTxt(kind, p, usado)} · Stock actual: ${cantidadTxt(kind, p, p.actual)}`),
    ex.nodos,
  ];

  const borrarBtn = !nuevo && dueno && h("button", { class: "btn danger", type: "button", onclick: () => confirmarBorrar(ctx, p, () => editor.cerrar()) }, "Borrar");
  const editor = ventana({
    titulo: nuevo ? K.nuevo : `Editar ${K.uno}`, boton: nuevo ? "Agregar" : "Guardar", campos: campos_, izquierda: borrarBtn, clase: "modal-ancho",
    onSubmit: async (fd) => {
      const nombre = canonico(fd.get("nombre"), S[kind].nombre);
      if (!nombre) throw userError("Escribe el nombre.");
      const datos = {
        nombre,
        tipo: canonico(fd.get("tipo"), S[kind].tipo),
        marca: canonico(fd.get("marca"), S.marcas),
        minimo: minimo.leer(),
        extra: ex.leer(fd),
      };
      if (kind === "aceites") {
        datos.presentacion = canonico(fd.get("presentacion"), S.aceites.presentacion);
        if (!datos.presentacion) throw userError("Escribe la presentación (por ejemplo, Galón).");
      } else {
        datos.referencia = canonico(fd.get("referencia"), S.filtros.referencia);
        datos.aplicacion = canonico(fd.get("aplicacion"), S.filtros.aplicacion);
      }
      if (nuevo || dueno) {
        datos.stock_inicial = inicial.leer();
        if (datos.stock_inicial < 0) throw userError("El stock inicial no puede ser negativo.");
        if (!nuevo && datos.stock_inicial + Number(p.entradas) - usado < 0)
          throw userError(`Con ese stock inicial el stock quedaría en negativo: ya se usaron ${cantidadTxt(kind, p, usado)}.`);
      }
      if (nuevo) must(await sb.from(K.tabla).insert(datos).select("id").single());
      else must(await sb.from(K.tabla).update(datos).eq("id", p.id).select("id").single());
      await ctx.recargar?.();
      return nuevo ? `${K.Uno} agregado: ${nombre}` : "Cambios guardados";
    },
  });
}

function confirmarBorrar(ctx, p, despues) {
  const K = KINDS[ctx.kind];
  ventana({
    titulo: `Borrar ${K.uno}`, boton: "Borrar", peligro: true,
    texto: `${p.nombre}${p.marca ? ` · ${p.marca}` : ""}. Desaparece de la lista; si tiene usos registrados, primero hay que borrarlos desde el Historial.`,
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
    titulo: "Agregar stock", texto: `${p.nombre}${p.marca ? ` · ${p.marca}` : ""} · ahora hay ${cantidadTxt(kind, p, p.actual)}.`,
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
export async function abrirUso(ctx, p) {
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
        [x.nombre, x.marca, `${cantidadTxt(kind, x, x.actual)}`].filter(Boolean).join(" · "))));
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
      p && !elegirTipo ? h("p", { class: "uso-prod" }, h("b", {}, p.nombre), p.marca ? ` · ${p.marca}` : "") : prodField,
      p && !elegirTipo && h("div", { hidden: true }, prodSel),
      disp,
      h("div", { class: "cols" }, field("Fecha *", fecha), field("Cliente *", inputSugerido({ name: "cliente", required: true, maxlength: 120, placeholder: "Nombre del cliente" }, S.clientes))),
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
      return r.avisos?.length
        ? [`Registrado. ⚠ Stock bajo: quedan ${cantidadTxt(kind, prod, queda)} de ${prod.nombre}`, "warn"]
        : `Registrado: ${cantidadTxt(kind, prod, q)} de ${prod.nombre} para ${cliente}`;
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
            (u.clase || ext.length) ? h("div", { class: "note" }, [u.clase, ...ext].filter(Boolean).join(" · ")) : null),
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
