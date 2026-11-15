-- =====================================================================
-- ZYNTHEA LAVADORAS · 007 · Plan Profesional: datos de aceites y filtros, y cambios por tipo
--
-- BORRADOR (no ejecutado). REGLA DE MIGRACIONES: solo aditivo.
--  · ADD COLUMN con default (las filas existentes quedan igual), sin DROP ni RENAME.
--  · Vistas stock_*: create or replace con las columnas nuevas AL FINAL (las de antes no cambian).
--  · proteger_precios(): se reemplaza (misma firma) para cubrir también precio_compra.
--  · registrar_cambio() NO se toca: se agrega registrar_cambio_pro() (función nueva).
-- ANTES de ejecutar: zynthea-ops → "Respaldo diario" ✅ y luego "Mantenimiento semanal" ✅.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. ACEITES: SAE, uso, equivalencia en galones y precio de compra
--    · precio          = precio de VENTA por unidad de la presentación (ya existe)
--    · precio_cuarto   = venta por cuarto, solo presentación "Galón" (ya existe)
--    · precio_compra   = costo por unidad de la presentación (nuevo)
--    · galones_unidad  = galones que trae una unidad: Cuarto 0,25 · Galón 1 · Galón y cuarto 1,25 ·
--                        Minicaneca 2,5 · Caneca 5. null = presentación sin equivalencia (p. ej. Litro).
-- ---------------------------------------------------------------------
alter table public.aceites add column if not exists sae            text not null default '';
alter table public.aceites add column if not exists uso            text not null default '';
alter table public.aceites add column if not exists galones_unidad numeric(8,4) check (galones_unidad > 0);
alter table public.aceites add column if not exists precio_compra  numeric(10,2) not null default 0 check (precio_compra >= 0);

-- ---------------------------------------------------------------------
-- 2. FILTROS: rosca y precio de compra
-- ---------------------------------------------------------------------
alter table public.filtros add column if not exists rosca         text not null default '';
alter table public.filtros add column if not exists precio_compra numeric(10,2) not null default 0 check (precio_compra >= 0);
create index if not exists filtros_rosca_idx on public.filtros (lavadora_id, lower(rosca)) where deleted_at is null and rosca <> '';

-- ---------------------------------------------------------------------
-- 3. CAMBIOS: Auto/Moto, tipo de cambio y placa
-- ---------------------------------------------------------------------
alter table public.cambios add column if not exists segmento text not null default 'auto' check (segmento in ('auto','moto'));
alter table public.cambios add column if not exists tipo     text not null default 'Aceite de motor'
  check (tipo in ('Aceite de motor','Caja','Transmisión','Refrigerante','Filtros'));
alter table public.cambios add column if not exists placa    text not null default '' check (length(placa) <= 20);
create index if not exists cambios_placa_idx on public.cambios (lavadora_id, lower(placa)) where deleted_at is null and placa <> '';

-- ---------------------------------------------------------------------
-- 4. VISTAS DE STOCK: mismas columnas que en el 003 y las nuevas al final
-- ---------------------------------------------------------------------
create or replace view public.stock_aceites with (security_invoker = true) as
select a.id, a.lavadora_id, a.nombre, a.tipo, a.marca, a.presentacion, a.stock_inicial, a.entradas, a.minimo,
       a.precio, a.precio_cuarto, a.created_by, a.created_at, a.updated_at, a.deleted_at,
       round(a.stock_inicial + a.entradas - coalesce(u.usado, 0), 2) as actual,
       a.extra,
       a.sae, a.uso, a.galones_unidad, a.precio_compra
from public.aceites a
left join lateral (select sum(x.cantidad) as usado from public.usos_aceite x
                   where x.lavadora_id = a.lavadora_id and x.aceite_id = a.id and x.deleted_at is null) u on true
where a.deleted_at is null;

create or replace view public.stock_filtros with (security_invoker = true) as
select f.id, f.lavadora_id, f.nombre, f.tipo, f.marca, f.referencia, f.aplicacion, f.stock_inicial, f.entradas, f.minimo,
       f.precio, f.created_by, f.created_at, f.updated_at, f.deleted_at,
       round(f.stock_inicial + f.entradas - coalesce(u.usado, 0), 2) as actual,
       f.extra,
       f.rosca, f.precio_compra
from public.filtros f
left join lateral (select sum(x.cantidad) as usado from public.usos_filtro x
                   where x.lavadora_id = f.lavadora_id and x.filtro_id = f.id and x.deleted_at is null) u on true
