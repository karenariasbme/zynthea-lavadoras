# Plan: Sistema para Lavadoras con acceso por aprobación

Proyecto Supabase propio: **zynthea-lavadoras** (Free, us-east-2), separado de zynthea-talleres.
Schema: `public` (el proyecto es solo de lavadoras).

| Paso | Qué | Estado |
|---|---|---|
| 1 | Decisiones (proyecto nuevo, repo `zynthea-lavadoras`, DI-KAR migra en el paso 10 como Premium) | ✅ |
| 2 | `sql/lavadoras/001_esquema.sql` (tablas, RLS, borrado lógico, auditoría, funciones de la app) | ✅ Ejecutado (03/11/2026) |
| 3 | Pruebas de seguridad del SQL en el proyecto real | ✅ 40/40 (03/11/2026) |
| 4 | `002`: funciones de administración (aprobar, cambiar plan, suspender) | ✅ Ejecutado (03/11/2026) |
| 4b | `003`: campos personalizados por cliente (columna `extra`) | ✅ Ejecutado (03/11/2026, sin respaldo: solo había datos de prueba) |
| 4c | `004`: `corregir_registro()` (cliente, fecha y campos de cambios y usos; solo el dueño) + corrección del 003 (obligatorios en usos de un cambio) | ✅ Ejecutado (03/11/2026, sin respaldo: solo había datos de prueba) |
| 4d | `005`: autor (`created_by`) a null cuando se elimina una cuenta (encontrado en la prueba de restauración del paso 5) | ✅ Ejecutado (03/11/2026, con respaldo previo de las 18:20) |
| 5 | zynthea-ops para los dos proyectos | ✅ Respaldo, restauración de prueba y reporte verificados (03/11/2026) |
| 6 | App parte 1 (login, pendiente, Mi lavadora) + mover la demo a `/demo/` + configuración de Auth | Pendiente |
| 7–9 | App: Básico → Estándar/Profesional/Premium, prueba completa y publicación | Pendiente |
| 10 | Migrar DI-KAR (Premium) | Pendiente |

## Requisito permanente: cada cliente conserva SIEMPRE todo lo que guardó

Aunque cambie de plan o se agreguen campos.

**Regla de migraciones (todo script desde el 003):**
- Solo cambios **aditivos**: `ADD COLUMN` con default, tablas nuevas, funciones nuevas o reemplazadas.
- **Nunca** `DROP` ni `RENAME` de columnas o tablas con datos. Renombrar = crear la columna nueva + copiar los datos (la vieja se queda).
- **Antes de cada migración:** en zynthea-ops correr "Respaldo diario" a mano (éxito) y luego "Mantenimiento semanal" (restauración de prueba OK).
- Ningún cambio de `tipo` en un campo personalizado con datos: se crea un campo nuevo.
- **Antes de aprobar al primer cliente real**, zynthea-ops debe respaldar el proyecto zynthea-lavadoras y probar su restauración (paso 5). Desde ahí, **ninguna migración se ejecuta sin respaldo previo**. (El 003 se ejecutó sin respaldo porque solo había datos de prueba; es la única excepción.)

**Cambio de plan:** solo oculta o muestra funciones; nunca borra ni modifica datos.
Verificado: BAS → PRO → BAS → PRO deja la huella (md5) de todos los datos idéntica en los 5 pasos.

**Campos personalizados por cliente (003):**
- Columna `extra jsonb not null default '{}'` en aceites, filtros, vehiculos, cambios, usos_aceite y usos_filtro.
- Tabla `campos_personalizados` (lavadora, tabla, clave, etiqueta, tipo texto/numero/fecha/lista/si_no, opciones, obligatorio, orden, activo). El cliente la lee; solo el admin la escribe desde el SQL Editor con `agregar_campo()` y `activar_campo()`.
- La base valida que cada valor respete su tipo. Al editar, los valores que no se envían se conservan (para vaciar uno se envía `null`). Un campo desactivado se oculta pero sus datos quedan.
- Los obligatorios se exigen al crear registros nuevos (los anteriores al campo no se bloquean).
- La app dibuja estos campos sola en formularios, tablas y Excel.

## Paso 5 · zynthea-ops con dos proyectos

- Secretos separados por proyecto (nunca en el repo):
  - Talleres: `SUPABASE_DB_URL` (actual) → renombrar o mantener; `BACKUP_PASSPHRASE`.
  - Lavadoras: `SUPABASE_DB_URL_LAVADORAS` (Session pooler del proyecto nuevo) y, si se quiere frase propia, `BACKUP_PASSPHRASE_LAVADORAS`.
- **Respaldo diario**: una ejecución por proyecto (matrix `proyecto: [talleres, lavadoras]`), artifact `respaldo-<proyecto>-<fecha>`. El respaldo diario también evita la pausa por inactividad de cada proyecto.
- `conteos.sql` por proyecto (lavadoras: auth.users, perfiles, lavadoras, miembros, aceites, filtros, vehiculos, cambios, usos_aceite, usos_filtro, auditoria).
- **Reporte diario**: uno por proyecto. El de lavadoras incluye "Solicitudes pendientes" (perfiles en estado pendiente: correo y fecha).
- **Mantenimiento semanal**: prueba de restauración por proyecto con su último respaldo. Lavadoras no borra nada (no hay huérfanos que limpiar: nunca se elimina una fila); solo controla tamaño.

## Paso 6 · Configuración de Auth del proyecto nuevo

- **Google**: reutilizar el mismo cliente OAuth de Google Cloud.
  - Google Cloud → APIs y servicios → Credenciales → el cliente OAuth → *URI de redireccionamiento autorizados* → agregar `https://<ref-nuevo>.supabase.co/auth/v1/callback` (se mantiene el de talleres).
  - Supabase (nuevo) → Authentication → Sign In / Providers → Google → mismo Client ID y Client Secret.
  - La pantalla de consentimiento es compartida: mostrará el dominio del proyecto nuevo.
- **URL Configuration**:
  - Site URL: `https://karenariasbme.github.io/zynthea-lavadoras/`
  - Redirect URLs: `https://karenariasbme.github.io/zynthea-lavadoras/**`
- **Plantillas de correo** (Authentication → Emails → Templates), en español y con "Sistema para Lavadoras": confirmar registro, restablecer contraseña, cambio de correo y enlace mágico.
- **SMTP propio: recomendado** antes de recibir clientes. El servidor de correo incluido en Supabase es solo para pruebas y tiene un límite de envío muy bajo por hora. Opciones: Brevo o Resend (planes gratuitos). Lo ideal es un dominio propio para el remitente; con un remitente @gmail.com los correos pueden caer en spam.
- Confirmación de correo: activa (igual que talleres).
