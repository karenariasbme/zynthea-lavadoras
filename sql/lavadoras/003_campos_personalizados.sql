-- =====================================================================
-- ZYNTHEA LAVADORAS · 003 · Campos personalizados (sin cambiar el esquema por cliente)
--
-- REGLA DE MIGRACIONES (vale para este script y todos los siguientes):
--  · Solo cambios ADITIVOS: ADD COLUMN con default, tablas nuevas, funciones nuevas o reemplazadas.
--  · NUNCA DROP ni RENAME de columnas o tablas con datos. Renombrar = crear la columna nueva
--    y copiar los datos (la columna vieja se queda).
--  · ANTES de ejecutar: en zynthea-ops, correr "Respaldo diario" a mano (éxito) y luego
--    "Mantenimiento semanal" (restauración de prueba OK).
--
-- Qué hace este script (no borra ni modifica ningún dato existente):
--  1. Columna extra jsonb (default '{}') en aceites, filtros, vehiculos, cambios, usos_aceite, usos_filtro.
--  2. Tabla campos_personalizados: los campos propios de cada lavadora (el cliente la lee; solo el admin la escribe).
--  3. Validación en la base: cada valor de extra respeta el tipo de su campo. Un valor guardado nunca
--     se pierde: al editar, lo que no se envía se conserva; para vaciarlo se envía null.
--  4. Vistas stock_* con la columna extra.
--  5. registrar_uso / registrar_cambio aceptan p_extra (se reemplazan: las funciones no guardan datos).
--  6. Los errores de "no existe" pasan de HTTP 500 a 400 (detectado en las pruebas del paso 3).
--  7. Admin: agregar_campo() y activar_campo().
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. COLUMNA extra
-- ---------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['aceites','filtros','vehiculos','cambios','usos_aceite','usos_filtro'] loop
    execute format('alter table public.%I add column if not exists extra jsonb not null default ''{}''::jsonb', t);
    execute format('alter table public.%I add constraint %I check (jsonb_typeof(extra) = ''object'')', t, t || '_extra_objeto');
  end loop;
end $$;


-- ---------------------------------------------------------------------
-- 2. CAMPOS PERSONALIZADOS
--    No se cambia el tipo de un campo con datos: si hace falta otro tipo, se crea un campo nuevo.
-- ---------------------------------------------------------------------
create table public.campos_personalizados (
  id          uuid primary key default gen_random_uuid(),
  lavadora_id uuid not null references public.lavadoras(id),
  tabla       text not null check (tabla in ('aceites','filtros','vehiculos','cambios','usos_aceite','usos_filtro')),
  clave       text not null check (clave ~ '^[a-z][a-z0-9_]{0,39}$'),
  etiqueta    text not null check (length(trim(etiqueta)) between 1 and 60),
  tipo        text not null check (tipo in ('texto','numero','fecha','lista','si_no')),
  opciones    jsonb not null default '[]'::jsonb check (jsonb_typeof(opciones) = 'array'),
  obligatorio boolean not null default false,
  orden       integer not null default 0,
  activo      boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (lavadora_id, tabla, clave),
  check (tipo <> 'lista' or jsonb_array_length(opciones) > 0)
);
create index campos_lav_idx on public.campos_personalizados (lavadora_id, tabla, orden);

create trigger trg_campos_updated before update on public.campos_personalizados
  for each row execute function public.tocar_updated_at();
create trigger trg_campos_personalizados_auditar after insert or update on public.campos_personalizados
  for each row execute function public.auditar();

alter table public.campos_personalizados enable row level security;
create policy campos_select on public.campos_personalizados for select to authenticated
  using (lavadora_id = (select public.mi_lavadora()));

revoke all on public.campos_personalizados from anon, authenticated;
grant select on public.campos_personalizados to authenticated;


