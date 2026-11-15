// Tarjetas de "Mi lavadora" (datos y logo). Se muestran en Configuración.
import { sb } from "../sb.js";
import { h, must, val, toast, errMsg, esHex, tintaSobre, contraste, COLOR_PRIMARIO, COLOR_ACENTO } from "../util.js";
import { state, esDueno, LAVADORA_COLS } from "../state.js";
import { field, input, asyncForm, userError, lavadoraLogo } from "../ui.js";

const LOGO_TIPOS = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" };
const LOGO_MAX = 1024 * 1024; // 1 MB (el bucket "logos" tiene el mismo límite)

/** Guarda columnas editables de la lavadora (la base solo deja al dueño) y refresca la barra superior. */
async function guardarLavadora(cambios) {
  const l = must(await sb.from("lavadoras").update(cambios).eq("id", state.lavadora.id).select(LAVADORA_COLS).single());
  state.lavadora = l;
  state.updateChrome();
  return l;
}

/** Borra de la carpeta de la lavadora todo excepto el logo vigente (incluye restos de subidas fallidas). */
async function limpiarLogos(vigente) {
  const carpeta = state.lavadora.id;
  const { data, error } = await sb.storage.from("logos").list(carpeta, { limit: 100 });
  if (error || !data) return; // la limpieza no debe impedir el cambio de logo
  const sobrantes = data.map((o) => `${carpeta}/${o.name}`).filter((ruta) => ruta !== vigente);
  if (sobrantes.length) await sb.storage.from("logos").remove(sobrantes);
}

// ---------- Datos y colores ----------
function colorField(label, name, valor, dueno, onInput) {
  const picker = h("input", { type: "color", value: valor, disabled: !dueno, "aria-label": `${label} (selector)` });
  const hex = input({ name, value: valor.toUpperCase(), maxlength: 7, pattern: "#[0-9A-Fa-f]{6}", disabled: !dueno,
    spellcheck: "false", autocomplete: "off", "aria-label": `${label} (código)` });
  picker.addEventListener("input", () => { hex.value = picker.value.toUpperCase(); onInput(); });
  hex.addEventListener("input", () => {
    let v = hex.value.trim();
    if (v && !v.startsWith("#")) v = "#" + v;
    if (esHex(v)) picker.value = v.toLowerCase();
    onInput();
  });
  const leer = () => { const v = hex.value.trim(); return esHex(v.startsWith("#") ? v : "#" + v) ? (v.startsWith("#") ? v : "#" + v).toUpperCase() : null; };
  return { el: h("div", { class: "field" }, h("span", { class: "field-label" }, label), h("div", { class: "color-row" }, picker, hex)), leer };
}

export function datosCard(dueno) {
  const l = state.lavadora;

  // Muestra en vivo de los colores con el texto de contraste automático
  const muestraBar = h("div", { class: "muestra-bar" });
  const muestraBtn = h("span", { class: "muestra-btn" }, "Botón");
  const muestraBadge = h("span", { class: "badge" }, "Plan");
  const contrasteTxt = h("p", { class: "contraste", "aria-live": "polite" });
  const muestra = h("div", { class: "muestra", "aria-label": "Vista previa de los colores" },
    muestraBar, h("div", { class: "muestra-body" }, muestraBtn, muestraBadge));

  const pintar = () => {
    const p = primario.leer() || COLOR_PRIMARIO;
    const a = acento.leer() || COLOR_ACENTO;
    const pi = tintaSobre(p), ai = tintaSobre(a);
    muestraBar.style.background = p; muestraBar.style.color = pi;
    muestraBar.textContent = nombreIn.value.trim() || "Mi lavadora";
    muestraBtn.style.background = a; muestraBtn.style.color = ai;
    muestraBadge.style.background = a; muestraBadge.style.color = ai;
    const txt = (c) => (c === "#FFFFFF" ? "blanco" : "oscuro");
    contrasteTxt.textContent =
      `Texto automático: ${txt(pi)} sobre el primario (${contraste(p, pi).toFixed(1)}:1) y ${txt(ai)} sobre el acento (${contraste(a, ai).toFixed(1)}:1).`;
  };

  const nombreIn = input({ name: "nombre", required: true, maxlength: 120, value: l.nombre, disabled: !dueno });
  nombreIn.addEventListener("input", pintar);
  const primario = colorField("Color primario", "color_primario", l.color_primario, dueno, pintar);
  const acento = colorField("Color de acento", "color_acento", l.color_acento, dueno, pintar);
  pintar();

  const children = [
    h("h2", {}, "Datos"),
    field("Nombre de la lavadora *", nombreIn, dueno && "Aparece en la barra superior."),
    field("Mano de obra por cambio de aceite (USD)",
      input({ name: "mano_obra", type: "number", min: 0, step: "0.01", inputmode: "decimal", required: true, value: l.mano_obra, disabled: !dueno }),
      dueno && "Valor por defecto; cada modelo de vehículo puede tener el suyo."),
    h("div", { class: "cols" }, primario.el, acento.el),
    muestra,
    contrasteTxt,
    dueno && h("div", { class: "actions" },
      h("button", { class: "btn primary", type: "submit" }, "Guardar cambios"),
      h("button", { class: "btn ghost", type: "button", onclick: () => {
        for (const [c, v] of [[primario, COLOR_PRIMARIO], [acento, COLOR_ACENTO]]) {
          const [pk, hx] = c.el.querySelectorAll("input");
          pk.value = v.toLowerCase(); hx.value = v;
        }
        pintar();
      } }, "Colores originales")),
  ];

  if (!dueno) return h("div", { class: "card stack" }, children);

  return asyncForm({ class: "card stack", novalidate: true }, children, async (fd) => {
    const nombre = val(fd, "nombre");
    if (!nombre) throw userError("Escribe el nombre de la lavadora.");
    const mo = Number(String(fd.get("mano_obra") ?? "").replace(",", "."));
    if (fd.get("mano_obra") === "" || !Number.isFinite(mo) || mo < 0) throw userError("La mano de obra debe ser un número igual o mayor a 0.");
    if (mo > 99999999) throw userError("La mano de obra es demasiado alta.");
    const cp = primario.leer(), ca = acento.leer();
    if (!cp || !ca) throw userError("Los colores deben tener el formato #RRGGBB (por ejemplo #0F2E44).");
    await guardarLavadora({ nombre, mano_obra: Math.round(mo * 100) / 100, color_primario: cp, color_acento: ca });
    toast("Cambios guardados");
  });
}

