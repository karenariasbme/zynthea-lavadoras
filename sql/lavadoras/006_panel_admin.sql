-- =====================================================================
-- ZYNTHEA LAVADORAS · 006 · Panel de administración en la app
--
-- REGLA DE MIGRACIONES: solo aditivo. Crea 2 tablas (admins, invitaciones) y funciones nuevas;
-- reemplaza solicitar_acceso() (misma firma, agrega la invitación y el dato "admin").
-- No cambia ni borra tablas ni datos existentes.
-- ANTES de ejecutar: respaldo en zynthea-ops (Respaldo diario ✅).
--
-- · admins: quién es administrador (por user_id; se agrega solo desde el SQL Editor).
-- · es_admin(): la app la usa para mostrar el panel; las funciones admin_* la exigen.
-- · invitaciones: "dar acceso" a un correo que aún no se registró. Al entrar por primera vez
--   (Google o contraseña, con el correo confirmado), solicitar_acceso() lo aprueba solo.
-- · admin_*: llaman a aprobar / cambiar_plan / suspender / reactivar / rechazar del 002
--   solo si quien llama es admin. Sin service_role en el navegador.
-- · Auditoría: los triggers del 001 ya registran perfiles, lavadoras y miembros con el
--   usuario y correo de quien hizo el cambio (la admin). Se agregan admins e invitaciones.
--
-- Ejecutar UNA vez en: SQL Editor → New query → Run.
-- La administradora debe haber entrado a la app al menos una vez (para existir en auth.users).
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. ADMINS
-- ---------------------------------------------------------------------
create table public.admins (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

create function public.es_admin()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.admins where user_id = auth.uid())
$$;

-- Corta cualquier función admin_* si quien llama no es admin
create function public._exigir_admin()
returns void language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.es_admin() then
    raise exception 'Solo la administradora puede hacer esto.' using errcode = '42501';
  end if;
end $$;


