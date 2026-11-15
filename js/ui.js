import { sb } from "./sb.js";
import { h, errMsg, toast, tintaSobre, esHex, COLOR_PRIMARIO, COLOR_ACENTO } from "./util.js";

// ---------- Logo de la lavadora ----------
export const logoUrl = (path) => (path ? sb.storage.from("logos").getPublicUrl(path).data.publicUrl : null);

export function iniciales(nombre) {
  const w = (nombre || "").trim().split(/\s+/).filter(Boolean);
  return ((w[0]?.[0] || "L") + (w[1]?.[0] || "")).toUpperCase();
}

/** Logo de la lavadora, o sus iniciales sobre el color de acento si no tiene logo. */
export function lavadoraLogo(l, size = "sm") {
  const url = logoUrl(l?.logo_path);
  return url
    ? h("img", { class: `logo ${size}`, src: url, alt: `Logo de ${l.nombre}` })
    : h("span", { class: `logo initials ${size}`, "aria-hidden": "true" }, iniciales(l?.nombre));
}

export const loading = (text = "Cargando…") =>
  h("div", { class: "state" }, h("span", { class: "spinner", "aria-hidden": "true" }), text);

export const errorBox = (text) => h("div", { class: "state error", role: "alert" }, text);

export const pageHead = (title, sub) =>
  h("div", { class: "page-head" }, h("h1", {}, title), sub && h("p", {}, sub));

/** Etiqueta + control de formulario. */
export const field = (label, control, hint) =>
  h("label", { class: "field" }, h("span", { class: "field-label" }, label), control, hint && h("small", {}, hint));

export const input = (props) => h("input", { class: "input", ...props });

/** Error de validación con mensaje para el usuario. */
export function userError(text) {
  const e = new Error(text);
  e.userMessage = text;
  return e;
}

/** Formulario de envío con estado de carga y mensaje de error propio. */
export function asyncForm(props, children, onSubmit) {
  const msg = h("p", { class: "msg error", role: "alert", hidden: true });
  const form = h("form", props, children, msg);
  form.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const btn = form.querySelector("button[type=submit]");
    const label = btn?.textContent;
    msg.hidden = true;
    if (btn) { btn.disabled = true; btn.textContent = "Guardando…"; }
    try {
      await onSubmit(new FormData(form), form);
    } catch (e) {
      msg.textContent = e.userMessage || errMsg(e);
      msg.hidden = false;
      msg.scrollIntoView({ block: "nearest", behavior: "smooth" });
    } finally {
      if (btn && btn.isConnected) { btn.disabled = false; btn.textContent = label; }
    }
  });
  return form;
}

