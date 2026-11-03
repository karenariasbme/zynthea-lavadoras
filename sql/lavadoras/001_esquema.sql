-- =====================================================================
-- ZYNTHEA LAVADORAS · 001 · Esquema
-- Proyecto Supabase "zynthea-lavadoras" (solo lavadoras) · schema public
--
-- · Acceso por aprobación: al primer inicio de sesión la app llama a
--   solicitar_acceso() y el perfil queda "pendiente" (sin trigger en auth.users).
-- · Una lavadora por cliente aprobado, con plan BAS / EST / PRO / PRE.
-- · Todo aislado por RLS. Los clientes NO pueden borrar filas: borrado lógico
--   (deleted_at) con la función borrar(); sin política ni permiso DELETE.
-- · Auditoría: quién, qué, cuándo, valores anterior y nuevo.
-- · Los usos y cambios de aceite solo se registran con funciones que validan
--   el stock y calculan el valor en la base.
--
-- Ejecutar UNA vez en: SQL Editor → New query → Run.
-- Las funciones de administración (aprobar, cambiar plan, suspender) van en 002.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. PERFILES: solicitud de acceso de cada usuario
-- ---------------------------------------------------------------------
create table public.perfiles (
  user_id     uuid primary key references auth.users(id) on delete cascade,
  email       text not null,
  nombre      text,
  estado      text not null default 'pendiente'
              check (estado in ('pendiente','aprobado','rechazado','suspendido')),
  nota        text,                                   -- motivo de rechazo o suspensión (lo ve el usuario)
  created_at  timestamptz not null default now(),
  revisado_at timestamptz
);
create index perfiles_estado_idx on public.perfiles (estado, created_at);


