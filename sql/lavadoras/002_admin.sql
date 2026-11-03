-- =====================================================================
-- ZYNTHEA LAVADORAS · 002 · Administración (solo desde el SQL Editor)
--
-- Nadie de la app puede ejecutar estas funciones (sin permiso para anon ni
-- authenticated). Se usan así, en el SQL Editor del proyecto zynthea-lavadoras:
--
--   select aprobar('cliente@correo.com', 'PRO', 'Lubricadora El Pistón');
--   select cambiar_plan('cliente@correo.com', 'PRE');
--   select agregar_personal('empleado@correo.com', 'cliente@correo.com');   -- solo plan PRE
--   select suspender('cliente@correo.com', 'Pago pendiente');               -- dueño: bloquea toda la lavadora
--   select reactivar('cliente@correo.com');
--   select rechazar('curioso@correo.com', 'No es cliente');
--
--   -- Solicitudes por revisar:
--   select email, nombre, created_at from perfiles where estado = 'pendiente' order by created_at;
--
-- Todo queda en la auditoría (los triggers del 001 registran perfiles, lavadoras y miembros).
-- =====================================================================

-- Usuario por correo (sin distinguir mayúsculas)
create function public._usuario(p_email text)
returns uuid language sql stable security definer set search_path = '' as $$
  select u.id from auth.users u where lower(u.email) = lower(trim(p_email))
$$;