/** Ícono de WhatsApp para los botones. */
export function waIcon() {
  const ns = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(ns, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("aria-hidden", "true");
  const p = document.createElementNS(ns, "path");
  p.setAttribute("fill", "currentColor");
  p.setAttribute("d", "M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2zm0 18.2a8.2 8.2 0 0 1-4.2-1.1l-.3-.2-3 .8.8-2.9-.2-.3A8.2 8.2 0 1 1 12 20.2zm4.5-6.1c-.2-.1-1.5-.7-1.7-.8s-.4-.1-.6.1-.7.8-.8 1-.3.2-.5.1a6.7 6.7 0 0 1-3.3-2.9c-.3-.4.3-.4.7-1.3.1-.2 0-.3 0-.4l-.8-1.8c-.2-.5-.4-.4-.6-.4h-.5a1 1 0 0 0-.7.3 3 3 0 0 0-.9 2.2 5.2 5.2 0 0 0 1.1 2.8 11.9 11.9 0 0 0 4.6 4c1.7.7 2.3.8 3.2.7a2.7 2.7 0 0 0 1.8-1.3 2.2 2.2 0 0 0 .2-1.3c-.1-.1-.3-.2-.5-.3z");
  svg.append(p);
  return svg;
}

/** Pone los colores de la lavadora en toda la app, con el color de texto de mejor contraste. */
export function aplicarColores(primario, acento) {
  const p = esHex(primario) ? primario : COLOR_PRIMARIO;
  const a = esHex(acento) ? acento : COLOR_ACENTO;
  const s = document.documentElement.style;
  s.setProperty("--brand", p);
  s.setProperty("--brand-ink", tintaSobre(p));
  s.setProperty("--accent", a);
  s.setProperty("--accent-ink", tintaSobre(a));
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", p);
}

// ---------- Ventanas (dentro de la página; nunca alert/confirm del navegador) ----------
function abrirDialogo(titulo, clase = "") {
  const dlg = h("dialog", { class: `modal ${clase}`, "aria-label": titulo });
  const cerrar = () => { if (dlg.open) dlg.close(); dlg.remove(); };
  dlg.addEventListener("cancel", (e) => { e.preventDefault(); cerrar(); });   // tecla Esc
  dlg.addEventListener("click", (e) => { if (e.target === dlg) cerrar(); });  // clic fuera
  return { dlg, cerrar, mostrar: () => { document.body.append(dlg); dlg.showModal(); } };
}

/**
 * Ventana con un formulario. onSubmit(fd, form) hace la acción; si lanza un error, se muestra dentro
 * de la ventana y queda abierta. Si termina bien, se cierra y muestra el aviso que devuelva
 * (texto, o [texto, "warn"]). izquierda: botón opcional al lado izquierdo (p. ej. Borrar).
 */
export function ventana({ titulo, texto, campos = [], boton, peligro = false, izquierda, clase, onSubmit }) {
  const { dlg, cerrar, mostrar } = abrirDialogo(titulo, clase);
  const form = asyncForm({ class: "stack" }, [
    h("h2", {}, titulo),
    texto && h("p", { class: "note" }, texto),
    campos,
    h("div", { class: "actions modal-actions" },
      izquierda && h("span", { class: "modal-izq" }, izquierda),
      h("button", { class: "btn ghost", type: "button", onclick: cerrar }, "Cancelar"),
      h("button", { class: `btn ${peligro ? "danger-fill" : "primary"}`, type: "submit" }, boton)),
  ], async (fd, f) => {
    const aviso = await onSubmit(fd, f);
    cerrar();
    if (Array.isArray(aviso)) toast(aviso[0], aviso[1]);
    else if (aviso) toast(aviso);
  });
  dlg.append(form);
  mostrar();
  if (!matchMedia("(pointer: coarse)").matches) dlg.querySelector("input:not([type=hidden]),select,textarea")?.focus();
  return { dlg, cerrar };
}

/** Ventana de solo lectura con un botón Cerrar. */
export function ventanaInfo({ titulo, contenido, clase }) {
  const { dlg, cerrar, mostrar } = abrirDialogo(titulo, clase);
  dlg.append(h("div", { class: "stack" }, h("h2", {}, titulo), contenido,
    h("div", { class: "actions modal-actions" }, h("button", { class: "btn primary", type: "button", onclick: cerrar }, "Cerrar"))));
  mostrar();
  return { dlg, cerrar };
}

// ---------- Íconos (trazo, 24×24) ----------
const ICONOS = {
  inicio: "M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z",
  aceite: "M12 3c3.5 4.6 6 8 6 11a6 6 0 0 1-12 0c0-3 2.5-6.4 6-11z",
  filtro: "M4 5h16l-6 7.5V19l-4 2v-8.5z",
  config: "M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z",
  salir: "M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9",
  mas: "M12 5v14M5 12h14",
  uso: "M9 11l3 3 8-8M20 12v7a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h9",
  alerta: "M12 8v5M12 16.5v.01M10.3 3.9 2.4 17.5A2 2 0 0 0 4.1 20.5h15.8a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z",
  buscar: "M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM20 20l-4-4",
};
export function icono(nombre) {
  const ns = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(ns, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("class", "ico");
  const p = document.createElementNS(ns, "path");
  p.setAttribute("d", ICONOS[nombre]);
  svg.append(p);
  return svg;
}
