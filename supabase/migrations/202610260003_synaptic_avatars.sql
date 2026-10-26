insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'synaptic-avatars',
  'synaptic-avatars',
  true,
  5242880,
  array['image/jpeg', 'image/png']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Anyone can view Synaptic avatars" on storage.objects;
create policy "Anyone can view Synaptic avatars"
  on storage.objects for select to public
  using (bucket_id = 'synaptic-avatars');

drop policy if exists "Users can upload their Synaptic avatar" on storage.objects;
create policy "Users can upload their Synaptic avatar"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'synaptic-avatars'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

drop policy if exists "Users can replace their Synaptic avatar" on storage.objects;
create policy "Users can replace their Synaptic avatar"
  on storage.objects for update to authenticated
  using (
    bucket_id = 'synaptic-avatars'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  )
  with check (
    bucket_id = 'synaptic-avatars'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

drop policy if exists "Users can remove their Synaptic avatar" on storage.objects;
create policy "Users can remove their Synaptic avatar"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'synaptic-avatars'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );
