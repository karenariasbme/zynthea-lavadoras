// Configuración: Mi lavadora (nombre, logo, colores, mano de obra), Mi plan y Mi cuenta.
import { h, PLANES, ROLES, waLink, PLANES_URL, toast, errMsg } from "../util.js";
import { state, esDueno } from "../state.js";
import { pageHead, waIcon, icono, input, loading, errorBox } from "../ui.js";
import { datosCard, logoCard } from "./lavadora.js";
import { norm } from "../stock.js";
import { leerAuditoria, describir, nombresProductos, todosLosCampos, descargarMisDatos } from "../respaldo.js";

// Lo que incluye cada plan (igual que la página de planes)
const INCLUYE = {
  BAS: ["Stock de aceites y de filtros", "Tipo, marca, presentación y código de cada producto",
        "Aceite en galones y cuartos (cantidad)",
        "Stock inicial y entradas de mercadería", "El stock se resta solo al registrar lo que se usó",
        "Aviso de stock bajo y de productos agotados", "Registro de aceite y filtros usados por cliente",
        "Buscador de aceites y filtros", "Historial de cambios y descarga de tus datos en Excel"],
  EST: ["Precio a cobrar de cada aceite y filtro", "Precio por galón y por cuarto",
        "Base de marcas y modelos de vehículos", "Valor de cada registro en el historial", "Exportar a Excel"],
  PRO: ["Cambio de aceite en un solo paso: aceite y filtros juntos", "Filtro original y compatible por modelo",
        "Total a cobrar con mano de obra", "Historial de cambios por cliente y vehículo"],
  PRE: ["Varios usuarios: dueño y personal", "App instalable con el ícono de tu lavadora",
        "Detalle del cambio y recordatorio al cliente por WhatsApp", "Lista de compras sugerida"],
};
const ORDEN = ["BAS", "EST", "PRO", "PRE"];

export async function render(box) {
  const dueno = esDueno();
  box.append(
    pageHead("Configuración", "Tu lavadora, tu plan y tu cuenta"),
    h("section", { class: "cfg-sec" },
      h("h2", { class: "cfg-tit" }, "Mi lavadora"),
      !dueno && h("p", { class: "aviso", style: { marginBottom: "12px" } }, "Solo el dueño puede cambiar estos datos. Si algo está mal, avísale."),
      h("div", { class: "grid2" }, datosCard(dueno), logoCard(dueno))),
    h("div", { class: "grid2 cfg-sec" }, planCard(), cuentaCard()),
    h("div", { class: "cfg-sec" }, datosDescargaCard()),
    h("div", { class: "cfg-sec" }, historialCard(dueno)),
  );
}

function planCard() {
  const l = state.lavadora;
  const plan = l.plan, i = ORDEN.indexOf(plan);
  const siguiente = ORDEN[i + 1];
  const anterior = ORDEN[i - 1];
  const msg = `Hola Karen, tengo el plan ${PLANES[plan]} del Sistema para Lavadoras (lavadora "${l.nombre}", correo ${state.email}) y quiero mejorar mi plan.`;
  return h("section", { class: "card stack" },
    h("h2", {}, "Mi plan"),
    h("dl", { class: "cfg-datos" },
      h("div", {}, h("dt", {}, "Plan"), h("dd", {}, h("span", { class: "badge" }, PLANES[plan] || plan))),
      h("div", {}, h("dt", {}, "Rol"), h("dd", {}, ROLES[state.acceso?.rol] || "—"))),
    h("div", {},
      h("p", { class: "field-label" }, "Incluye"),
      anterior && h("p", { class: "note" }, `Todo lo del plan ${PLANES[anterior]}, más:`),
      h("ul", { class: "incluye" }, INCLUYE[plan].map((t) => h("li", {}, t)))),
    siguiente && h("p", { class: "note" }, `Con el plan ${PLANES[siguiente]}: ${INCLUYE[siguiente].slice(0, 3).join(", ").toLowerCase()}…`),
    h("div", { class: "actions" },
      siguiente && h("a", { class: "btn whatsapp", href: waLink(msg), target: "_blank", rel: "noopener" }, waIcon(), "Mejorar plan"),
      h("a", { class: "link", href: PLANES_URL, target: "_blank", rel: "noopener" }, "Ver todos los planes")));
}

function cuentaCard() {
  return h("section", { class: "card stack" },
    h("h2", {}, "Mi cuenta"),
    h("dl", { class: "cfg-datos" },
      h("div", {}, h("dt", {}, "Correo"), h("dd", { class: "texto" }, state.email || "—"))),
    h("div", { class: "actions" },
      h("button", { class: "btn", type: "button", onclick: () => state.logout() }, icono("salir"), "Cerrar sesión")));
}

