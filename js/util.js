export const WHATSAPP = "593967857347";
export const PLANES_URL = "https://karenariasbme.github.io/KarenArias/lavadoras/#planes";
export const DEMO_URL = "demo/"; // = /zynthea-lavadoras/demo/ en GitHub Pages (relativo para que también funcione en local)

export const PLANES = { BAS: "Básico", EST: "Estándar", PRO: "Profesional", PRE: "Premium" };
export const ROLES = { dueno: "Dueño", personal: "Personal" };

export const COLOR_PRIMARIO = "#0F2E44";
export const COLOR_ACENTO = "#D0911C";

/**
 * Crea un elemento del DOM. Los hijos de tipo texto se insertan como nodos de texto,
 * nunca como HTML, así que es seguro pasarle datos escritos por el usuario.
 */
export function h(tag, props, ...children) {
  const el = document.createElement(tag);
  let value;
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k === "class") el.className = v;
    else if (k === "value") value = v;
    else if (k === "style" && typeof v === "object") Object.assign(el.style, v);
    else if (k.startsWith("on") && typeof v === "function") el.addEventListener(k.slice(2), v);
    else if (v === true) el.setAttribute(k, "");
    else el.setAttribute(k, String(v));
  }
  for (const c of children.flat(Infinity)) {
    if (c == null || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  if (value !== undefined) el.value = value;
  return el;
}

/** Devuelve data o lanza el error de una respuesta de Supabase. */
export function must({ data, error }) {
  if (error) throw error;
  return data;
}

/** Texto de un campo de formulario sin espacios extremos; vacío → null. */
export function val(fd, name) {
  const v = (fd.get(name) ?? "").toString().trim();
  return v === "" ? null : v;
}

const fmtUSD = new Intl.NumberFormat("es-EC", { style: "currency", currency: "USD" });
export const money = (n) => fmtUSD.format(Number(n) || 0);

/** Enlace de WhatsApp con el mensaje ya escrito. */
export const waLink = (texto) => `https://wa.me/${WHATSAPP}?text=${encodeURIComponent(texto)}`;

// ---------- Colores y contraste (WCAG) ----------
export const esHex = (c) => /^#[0-9A-Fa-f]{6}$/.test(c || "");

function luminancia(hex) {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contraste(a, b) {
  const [l1, l2] = [luminancia(a), luminancia(b)].sort((x, y) => y - x);
  return (l1 + 0.05) / (l2 + 0.05);
}

const TINTA_CLARA = "#FFFFFF";
const TINTA_OSCURA = "#13212B";

/** Color de texto (blanco u oscuro) con mejor contraste sobre un fondo. */
export const tintaSobre = (fondo) =>
  contraste(fondo, TINTA_CLARA) >= contraste(fondo, TINTA_OSCURA) ? TINTA_CLARA : TINTA_OSCURA;

// ---------- Errores en español ----------
// Los mensajes que lanzan las funciones de la base (solicitar_acceso, borrar, …) ya están en español.
const EN_INGLES = /violates|permission denied|row-level|duplicate key|null value|invalid input|does not exist|not found|JWT|fetch/i;

export function errMsg(e) {
  if (!e) return "Ocurrió un error inesperado.";
  const m = e.message || e.error_description || String(e);
  if (/Failed to fetch|NetworkError|Load failed|network/i.test(m))
    return "No hay conexión con el servidor. Revisa tu internet e inténtalo de nuevo.";
  // Storage (logos)
  if (/exceeded the maximum allowed size|Payload too large|413/i.test(m)) return "La imagen pesa más de 1 MB. Elige una más liviana.";
  if (/mime type|invalid_mime_type/i.test(m)) return "Formato no permitido. Usa una imagen PNG, JPG o WEBP.";
  // Auth
  if (/Invalid login credentials/i.test(m)) return "Correo o contraseña incorrectos.";
  if (/Email not confirmed/i.test(m)) return "Aún no confirmas tu correo. Revisa tu bandeja de entrada (y la carpeta de spam).";
  if (/already registered|already been registered|already exists/i.test(m)) return "Ya existe una cuenta con ese correo. Inicia sesión.";
  if (/Password should be at least|password.*characters/i.test(m)) return "La contraseña debe tener al menos 8 caracteres.";
  if (/weak|pwned|leaked/i.test(m)) return "Esa contraseña es muy fácil de adivinar. Usa otra más segura.";
  if (/rate limit|too many|security purposes/i.test(m)) return "Demasiados intentos seguidos. Espera unos minutos y vuelve a intentarlo.";
  if (/valid email|invalid format|Unable to validate email/i.test(m)) return "El correo no es válido.";
  if (/same.*password|different from the old/i.test(m)) return "La nueva contraseña debe ser distinta a la anterior.";
  if (/signups? not allowed|Signups not allowed/i.test(m)) return "El registro está desactivado por el momento. Escríbenos por WhatsApp.";
  if (/JWT|session.*(missing|not found|expired)|refresh token/i.test(m)) return "Tu sesión expiró. Vuelve a iniciar sesión.";
  // Base de datos
  if (["42501", "22023", "P0002", "23514", "P0001"].includes(e.code) && !EN_INGLES.test(m)) return m;
  switch (e.code) {
    case "42501": return "No tienes permiso para esta acción.";
    case "23514":
      if (/color/i.test(m)) return "El color debe tener el formato #RRGGBB.";
      if (/mano_obra/i.test(m)) return "La mano de obra no puede ser negativa.";
      if (/nombre/i.test(m)) return "Escribe el nombre de la lavadora (máximo 120 caracteres).";
      return "Algún dato no es válido.";
    case "23502": return "Falta completar un campo obligatorio.";
    case "22P02": return "Algún número no es válido.";
    case "PGRST116": return "No se encontró el registro.";
  }
  if (/row-level security/i.test(m)) return "No tienes permiso para esta acción.";
  return "Ocurrió un error: " + m;
}

// ---------- Aviso flotante ----------
let toastTimer;
export function toast(text, kind = "ok") {
  let t = document.getElementById("toast");
  if (!t) {
    t = h("div", { id: "toast", role: "status", "aria-live": "polite" });
    document.body.append(t);
  }
  t.textContent = text;
  t.className = `toast show ${kind}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove("show"), 3500);
}
