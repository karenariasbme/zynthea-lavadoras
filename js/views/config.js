// Configuración: Mi lavadora (nombre, logo, colores, mano de obra), Mi plan y Mi cuenta.
import { h, PLANES, ROLES, waLink, PLANES_URL } from "../util.js";
import { state, esDueno } from "../state.js";
import { pageHead, waIcon, icono } from "../ui.js";
import { datosCard, logoCard } from "./lavadora.js";

// Lo que incluye cada plan (igual que la página de planes)
const INCLUYE = {
  BAS: ["Stock de aceites y de filtros", "Tipo, marca, presentación y código de cada producto",
        "Stock inicial y entradas de mercadería", "El stock se resta solo al registrar lo que se usó",
        "Aviso de stock bajo y de productos agotados", "Registro de aceite y filtros usados por cliente",
        "Buscador de aceites y filtros"],
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
