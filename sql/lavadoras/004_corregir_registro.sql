-- =====================================================================
-- ZYNTHEA LAVADORAS · 004 · Corregir registros (cliente, fecha y campos personalizados)
--
-- REGLA DE MIGRACIONES: solo cambios aditivos (aquí: una función nueva y una reemplazada).
-- No toca tablas ni datos existentes.
--
-- Qué hace este script:
--  1. corregir_registro(tabla, id, cliente, fecha, extra): el DUEÑO corrige un cambio de aceite
--     o un uso registrado. Solo cambia cliente, fecha y campos personalizados; NUNCA cantidades,
--     productos, precios, valores ni totales. Si corrige un cambio, el cliente y la fecha pasan
--     también a sus usos. Todo queda en la auditoría (el trigger del 001 registra antes y después).
--  2. Corrección del 003: un campo obligatorio en usos_aceite o usos_filtro bloqueaba
--     registrar_cambio(), porque los usos que crea un cambio no traen campos personalizados.
--     Ahora el obligatorio se exige en los usos registrados por separado, no en los de un cambio.
--
-- Uso desde la app (los parámetros que no se envían o van en null no se cambian):
--   rpc('corregir_registro', { p_tabla: 'cambios', p_id: '...', p_cliente: 'Juan Pérez' })
--   rpc('corregir_registro', { p_tabla: 'usos_filtro', p_id: '...', p_fecha: '2026-11-01', p_extra: { garantia: true } })
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. CORREGIR UN REGISTRO
-- ---------------------------------------------------------------------
create function public.corregir_registro(p_tabla text, p_id uuid, p_cliente text default null,
                                         p_fecha date default null, p_extra jsonb default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_lav uuid := public.mi_lavadora(); r jsonb; v_cliente text; v_fecha date; v_extra jsonb;
begin
  if public.mi_rol() is distinct from 'dueno' then
    raise exception 'Solo el dueño puede corregir registros.' using errcode = '42501'; end if;
  if v_lav is null then raise exception 'Tu acceso no está activo.' using errcode = '42501'; end if;
  if p_tabla not in ('cambios','usos_aceite','usos_filtro') then
    raise exception 'Solo se corrigen cambios de aceite y usos registrados.' using errcode = '22023'; end if;
  if p_tabla = 'cambios' and not public.plan_incluye('PRO') then
    raise exception 'El cambio de aceite no está en tu plan.' using errcode = '42501'; end if;
  if p_cliente is null and p_fecha is null and p_extra is null then
    raise exception 'No hay nada que corregir.' using errcode = '22023'; end if;
  if p_cliente is not null and length(trim(p_cliente)) not between 1 and 120 then
    raise exception 'Escribe el nombre del cliente (máximo 120 caracteres).' using errcode = '22023'; end if;
  if p_fecha > (now() at time zone 'America/Guayaquil')::date then
    raise exception 'La fecha no puede ser futura.' using errcode = '22023'; end if;
  if p_extra is not null and jsonb_typeof(p_extra) <> 'object' then
    raise exception 'Los campos personalizados no son válidos.' using errcode = '22023'; end if;

  execute format('select to_jsonb(x) from public.%I x where id = $1 and lavadora_id = $2 for update', p_tabla)
    into r using p_id, v_lav;
  if r is null then raise exception 'No se encontró el registro.' using errcode = '22023'; end if;
  if r->>'deleted_at' is not null then
    raise exception 'Este registro está borrado y no se puede corregir.' using errcode = '22023'; end if;

  v_cliente := coalesce(trim(p_cliente), r->>'cliente');
  v_fecha   := coalesce(p_fecha, (r->>'fecha')::date);
  v_extra   := coalesce(p_extra, '{}'::jsonb);   -- validar_extra() lo mezcla con lo guardado y lo valida

  -- Un uso que es parte de un cambio toma el cliente y la fecha del cambio
  if p_tabla in ('usos_aceite','usos_filtro') and r->>'cambio_id' is not null
     and (v_cliente <> r->>'cliente' or v_fecha <> (r->>'fecha')::date) then
    raise exception 'Este registro es parte de un cambio de aceite. Corrige el cliente y la fecha desde Cambio de aceite.'
      using errcode = '22023'; end if;

  -- Solo estas tres columnas; las demás (cantidades, productos, precios, valores, totales) no se tocan
  execute format('update public.%I set cliente = $1, fecha = $2, extra = $3 where id = $4 and lavadora_id = $5', p_tabla)
    using v_cliente, v_fecha, v_extra, p_id, v_lav;

  if p_tabla = 'cambios' then
    update public.usos_aceite set cliente = v_cliente, fecha = v_fecha
     where cambio_id = p_id and lavadora_id = v_lav and deleted_at is null
       and (cliente <> v_cliente or fecha <> v_fecha);
    update public.usos_filtro set cliente = v_cliente, fecha = v_fecha
     where cambio_id = p_id and lavadora_id = v_lav and deleted_at is null
       and (cliente <> v_cliente or fecha <> v_fecha);
  end if;

  execute format('select to_jsonb(x) from public.%I x where id = $1', p_tabla) into r using p_id;
  return r;
end $$;


-- ---------------------------------------------------------------------
-- 2. validar_extra(): igual que en el 003, salvo el bloque de obligatorios (marcado abajo)
-- ---------------------------------------------------------------------
create or replace function public.validar_extra()
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

  -- Obligatorios: se exigen al crear (los registros anteriores al campo no se bloquean al editarlos).
  -- CAMBIO DEL 004: no se exigen en los usos que crea un cambio de aceite (cambio_id no nulo).
  if tg_op = 'INSERT' and (to_jsonb(new) ->> 'cambio_id') is null then
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


-- ---------------------------------------------------------------------
-- PERMISOS
-- ---------------------------------------------------------------------
revoke execute on function public.corregir_registro(text, uuid, text, date, jsonb) from public, anon;
grant execute on function public.corregir_registro(text, uuid, text, date, jsonb) to authenticated;
revoke execute on function public.validar_extra() from public, anon, authenticated;