where f.deleted_at is null;

-- Mismos permisos que en el 001 (create or replace view los conserva; se repiten para que quede explícito)
revoke all on public.stock_aceites, public.stock_filtros from anon, authenticated;
grant select on public.stock_aceites, public.stock_filtros to authenticated;

-- ---------------------------------------------------------------------
-- 5. PRECIOS: el personal (Premium) tampoco crea ni cambia el precio de compra
-- ---------------------------------------------------------------------
create or replace function public.proteger_precios()
returns trigger language plpgsql set search_path = '' as $$
declare n jsonb := to_jsonb(new); o jsonb := case when tg_op = 'UPDATE' then to_jsonb(old) end;
begin
  if public.mi_rol() = 'personal' then
    if tg_op = 'INSERT' and (coalesce((n->>'precio')::numeric, 0) <> 0
                             or coalesce((n->>'precio_cuarto')::numeric, 0) <> 0
                             or coalesce((n->>'precio_compra')::numeric, 0) <> 0
                             or coalesce((n->>'stock_inicial')::numeric, 0) <> 0) then
      raise exception 'Solo el dueño puede poner precios y stock inicial.' using errcode = '42501';
    end if;
    if tg_op = 'UPDATE' and (n->'precio' is distinct from o->'precio'
                             or n->'precio_cuarto' is distinct from o->'precio_cuarto'
                             or n->'precio_compra' is distinct from o->'precio_compra'
                             or n->'stock_inicial' is distinct from o->'stock_inicial') then
      raise exception 'Solo el dueño puede cambiar precios y stock inicial.' using errcode = '42501';
    end if;
  end if;
  return new;
end $$;

