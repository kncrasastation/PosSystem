-- Optional Chinese display names. English `name` stays required and is the fallback.
alter table public.categories add column name_zh text;
alter table public.products add column name_zh text;

-- Historical orders keep the Chinese name as it was when ordered.
alter table public.order_items add column product_name_zh_snapshot text;

-- products.image_url already exists (0001). Photos will live in a Supabase Storage
-- bucket created when the Supabase backend is wired up.
