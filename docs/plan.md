# Plan: Sistema para Lavadoras con acceso por aprobación

Proyecto Supabase propio: **zynthea-lavadoras** (Free, us-east-1), separado de zynthea-talleres.
Schema: `public` (el proyecto es solo de lavadoras).

| Paso | Qué | Estado |
|---|---|---|
| 1 | Decisiones (proyecto nuevo, repo `zynthea-lavadoras`, DI-KAR migra en el paso 10 como Premium) | ✅ |
| 2 | `sql/lavadoras/001_esquema.sql` (tablas, RLS, borrado lógico, auditoría, funciones de la app) | En revisión |
| 3 | Pruebas de seguridad del SQL en el proyecto real | Pendiente |
| 4 | `002`: funciones de administración (aprobar, cambiar plan, suspender) | Pendiente |
| 5 | zynthea-ops para los dos proyectos | Pendiente |
| 6 | App parte 1 (login, pendiente, Mi lavadora) + mover la demo a `/demo/` + configuración de Auth | Pendiente |
| 7–9 | App: Básico → Estándar/Profesional/Premium, prueba completa y publicación | Pendiente |
| 10 | Migrar DI-KAR (Premium) | Pendiente |

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