// ---------- Descargar mis datos (todos los planes) ----------
function datosDescargaCard() {
  const btn = h("button", { class: "btn primary", type: "button" }, "Descargar mis datos (Excel)");
  const msg = h("p", { class: "msg ok", role: "status", hidden: true });
  btn.addEventListener("click", async () => {
    btn.disabled = true; btn.textContent = "Preparando el Excel…"; msg.hidden = true;
    try {
      const r = await descargarMisDatos();
      msg.className = "msg ok";
      msg.textContent = `Listo: ${r.archivo} (${r.filas.Aceites} aceites, ${r.filas.Filtros} filtros, ` +
        `${r.filas["Usos de aceite"] + r.filas["Usos de filtros"]} usos, ${r.filas["Historial de cambios"]} cambios; incluye lo borrado, marcado).`;
    } catch (e) {
      msg.className = "msg error"; msg.textContent = errMsg(e);
    } finally {
      msg.hidden = false; btn.disabled = false; btn.textContent = "Descargar mis datos (Excel)";
    }
  });
  return h("section", { class: "card stack" },
    h("h2", {}, "Descargar mis datos"),
    h("p", { class: "note" }, "Un Excel con todo lo que guardaste: aceites, filtros, usos registrados (también los borrados, marcados como tales) " +
      "e historial de cambios. Es tu respaldo: guárdalo donde quieras."),
    h("div", { class: "actions" }, btn), msg);
}

// ---------- Historial de cambios (auditoría de la lavadora) ----------
function historialCard(dueno) {
  const card = h("section", { class: "card stack" }, h("h2", {}, "Historial de cambios"));
  if (!dueno) {
    card.append(h("p", { class: "note" }, "Solo el dueño puede ver el historial de cambios."));
    return card;
  }
  const buscar = input({ type: "search", placeholder: "Buscar: producto, cliente, usuario, fecha…", "aria-label": "Buscar en el historial" });
  const lista = h("ul", { class: "audit" });
  const pie = h("div", { class: "actions" });
  const info = h("p", { class: "note", "aria-live": "polite" });
  card.append(h("p", { class: "note" }, "Quién cambió qué y cuándo: fecha, usuario, qué cambió y el valor de antes → después."),
    h("label", { class: "buscar" }, icono("buscar"), buscar), info, lista, pie);

  let filas = [], productos, campos, fin = false, mostrar = 50;
  const POR_PAGINA = 200;
  const pintar = () => {
    const q = norm(buscar.value.trim());
    const vis = q ? filas.filter((x) => x.texto.includes(q)) : filas;
    info.textContent = !filas.length ? "Todavía no hay cambios registrados."
      : q ? `${vis.length} resultado${vis.length === 1 ? "" : "s"} en los ${filas.length} cambios cargados` : `${filas.length} cambios cargados`;
    lista.replaceChildren(...vis.slice(0, mostrar).map((x) => h("li", { class: "audit-fila" },
      h("div", { class: "audit-cab" }, h("span", { class: `chip ${x.accion === "Borrado" ? "bad" : x.accion === "Creado" ? "ok" : "tipo"}` }, x.accion),
        h("b", {}, x.que)),
      h("div", { class: "note" }, x.fecha, " · ", x.usuario),
      x.cambios.length > 0 && h("ul", { class: "audit-cambios" }, x.cambios.map((c) => h("li", {},
        h("span", { class: "audit-campo" }, `${c.campo}: `),
        c.antes == null ? c.despues : [h("s", {}, c.antes), " → ", h("b", {}, c.despues)]))))));
    const botones = [];
    if (vis.length > mostrar) botones.push(h("button", { class: "btn sm", type: "button", onclick: () => { mostrar += 50; pintar(); } }, "Mostrar más"));
    if (!fin) botones.push(h("button", { class: "btn sm", type: "button", onclick: cargar }, "Cargar cambios más antiguos"));
    pie.replaceChildren(...botones);
  };
  async function cargar() {
    pie.replaceChildren(loading());
    try {
      if (!productos) [productos, campos] = await Promise.all([nombresProductos(), todosLosCampos()]);
      const nuevas = await leerAuditoria(filas.length, POR_PAGINA);
      fin = nuevas.length < POR_PAGINA;
      for (const r of nuevas) {
        const x = describir(r, productos, campos);
        x.texto = norm([x.fecha, x.usuario, x.accion, x.que, ...x.cambios.map((c) => `${c.campo} ${c.antes ?? ""} ${c.despues}`)].join(" "));
        filas.push(x);
      }
      pintar();
    } catch (e) {
      pie.replaceChildren(errorBox(errMsg(e)));
    }
  }
  buscar.addEventListener("input", () => { mostrar = 50; pintar(); });
  cargar();
  return card;
}
