import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "../config.js";

// Solo la publishable key (pública por diseño); la seguridad la dan RLS y las funciones de la base.
export const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
