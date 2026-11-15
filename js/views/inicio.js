// Inicio: saludo con el logo, alertas de stock bajo y accesos rápidos.
import { h } from "../util.js";
import { state, esDueno, planIncluye } from "../state.js";
import { lavadoraLogo, icono } from "../ui.js";
import { KINDS, cantidadTxt } from "../stock.js";
import { cargarProductos, estado, chipEstado, abrirUso, abrirEditor } from "./productos.js";
import { abrirNuevoCambio } from "./cambios.js";

export async function render(box) {
  const l = state.lavadora;
  const sinConfigurar = esDueno() && !l.logo_path
    && l.color_primario.toUpperCase() === "#0F2E44" && l.color_acento.toUpperCase() === "#D0911C";

  const [aceites, filtros] = await Promise.all([cargarProductos("aceites"), cargarProductos("filtros")]);
  const alertas = [
    ...aceites.filter((p) => estado(p) !== "ok").map((p) => ({ kind: "aceites", p })),
    ...filtros.filter((p) => estado(p) !== "ok").map((p) => ({ kind: "filtros", p })),
  ].sort((a, b) => (estado(a.p) === "agotado" ? 0 : 1) - (estado(b.p) === "agotado" ? 0 : 1));

  const recargar = () => state.refresh();
  const accion = (ico, titulo, sub, onclick) =>
    h("button", { class: "card rapido", type: "button", onclick }, h("span", { class: "rapido-ico" }, icono(ico)),
      h("span", {}, h("b", {}, titulo), h("small", {}, sub)));

  box.append(...[
    h("section", { class: "hero" },
      lavadoraLogo(l, "lg"),
      h("div", { style: { minWidth: "0" } },
        h("p", { class: "hero-saludo" }, "¡Hola! Bienvenido a"),
        h("h1", {}, l.nombre),
        h("p", {}, `${aceites.length} ${aceites.length === 1 ? "aceite" : "aceites"} · ${filtros.length} ${filtros.length === 1 ? "filtro" : "filtros"}`))),

    h("div", { class: "rapidos" },
      planIncluye("PRO") && accion("cambio", "Nuevo cambio", "Aceite, filtros y mano de obra", () => abrirNuevoCambio({ onDone: recargar })),
      accion("uso", "Registrar uso", "Aceite o filtro usado", () => abrirUso({ kind: null, recargar }, null)),
      accion("aceite", "Agregar aceite", "Con su stock inicial", () => abrirEditor({ kind: "aceites", recargar }, null)),
      accion("filtro", "Agregar filtro", "Con su stock inicial", () => abrirEditor({ kind: "filtros", recargar }, null))),

    h("section", { class: "card stack" },
      h("div", { class: "head-row" }, h("h2", {}, "Stock bajo"),
        alertas.length > 0 && h("span", { class: "chip warn" }, `${alertas.length}`)),
      alertas.length
        ? h("ul", { class: "alertas" }, alertas.map(({ kind, p }) => h("li", {},
            h("a", { href: `#${kind}/bajo` },
              h("span", { class: "alerta-ico" }, icono(KINDS[kind].icono)),
              h("span", { class: "alerta-txt" }, h("b", {}, p.nombre),
                h("small", {}, [p.marca, KINDS[kind].Uno, `quedan ${cantidadTxt(kind, p, p.actual)}`].filter(Boolean).join(" · "))),
              chipEstado(estado(p))))))
        : h("p", { class: "ok-txt" }, aceites.length + filtros.length
            ? "Todo el stock está por encima del mínimo."
            : "Agrega tus aceites y filtros para ver aquí los avisos de stock bajo.")),

    sinConfigurar && h("p", { class: "aviso" },
      "Personaliza tu lavadora: sube tu logo y elige tus colores en ", h("a", { href: "#config" }, "Configuración"), "."),
  ].filter(Boolean));
}
