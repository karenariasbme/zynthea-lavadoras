// Panel de administración. Solo lo ve una cuenta de public.admins (solicitar_acceso() devuelve admin: true).
// La seguridad está en la base: cada función admin_* comprueba es_admin() y rechaza a cualquier otro usuario.
import { sb } from "../sb.js";
import { h, must, val, toast, errMsg, PLANES } from "../util.js";
import { pageHead, field, input, asyncForm, userError, loading, errorBox, ventana } from "../ui.js";

const TABS = [
  ["dar", "Dar acceso"],
  ["solicitudes", "Solicitudes"],
  ["clientes", "Mis clientes"],
  ["invitaciones", "Invitaciones"],
];

const fmtFecha = new Intl.DateTimeFormat("es-EC", { timeZone: "America/Guayaquil", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
const fecha = (iso) => fmtFecha.format(new Date(iso));
const rpc = async (fn, args) => must(await sb.rpc(fn, args));

const planSelect = (valor = "BAS") =>
  h("select", { class: "input", name: "plan", required: true },
    Object.entries(PLANES).map(([k, n]) => h("option", { value: k, selected: k === valor }, `${n} (${k})`)));

const tabActual = () => {
  const t = location.hash.replace(/^#/, "").split("/")[1];
  return TABS.some(([k]) => k === t) ? t : "dar";
};

const notaField = (label, requerido) =>
  field(label, h("textarea", { class: "input", name: "nota", rows: 3, maxlength: 300, required: requerido }),
    "La verá el cliente al intentar entrar.");

// ---------- Panel ----------
export async function render(box) {
  const actual = tabActual();
  const contenido = h("div", { class: "admin-body" }, loading());
  const tabs = h("div", { class: "admin-tabs", role: "tablist", "aria-label": "Secciones del panel" },
    TABS.map(([k, n]) => h("a", { href: `#admin/${k}`, role: "tab", "aria-selected": String(k === actual), "data-tab": k },
      n, h("span", { class: "count", hidden: true }))));

  box.append(pageHead("Panel de administración", "Acceso de clientes, planes e invitaciones"), tabs, contenido);

  // Contadores de las pestañas (no detienen la pantalla si fallan)
  const contar = async () => {
    const [s, i] = await Promise.all([sb.rpc("admin_solicitudes"), sb.rpc("admin_invitaciones")]);
    const pon = (k, n) => {
      const el = tabs.querySelector(`[data-tab="${k}"] .count`);
      el.textContent = n; el.hidden = !n;
    };
    if (!s.error) pon("solicitudes", s.data.length);
    if (!i.error) pon("invitaciones", i.data.length);
  };

  // Vuelve a pintar la pestaña (después de cada acción)
  const recargar = async () => {
    contar();
    try {
      const nodo = await VISTAS[actual]({ recargar, contar });
      contenido.replaceChildren(nodo);
    } catch (e) {
      contenido.replaceChildren(errorBox(errMsg(e)));
    }
  };
  await recargar();
}

const VISTAS = {
  // 1. Dar acceso por correo
  async dar({ contar }) {
    const resultado = h("div", { class: "msg ok", role: "status", hidden: true });
    const form = asyncForm({ class: "stack" }, [
      field("Correo del cliente", input({ name: "email", type: "email", required: true, autocomplete: "off", inputmode: "email", spellcheck: "false" })),
      field("Plan", planSelect()),
      field("Nombre de la lavadora", input({ name: "nombre", required: true, maxlength: 120 })),
      h("button", { class: "btn primary", type: "submit" }, "Dar acceso"),
    ], async (fd, f) => {
      const email = val(fd, "email"), nombre = val(fd, "nombre");
      if (!email || !nombre) throw userError("Completa el correo y el nombre de la lavadora.");
      resultado.hidden = true;
      const r = await rpc("admin_dar_acceso", { p_email: email, p_plan: fd.get("plan"), p_nombre: nombre });
      resultado.textContent = r.resultado === "aprobado"
        ? `✅ Aprobado: ${email} ya puede entrar a "${nombre}" con el plan ${PLANES[r.plan]}.`
        : `📨 Invitación creada: cuando ${email} entre por primera vez (Google o contraseña) quedará aprobado con el plan ${PLANES[r.plan]}.`;
      resultado.hidden = false;
      f.reset();
      contar();
    });
    return h("div", { class: "card admin-form" },
      h("p", { class: "note", style: { marginBottom: "14px" } },
        "Si el correo ya tiene cuenta, se aprueba al momento. Si todavía no se registra, queda una invitación y se aprueba solo cuando entre por primera vez."),
      form, resultado);
  },

  // 2. Solicitudes pendientes
  async solicitudes({ recargar }) {
    const lista = await rpc("admin_solicitudes");
    if (!lista.length) return vacio("No hay solicitudes pendientes.");
    return h("div", { class: "lista" }, lista.map((s) => h("article", { class: "card item" },
      h("div", { class: "item-head" }, h("h3", { class: "item-email" }, s.email)),
      h("p", { class: "note" }, s.nombre ? `${s.nombre} · ` : "", "Solicitó el ", fecha(s.created_at)),
      h("div", { class: "actions" },
        h("button", { class: "btn primary sm", type: "button", onclick: () => ventana({
          titulo: "Aprobar solicitud", texto: s.email, boton: "Aprobar",
          campos: [field("Plan", planSelect()), field("Nombre de la lavadora", input({ name: "nombre", required: true, maxlength: 120 }))],
          onSubmit: async (fd) => {
            await rpc("admin_aprobar", { p_email: s.email, p_plan: fd.get("plan"), p_nombre: val(fd, "nombre") });
            await recargar();
            return `Aprobado: ${s.email}`;
          } }) }, "Aprobar"),
        h("button", { class: "btn danger sm", type: "button", onclick: () => ventana({
          titulo: "Rechazar solicitud", texto: s.email, boton: "Rechazar", peligro: true,
          campos: [notaField("Motivo", true)],
          onSubmit: async (fd) => {
            const nota = val(fd, "nota");
            if (!nota) throw userError("Escribe el motivo.");
            await rpc("admin_rechazar", { p_email: s.email, p_nota: nota });
            await recargar();
            return `Rechazado: ${s.email}`;
          } }) }, "Rechazar")))));
  },

  // 3. Mis clientes
  async clientes({ recargar }) {
    const lista = await rpc("admin_clientes");
    if (!lista.length) return vacio("Todavía no hay lavadoras.");
    const buscar = input({ type: "search", placeholder: "Buscar por lavadora o correo", "aria-label": "Buscar cliente" });
    const items = lista.map((c) => ({ c, el: clienteCard(c, recargar) }));
    const sinResultados = h("p", { class: "note", hidden: true }, "Ningún cliente coincide con la búsqueda.");
    buscar.addEventListener("input", () => {
      const q = buscar.value.trim().toLowerCase();
      let n = 0;
      for (const { c, el } of items) {
        const ok = !q || `${c.lavadora} ${c.dueno_email || ""}`.toLowerCase().includes(q);
        el.hidden = !ok; if (ok) n++;
      }
      sinResultados.hidden = n > 0;
    });
    const activas = lista.filter((c) => c.activa).length;
    return h("div", { class: "stack" },
      h("div", { class: "lista-tools" }, buscar,
        h("p", { class: "note" }, `${lista.length} lavadora${lista.length === 1 ? "" : "s"} · ${activas} activa${activas === 1 ? "" : "s"}`)),
      h("div", { class: "lista" }, items.map((x) => x.el)), sinResultados);
  },

  // 4. Invitaciones pendientes
  async invitaciones({ recargar }) {
    const lista = await rpc("admin_invitaciones");
    if (!lista.length) return vacio("No hay invitaciones pendientes.");
    return h("div", { class: "lista" }, lista.map((i) => h("article", { class: "card item" },
      h("div", { class: "item-head" }, h("h3", { class: "item-email" }, i.email), h("span", { class: "badge" }, PLANES[i.plan])),
      h("p", {}, i.nombre),
      h("p", { class: "note" }, "Creada el ", fecha(i.created_at), " · se aprueba sola cuando entre con ese correo."),
      h("div", { class: "actions" },
        h("button", { class: "btn danger sm", type: "button", onclick: () => ventana({
          titulo: "Anular invitación", texto: `${i.email} · ${i.nombre} (${PLANES[i.plan]}). Si entra después, quedará en revisión como cualquier solicitud.`,
          boton: "Anular", peligro: true,
          onSubmit: async () => {
            await rpc("admin_anular_invitacion", { p_id: i.id });
            await recargar();
            return `Invitación anulada: ${i.email}`;
          } }) }, "Anular")))));
  },
};

function clienteCard(c, recargar) {
  const dueno = c.dueno_email;
  const estado = c.activa ? h("span", { class: "chip ok" }, "Activa") : h("span", { class: "chip bad" }, "Suspendida");
  return h("article", { class: "card item" },
    h("div", { class: "item-head" }, h("h3", {}, c.lavadora), h("span", { class: "badge" }, PLANES[c.plan] || c.plan)),
    h("p", { class: "item-email" }, dueno || "Sin dueño"),
    h("p", { class: "note" }, estado, c.personal ? ` · ${c.personal} de personal` : "", " · desde el ", fecha(c.created_at)),
    !c.activa && c.nota && h("p", { class: "nota" }, c.nota),
    dueno && h("div", { class: "actions" },
      h("button", { class: "btn sm", type: "button", onclick: () => ventana({
        titulo: "Cambiar plan", texto: `${c.lavadora} · ${dueno}`, boton: "Cambiar plan",
        campos: [field("Plan nuevo", planSelect(c.plan))],
        onSubmit: async (fd) => {
          const plan = fd.get("plan");
          if (plan === c.plan) throw userError("Ese ya es su plan.");
          await rpc("admin_cambiar_plan", { p_email_dueno: dueno, p_plan: plan });
          await recargar();
          return `${c.lavadora}: plan ${PLANES[plan]}`;
        } }) }, "Cambiar plan"),
      c.activa
        ? h("button", { class: "btn danger sm", type: "button", onclick: () => ventana({
            titulo: "Suspender lavadora", boton: "Suspender", peligro: true,
            texto: `${c.lavadora} · ${dueno}. Nadie de esta lavadora podrá entrar. Sus datos no se borran: con Reactivar vuelve todo como estaba.`,
            campos: [notaField("Motivo (opcional)", false)],
            onSubmit: async (fd) => {
              await rpc("admin_suspender", { p_email: dueno, p_nota: val(fd, "nota") });
              await recargar();
              return `Suspendida: ${c.lavadora}`;
            } }) }, "Suspender")
        : h("button", { class: "btn primary sm", type: "button", onclick: () => ventana({
            titulo: "Reactivar lavadora", boton: "Reactivar",
            texto: `${c.lavadora} · ${dueno}. Podrán volver a entrar y verán todos sus datos.`,
            onSubmit: async () => {
              await rpc("admin_reactivar", { p_email: dueno });
              await recargar();
              return `Reactivada: ${c.lavadora}`;
            } }) }, "Reactivar")));
}

const vacio = (texto) => h("div", { class: "card state" }, texto);
