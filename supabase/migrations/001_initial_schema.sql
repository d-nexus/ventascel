-- 001_initial_schema.sql — VentasCel
-- Esquema inicial: catálogo de productos, estado de versión del catálogo,
-- auditoría, RLS y bucket de imágenes.
-- Idempotente: se puede aplicar dos veces sin error.
-- Origen: plan 001, §4 (con la corrección del claim JWT: 'app_metadata').

-- 1) Secuencia de ids para productos NUEVOS.
--    Arranca en 1000: reserva el hueco 1..999 (ids heredados del maestro 1..75),
--    y como solo avanza, nunca reutiliza el id de un producto retirado (RF-3).
create sequence if not exists public.product_id_seq start with 1000;

-- 2) Catálogo. `id` es clave primaria y lo asigna el servidor (RF-2, RF-3).
create table if not exists public.products (
  id            bigint primary key default nextval('public.product_id_seq'),
  name          text         not null,
  category      text         not null default 'General',
  badge         text         not null default '',
  price_cup     numeric(12,2) not null default 0 check (price_cup >= 0),
  price_usd     numeric(12,2) check (price_usd is null or price_usd >= 0),
  old_price_cup numeric(12,2) check (old_price_cup is null or old_price_cup >= 0),
  old_price_usd numeric(12,2) check (old_price_usd is null or old_price_usd >= 0),
  rating        numeric(2,1) not null default 4.5 check (rating >= 0 and rating <= 5),
  reviews       integer      not null default 0 check (reviews >= 0),
  image_url     text         not null default '',
  description   text         not null default '',
  specs         jsonb        not null default '[]'::jsonb check (jsonb_typeof(specs) = 'array'),
  stock         integer      check (stock is null or stock >= 0),
  active        boolean      not null default true,
  updated_at    timestamptz  not null default now(),
  updated_by    uuid references auth.users(id) on delete set null
);
create index if not exists products_active_idx on public.products (active);

-- 3) Versión del catálogo: una sola fila (id = 1) (RF-6).
create table if not exists public.catalog_state (
  id         smallint primary key default 1 check (id = 1),
  version    integer     not null default 1,
  updated_at timestamptz not null default now()
);

-- 4) Auditoría: quién y cuándo, decidido por el servidor (RF-19).
create or replace function public.products_set_audit()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  new.updated_at := now();
  new.updated_by := auth.uid();   -- NULL en la carga inicial (credencial de servicio)
  return new;
end $$;
drop trigger if exists products_audit_trg on public.products;
create trigger products_audit_trg
  before insert or update on public.products
  for each row execute function public.products_set_audit();

-- 5) La versión SOLO avanza si el contenido cambia de verdad (RF-6).
create or replace function public.products_bump_version()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_changed boolean := false;
begin
  if tg_op = 'INSERT' then v_changed := true;
  elsif tg_op = 'DELETE' then v_changed := true;
  else
    v_changed := row(new.name, new.category, new.badge, new.price_cup, new.price_usd,
                     new.old_price_cup, new.old_price_usd, new.rating, new.reviews,
                     new.image_url, new.description, new.specs, new.stock, new.active)
               is distinct from
                 row(old.name, old.category, old.badge, old.price_cup, old.price_usd,
                     old.old_price_cup, old.old_price_usd, old.rating, old.reviews,
                     old.image_url, old.description, old.specs, old.stock, old.active);
  end if;
  if v_changed then
    update public.catalog_state set version = version + 1, updated_at = now() where id = 1;
  end if;
  return null;
end $$;
drop trigger if exists products_version_trg on public.products;
create trigger products_version_trg
  after insert or update or delete on public.products
  for each row execute function public.products_bump_version();

-- 6) RLS: el público solo lee productos activos; escribir exige rol admin (RF-13, RF-26).
alter table public.products enable row level security;
alter table public.catalog_state enable row level security;

drop policy if exists products_public_read on public.products;
create policy products_public_read on public.products
  for select using (active = true);

drop policy if exists products_admin_read on public.products;
create policy products_admin_read on public.products
  for select to authenticated
  using ((select auth.jwt()) -> 'app_metadata' ->> 'role' = 'admin');

drop policy if exists products_admin_insert on public.products;
create policy products_admin_insert on public.products
  for insert to authenticated
  with check ((select auth.jwt()) -> 'app_metadata' ->> 'role' = 'admin');

drop policy if exists products_admin_update on public.products;
create policy products_admin_update on public.products
  for update to authenticated
  using ((select auth.jwt()) -> 'app_metadata' ->> 'role' = 'admin')
  with check ((select auth.jwt()) -> 'app_metadata' ->> 'role' = 'admin');

drop policy if exists products_admin_delete on public.products;
create policy products_admin_delete on public.products
  for delete to authenticated
  using ((select auth.jwt()) -> 'app_metadata' ->> 'role' = 'admin');

drop policy if exists catalog_state_public_read on public.catalog_state;
create policy catalog_state_public_read on public.catalog_state
  for select using (true);

-- 7) El anónimo no puede ni ver las columnas internas (RNF-5):
--    `updated_at` y `updated_by` no son seleccionables por el rol `anon`.
revoke select (updated_at, updated_by) on public.products from anon;
revoke insert, update, delete on public.products from anon;
revoke insert, update, delete on public.catalog_state from anon, authenticated;

-- 7b) Las funciones internas de triggers no se exponen por RPC (aviso de los linters).
revoke execute on function public.products_set_audit() from public, anon, authenticated;
revoke execute on function public.products_bump_version() from public, anon, authenticated;

-- 8) Bucket de imágenes: lectura pública, escritura solo admin (RF-13).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('product-images', 'product-images', true, 5242880,
        array['image/jpeg','image/png','image/webp','image/gif'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "product-images public read" on storage.objects;
create policy "product-images public read" on storage.objects
  for select using (bucket_id = 'product-images');

drop policy if exists "product-images admin insert" on storage.objects;
create policy "product-images admin insert" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'product-images' and (select auth.jwt()) -> 'app_metadata' ->> 'role' = 'admin');

drop policy if exists "product-images admin update" on storage.objects;
create policy "product-images admin update" on storage.objects
  for update to authenticated
  using (bucket_id = 'product-images' and (select auth.jwt()) -> 'app_metadata' ->> 'role' = 'admin')
  with check (bucket_id = 'product-images' and (select auth.jwt()) -> 'app_metadata' ->> 'role' = 'admin');

drop policy if exists "product-images admin delete" on storage.objects;
create policy "product-images admin delete" on storage.objects
  for delete to authenticated
  using (bucket_id = 'product-images' and (select auth.jwt()) -> 'app_metadata' ->> 'role' = 'admin');
