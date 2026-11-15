import { sb } from "./sb.js";
import { errMsg } from "./util.js";

const $ = (id) => document.getElementById(id);
const forms = {
  login: $("form-login"),
  signup: $("form-signup"),
  reset: $("form-reset"),
  newpass: $("form-newpass"),
};
const msg = $("msg");
const appUrl = new URL("app.html", location.href).href;
const loginUrl = new URL("index.html", location.href).href;

function show(name) {
  for (const [k, f] of Object.entries(forms)) f.hidden = k !== name;
  $("tab-login").setAttribute("aria-selected", String(name === "login"));
  $("tab-signup").setAttribute("aria-selected", String(name === "signup"));
  $("tabs").hidden = name === "newpass" || name === "reset";
  setMsg("");
  forms[name].querySelector("input")?.focus();
}

function setMsg(text, kind = "error") {
  msg.textContent = text;
  msg.className = `msg ${kind}`;
  msg.hidden = !text;
}

/** Ejecuta la acción del formulario con el botón deshabilitado y muestra el error si falla. */
function onSubmit(form, fn) {
  form.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const btn = form.querySelector("button[type=submit]");
    const label = btn.textContent;
    btn.disabled = true;
    btn.textContent = "Procesando…";
    setMsg("");
    try {
      await fn(new FormData(form));
    } catch (e) {
      setMsg(errMsg(e));
    } finally {
      btn.disabled = false;
      btn.textContent = label;
    }
  });
}

// ---------- Continuar con Google ----------
for (const btn of document.querySelectorAll("[data-google]")) {
  btn.addEventListener("click", async () => {
    setMsg("");
    btn.disabled = true;
    const label = btn.querySelector("span");
    const texto = label.textContent;
    label.textContent = "Abriendo Google…";
    // Si todo va bien, el navegador sale hacia Google y vuelve a app.html con la sesión
    const { error } = await sb.auth.signInWithOAuth({ provider: "google", options: { redirectTo: appUrl } });
    if (error) {
      setMsg("No se pudo abrir el inicio de sesión con Google. Inténtalo de nuevo o usa tu correo y contraseña.");
      btn.disabled = false;
      label.textContent = texto;
    }
  });
}

// Avisos que llegan en la URL desde app.html
const aviso = new URLSearchParams(location.search);
if (aviso.get("sesion") === "expirada") setMsg("Tu sesión expiró, vuelve a ingresar.", "warn");
const oauth = aviso.get("oauth_error");
if (oauth) {
  setMsg(oauth === "access_denied"
    ? "Cancelaste el inicio de sesión con Google. Puedes intentarlo de nuevo o usar tu correo."
    : "No se pudo iniciar sesión con Google. Inténtalo de nuevo o usa tu correo y contraseña.");
}
if (aviso.has("sesion") || oauth) history.replaceState(null, "", location.pathname + location.hash);

$("tab-login").addEventListener("click", () => show("login"));
$("tab-signup").addEventListener("click", () => show("signup"));
$("go-reset").addEventListener("click", () => show("reset"));
$("back-login").addEventListener("click", () => show("login"));
// Enlaces de la landing (?registro=1 o #registro) abren directamente "Crear cuenta"
if (aviso.get("registro") === "1" || location.hash === "#registro") show("signup");

onSubmit(forms.login, async (fd) => {
  const { error } = await sb.auth.signInWithPassword({
    email: fd.get("email").trim(),
    password: fd.get("password"),
  });
  if (error) throw error;
  location.replace(appUrl);
});

// Registro abierto: cualquiera crea su cuenta, pero queda "pendiente" hasta que se apruebe (solicitar_acceso en app.js)
onSubmit(forms.signup, async (fd) => {
  const nombre = fd.get("nombre").trim();
  const password = fd.get("password");
  if (!nombre) return setMsg("Escribe tu nombre.");
  if (password.length < 8) return setMsg("La contraseña debe tener al menos 8 caracteres.");
  const { data, error } = await sb.auth.signUp({
    email: fd.get("email").trim(),
    password,
    options: { data: { full_name: nombre }, emailRedirectTo: appUrl },
  });
  if (error) throw error;
  // Con confirmación de correo activa, un correo ya registrado devuelve un usuario sin identidades
  if (data.user && Array.isArray(data.user.identities) && data.user.identities.length === 0) {
    return setMsg("Ya existe una cuenta con ese correo. Inicia sesión o recupera tu contraseña.");
  }
  if (data.session) return location.replace(appUrl);
  forms.signup.reset();
  setMsg("Te enviamos un correo para confirmar tu cuenta. Ábrelo y luego inicia sesión aquí.", "ok");
});

onSubmit(forms.reset, async (fd) => {
  const { error } = await sb.auth.resetPasswordForEmail(fd.get("email").trim(), { redirectTo: loginUrl });
  if (error) throw error;
  setMsg("Si el correo está registrado, te enviamos un enlace para crear una contraseña nueva.", "ok");
});

onSubmit(forms.newpass, async (fd) => {
  const password = fd.get("password");
  if (password.length < 8) return setMsg("La contraseña debe tener al menos 8 caracteres.");
  if (password !== fd.get("password2")) return setMsg("Las contraseñas no coinciden.");
  const { error } = await sb.auth.updateUser({ password });
  if (error) throw error;
  location.replace(appUrl);
});

// Enlace de recuperación de contraseña: mostrar el formulario de contraseña nueva
const isRecovery = location.hash.includes("type=recovery");
sb.auth.onAuthStateChange((event) => {
  if (event === "PASSWORD_RECOVERY") show("newpass");
});
if (isRecovery) {
  show("newpass");
} else {
  const { data } = await sb.auth.getSession();
  if (data.session) location.replace(appUrl);
}