-- ---------------------------------------------------------------------
-- 2. INVITACIONES
-- ---------------------------------------------------------------------
create table public.invitaciones (
  id         uuid primary key default gen_random_uuid(),
  email      text not null check (email = lower(trim(email)) and email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  plan       text not null check (plan in ('BAS','EST','PRO','PRE')),
  nombre     text not null check (length(trim(nombre)) between 1 and 120),
  estado     text not null default 'pendiente' check (estado in ('pendiente','usada','anulada')),
  creada_por uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  usada_por  uuid references auth.users(id) on delete set null,
  cerrada_at timestamptz                                  -- cuándo se usó o se anuló
);
-- Una sola invitación pendiente por correo
create unique index invitaciones_pendiente_uq on public.invitaciones (email) where estado = 'pendiente';

-- Auditoría (mismo trigger del 001)
create trigger trg_admins_auditar after insert or update on public.admins
  for each row execute function public.auditar();
create trigger trg_invitaciones_auditar after insert or update on public.invitaciones
  for each row execute function public.auditar();


-- ---------------------------------------------------------------------
-- 3. solicitar_acceso(): igual que antes + invitación + dato "admin"
-- ---------------------------------------------------------------------
create or replace function public.solicitar_acceso()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid(); r public.perfiles; u auth.users; v_inv public.invitaciones;
begin
  if v_uid is null then raise exception 'Inicia sesión primero.' using errcode = '42501'; end if;
  select * into u from auth.users where id = v_uid;

  insert into public.perfiles (user_id, email, nombre)
  values (u.id, coalesce(u.email, ''), nullif(trim(coalesce(u.raw_user_meta_data->>'full_name', u.raw_user_meta_data->>'name', '')), ''))
  on conflict (user_id) do nothing;
  select * into r from public.perfiles where user_id = v_uid;

  -- Invitación: solo si está pendiente de revisión, sin lavadora y con el correo confirmado
  if r.estado = 'pendiente' and u.email_confirmed_at is not null
     and not exists (select 1 from public.miembros where user_id = v_uid) then
    select * into v_inv from public.invitaciones
     where email = lower(trim(u.email)) and estado = 'pendiente' for update;
    if found then
      begin
        perform public.aprobar(u.email, v_inv.plan, v_inv.nombre);
        update public.invitaciones set estado = 'usada', usada_por = v_uid, cerrada_at = now() where id = v_inv.id;
      exception when others then
        null;   -- si algo falla, queda pendiente de revisión y la invitación sigue visible en el panel
      end;
      select * into r from public.perfiles where user_id = v_uid;
    end if;
  end if;

  return jsonb_build_object('estado', r.estado, 'nota', r.nota, 'lavadora_id', public.mi_lavadora(),
                            'plan', public.mi_plan(), 'rol', public.mi_rol(), 'admin', public.es_admin());
end $$;


-- ---------------------------------------------------------------------
-- 4. FUNCIONES DEL PANEL (todas empiezan con _exigir_admin())
-- ---------------------------------------------------------------------

-- 4.1 Dar acceso por correo: si el usuario existe, se aprueba al momento; si no, queda invitación.
create function public.admin_dar_acceso(p_email text, p_plan text, p_nombre text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_email text := lower(trim(coalesce(p_email, ''))); v_inv uuid;
begin
  perform public._exigir_admin();
  if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'Escribe un correo válido.' using errcode = '22023'; end if;
  if p_plan not in ('BAS','EST','PRO','PRE') then raise exception 'Plan no válido.' using errcode = '22023'; end if;
  if coalesce(trim(p_nombre), '') = '' then raise exception 'Escribe el nombre de la lavadora.' using errcode = '22023'; end if;
  if exists (select 1 from public.admins a join auth.users u on u.id = a.user_id where lower(u.email) = v_email) then
    raise exception 'Ese correo es de administradora, no de cliente.' using errcode = '22023'; end if;

  if public._usuario(v_email) is not null then
    return public.aprobar(v_email, p_plan, p_nombre) || jsonb_build_object('resultado', 'aprobado');
  end if;

  if exists (select 1 from public.invitaciones where email = v_email and estado = 'pendiente') then
    raise exception 'Ya hay una invitación pendiente para ese correo. Anúlala primero si quieres cambiarla.' using errcode = '22023'; end if;
  insert into public.invitaciones (email, plan, nombre, creada_por)
  values (v_email, p_plan, trim(p_nombre), auth.uid()) returning id into v_inv;
  return jsonb_build_object('resultado', 'invitado', 'invitacion_id', v_inv, 'email', v_email, 'plan', p_plan, 'nombre', trim(p_nombre));
end $$;

-- 4.2 Solicitudes pendientes (sin las cuentas de administradora)
create function public.admin_solicitudes()
returns table (email text, nombre text, created_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform public._exigir_admin();
  return query
    select p.email, p.nombre, p.created_at from public.perfiles p
    where p.estado = 'pendiente'
      and not exists (select 1 from public.admins a where a.user_id = p.user_id)
      and not exists (select 1 from public.miembros m where m.user_id = p.user_id)
    order by p.created_at;
end $$;

create function public.admin_aprobar(p_email text, p_plan text, p_nombre text)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  perform public._exigir_admin();
  return public.aprobar(p_email, p_plan, p_nombre);
end $$;

create function public.admin_rechazar(p_email text, p_nota text)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  perform public._exigir_admin();
  return public.rechazar(p_email, p_nota);
end $$;

-- 4.3 Mis clientes: una fila por lavadora, con su dueño
create function public.admin_clientes()
returns table (lavadora_id uuid, lavadora text, plan text, activa boolean, dueno_email text,
               estado text, nota text, personal integer, created_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform public._exigir_admin();
  return query
    select l.id, l.nombre, l.plan, l.activa, p.email, p.estado, p.nota,
           (select count(*)::integer from public.miembros x where x.lavadora_id = l.id and x.rol = 'personal'),
           l.created_at
    from public.lavadoras l
    left join public.miembros m on m.lavadora_id = l.id and m.rol = 'dueno'
    left join public.perfiles p on p.user_id = m.user_id
    order by l.nombre;
end $$;

create function public.admin_cambiar_plan(p_email_dueno text, p_plan text)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  perform public._exigir_admin();
  return public.cambiar_plan(p_email_dueno, p_plan);
end $$;

create function public.admin_suspender(p_email text, p_nota text)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  perform public._exigir_admin();
  return public.suspender(p_email, p_nota);
end $$;

create function public.admin_reactivar(p_email text)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  perform public._exigir_admin();
  return public.reactivar(p_email);
end $$;

-- 4.4 Invitaciones pendientes
create function public.admin_invitaciones()
returns table (id uuid, email text, plan text, nombre text, created_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform public._exigir_admin();
  return query
    select i.id, i.email, i.plan, i.nombre, i.created_at from public.invitaciones i
    where i.estado = 'pendiente' order by i.created_at;
end $$;

create function public.admin_anular_invitacion(p_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  perform public._exigir_admin();
  update public.invitaciones set estado = 'anulada', cerrada_at = now() where id = p_id and estado = 'pendiente';
  if not found then raise exception 'La invitación ya se usó o ya estaba anulada.' using errcode = 'P0002'; end if;
  return jsonb_build_object('invitacion_id', p_id, 'estado', 'anulada');
end $$;


-- ---------------------------------------------------------------------
-- 5. SEGURIDAD: tablas cerradas a la app; solo se ejecutan las funciones
-- ---------------------------------------------------------------------
alter table public.admins       enable row level security;   -- sin políticas: nadie de la app las lee
alter table public.invitaciones enable row level security;
revoke all on public.admins, public.invitaciones from anon, authenticated;

revoke execute on function public.es_admin(), public._exigir_admin(),
  public.admin_dar_acceso(text, text, text), public.admin_solicitudes(), public.admin_aprobar(text, text, text),
  public.admin_rechazar(text, text), public.admin_clientes(), public.admin_cambiar_plan(text, text),
  public.admin_suspender(text, text), public.admin_reactivar(text), public.admin_invitaciones(),
  public.admin_anular_invitacion(uuid)
  from public, anon, authenticated;

-- authenticated: cada admin_* comprueba es_admin() por dentro. _exigir_admin() queda interna.
grant execute on function public.es_admin(),
  public.admin_dar_acceso(text, text, text), public.admin_solicitudes(), public.admin_aprobar(text, text, text),
  public.admin_rechazar(text, text), public.admin_clientes(), public.admin_cambiar_plan(text, text),
  public.admin_suspender(text, text), public.admin_reactivar(text), public.admin_invitaciones(),
  public.admin_anular_invitacion(uuid)
  to authenticated;
-- solicitar_acceso() conserva su permiso (create or replace no lo cambia).


-- ---------------------------------------------------------------------
-- 6. LA ADMINISTRADORA (cambiar el correo si hace falta; debe haber entrado a la app una vez)
-- ---------------------------------------------------------------------
do $$
declare v_uid uuid := public._usuario('karenarias.bme@gmail.com');
begin
  if v_uid is null then
    raise exception 'Ese correo no existe en Authentication: entra a la app una vez con él y vuelve a ejecutar.';
  end if;
  if exists (select 1 from public.miembros where user_id = v_uid) then
    raise exception 'Ese correo ya es cliente de una lavadora: usa otro para administrar.';
  end if;
  insert into public.admins (user_id) values (v_uid);
end $$;