// ---------- Logo ----------
export function logoCard(dueno) {
  const preview = h("div", { class: "logo-preview" });
  const msg = h("p", { class: "msg error", role: "alert", hidden: true });
  const fileIn = h("input", { type: "file", accept: "image/png,image/jpeg,image/webp", class: "sr-only", id: "logo-file" });
  const subirLbl = h("label", { class: "btn primary", for: "logo-file" });
  const quitarBtn = h("button", { class: "btn danger", type: "button" }, "Quitar logo");

  function pintar() {
    const l = state.lavadora;
    preview.replaceChildren(lavadoraLogo(l, "lg"),
      h("p", { class: "note" }, l.logo_path ? "Este es el logo actual." : "Sin logo: se muestran las iniciales de la lavadora."));
    subirLbl.textContent = l.logo_path ? "Reemplazar logo" : "Subir logo";
    quitarBtn.hidden = !l.logo_path;
  }

  let busy = false;
  const error = (e) => { msg.textContent = e.userMessage || errMsg(e); msg.hidden = false; };
  const ocupado = (on) => { busy = on; subirLbl.classList.toggle("disabled", on); quitarBtn.disabled = on; fileIn.disabled = on; };

  fileIn.addEventListener("change", async () => {
    const file = fileIn.files[0];
    fileIn.value = "";
    if (!file || busy) return; // una subida a la vez
    msg.hidden = true;
    const ext = LOGO_TIPOS[file.type];
    if (!ext) return error(userError("Formato no permitido. Usa una imagen PNG, JPG o WEBP."));
    if (file.size > LOGO_MAX) return error(userError(`La imagen pesa ${(file.size / 1048576).toFixed(1)} MB. El máximo es 1 MB.`));

    const anterior = state.lavadora.logo_path;
    // Carpeta = id de la lavadora (lo exige la política del bucket). El timestamp evita ver el logo viejo en caché.
    const ruta = `${state.lavadora.id}/logo-${Date.now()}.${ext}`;
    ocupado(true);
    subirLbl.textContent = "Subiendo…";
    try {
      must(await sb.storage.from("logos").upload(ruta, file, { contentType: file.type, upsert: false }));
      try {
        await guardarLavadora({ logo_path: ruta });
      } catch (e) {
        await sb.storage.from("logos").remove([ruta]); // no dejar archivos sin usar
        throw e;
      }
      await limpiarLogos(ruta);
      toast(anterior ? "Logo reemplazado" : "Logo subido");
    } catch (e) {
      error(e);
    } finally {
      ocupado(false);
      pintar();
    }
  });

  quitarBtn.addEventListener("click", async () => {
    const anterior = state.lavadora.logo_path;
    if (busy || !anterior || !confirm("¿Quitar el logo? Se mostrarán las iniciales de la lavadora en su lugar.")) return;
    msg.hidden = true;
    ocupado(true);
    try {
      await guardarLavadora({ logo_path: null });
      await limpiarLogos(null);
      toast("Logo quitado");
    } catch (e) {
      error(e);
    } finally {
      ocupado(false);
      pintar();
    }
  });

  pintar();
  return h("div", { class: "card stack" },
    h("h2", {}, "Logo"),
    preview,
    dueno && [
      h("p", { class: "note" }, "PNG, JPG o WEBP de hasta 1 MB. Mejor si es cuadrado o con fondo transparente."),
      fileIn,
      h("div", { class: "actions" }, subirLbl, quitarBtn),
      msg,
    ]);
}
