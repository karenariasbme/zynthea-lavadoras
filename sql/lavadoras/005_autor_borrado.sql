-- =====================================================================
-- ZYNTHEA LAVADORAS · 005 · Autor de un registro cuando se elimina su cuenta
--
-- REGLA DE MIGRACIONES: se reemplaza una función; no cambia tablas. El único dato que toca es
-- created_by = null en registros cuyo autor ya fue eliminado (queda en la auditoría).
-- ANTES de ejecutar: respaldo + restauración de prueba en zynthea-ops (paso 5).
--
-- Problema (encontrado al probar la restauración del paso 5):
--   Al eliminar un usuario en Authentication, la base pone created_by = null en sus registros
--   (on delete set null), pero el trigger proteger() del 001 devolvía el valor anterior.
--   El registro quedaba apuntando a un usuario inexistente y, al restaurar un respaldo,
--   la llave foránea created_by no se podía volver a crear.
-- Corrección:
--   created_by solo puede pasar a null cuando lo hace la base (sin usuario de la app), es decir,
--   al eliminar la cuenta. Desde la app sigue sin poder cambiarse. La auditoría conserva quién
--   creó cada registro (user_id y correo).
-- =====================================================================

create or replace function public.proteger()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.lavadora_id := old.lavadora_id;
  new.created_by  := case when auth.uid() is null and new.created_by is null then null   -- cuenta eliminada
                          else old.created_by end;
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

-- Reparar los registros que ya apuntan a un usuario eliminado (sin usuario de la app: proteger() lo permite)
do $$
declare t text;
begin
  foreach t in array array['aceites','filtros','vehiculos','cambios','usos_aceite','usos_filtro'] loop
    execute format('update public.%I x set created_by = null
                    where x.created_by is not null and not exists (select 1 from auth.users u where u.id = x.created_by)', t);
  end loop;
end $$;