-- ---------------------------------------------------------------------
-- 3. VALIDACIÓN DE extra
--    Se ejecuta después de preparar_alta / proteger (los triggers BEFORE corren en orden alfabético).
-- ---------------------------------------------------------------------
create function public.validar_extra()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  viejo jsonb := '{}'::jsonb; k text; v jsonb; c public.campos_personalizados; txt text;
begin
  if new.extra is null then new.extra := '{}'::jsonb; end if;
  if jsonb_typeof(new.extra) <> 'object' then
    raise exception 'Los campos personalizados no son válidos.' using errcode = '22023'; end if;
  if tg_op = 'UPDATE' then
    viejo := coalesce(old.extra, '{}'::jsonb);
    new.extra := viejo || new.extra;          -- nunca se pierde un valor guardado
  end if;

  for k, v in select * from jsonb_each(new.extra) loop
    continue when viejo ? k and viejo -> k = v;   -- sin cambios: se conserva tal cual
    select * into c from public.campos_personalizados
     where lavadora_id = new.lavadora_id and tabla = tg_table_name and clave = k;
    if not found then raise exception 'El campo «%» no existe.', k using errcode = '22023'; end if;
    if not c.activo then raise exception 'El campo «%» está desactivado.', c.etiqueta using errcode = '22023'; end if;

    if v = 'null'::jsonb or (jsonb_typeof(v) = 'string' and trim(v #>> '{}') = '') then
      if c.obligatorio then raise exception 'El campo «%» es obligatorio.', c.etiqueta using errcode = '22023'; end if;
      continue;
    end if;

    txt := v #>> '{}';
    if c.tipo = 'texto' and (jsonb_typeof(v) <> 'string' or length(txt) > 500) then
      raise exception 'El campo «%» debe ser texto (máximo 500 caracteres).', c.etiqueta using errcode = '22023';
    elsif c.tipo = 'numero' and jsonb_typeof(v) <> 'number' then
      raise exception 'El campo «%» debe ser un número.', c.etiqueta using errcode = '22023';
    elsif c.tipo = 'si_no' and jsonb_typeof(v) <> 'boolean' then
      raise exception 'El campo «%» debe ser sí o no.', c.etiqueta using errcode = '22023';
    elsif c.tipo = 'lista' and (jsonb_typeof(v) <> 'string' or not (c.opciones ? txt)) then
      raise exception 'El campo «%» debe ser una de sus opciones.', c.etiqueta using errcode = '22023';
    elsif c.tipo = 'fecha' then
      if jsonb_typeof(v) <> 'string' or txt !~ '^\d{4}-\d{2}-\d{2}$' then
        raise exception 'El campo «%» debe ser una fecha (AAAA-MM-DD).', c.etiqueta using errcode = '22023'; end if;
      begin
        if to_char(txt::date, 'YYYY-MM-DD') <> txt then raise exception 'fecha'; end if;
      exception when others then
        raise exception 'El campo «%» tiene una fecha que no existe.', c.etiqueta using errcode = '22023';
      end;
    end if;
  end loop;

  -- Obligatorios: se exigen al crear (los registros anteriores al campo no se bloquean al editarlos)
  if tg_op = 'INSERT' then
    for c in select * from public.campos_personalizados
              where lavadora_id = new.lavadora_id and tabla = tg_table_name and activo and obligatorio loop
      if not (new.extra ? c.clave) or new.extra -> c.clave = 'null'::jsonb
         or (jsonb_typeof(new.extra -> c.clave) = 'string' and trim(new.extra ->> c.clave) = '') then
        raise exception 'El campo «%» es obligatorio.', c.etiqueta using errcode = '22023';
      end if;
    end loop;
  end if;
  return new;
end $$;

do $$
declare t text;
begin
  foreach t in array array['aceites','filtros','vehiculos','cambios','usos_aceite','usos_filtro'] loop
    execute format('create trigger trg_%1$s_zextra before insert or update on public.%1$I for each row execute function public.validar_extra()', t);
  end loop;
end $$;


-- ---------------------------------------------------------------------
-- 4. VISTAS DE STOCK con extra (mismas columnas, extra al final)
-- ---------------------------------------------------------------------
create or replace view public.stock_aceites with (security_invoker = true) as
select a.id, a.lavadora_id, a.nombre, a.tipo, a.marca, a.presentacion, a.stock_inicial, a.entradas, a.minimo,
       a.precio, a.precio_cuarto, a.created_by, a.created_at, a.updated_at, a.deleted_at,
       round(a.stock_inicial + a.entradas - coalesce(u.usado, 0), 2) as actual,
       a.extra
from public.aceites a
left join lateral (select sum(x.cantidad) as usado from public.usos_aceite x
                   where x.lavadora_id = a.lavadora_id and x.aceite_id = a.id and x.deleted_at is null) u on true
where a.deleted_at is null;

create or replace view public.stock_filtros with (security_invoker = true) as
select f.id, f.lavadora_id, f.nombre, f.tipo, f.marca, f.referencia, f.aplicacion, f.stock_inicial, f.entradas, f.minimo,
       f.precio, f.created_by, f.created_at, f.updated_at, f.deleted_at,
       round(f.stock_inicial + f.entradas - coalesce(u.usado, 0), 2) as actual,
       f.extra
from public.filtros f
left join lateral (select sum(x.cantidad) as usado from public.usos_filtro x
                   where x.lavadora_id = f.lavadora_id and x.filtro_id = f.id and x.deleted_at is null) u on true
where f.deleted_at is null;


-- ---------------------------------------------------------------------
-- 5 y 6. FUNCIONES DE LA APP: extra y errores 400 en vez de 500
-- ---------------------------------------------------------------------
create or replace function public._stock_aceite(p_lav uuid, p_id uuid)
returns public.aceites language plpgsql security definer set search_path = '' as $$
declare a public.aceites;
begin
  select * into a from public.aceites where id = p_id and lavadora_id = p_lav and deleted_at is null for update;
  if not found then raise exception 'El aceite no existe o fue borrado.' using errcode = '22023'; end if;
  return a;
end $$;

create or replace function public._stock_filtro(p_lav uuid, p_id uuid)
returns public.filtros language plpgsql security definer set search_path = '' as $$
declare f public.filtros;
begin
  select * into f from public.filtros where id = p_id and lavadora_id = p_lav and deleted_at is null for update;
  if not found then raise exception 'El filtro no existe o fue borrado.' using errcode = '22023'; end if;
  return f;
end $$;

-- registrar_uso y registrar_cambio cambian de firma (nuevo parámetro p_extra): se reemplazan.
drop function public.registrar_uso(text, date, text, uuid, jsonb);
drop function public.registrar_cambio(date, text, uuid, uuid, numeric, jsonb, numeric);

-- p_extra: campos personalizados de cada uso registrado (tabla usos_aceite o usos_filtro)
create function public.registrar_uso(p_tipo text, p_fecha date, p_cliente text, p_vehiculo_id uuid, p_items jsonb,
                                     p_extra jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_lav uuid := public.mi_lavadora(); v_marca text := ''; v_modelo text := '';
  it jsonb; q numeric; v_valor numeric; v_total numeric := 0; avisos text[] := '{}';
  a public.aceites; f public.filtros; disp numeric;
begin
  if v_lav is null then raise exception 'Tu acceso no está activo.' using errcode = '42501'; end if;
  if p_tipo not in ('aceite','filtro') then raise exception 'Tipo no válido.' using errcode = '22023'; end if;
  if coalesce(trim(p_cliente), '') = '' then raise exception 'Escribe el nombre del cliente.' using errcode = '22023'; end if;
  if p_fecha > (now() at time zone 'America/Guayaquil')::date then
    raise exception 'La fecha no puede ser futura.' using errcode = '22023'; end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'Elige al menos un producto.' using errcode = '22023'; end if;
  if p_tipo = 'aceite' and jsonb_array_length(p_items) <> 1 then
    raise exception 'Registra un aceite a la vez.' using errcode = '22023'; end if;
  if p_tipo = 'filtro' and exists (select 1 from jsonb_array_elements(p_items) x
                                   where coalesce(x->>'clase', '') not in ('Original','Compatible','Otro','')) then
    raise exception 'Clase de filtro no válida.' using errcode = '22023'; end if;
  if p_vehiculo_id is not null then
    if not public.plan_incluye('EST') then raise exception 'Marcas y modelos no están en tu plan.' using errcode = '42501'; end if;
    select v.marca, v.modelo into v_marca, v_modelo from public.vehiculos v
     where v.id = p_vehiculo_id and v.lavadora_id = v_lav and v.deleted_at is null;
    if not found then raise exception 'El vehículo no existe.' using errcode = '22023'; end if;
  end if;

  perform set_config('lavadoras.borrando', '', true);
  for it in select * from jsonb_array_elements(p_items) loop
    q := round(coalesce((it->>'cantidad')::numeric, 0), 2);
    if q <= 0 then raise exception 'La cantidad debe ser mayor a 0.' using errcode = '22023'; end if;
    if p_tipo = 'aceite' then
      a := public._stock_aceite(v_lav, (it->>'id')::uuid);
      disp := public._disponible_aceite(a);
      if q > disp + 1e-9 then raise exception 'No alcanza: quedan % de %.', disp, a.nombre using errcode = '23514'; end if;
      v_valor := public.valor_aceite(a.presentacion, a.precio, a.precio_cuarto, q);
      insert into public.usos_aceite (fecha, cliente, marca, modelo, aceite_id, cantidad, valor, extra)
      values (coalesce(p_fecha, (now() at time zone 'America/Guayaquil')::date), trim(p_cliente), v_marca, v_modelo, a.id, q, v_valor,
              coalesce(p_extra, '{}'::jsonb));
      if disp - q <= a.minimo then avisos := avisos || format('%s: quedan %s', a.nombre, disp - q); end if;
    else
      f := public._stock_filtro(v_lav, (it->>'id')::uuid);
      disp := public._disponible_filtro(f);
      if q > disp + 1e-9 then raise exception 'No alcanza: quedan % de %.', disp, f.nombre using errcode = '23514'; end if;
      v_valor := round(f.precio * q, 2);
      insert into public.usos_filtro (fecha, cliente, marca, modelo, filtro_id, cantidad, clase, valor, extra)
      values (coalesce(p_fecha, (now() at time zone 'America/Guayaquil')::date), trim(p_cliente), v_marca, v_modelo, f.id, q,
              coalesce(nullif(it->>'clase', ''), ''), v_valor, coalesce(p_extra, '{}'::jsonb));
      if disp - q <= f.minimo then avisos := avisos || format('%s %s: quedan %s', f.nombre, f.aplicacion, disp - q); end if;
    end if;
    v_total := v_total + v_valor;
  end loop;
  return jsonb_build_object('total', v_total, 'avisos', to_jsonb(avisos));
end $$;

-- p_extra: campos personalizados del cambio (tabla cambios)
create function public.registrar_cambio(p_fecha date, p_cliente text, p_vehiculo_id uuid,
                                        p_aceite_id uuid, p_cantidad numeric, p_filtros jsonb, p_mano_obra numeric,
                                        p_extra jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_lav uuid := public.mi_lavadora(); v_fecha date := coalesce(p_fecha, (now() at time zone 'America/Guayaquil')::date);
  v_marca text := ''; v_modelo text := ''; v_cambio uuid; v_total numeric; v_valor numeric; q numeric;
  it jsonb; a public.aceites; f public.filtros; disp numeric; avisos text[] := '{}';
begin
  if v_lav is null then raise exception 'Tu acceso no está activo.' using errcode = '42501'; end if;
  if not public.plan_incluye('PRO') then raise exception 'El cambio de aceite completo no está en tu plan.' using errcode = '42501'; end if;
  if coalesce(trim(p_cliente), '') = '' then raise exception 'Escribe el nombre del cliente.' using errcode = '22023'; end if;
  q := round(coalesce(p_cantidad, 0), 2);
  if p_aceite_id is null or q <= 0 then raise exception 'Elige el aceite y la cantidad.' using errcode = '22023'; end if;
  if coalesce(p_mano_obra, 0) < 0 then raise exception 'La mano de obra no puede ser negativa.' using errcode = '22023'; end if;
  if v_fecha > (now() at time zone 'America/Guayaquil')::date then
    raise exception 'La fecha no puede ser futura.' using errcode = '22023'; end if;
  if exists (select 1 from jsonb_array_elements(coalesce(p_filtros, '[]'::jsonb)) x
             where coalesce(x->>'clase', '') not in ('Original','Compatible','Otro','')) then
    raise exception 'Clase de filtro no válida.' using errcode = '22023'; end if;
  if p_vehiculo_id is not null then
    select v.marca, v.modelo into v_marca, v_modelo from public.vehiculos v
     where v.id = p_vehiculo_id and v.lavadora_id = v_lav and v.deleted_at is null;
    if not found then raise exception 'El vehículo no existe.' using errcode = '22023'; end if;
  end if;

  perform set_config('lavadoras.borrando', '', true);
  v_total := round(coalesce(p_mano_obra, 0), 2);
  insert into public.cambios (fecha, cliente, marca, modelo, vehiculo_id, mano_obra, total, extra)
  values (v_fecha, trim(p_cliente), v_marca, v_modelo, p_vehiculo_id, v_total, 0, coalesce(p_extra, '{}'::jsonb))
  returning id into v_cambio;

  a := public._stock_aceite(v_lav, p_aceite_id);
  disp := public._disponible_aceite(a);
  if q > disp + 1e-9 then raise exception 'No alcanza: quedan % de %.', disp, a.nombre using errcode = '23514'; end if;
  v_valor := public.valor_aceite(a.presentacion, a.precio, a.precio_cuarto, q);
  insert into public.usos_aceite (fecha, cliente, marca, modelo, aceite_id, cantidad, valor, cambio_id)
  values (v_fecha, trim(p_cliente), v_marca, v_modelo, a.id, q, v_valor, v_cambio);
  v_total := v_total + v_valor;
  if disp - q <= a.minimo then avisos := avisos || format('%s: quedan %s', a.nombre, disp - q); end if;

  for it in select * from jsonb_array_elements(coalesce(p_filtros, '[]'::jsonb)) loop
    f := public._stock_filtro(v_lav, (it->>'id')::uuid);
    disp := public._disponible_filtro(f);
    if 1 > disp + 1e-9 then raise exception 'No alcanza: quedan % de %.', disp, f.nombre using errcode = '23514'; end if;
    v_valor := round(f.precio, 2);
    insert into public.usos_filtro (fecha, cliente, marca, modelo, filtro_id, cantidad, clase, valor, cambio_id)
    values (v_fecha, trim(p_cliente), v_marca, v_modelo, f.id, 1, coalesce(nullif(it->>'clase', ''), ''), v_valor, v_cambio);
    v_total := v_total + v_valor;
    if disp - 1 <= f.minimo then avisos := avisos || format('%s %s: quedan %s', f.nombre, f.aplicacion, disp - 1); end if;
  end loop;

  update public.cambios set total = v_total where id = v_cambio;
  return jsonb_build_object('cambio_id', v_cambio, 'total', v_total, 'avisos', to_jsonb(avisos));
end $$;

-- borrar(): igual que en el 001, con "no encontrado" como error 400
create or replace function public.borrar(p_tabla text, p_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_lav uuid := public.mi_lavadora(); v_cambio uuid; n integer;
begin
  if public.mi_rol() <> 'dueno' then raise exception 'Solo el dueño puede borrar registros.' using errcode='42501'; end if;
  if v_lav is null then raise exception 'Tu acceso no está activo.' using errcode = '42501'; end if;
  if p_tabla not in ('aceites','filtros','vehiculos','cambios','usos_aceite','usos_filtro') then
    raise exception 'Tabla no válida.' using errcode = '22023'; end if;
  if p_tabla = 'vehiculos' and not public.plan_incluye('EST') then
    raise exception 'Marcas y modelos no están en tu plan.' using errcode = '42501'; end if;
  if p_tabla = 'cambios' and not public.plan_incluye('PRO') then
    raise exception 'El cambio de aceite no está en tu plan.' using errcode = '42501'; end if;

  if p_tabla in ('usos_aceite','usos_filtro') then
    execute format('select cambio_id from public.%I where id = $1 and lavadora_id = $2 and deleted_at is null', p_tabla)
      into v_cambio using p_id, v_lav;
    if v_cambio is not null then
      raise exception 'Este registro es parte de un cambio de aceite. Bórralo desde Cambio de aceite.' using errcode = '22023'; end if;
  end if;
  if p_tabla = 'aceites' and exists (select 1 from public.usos_aceite where aceite_id = p_id and lavadora_id = v_lav and deleted_at is null) then
    raise exception 'Tiene usos registrados. Borra primero esos registros.' using errcode = '22023'; end if;
  if p_tabla = 'filtros' and exists (select 1 from public.usos_filtro where filtro_id = p_id and lavadora_id = v_lav and deleted_at is null) then
    raise exception 'Tiene usos registrados. Borra primero esos registros.' using errcode = '22023'; end if;

  perform set_config('lavadoras.borrando', '1', true);
  execute format('update public.%I set deleted_at = now() where id = $1 and lavadora_id = $2 and deleted_at is null', p_tabla)
    using p_id, v_lav;
  get diagnostics n = row_count;
  if n = 0 then raise exception 'No se encontró el registro.' using errcode = '22023'; end if;

  if p_tabla = 'cambios' then
    update public.usos_aceite set deleted_at = now() where cambio_id = p_id and lavadora_id = v_lav and deleted_at is null;
    update public.usos_filtro set deleted_at = now() where cambio_id = p_id and lavadora_id = v_lav and deleted_at is null;
  elsif p_tabla = 'aceites' then
    update public.vehiculos set aceite_id = null where aceite_id = p_id and lavadora_id = v_lav and deleted_at is null;
  elsif p_tabla = 'filtros' then
    update public.vehiculos set
      f_aceite   = nullif(f_aceite,   p_id), f_aceite_c = nullif(f_aceite_c, p_id),
      f_aire     = nullif(f_aire,     p_id), f_aire_c   = nullif(f_aire_c,   p_id),
      f_comb     = nullif(f_comb,     p_id), f_comb_c   = nullif(f_comb_c,   p_id),
      f_cabina   = nullif(f_cabina,   p_id), f_cabina_c = nullif(f_cabina_c, p_id)
    where lavadora_id = v_lav and deleted_at is null
      and p_id in (f_aceite, f_aceite_c, f_aire, f_aire_c, f_comb, f_comb_c, f_cabina, f_cabina_c);
  end if;
  perform set_config('lavadoras.borrando', '', true);
end $$;


-- ---------------------------------------------------------------------
-- 7. ADMIN (solo SQL Editor)
--   select agregar_campo('cliente@correo.com', 'cambios', 'km', 'Kilometraje', 'numero');
--   select agregar_campo('cliente@correo.com', 'aceites', 'api', 'Norma API', 'lista', '["SN","SP"]');
--   select activar_campo('cliente@correo.com', 'aceites', 'api', false);   -- se oculta; sus datos se conservan
-- ---------------------------------------------------------------------
create function public.agregar_campo(p_email_dueno text, p_tabla text, p_clave text, p_etiqueta text, p_tipo text,
                                     p_opciones jsonb default '[]'::jsonb, p_obligatorio boolean default false,
                                     p_orden integer default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_lav uuid; r public.campos_personalizados;
begin
  select m.lavadora_id into v_lav from public.miembros m
   where m.user_id = public._usuario(p_email_dueno) and m.rol = 'dueno';
  if v_lav is null then raise exception 'No hay una lavadora cuyo dueño sea %.', p_email_dueno; end if;
  if p_tabla not in ('aceites','filtros','vehiculos','cambios','usos_aceite','usos_filtro') then
    raise exception 'Tabla no válida: aceites, filtros, vehiculos, cambios, usos_aceite o usos_filtro.'; end if;
  if p_clave !~ '^[a-z][a-z0-9_]{0,39}$' then
    raise exception 'Clave no válida: minúsculas, números y _ (ej. km_ingreso).'; end if;
  if p_tipo not in ('texto','numero','fecha','lista','si_no') then
    raise exception 'Tipo no válido: texto, numero, fecha, lista o si_no.'; end if;
  if p_tipo = 'lista' and (jsonb_typeof(p_opciones) <> 'array' or jsonb_array_length(p_opciones) = 0
       or exists (select 1 from jsonb_array_elements(p_opciones) o where jsonb_typeof(o) <> 'string')) then
    raise exception 'Para el tipo lista, las opciones son una lista de textos: ''["Opción 1","Opción 2"]''.'; end if;
  if exists (select 1 from public.campos_personalizados where lavadora_id = v_lav and tabla = p_tabla and clave = p_clave) then
    raise exception 'Ese campo ya existe. Para mostrarlo u ocultarlo usa activar_campo().'; end if;

  insert into public.campos_personalizados (lavadora_id, tabla, clave, etiqueta, tipo, opciones, obligatorio, orden)
  values (v_lav, p_tabla, p_clave, trim(p_etiqueta), p_tipo,
          case when p_tipo = 'lista' then p_opciones else '[]'::jsonb end, coalesce(p_obligatorio, false),
          coalesce(p_orden, (select coalesce(max(orden), 0) + 1 from public.campos_personalizados
                             where lavadora_id = v_lav and tabla = p_tabla)))
  returning * into r;
  return to_jsonb(r);
end $$;

create function public.activar_campo(p_email_dueno text, p_tabla text, p_clave text, p_activo boolean)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_lav uuid; r public.campos_personalizados;
begin
  select m.lavadora_id into v_lav from public.miembros m
   where m.user_id = public._usuario(p_email_dueno) and m.rol = 'dueno';
  if v_lav is null then raise exception 'No hay una lavadora cuyo dueño sea %.', p_email_dueno; end if;
  update public.campos_personalizados set activo = p_activo
   where lavadora_id = v_lav and tabla = p_tabla and clave = p_clave
  returning * into r;
  if not found then raise exception 'No existe el campo % en %.', p_clave, p_tabla; end if;
  return to_jsonb(r);
end $$;


-- ---------------------------------------------------------------------
-- PERMISOS
-- ---------------------------------------------------------------------
revoke execute on function public.validar_extra(), public.agregar_campo(text, text, text, text, text, jsonb, boolean, integer),
                           public.activar_campo(text, text, text, boolean)
  from public, anon, authenticated;
revoke execute on function public.registrar_uso(text, date, text, uuid, jsonb, jsonb),
                           public.registrar_cambio(date, text, uuid, uuid, numeric, jsonb, numeric, jsonb)
  from public, anon;
grant execute on function public.registrar_uso(text, date, text, uuid, jsonb, jsonb),
                          public.registrar_cambio(date, text, uuid, uuid, numeric, jsonb, numeric, jsonb)
  to authenticated;
