import { h, money, PLANES, ROLES } from "../util.js";
import { state, esDueno } from "../state.js";
import { lavadoraLogo } from "../ui.js";

const dato = (label, valor, texto = false) =>
  h("div", { class: "dato" }, h("dt", {}, label), h("dd", { class: texto ? "texto" : null }, valor));

export async function render(box) {
  const l = state.lavadora;
  const rol = state.acceso?.rol;
  const sinConfigurar = esDueno() && !l.logo_path
    && l.color_primario.toUpperCase() === "#0F2E44" && l.color_acento.toUpperCase() === "#D0911C";

  // box.append es del DOM: convertiría false en el texto "false", por eso se filtra
  box.append(...[
    h("section", { class: "hero" },
      lavadoraLogo(l, "lg"),
      h("div", { style: { minWidth: "0" } },
        h("h1", {}, `Bienvenido a ${l.nombre}`),
        h("p", {}, "Sistema para Lavadoras y Lubricadoras"))),
    h("dl", { class: "datos", style: { margin: "0 0 16px" } },
      dato("Plan", h("span", {}, PLANES[l.plan] || l.plan)),
      dato("Rol", ROLES[rol] || rol || "—"),
      dato("Correo", state.email || "—", true),
      dato("Mano de obra", money(l.mano_obra))),
    sinConfigurar && h("p", { class: "aviso" },
      "Personaliza tu lavadora: sube tu logo y elige tus colores en ",
      h("a", { href: "#lavadora" }, "Mi lavadora"), "."),
    !esDueno() && h("p", { class: "note" }, "La configuración de la lavadora la cambia el dueño."),
  ].filter(Boolean));
}
