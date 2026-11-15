export const LAVADORA_COLS = "id,nombre,logo_path,color_primario,color_acento,mano_obra,plan";

// Estado compartido de la app (se llena en app.js al iniciar)
export const state = {
  email: "",              // correo del usuario
  acceso: null,           // respuesta de solicitar_acceso(): { estado, nota, lavadora_id, plan, rol, admin }
  lavadora: null,         // { id, nombre, logo_path, color_primario, color_acento, mano_obra, plan }
  refresh: () => {},      // vuelve a pintar la pantalla actual
  updateChrome: () => {}, // vuelve a pintar logo, nombre y colores
  logout: () => {},       // cierra la sesión (Configuración → Mi cuenta)
};

/** ¿El usuario puede editar la configuración de la lavadora? (solo el dueño) */
export const esDueno = () => state.acceso?.rol === "dueno";

/** ¿El plan de la lavadora incluye el mínimo indicado? (mismo orden que plan_incluye() en la base: BAS < EST < PRO < PRE) */
const ORDEN_PLANES = ["BAS", "EST", "PRO", "PRE"];
export const planIncluye = (minimo) =>
  ORDEN_PLANES.indexOf(state.lavadora?.plan) >= ORDEN_PLANES.indexOf(minimo);
