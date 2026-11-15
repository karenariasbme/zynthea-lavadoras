import { sb } from "./sb.js";
import { h, errMsg, must, waLink, PLANES_URL, DEMO_URL } from "./util.js";
import { state, LAVADORA_COLS } from "./state.js";
import { loading, errorBox, lavadoraLogo, waIcon, aplicarColores } from "./ui.js";
import * as inicio from "./views/inicio.js";
import * as lavadora from "./views/lavadora.js";
import * as admin from "./views/admin.js";

const $ = (id) => document.getElementById(id);

// Parte 1: solo Inicio y Mi lavadora. La administradora solo tiene el panel (#admin/<pestaña>).
let routes = { inicio: inicio.render, lavadora: lavadora.render };

let seq = 0;
async function route() {
  const name = location.hash.replace(/^#/, "").split("/")[0];
  const key = routes[name] ? name : Object.keys(routes)[0];
  for (const a of document.querySelectorAll("#nav a")) {
    if (a.dataset.route === key) a.setAttribute("aria-current", "page");
    else a.removeAttribute("aria-current");
  }
  const view = $("view");
  const token = ++seq;
  view.replaceChildren(loading());
  const box = h("div", { class: "page" });
  try {
    await routes[key](box);
    if (token === seq) view.replaceChildren(box);
  } catch (e) {
    if (token === seq) view.replaceChildren(errorBox(errMsg(e)));
  }
  if (token === seq) window.scrollTo(0, 0);
}
state.refresh = route;

async function logout() {
  await sb.auth.signOut();
  location.replace("index.html");
}

/** Logo, nombre y colores de la lavadora en la barra superior. */
function updateChrome() {
  const l = state.lavadora;
  aplicarColores(l.color_primario, l.color_acento);
  $("lavLogo").replaceChildren(lavadoraLogo(l, "sm"));
  $("lavNombre").textContent = l.nombre;
  document.title = `${l.nombre} · Sistema para Lavadoras`;
}
state.updateChrome = updateChrome;

// ---------- Pantallas sin acceso: pendiente, rechazado, suspendido ----------
const ICONOS = {
  wait: "M12 7v5l3 2M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z",
  stop: "M12 8v5M12 16.5v.01M10.3 3.9 2.4 17.5A2 2 0 0 0 4.1 20.5h15.8a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z",
};
function gateIcon(tipo) {
  const ns = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(ns, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("aria-hidden", "true");
  const p = document.createElementNS(ns, "path");
  p.setAttribute("d", ICONOS[tipo]);
  svg.append(p);
  return h("div", { class: `gate-icon ${tipo}` }, svg);
}

const waBtn = (texto) =>
  h("a", { class: "btn whatsapp block", href: waLink(texto), target: "_blank", rel: "noopener" }, waIcon(), "Escribir por WhatsApp");

function showGate(children) {
  $("splash").hidden = true;
  $("shell").hidden = true;
  $("gate").replaceChildren(h("div", { class: "card gate-card" },
    h("div", { class: "brand" }, h("i", { class: "brand-mark", "aria-hidden": "true" }), h("b", {}, "Sistema para Lavadoras")),
    children,
    h("div", { class: "actions", style: { justifyContent: "space-between", marginTop: "14px" } },
      h("button", { class: "link", type: "button", onclick: () => location.reload() }, "Volver a revisar"),
      h("button", { class: "link", type: "button", onclick: logout }, "Cerrar sesión")),
    h("p", { class: "foot-credit" }, "Desarrollado por Zynthea Solutions")));
  $("gate").hidden = false;
}

function showPendiente(email) {
  showGate([
    gateIcon("wait"),
    h("h1", {}, "Tu acceso está en revisión"),
    h("p", {}, "Te registraste con ", h("span", { class: "email-pill" }, email), "."),
    h("p", { class: "note" }, "Cuando activemos tu plan podrás entrar con este mismo correo. Escríbenos para activarlo:"),
    h("div", { class: "stack" },
      waBtn(`Hola Karen, me registré en el Sistema para Lavadoras con el correo ${email} y quiero activar mi plan.`),
      h("div", { class: "gate-links" },
        h("a", { href: PLANES_URL }, "Ver planes"),
        h("a", { href: DEMO_URL }, "Probar la demo"))),
  ]);
}

function showSinAcceso(email, estado, nota) {
  const titulo = estado === "rechazado" ? "Tu solicitud no fue aprobada"
    : estado === "suspendido" ? "Tu acceso está suspendido"
    : "Tu lavadora no está activa";
  const palabra = estado === "rechazado" ? "rechazado" : estado === "suspendido" ? "suspendido" : "inactivo";
  showGate([
    gateIcon("stop"),
    h("h1", {}, titulo),
    h("p", {}, "Cuenta: ", h("span", { class: "email-pill" }, email)),
    nota ? h("p", { class: "nota" }, nota) : h("p", { class: "note" }, "Tus datos no se borran. Escríbenos para revisar tu caso."),
    waBtn(`Hola Karen, mi acceso al Sistema para Lavadoras con el correo ${email} aparece como ${palabra}. ¿Me ayudas a revisarlo?`),
  ]);
}

// ---------- Sesión ----------
/** Código de error que devuelve Google/Supabase en la URL al cancelar o fallar el inicio de sesión. */
function errorOAuth(url) {
  const u = new URL(url);
  return new URLSearchParams(u.hash.slice(1)).get("error") || u.searchParams.get("error");
}

/** ¿El error indica que la sesión ya no es válida (usuario borrado, token inválido)? Un fallo de red no cuenta. */
const sesionInvalida = (e) =>
  [401, 403].includes(e?.status) || /user_not_found|bad_jwt|session_not_found|invalid.*(jwt|token)|user.*not.*exist/i.test(`${e?.code} ${e?.message}`);

async function expulsar() {
  try { await sb.auth.signOut({ scope: "local" }); } catch { /* la sesión ya no existe en el servidor */ }
  location.replace("index.html?sesion=expirada");
}

async function init() {
  const errGoogle = errorOAuth(window.__urlInicial || location.href);
  if (errGoogle) return location.replace(`index.html?oauth_error=${encodeURIComponent(errGoogle)}`);

  const { data: { session } } = await sb.auth.getSession();
  if (!session) return location.replace("index.html");

  // La sesión guardada puede ser de un usuario que ya no existe: validarla con el servidor
  const { data: ud, error: ue } = await sb.auth.getUser();
  if (ue || !ud?.user) {
    if (!ue || sesionInvalida(ue)) return expulsar();
    throw ue; // fallo de red: se muestra el error con "Reintentar"
  }
  state.email = ud.user.email || "";

  sb.auth.onAuthStateChange((event, s) => {
    if (event === "SIGNED_OUT" || !s) location.replace("index.html");
  });

  // Primer inicio de sesión: crea el perfil "pendiente". Después devuelve el estado actual.
  const { data: acceso, error } = await sb.rpc("solicitar_acceso");
  if (error) {
    if (sesionInvalida(error)) return expulsar();
    throw error;
  }
  state.acceso = acceso;

  if (acceso.admin) return iniciarAdmin();

  if (acceso.estado === "pendiente") return showPendiente(state.email);
  if (acceso.estado !== "aprobado") return showSinAcceso(state.email, acceso.estado, acceso.nota);
  // Aprobado pero sin lavadora activa (p. ej. personal de una lavadora suspendida)
  if (!acceso.lavadora_id) return showSinAcceso(state.email, "inactiva", acceso.nota);

  state.lavadora = must(await sb.from("lavadoras").select(LAVADORA_COLS).eq("id", acceso.lavadora_id).single());

  updateChrome();
  $("logoutBtn").addEventListener("click", logout);
  $("splash").hidden = true;
  $("shell").hidden = false;
  window.addEventListener("hashchange", route);
  route();
}

/** Cuenta de administradora: barra con "Panel de administración" y solo la ruta del panel. */
function iniciarAdmin() {
  routes = { admin: admin.render };
  $("lavLogo").replaceChildren(h("i", { class: "brand-mark", "aria-hidden": "true" }));
  $("lavNombre").textContent = "Sistema para Lavadoras";
  document.querySelector(".top-brand").setAttribute("href", "#admin");
  $("nav").hidden = true;
  document.title = "Panel · Sistema para Lavadoras";
  $("logoutBtn").addEventListener("click", logout);
  $("splash").hidden = true;
  $("shell").hidden = false;
  window.addEventListener("hashchange", route);
  route();
}

init().catch((e) => {
  $("splash").replaceChildren(h("p", {}, errMsg(e)),
    h("button", { class: "btn primary", type: "button", onclick: () => location.reload() }, "Reintentar"));
});
