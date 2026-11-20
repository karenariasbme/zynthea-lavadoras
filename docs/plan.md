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
| 6 | App parte 1 (login, pendiente, Mi lavadora) + mover la demo a `/demo/` + configuración de Auth | ✅ Parte 1 en `main` y probada en GitHub Pages con lavpend, lavbas y lavpro, a 375 px y en escritorio. Auth verificado: "Continuar con Google" con una cuenta nueva y registro de +lavnuevo con confirmación por correo, ambos en "Tu acceso está en revisión" (15/11/2026). Queda para antes del primer cliente real: SMTP propio + plantillas en español |
| 6b | Panel de administración en la app + `006` (admins, invitaciones, funciones `admin_*`) | 🟡 006 ejecutado con respaldo y restauración de prueba previos (15/11/2026); clientes rechazados por las 10 funciones `admin_*` (lavpend, lavbas). Admin: `karenarias.bme@gmail.com`. Panel en `main` y publicado en GitHub Pages (entró antes del paso 7), probado con datos simulados a 375 px y escritorio. Falta: prueba real de Karen con su cuenta, en GitHub Pages |
| 7 | App Plan Básico: Aceites y Filtros con Supabase, menú tipo app, Configuración, buscador con marca y stock bajo, memoria al escribir | ✅ En `main` (15/11/2026), sin migraciones. Incluye Clientes (buscador e historial por cliente), Historial de cambios y Descargar mis datos. Probado con lavbas contra Supabase real a 375 px y escritorio; landing actualizada (galones y cuartos en Básico, respaldo en Excel en todos los planes) |
| 8 | Plan Profesional (cliente de Karen): `007` + Aceites con SAE/uso/presentaciones, Filtros con rosca, precios de compra y venta, pestaña Cambios (Autos/Motos) | 🟡 `007` ejecutado (15/11/2026) con respaldo y restauración de prueba previos; 24/24 pruebas en la base (lavbas y lavpro). App en `main` y publicada (15/11/2026): sin campo Nombre (título Marca + SAE / Marca + Código; la columna nombre se llena sola). Probada en GitHub Pages con lavpro y lavbas a 375 px y escritorio. Falta: revisión de Karen |
| 9 | Premium, prueba completa y publicación | Pendiente |
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
- Confirmación de correo: activa (igual que talleres). Contraseña mínima: 8 caracteres (igual que la app).

**Estado (15/11/2026):**
- ✅ URL Configuration.
- ✅ Google: callback `https://hkpuevxyqxohksazowul.supabase.co/auth/v1/callback` agregado al cliente `zynthea-talleres-web`; Google activado en Supabase lavadoras con ese Client ID y un **secreto nuevo**, que también se actualizó en Supabase talleres.
- ✅ Correo: Confirm email activo, contraseña mínima 8.
- ⏳ **Pendiente antes del primer cliente real: SMTP propio + plantillas en español.** Supabase no deja editar las plantillas sin SMTP propio, así que por ahora salen las plantillas por defecto en inglés. Configurar el SMTP primero y después las cuatro plantillas (confirmar registro, restablecer contraseña, cambio de correo, enlace mágico).

## Paso 7 · Plan Básico (sin cambios en la base)

- Usa lo que ya existe: vistas `stock_aceites` / `stock_filtros` (stock actual), `registrar_uso()`, `borrar()` (nunca DELETE), `extra` + `campos_personalizados`, auditoría.
- **Agregar stock (entradas)** sin migración: la app guarda `entradas + cantidad` solo si `entradas` no cambió desde que se leyó (si cambió, vuelve a leer y reintenta hasta 3 veces). La auditoría registra el antes y el después, y el Historial lo muestra.
- **Memoria al escribir**: sugerencias desde Supabase (productos y clientes ya guardados), comparando sin mayúsculas ni tildes (lista propia: el datalist del navegador no ignora tildes).
- **Normalización al guardar**: marca, tipo, presentación y cliente → si ya existe (sin mayúsculas ni tildes) se usa el existente; si es nuevo, primera letra de cada palabra en mayúscula ("mobil" → "Mobil"). Nombre, código y aplicación: solo se quitan espacios extra ("PH3593A", "5W-30" tal cual). No se puede crear un producto repetido (mismo nombre, marca y presentación/código).
- **Configuración → Historial de cambios**: la auditoría de la lavadora (fecha, usuario, qué cambió, antes → después) con buscador. La lee el dueño por la política `auditoria_dueno` del 001; el personal (Premium) no la ve.
- **Configuración → Descargar mis datos** (todos los planes): Excel de respaldo con lavadora, aceites, filtros, usos (también los borrados, marcados) e historial. No son los reportes del Estándar; los precios solo salen desde el Estándar.
- **Clientes**: se arman con los usos registrados (aceite y filtros, también los borrados), agrupados sin mayúsculas ni tildes; buscador, último uso, número de usos e historial por cliente (borrados marcados "Borrado el …") con "Registrar uso" y el nombre ya puesto. Sin tabla nueva.
- Menú: Inicio · Aceites · Filtros · Clientes · Configuración; en celular, 5 íconos en la barra inferior y "Salir" arriba a la derecha (y en Configuración → Mi cuenta).
- Borrar un uso no lo elimina: queda con `deleted_at` y como `BORRADO` en la auditoría (verificado 15/11/2026).
- Precios, valor de cada uso y los reportes en Excel son del plan Estándar. Galones y cuartos (cantidad) quedan en el Básico; la landing se actualiza en la rama `lavadoras-galones-basico` del repo KarenArias.

**Pendiente para el paso 8 (con respaldo + restauración de prueba antes):**
- Función `registrar_entrada(p_tabla, p_id, p_cantidad)` en la base (suma atómica `entradas = entradas + n`, valida plan y rol) para Premium con varios usuarios. La app pasará a usarla en lugar de la suma desde el navegador.

## Paso 8 · Plan Profesional

- **`007`** (aditivo): aceites `sae`, `uso`, `galones_unidad`, `precio_compra`; filtros `rosca`, `precio_compra`; cambios `segmento` (auto/moto), `tipo`, `placa`; vistas `stock_*` con las columnas nuevas al final; `proteger_precios()` cubre `precio_compra`; función nueva `registrar_cambio_pro()` (la de antes no cambia).
- **Stock (opción A)**: envases cerrados por unidades enteras; solo el Galón se vende por cuartos. Presentaciones: Cuarto 0,25 · Galón 1 · Galón y cuarto 1,25 · Minicaneca 2,5 · Caneca 5 galones. La base lo valida en `registrar_cambio_pro()`.
- **Planes**: SAE, uso, rosca, presentaciones y pestañas en todos; precios de compra y venta desde el Estándar; Cambios desde el Profesional.
- **Menú**: escritorio Inicio · Aceites · Filtros · Cambios · Clientes · Configuración; celular (Profesional) Inicio · Aceites · Filtros · Cambios · Más (Clientes, Configuración, Salir).
- Pendiente: `registrar_entrada()` en la base para Premium (sigue anotado en el paso 7).

## Cuentas de prueba (solo para pruebas)

En Supabase zynthea-lavadoras. **La contraseña no se escribe aquí**: este repositorio es público y este archivo se publica en GitHub Pages. Está en la memoria local de Claude Code (y la tiene Karen).

| Cuenta | Estado |
|---|---|
| `karenarias.bme+lavpend@gmail.com` | Pendiente, sin aprobar |
| `karenarias.bme+lavbas@gmail.com` | Aprobada, plan BAS |
| `karenarias.bme+lavpro@gmail.com` | Aprobada, plan PRO |