-- ---------------------------------------------------------------------
-- 2. LAVADORAS (cada cliente) y MIEMBROS (usuario → lavadora)
-- ---------------------------------------------------------------------
create table public.lavadoras (
  id             uuid primary key default gen_random_uuid(),
  nombre         text not null check (length(trim(nombre)) between 1 and 120),
  logo_path      text,                                -- ruta en el bucket "logos": <lavadora_id>/archivo
  color_primario text not null default '#0F2E44' check (color_primario ~ '^#[0-9A-Fa-f]{6}$'),
  color_acento   text not null default '#D0911C' check (color_acento ~ '^#[0-9A-Fa-f]{6}$'),
  mano_obra      numeric(10,2) not null default 5 check (mano_obra >= 0),
  plan           text not null check (plan in ('BAS','EST','PRO','PRE')),
  activa         boolean not null default true,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create table public.miembros (
  user_id     uuid primary key references auth.users(id) on delete cascade,   -- 1 usuario = 1 lavadora
  lavadora_id uuid not null references public.lavadoras(id) on delete restrict,
  rol         text not null default 'dueno' check (rol in ('dueno','personal')),
  created_at  timestamptz not null default now()
);
create index miembros_lavadora_idx on public.miembros (lavadora_id);


-- ---------------------------------------------------------------------
-- 3. FUNCIONES DE SEGURIDAD
--    mi_lavadora()  → lavadora del usuario, solo si su perfil está aprobado y la lavadora activa
--    mi_rol(), mi_plan(), plan_incluye('EST') con el orden BAS < EST < PRO < PRE
-- ---------------------------------------------------------------------
create function public.mi_lavadora()
returns uuid language sql stable security definer set search_path = '' as $$
  select m.lavadora_id
  from public.miembros m
  join public.perfiles p  on p.user_id = m.user_id and p.estado = 'aprobado'
  join public.lavadoras l on l.id = m.lavadora_id and l.activa
  where m.user_id = auth.uid()
$$;

create function public.mi_rol()
returns text language sql stable security definer set search_path = '' as $$
  select m.rol from public.miembros m
  where m.user_id = auth.uid() and m.lavadora_id = public.mi_lavadora()
$$;

create function public.mi_plan()
returns text language sql stable security definer set search_path = '' as $$
  select l.plan from public.lavadoras l where l.id = public.mi_lavadora()
$$;

create function public.plan_incluye(minimo text)
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce(
    array_position(array['BAS','EST','PRO','PRE'], public.mi_plan())
      >= array_position(array['BAS','EST','PRO','PRE'], minimo),
    false)
$$;


-- ---------------------------------------------------------------------
-- 4. DATOS DE TRABAJO
--    Todas las tablas: lavadora_id (lo pone la base), created_by, created_at,
--    updated_at y deleted_at (borrado lógico). unique (lavadora_id, id) permite
--    llaves foráneas compuestas: nada puede apuntar a datos de otra lavadora.
-- ---------------------------------------------------------------------
create table public.aceites (
  id            uuid primary key default gen_random_uuid(),
  lavadora_id   uuid not null default public.mi_lavadora() references public.lavadoras(id),
  nombre        text not null check (length(trim(nombre)) between 1 and 120),
  tipo          text not null default 'Mineral',
  marca         text not null default '',
  presentacion  text not null default 'Galón',       -- "Galón" → stock en galones (1 cuarto = 0,25)
  stock_inicial numeric(12,2) not null default 0 check (stock_inicial >= 0),
  entradas      numeric(12,2) not null default 0 check (entradas >= 0),
  minimo        numeric(12,2) not null default 0 check (minimo >= 0),
  precio        numeric(10,2) not null default 0 check (precio >= 0),          -- por galón o por unidad
  precio_cuarto numeric(10,2) not null default 0 check (precio_cuarto >= 0),   -- 0 = precio ÷ 4
  created_by    uuid default auth.uid() references auth.users(id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  deleted_at    timestamptz,
  unique (lavadora_id, id)
);

create table public.filtros (
  id            uuid primary key default gen_random_uuid(),
  lavadora_id   uuid not null default public.mi_lavadora() references public.lavadoras(id),
  nombre        text not null check (length(trim(nombre)) between 1 and 120),
  tipo          text not null default 'Aceite',
  marca         text not null default '',
  referencia    text not null default '',
  aplicacion    text not null default '',            -- "Para qué vehículos"
  stock_inicial numeric(12,2) not null default 0 check (stock_inicial >= 0),
  entradas      numeric(12,2) not null default 0 check (entradas >= 0),
  minimo        numeric(12,2) not null default 0 check (minimo >= 0),
  precio        numeric(10,2) not null default 0 check (precio >= 0),
  created_by    uuid default auth.uid() references auth.users(id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  deleted_at    timestamptz,
  unique (lavadora_id, id)
);

-- Marcas y modelos (Plan Estándar en adelante)
create table public.vehiculos (
  id           uuid primary key default gen_random_uuid(),
  lavadora_id  uuid not null default public.mi_lavadora() references public.lavadoras(id),
  marca        text not null check (length(trim(marca)) between 1 and 60),
  modelo       text not null check (length(trim(modelo)) between 1 and 60),
  aceite_id    uuid,
  cantidad     numeric(6,2) not null default 1 check (cantidad > 0),
  mano_obra    numeric(10,2) check (mano_obra >= 0),            -- null = la de la lavadora
  f_aceite uuid, f_aceite_c uuid, f_aire uuid, f_aire_c uuid,     -- original y compatible
  f_comb   uuid, f_comb_c   uuid, f_cabina uuid, f_cabina_c uuid,
  created_by   uuid default auth.uid() references auth.users(id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  deleted_at   timestamptz,
  unique (lavadora_id, id),
  foreign key (lavadora_id, aceite_id)  references public.aceites (lavadora_id, id),
  foreign key (lavadora_id, f_aceite)   references public.filtros (lavadora_id, id),
  foreign key (lavadora_id, f_aceite_c) references public.filtros (lavadora_id, id),
  foreign key (lavadora_id, f_aire)     references public.filtros (lavadora_id, id),
  foreign key (lavadora_id, f_aire_c)   references public.filtros (lavadora_id, id),
  foreign key (lavadora_id, f_comb)     references public.filtros (lavadora_id, id),
  foreign key (lavadora_id, f_comb_c)   references public.filtros (lavadora_id, id),
  foreign key (lavadora_id, f_cabina)   references public.filtros (lavadora_id, id),
  foreign key (lavadora_id, f_cabina_c) references public.filtros (lavadora_id, id)
);
create unique index vehiculos_modelo_uq on public.vehiculos (lavadora_id, lower(marca), lower(modelo))
  where deleted_at is null;

-- Cambio de aceite completo (Plan Profesional en adelante)
create table public.cambios (
  id          uuid primary key default gen_random_uuid(),
  lavadora_id uuid not null default public.mi_lavadora() references public.lavadoras(id),
  fecha       date not null default ((now() at time zone 'America/Guayaquil')::date),
  cliente     text not null check (length(trim(cliente)) between 1 and 120),
  marca       text not null default '',
  modelo      text not null default '',
  vehiculo_id uuid,
  mano_obra   numeric(10,2) not null default 0 check (mano_obra >= 0),
  total       numeric(12,2) not null default 0 check (total >= 0),
  created_by  uuid default auth.uid() references auth.users(id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  deleted_at  timestamptz,
  unique (lavadora_id, id),
  foreign key (lavadora_id, vehiculo_id) references public.vehiculos (lavadora_id, id)
);

create table public.usos_aceite (
  id          uuid primary key default gen_random_uuid(),
  lavadora_id uuid not null default public.mi_lavadora() references public.lavadoras(id),
  fecha       date not null default ((now() at time zone 'America/Guayaquil')::date),
  cliente     text not null check (length(trim(cliente)) between 1 and 120),
  marca       text not null default '',
  modelo      text not null default '',
  aceite_id   uuid not null,
  cantidad    numeric(10,2) not null check (cantidad > 0),
  valor       numeric(12,2) not null default 0 check (valor >= 0),
  cambio_id   uuid,                                   -- si es parte de un cambio de aceite
  created_by  uuid default auth.uid() references auth.users(id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  deleted_at  timestamptz,
  foreign key (lavadora_id, aceite_id) references public.aceites (lavadora_id, id),
  foreign key (lavadora_id, cambio_id) references public.cambios (lavadora_id, id)
);

create table public.usos_filtro (
  id          uuid primary key default gen_random_uuid(),
  lavadora_id uuid not null default public.mi_lavadora() references public.lavadoras(id),
  fecha       date not null default ((now() at time zone 'America/Guayaquil')::date),
  cliente     text not null check (length(trim(cliente)) between 1 and 120),
  marca       text not null default '',
  modelo      text not null default '',
  filtro_id   uuid not null,
  cantidad    numeric(10,2) not null check (cantidad > 0),
  clase       text not null default '' check (clase in ('Original','Compatible','Otro','')),
  valor       numeric(12,2) not null default 0 check (valor >= 0),
  cambio_id   uuid,
  created_by  uuid default auth.uid() references auth.users(id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  deleted_at  timestamptz,
  foreign key (lavadora_id, filtro_id) references public.filtros (lavadora_id, id),
  foreign key (lavadora_id, cambio_id) references public.cambios (lavadora_id, id)
);

-- Índices de trabajo (solo filas vigentes)
create index aceites_lav_idx     on public.aceites     (lavadora_id) where deleted_at is null;
create index filtros_lav_idx     on public.filtros     (lavadora_id) where deleted_at is null;
create index vehiculos_lav_idx   on public.vehiculos   (lavadora_id) where deleted_at is null;
create index cambios_lav_idx     on public.cambios     (lavadora_id, fecha desc) where deleted_at is null;
create index usos_aceite_prod_idx on public.usos_aceite (lavadora_id, aceite_id) where deleted_at is null;
create index usos_aceite_fecha_idx on public.usos_aceite (lavadora_id, fecha desc) where deleted_at is null;
create index usos_aceite_cambio_idx on public.usos_aceite (cambio_id) where cambio_id is not null;
create index usos_filtro_prod_idx on public.usos_filtro (lavadora_id, filtro_id) where deleted_at is null;
create index usos_filtro_fecha_idx on public.usos_filtro (lavadora_id, fecha desc) where deleted_at is null;
create index usos_filtro_cambio_idx on public.usos_filtro (cambio_id) where cambio_id is not null;


-- ---------------------------------------------------------------------
-- 5. AUDITORÍA: quién, qué, cuándo, antes y después
-- ---------------------------------------------------------------------
create table public.auditoria (
  id          bigint generated always as identity primary key,
  lavadora_id uuid,
  tabla       text not null,
  registro_id text not null,
  accion      text not null check (accion in ('INSERT','UPDATE','BORRADO','RESTAURADO')),
  antes       jsonb,
  despues     jsonb,
  user_id     uuid,
  email       text,
  at          timestamptz not null default now()
);
create index auditoria_lav_idx on public.auditoria (lavadora_id, at desc);
create index auditoria_reg_idx on public.auditoria (tabla, registro_id);

create function public.auditar()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  n jsonb := to_jsonb(new);
  o jsonb := case when tg_op = 'UPDATE' then to_jsonb(old) end;
  v_accion text := 'INSERT';
begin
  if tg_op = 'UPDATE' then
    if (o - 'updated_at') = (n - 'updated_at') then return null; end if;   -- nada cambió
    v_accion := case
      when o->>'deleted_at' is null and n->>'deleted_at' is not null then 'BORRADO'
      when o->>'deleted_at' is not null and n->>'deleted_at' is null then 'RESTAURADO'
      else 'UPDATE' end;
  end if;
  insert into public.auditoria (lavadora_id, tabla, registro_id, accion, antes, despues, user_id, email)
  values (
    coalesce((n->>'lavadora_id')::uuid, case when tg_table_name = 'lavadoras' then (n->>'id')::uuid end),
    tg_table_name,
    coalesce(n->>'id', n->>'user_id'),
    v_accion, o, n,
    auth.uid(),
    auth.jwt() ->> 'email');
  return null;
end $$;


-- ---------------------------------------------------------------------
-- 6. PROTECCIÓN DE FILAS (triggers BEFORE)
-- ---------------------------------------------------------------------
-- Al crear: la base fija autor, fechas y lavadora; nadie crea filas ya borradas.
create function public.preparar_alta()
returns trigger language plpgsql set search_path = '' as $$
begin
  if auth.uid() is not null then
    new.created_by  := auth.uid();
    new.lavadora_id := public.mi_lavadora();
  end if;
  new.created_at := now();
  new.updated_at := now();
  new.deleted_at := null;
  return new;
end $$;

-- Al editar: no cambia la lavadora, el autor ni la fecha de creación.
-- El borrado lógico solo se hace con borrar(); un cliente no edita ni restaura filas borradas.
-- (En el SQL Editor, sin usuario de la app, sí se puede restaurar.)
create function public.proteger()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.lavadora_id := old.lavadora_id;
  new.created_by  := old.created_by;
  new.created_at  := old.created_at;
  new.updated_at  := now();
  if auth.uid() is not null then
    if old.deleted_at is not null then
      raise exception 'Este registro está borrado y no se puede modificar.' using errcode = '42501';
    end if;
    if new.deleted_at is not null and coalesce(current_setting('lavadoras.borrando', true), '') <> '1' then
      raise exception 'Para borrar usa la función borrar().' using errcode = '42501';
    end if;
  end if;
  return new;
end $$;

-- Plan Premium: el personal no crea ni edita precios ni stock inicial
create function public.proteger_precios()
returns trigger language plpgsql set search_path = '' as $$
declare n jsonb := to_jsonb(new); o jsonb := case when tg_op = 'UPDATE' then to_jsonb(old) end;
begin
  if public.mi_rol() = 'personal' then
    if tg_op = 'INSERT' and (coalesce((n->>'precio')::numeric, 0) <> 0
                             or coalesce((n->>'precio_cuarto')::numeric, 0) <> 0
                             or coalesce((n->>'stock_inicial')::numeric, 0) <> 0) then
      raise exception 'Solo el dueño puede poner precios y stock inicial.' using errcode = '42501';
    end if;
    if tg_op = 'UPDATE' and (n->'precio' is distinct from o->'precio'
                             or n->'precio_cuarto' is distinct from o->'precio_cuarto'
                             or n->'stock_inicial' is distinct from o->'stock_inicial') then
      raise exception 'Solo el dueño puede cambiar precios y stock inicial.' using errcode = '42501';
    end if;
  end if;
  return new;
end $$;

create function public.tocar_updated_at()
returns trigger language plpgsql set search_path = '' as $$
begin new.updated_at := now(); return new; end $$;

do $$
declare t text;
begin
  foreach t in array array['aceites','filtros','vehiculos','cambios','usos_aceite','usos_filtro'] loop
    execute format('create trigger trg_%1$s_alta before insert on public.%1$I for each row execute function public.preparar_alta()', t);
    execute format('create trigger trg_%1$s_proteger before update on public.%1$I for each row execute function public.proteger()', t);
  end loop;
  foreach t in array array['aceites','filtros','vehiculos','cambios','usos_aceite','usos_filtro','lavadoras','miembros','perfiles'] loop
    execute format('create trigger trg_%1$s_auditar after insert or update on public.%1$I for each row execute function public.auditar()', t);
  end loop;
end $$;

create trigger trg_aceites_precios before insert or update on public.aceites
  for each row execute function public.proteger_precios();
create trigger trg_filtros_precios before insert or update on public.filtros
  for each row execute function public.proteger_precios();
create trigger trg_lavadoras_updated before update on public.lavadoras
  for each row execute function public.tocar_updated_at();


-- ---------------------------------------------------------------------
-- 7. STOCK Y VALOR (misma lógica que la app: galones y cuartos)
-- ---------------------------------------------------------------------
create view public.stock_aceites with (security_invoker = true) as
select a.*,
       round(a.stock_inicial + a.entradas - coalesce(u.usado, 0), 2) as actual
from public.aceites a
left join lateral (select sum(x.cantidad) as usado from public.usos_aceite x
                   where x.lavadora_id = a.lavadora_id and x.aceite_id = a.id and x.deleted_at is null) u on true
where a.deleted_at is null;

create view public.stock_filtros with (security_invoker = true) as
select f.*,
       round(f.stock_inicial + f.entradas - coalesce(u.usado, 0), 2) as actual
from public.filtros f
left join lateral (select sum(x.cantidad) as usado from public.usos_filtro x
                   where x.lavadora_id = f.lavadora_id and x.filtro_id = f.id and x.deleted_at is null) u on true
where f.deleted_at is null;

-- Valor de q unidades de un aceite. En galón: g galones × precio + c cuartos × precio del cuarto.
create function public.valor_aceite(p_presentacion text, p_precio numeric, p_precio_cuarto numeric, q numeric)
returns numeric language plpgsql immutable set search_path = '' as $$
declare g integer; c integer; pc numeric;
begin
  if p_presentacion ~* 'gal' and p_presentacion !~* 'caneca|tanque|balde' then
    g := floor(q + 1e-9); c := round((q - g) * 4);
    if c = 4 then g := g + 1; c := 0; end if;
    pc := case when p_precio_cuarto > 0 then p_precio_cuarto else p_precio / 4 end;
    return round(g * p_precio + c * pc, 2);
  end if;
  return round(q * p_precio, 2);
end $$;

-- Bloquea el producto (para que dos usuarios a la vez no dejen el stock en negativo) y devuelve lo que queda
create function public._stock_aceite(p_lav uuid, p_id uuid)
returns public.aceites language plpgsql security definer set search_path = '' as $$
declare a public.aceites;
begin
  select * into a from public.aceites where id = p_id and lavadora_id = p_lav and deleted_at is null for update;
  if not found then raise exception 'El aceite no existe o fue borrado.' using errcode = 'P0002'; end if;
  return a;
end $$;

create function public._stock_filtro(p_lav uuid, p_id uuid)
returns public.filtros language plpgsql security definer set search_path = '' as $$
declare f public.filtros;
begin
  select * into f from public.filtros where id = p_id and lavadora_id = p_lav and deleted_at is null for update;
  if not found then raise exception 'El filtro no existe o fue borrado.' using errcode = 'P0002'; end if;
  return f;
end $$;

create function public._disponible_aceite(a public.aceites)
returns numeric language sql stable security definer set search_path = '' as $$
  select round(a.stock_inicial + a.entradas - coalesce(sum(u.cantidad), 0), 2)
  from public.usos_aceite u where u.aceite_id = a.id and u.lavadora_id = a.lavadora_id and u.deleted_at is null
$$;

create function public._disponible_filtro(f public.filtros)
returns numeric language sql stable security definer set search_path = '' as $$
  select round(f.stock_inicial + f.entradas - coalesce(sum(u.cantidad), 0), 2)
  from public.usos_filtro u where u.filtro_id = f.id and u.lavadora_id = f.lavadora_id and u.deleted_at is null
$$;


-- ---------------------------------------------------------------------
-- 8. FUNCIONES QUE USA LA APP
-- ---------------------------------------------------------------------
-- Primer inicio de sesión: crea el perfil "pendiente" (solo quien entra a la app de lavadoras)
create function public.solicitar_acceso()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); r public.perfiles;
begin
  if v_uid is null then raise exception 'Inicia sesión primero.' using errcode = '42501'; end if;
  insert into public.perfiles (user_id, email, nombre)
  select u.id, coalesce(u.email, ''), nullif(trim(coalesce(u.raw_user_meta_data->>'full_name', u.raw_user_meta_data->>'name', '')), '')
  from auth.users u where u.id = v_uid
  on conflict (user_id) do nothing;
  select * into r from public.perfiles where user_id = v_uid;
  return jsonb_build_object('estado', r.estado, 'nota', r.nota, 'lavadora_id', public.mi_lavadora(), 'plan', public.mi_plan(), 'rol', public.mi_rol());
end $$;

-- Registrar aceite usado o filtros usados (Plan Básico en adelante).
-- p_tipo: 'aceite' | 'filtro'. p_items: [{"id": uuid, "cantidad": n, "clase": "Original"}]
-- p_vehiculo_id solo con Plan Estándar o superior (marcas y modelos).
create function public.registrar_uso(p_tipo text, p_fecha date, p_cliente text, p_vehiculo_id uuid, p_items jsonb)
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
    if not found then raise exception 'El vehículo no existe.' using errcode = 'P0002'; end if;
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
      insert into public.usos_aceite (fecha, cliente, marca, modelo, aceite_id, cantidad, valor)
      values (coalesce(p_fecha, (now() at time zone 'America/Guayaquil')::date), trim(p_cliente), v_marca, v_modelo, a.id, q, v_valor);
      if disp - q <= a.minimo then avisos := avisos || format('%s: quedan %s', a.nombre, disp - q); end if;
    else
      f := public._stock_filtro(v_lav, (it->>'id')::uuid);
      disp := public._disponible_filtro(f);
      if q > disp + 1e-9 then raise exception 'No alcanza: quedan % de %.', disp, f.nombre using errcode = '23514'; end if;
      v_valor := round(f.precio * q, 2);
      insert into public.usos_filtro (fecha, cliente, marca, modelo, filtro_id, cantidad, clase, valor)
      values (coalesce(p_fecha, (now() at time zone 'America/Guayaquil')::date), trim(p_cliente), v_marca, v_modelo, f.id, q,
              coalesce(nullif(it->>'clase', ''), ''), v_valor);
      if disp - q <= f.minimo then avisos := avisos || format('%s %s: quedan %s', f.nombre, f.aplicacion, disp - q); end if;
    end if;
    v_total := v_total + v_valor;
  end loop;
  return jsonb_build_object('total', v_total, 'avisos', to_jsonb(avisos));
end $$;

-- Cambio de aceite completo: aceite + filtros + mano de obra en una sola transacción (Plan Profesional en adelante).
-- p_filtros: [{"id": uuid, "clase": "Original" | "Compatible" | "Otro"}]
create function public.registrar_cambio(p_fecha date, p_cliente text, p_vehiculo_id uuid,
                                        p_aceite_id uuid, p_cantidad numeric, p_filtros jsonb, p_mano_obra numeric)
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
    if not found then raise exception 'El vehículo no existe.' using errcode = 'P0002'; end if;
  end if;

  perform set_config('lavadoras.borrando', '', true);
  v_total := round(coalesce(p_mano_obra, 0), 2);
  insert into public.cambios (fecha, cliente, marca, modelo, vehiculo_id, mano_obra, total)
  values (v_fecha, trim(p_cliente), v_marca, v_modelo, p_vehiculo_id, v_total, 0)
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

-- Borrado lógico (lo único que pueden "borrar" los clientes). Nunca se elimina una fila.
create function public.borrar(p_tabla text, p_id uuid)
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
  if n = 0 then raise exception 'No se encontró el registro.' using errcode = 'P0002'; end if;

  if p_tabla = 'cambios' then        -- el aceite y los filtros del cambio vuelven al stock
    update public.usos_aceite set deleted_at = now() where cambio_id = p_id and lavadora_id = v_lav and deleted_at is null;
    update public.usos_filtro set deleted_at = now() where cambio_id = p_id and lavadora_id = v_lav and deleted_at is null;
  elsif p_tabla = 'aceites' then     -- igual que la app: el modelo queda sin ese aceite
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
-- 9. ROW LEVEL SECURITY
--    Sin políticas DELETE en ninguna tabla. Las políticas no filtran deleted_at
--    (si lo hicieran, Postgres rechazaría el borrado lógico); la app pide
--    "deleted_at is null" o usa las vistas stock_*.
-- ---------------------------------------------------------------------
alter table public.perfiles    enable row level security;
alter table public.lavadoras   enable row level security;
alter table public.miembros    enable row level security;
alter table public.aceites     enable row level security;
alter table public.filtros     enable row level security;
alter table public.vehiculos   enable row level security;
alter table public.cambios     enable row level security;
alter table public.usos_aceite enable row level security;
alter table public.usos_filtro enable row level security;
alter table public.auditoria   enable row level security;

create policy perfiles_propio on public.perfiles for select to authenticated
  using (user_id = (select auth.uid()));

create policy lavadoras_select on public.lavadoras for select to authenticated
  using (id = (select public.mi_lavadora()));
create policy lavadoras_update_dueno on public.lavadoras for update to authenticated
  using (id = (select public.mi_lavadora()) and (select public.mi_rol()) = 'dueno')
  with check (id = (select public.mi_lavadora()));

create policy miembros_select on public.miembros for select to authenticated
  using (user_id = (select auth.uid()) or lavadora_id = (select public.mi_lavadora()));

create policy aceites_rw on public.aceites for select to authenticated
  using (lavadora_id = (select public.mi_lavadora()));
create policy aceites_ins on public.aceites for insert to authenticated
  with check (lavadora_id = (select public.mi_lavadora()));
create policy aceites_upd on public.aceites for update to authenticated
  using (lavadora_id = (select public.mi_lavadora())) with check (lavadora_id = (select public.mi_lavadora()));

create policy filtros_rw on public.filtros for select to authenticated
  using (lavadora_id = (select public.mi_lavadora()));
create policy filtros_ins on public.filtros for insert to authenticated
  with check (lavadora_id = (select public.mi_lavadora()));
create policy filtros_upd on public.filtros for update to authenticated
  using (lavadora_id = (select public.mi_lavadora())) with check (lavadora_id = (select public.mi_lavadora()));

create policy vehiculos_sel on public.vehiculos for select to authenticated
  using (lavadora_id = (select public.mi_lavadora()) and (select public.plan_incluye('EST')));
create policy vehiculos_ins on public.vehiculos for insert to authenticated
  with check (lavadora_id = (select public.mi_lavadora()) and (select public.plan_incluye('EST')));
create policy vehiculos_upd on public.vehiculos for update to authenticated
  using (lavadora_id = (select public.mi_lavadora()) and (select public.plan_incluye('EST')))
  with check (lavadora_id = (select public.mi_lavadora()));

-- Usos y cambios: solo lectura directa; se crean con registrar_uso / registrar_cambio y se borran con borrar()
create policy cambios_sel on public.cambios for select to authenticated
  using (lavadora_id = (select public.mi_lavadora()) and (select public.plan_incluye('PRO')));
create policy usos_aceite_sel on public.usos_aceite for select to authenticated
  using (lavadora_id = (select public.mi_lavadora()));
create policy usos_filtro_sel on public.usos_filtro for select to authenticated
  using (lavadora_id = (select public.mi_lavadora()));

-- Auditoría: solo el dueño la consulta; nadie la escribe (la llenan los triggers)
create policy auditoria_dueno on public.auditoria for select to authenticated
  using (lavadora_id = (select public.mi_lavadora()) and (select public.mi_rol()) = 'dueno');


-- ---------------------------------------------------------------------
-- 10. PERMISOS (Supabase da permisos amplios por defecto: se quitan y se dan solo los necesarios)
-- ---------------------------------------------------------------------
revoke all on public.perfiles, public.lavadoras, public.miembros, public.aceites, public.filtros,
              public.vehiculos, public.cambios, public.usos_aceite, public.usos_filtro, public.auditoria,
              public.stock_aceites, public.stock_filtros
  from anon, authenticated;

grant usage on schema public to authenticated;
grant select on public.perfiles, public.lavadoras, public.miembros, public.auditoria,
                public.cambios, public.usos_aceite, public.usos_filtro,
                public.stock_aceites, public.stock_filtros to authenticated;
grant select, insert, update on public.aceites, public.filtros, public.vehiculos to authenticated;
-- La lavadora: el dueño solo edita su configuración (nunca el plan ni si está activa)
grant update (nombre, logo_path, color_primario, color_acento, mano_obra) on public.lavadoras to authenticated;
-- Ningún DELETE para nadie de la app.

revoke execute on all functions in schema public from public, anon, authenticated;
grant execute on function public.mi_lavadora(), public.mi_rol(), public.mi_plan(), public.plan_incluye(text),
                          public.valor_aceite(text, numeric, numeric, numeric),
                          public.solicitar_acceso(),
                          public.registrar_uso(text, date, text, uuid, jsonb),
                          public.registrar_cambio(date, text, uuid, uuid, numeric, jsonb, numeric),
                          public.borrar(text, uuid)
  to authenticated;
-- Funciones internas (_stock_*, _disponible_*, triggers): sin permiso para la app.

-- Que las tablas y funciones que se creen después no queden abiertas por defecto
alter default privileges in schema public revoke all on tables from anon, authenticated;
alter default privileges in schema public revoke execute on functions from public, anon, authenticated;


-- ---------------------------------------------------------------------
-- 11. LOGOS (Storage): bucket público, máx. 1 MB, png/jpg/webp; cada lavadora escribe solo en <lavadora_id>/
-- ---------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('logos', 'logos', true, 1048576, array['image/png','image/jpeg','image/webp'])
on conflict (id) do nothing;

create policy logos_select_propio on storage.objects for select to authenticated
  using (bucket_id = 'logos' and (storage.foldername(name))[1] = (select public.mi_lavadora())::text);
create policy logos_insert_propio on storage.objects for insert to authenticated
  with check (bucket_id = 'logos' and (storage.foldername(name))[1] = (select public.mi_lavadora())::text
              and (select public.mi_rol()) = 'dueno');
create policy logos_update_propio on storage.objects for update to authenticated
  using (bucket_id = 'logos' and (storage.foldername(name))[1] = (select public.mi_lavadora())::text
         and (select public.mi_rol()) = 'dueno')
  with check (bucket_id = 'logos' and (storage.foldername(name))[1] = (select public.mi_lavadora())::text);
create policy logos_delete_propio on storage.objects for delete to authenticated
  using (bucket_id = 'logos' and (storage.foldername(name))[1] = (select public.mi_lavadora())::text
         and (select public.mi_rol()) = 'dueno');