-- Aprueba a un usuario: crea su lavadora con el plan indicado y lo deja como dueño.
-- Sirve aunque el usuario aún no haya entrado a la app (crea su perfil).
create function public.aprobar(p_email text, p_plan text, p_nombre text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := public._usuario(p_email); v_lav uuid;
begin
  if p_plan not in ('BAS','EST','PRO','PRE') then raise exception 'Plan no válido: usa BAS, EST, PRO o PRE.'; end if;
  if coalesce(trim(p_nombre), '') = '' then raise exception 'Escribe el nombre de la lavadora.'; end if;
  if v_uid is null then raise exception 'No existe un usuario con el correo %.', p_email; end if;
  if exists (select 1 from public.miembros where user_id = v_uid) then
    raise exception 'Ese usuario ya pertenece a una lavadora. Usa cambiar_plan() o reactivar().'; end if;

  insert into public.perfiles (user_id, email, nombre, estado, revisado_at)
  select u.id, coalesce(u.email, ''),
         nullif(trim(coalesce(u.raw_user_meta_data->>'full_name', u.raw_user_meta_data->>'name', '')), ''),
         'aprobado', now()
  from auth.users u where u.id = v_uid
  on conflict (user_id) do update set estado = 'aprobado', nota = null, revisado_at = now();

  insert into public.lavadoras (nombre, plan) values (trim(p_nombre), p_plan) returning id into v_lav;
  insert into public.miembros (user_id, lavadora_id, rol) values (v_uid, v_lav, 'dueno');
  return jsonb_build_object('email', p_email, 'lavadora_id', v_lav, 'nombre', trim(p_nombre), 'plan', p_plan);
end $$;

-- Cambia el plan de la lavadora del dueño indicado.
create function public.cambiar_plan(p_email_dueno text, p_plan text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_lav uuid; v_antes text;
begin
  if p_plan not in ('BAS','EST','PRO','PRE') then raise exception 'Plan no válido: usa BAS, EST, PRO o PRE.'; end if;
  select m.lavadora_id into v_lav from public.miembros m
   where m.user_id = public._usuario(p_email_dueno) and m.rol = 'dueno';
  if v_lav is null then raise exception 'No hay una lavadora cuyo dueño sea %.', p_email_dueno; end if;
  if p_plan <> 'PRE' and exists (select 1 from public.miembros m join public.perfiles p on p.user_id = m.user_id
                                 where m.lavadora_id = v_lav and m.rol = 'personal' and p.estado = 'aprobado') then
    raise exception 'Esa lavadora tiene personal activo (solo Premium). Suspende primero al personal.'; end if;
  select plan into v_antes from public.lavadoras where id = v_lav;
  update public.lavadoras set plan = p_plan where id = v_lav;
  return jsonb_build_object('email', p_email_dueno, 'lavadora_id', v_lav, 'plan_antes', v_antes, 'plan', p_plan);
end $$;

-- Plan Premium: agrega un usuario como personal de la lavadora del dueño indicado.
create function public.agregar_personal(p_email_personal text, p_email_dueno text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := public._usuario(p_email_personal); v_lav uuid; v_plan text;
begin
  if v_uid is null then raise exception 'No existe un usuario con el correo %.', p_email_personal; end if;
  select m.lavadora_id, l.plan into v_lav, v_plan from public.miembros m join public.lavadoras l on l.id = m.lavadora_id
   where m.user_id = public._usuario(p_email_dueno) and m.rol = 'dueno';
  if v_lav is null then raise exception 'No hay una lavadora cuyo dueño sea %.', p_email_dueno; end if;
  if v_plan <> 'PRE' then raise exception 'Varios usuarios solo en el plan Premium (la lavadora está en %).', v_plan; end if;
  if exists (select 1 from public.miembros where user_id = v_uid) then
    raise exception 'Ese usuario ya pertenece a una lavadora.'; end if;

  insert into public.perfiles (user_id, email, estado, revisado_at)
  select u.id, coalesce(u.email, ''), 'aprobado', now() from auth.users u where u.id = v_uid
  on conflict (user_id) do update set estado = 'aprobado', nota = null, revisado_at = now();
  insert into public.miembros (user_id, lavadora_id, rol) values (v_uid, v_lav, 'personal');
  return jsonb_build_object('email', p_email_personal, 'lavadora_id', v_lav, 'rol', 'personal');
end $$;

-- Suspende un acceso. Si es el dueño, se desactiva toda la lavadora (nadie de ella entra).
-- Los datos no se borran: con reactivar() vuelve todo como estaba.
create function public.suspender(p_email text, p_nota text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := public._usuario(p_email); v_rol text; v_lav uuid;
begin
  if v_uid is null then raise exception 'No existe un usuario con el correo %.', p_email; end if;
  update public.perfiles set estado = 'suspendido', nota = nullif(trim(coalesce(p_nota, '')), ''), revisado_at = now()
   where user_id = v_uid;
  if not found then raise exception 'Ese usuario no tiene perfil (nunca entró ni fue aprobado).'; end if;
  select rol, lavadora_id into v_rol, v_lav from public.miembros where user_id = v_uid;
  if v_rol = 'dueno' then update public.lavadoras set activa = false where id = v_lav; end if;
  return jsonb_build_object('email', p_email, 'estado', 'suspendido', 'lavadora_desactivada', v_rol = 'dueno');
end $$;

create function public.reactivar(p_email text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := public._usuario(p_email); v_rol text; v_lav uuid;
begin
  if v_uid is null then raise exception 'No existe un usuario con el correo %.', p_email; end if;
  select rol, lavadora_id into v_rol, v_lav from public.miembros where user_id = v_uid;
  if v_lav is null then raise exception 'Ese usuario no tiene lavadora: usa aprobar().'; end if;
  update public.perfiles set estado = 'aprobado', nota = null, revisado_at = now() where user_id = v_uid;
  if v_rol = 'dueno' then update public.lavadoras set activa = true where id = v_lav; end if;
  return jsonb_build_object('email', p_email, 'estado', 'aprobado', 'rol', v_rol);
end $$;

-- Rechaza una solicitud pendiente (el usuario verá la nota).
create function public.rechazar(p_email text, p_nota text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := public._usuario(p_email);
begin
  if v_uid is null then raise exception 'No existe un usuario con el correo %.', p_email; end if;
  if exists (select 1 from public.miembros where user_id = v_uid) then
    raise exception 'Ese usuario ya tiene lavadora: usa suspender().'; end if;
  update public.perfiles set estado = 'rechazado', nota = nullif(trim(coalesce(p_nota, '')), ''), revisado_at = now()
   where user_id = v_uid;
  if not found then raise exception 'Ese usuario no tiene solicitud (nunca entró a la app).'; end if;
  return jsonb_build_object('email', p_email, 'estado', 'rechazado');
end $$;

-- Solo para el SQL Editor: ningún permiso para la app
revoke execute on function public._usuario(text), public.aprobar(text, text, text), public.cambiar_plan(text, text),
                           public.agregar_personal(text, text), public.suspender(text, text),
                           public.reactivar(text), public.rechazar(text, text)
  from public, anon, authenticated;