-- ---------------------------------------------------------------------
-- 6. registrar_cambio_pro(): cambio por tipo (Auto/Moto), con placa, aceite opcional en "Filtros"
--    y cantidad por filtro. Igual que registrar_cambio(): valida stock con bloqueo, calcula el valor
--    en la base (valor_aceite y precio de venta) y deja todo con cambio_id (borrar('cambios') lo revierte).
--    p_filtros: [{"id": uuid, "cantidad": 1, "clase": "Original"}]
-- ---------------------------------------------------------------------
create function public.registrar_cambio_pro(
  p_fecha date, p_cliente text, p_segmento text, p_tipo text, p_placa text, p_vehiculo text,
  p_aceite_id uuid, p_cantidad numeric, p_filtros jsonb, p_mano_obra numeric, p_extra jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_lav uuid := public.mi_lavadora(); v_fecha date := coalesce(p_fecha, (now() at time zone 'America/Guayaquil')::date);
  v_cambio uuid; v_total numeric; v_valor numeric; q numeric; it jsonb; a public.aceites; f public.filtros; disp numeric;
  avisos text[] := '{}'; v_placa text := upper(regexp_replace(coalesce(p_placa, ''), '\s+', '', 'g'));
  v_veh text := left(trim(regexp_replace(coalesce(p_vehiculo, ''), '\s+', ' ', 'g')), 60);
  n_filtros integer := jsonb_array_length(coalesce(p_filtros, '[]'::jsonb));
begin
  if v_lav is null then raise exception 'Tu acceso no está activo.' using errcode = '42501'; end if;
  if not public.plan_incluye('PRO') then raise exception 'El cambio de aceite completo no está en tu plan.' using errcode = '42501'; end if;
  if coalesce(trim(p_cliente), '') = '' then raise exception 'Escribe el nombre del cliente.' using errcode = '22023'; end if;
  if p_segmento not in ('auto','moto') then raise exception 'Elige Auto o Moto.' using errcode = '22023'; end if;
  if p_tipo not in ('Aceite de motor','Caja','Transmisión','Refrigerante','Filtros') then
    raise exception 'Tipo de cambio no válido.' using errcode = '22023'; end if;
  if length(v_placa) > 20 then raise exception 'La placa es muy larga.' using errcode = '22023'; end if;
  q := round(coalesce(p_cantidad, 0), 2);
  if p_tipo <> 'Filtros' and (p_aceite_id is null or q <= 0) then
    raise exception 'Elige el aceite y la cantidad.' using errcode = '22023'; end if;
  if p_tipo = 'Filtros' and n_filtros = 0 then raise exception 'Elige al menos un filtro.' using errcode = '22023'; end if;
  if p_aceite_id is not null and q <= 0 then raise exception 'La cantidad de aceite debe ser mayor a 0.' using errcode = '22023'; end if;
  if coalesce(p_mano_obra, 0) < 0 then raise exception 'La mano de obra no puede ser negativa.' using errcode = '22023'; end if;
  if v_fecha > (now() at time zone 'America/Guayaquil')::date then
    raise exception 'La fecha no puede ser futura.' using errcode = '22023'; end if;
  if exists (select 1 from jsonb_array_elements(coalesce(p_filtros, '[]'::jsonb)) x
             where coalesce(x->>'clase', '') not in ('Original','Compatible','Otro','')
                or coalesce((x->>'cantidad')::numeric, 1) <= 0
                or coalesce((x->>'cantidad')::numeric, 1) <> trunc(coalesce((x->>'cantidad')::numeric, 1))) then
    raise exception 'Filtro no válido: la cantidad debe ser un número entero mayor a 0.' using errcode = '22023'; end if;

  perform set_config('lavadoras.borrando', '', true);
  v_total := round(coalesce(p_mano_obra, 0), 2);
  insert into public.cambios (fecha, cliente, marca, modelo, vehiculo_id, mano_obra, total, extra, segmento, tipo, placa)
  values (v_fecha, trim(p_cliente), '', v_veh, null, v_total, 0, coalesce(p_extra, '{}'::jsonb), p_segmento, p_tipo, v_placa)
  returning id into v_cambio;

  if p_aceite_id is not null then
    a := public._stock_aceite(v_lav, p_aceite_id);
    disp := public._disponible_aceite(a);
    -- Envases cerrados por unidades enteras; solo el Galón se vende por cuartos (múltiplos de 0,25)
    if lower(trim(a.presentacion)) in ('galón','galon') then
      if q * 4 <> trunc(q * 4) then raise exception 'El galón se vende por cuartos (0,25).' using errcode = '22023'; end if;
    elsif q <> trunc(q) then
      raise exception '% se vende por unidades enteras.', a.presentacion using errcode = '22023';
    end if;
    if q > disp + 1e-9 then raise exception 'No alcanza: quedan % de %.', disp, a.nombre using errcode = '23514'; end if;
    v_valor := public.valor_aceite(a.presentacion, a.precio, a.precio_cuarto, q);
    insert into public.usos_aceite (fecha, cliente, marca, modelo, aceite_id, cantidad, valor, cambio_id)
    values (v_fecha, trim(p_cliente), '', v_veh, a.id, q, v_valor, v_cambio);
    v_total := v_total + v_valor;
    if disp - q <= a.minimo then avisos := avisos || format('%s: quedan %s', a.nombre, disp - q); end if;
  end if;

  for it in select * from jsonb_array_elements(coalesce(p_filtros, '[]'::jsonb)) loop
    q := round(coalesce((it->>'cantidad')::numeric, 1), 2);
    f := public._stock_filtro(v_lav, (it->>'id')::uuid);
    disp := public._disponible_filtro(f);
    if q > disp + 1e-9 then raise exception 'No alcanza: quedan % de %.', disp, f.nombre using errcode = '23514'; end if;
    v_valor := round(f.precio * q, 2);
    insert into public.usos_filtro (fecha, cliente, marca, modelo, filtro_id, cantidad, clase, valor, cambio_id)
    values (v_fecha, trim(p_cliente), '', v_veh, f.id, q, coalesce(nullif(it->>'clase', ''), ''), v_valor, v_cambio);
    v_total := v_total + v_valor;
    if disp - q <= f.minimo then avisos := avisos || format('%s %s: quedan %s', f.nombre, f.aplicacion, disp - q); end if;
  end loop;

  update public.cambios set total = v_total where id = v_cambio;
  return jsonb_build_object('cambio_id', v_cambio, 'total', v_total, 'avisos', to_jsonb(avisos));
end $$;

revoke execute on function public.registrar_cambio_pro(date, text, text, text, text, text, uuid, numeric, jsonb, numeric, jsonb)
  from public, anon, authenticated;
grant execute on function public.registrar_cambio_pro(date, text, text, text, text, text, uuid, numeric, jsonb, numeric, jsonb)
  to authenticated;
-- Las columnas nuevas quedan cubiertas por los permisos de tabla del 001 (select/insert/update en aceites y
-- filtros; solo select en cambios). La auditoría las registra sola (to_jsonb de la fila completa).
