-- Adds one transactional API to the existing CapRate schema. Does not recreate tables.
create or replace function public.studio_save_steps(chain_id uuid, expected jsonb, steps jsonb)
returns void language plpgsql security invoker set search_path = '' as $$
declare current_state jsonb; item jsonb; idx integer := 0;
begin
  if not exists (select 1 from public.profiles where id = (select auth.uid()) and is_superadmin is true) then
    raise exception 'Superadmin access required';
  end if;
  perform 1 from public.prompt_chains where id = chain_id for update;
  if not found then raise exception 'Chain no longer exists'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('id',s.id,'updated_at',s.updated_at) order by s.id), '[]'::jsonb)
    into current_state from public.prompt_chain_steps s where prompt_chain_id = chain_id;
  if current_state <> expected then raise exception 'Steps changed in another session. Reload before saving.'; end if;
  if jsonb_typeof(steps) <> 'array' or jsonb_array_length(steps) > 50 then raise exception 'Use at most 50 steps'; end if;
  if (select count(distinct value->>'id') from jsonb_array_elements(steps)) <> jsonb_array_length(steps) then raise exception 'Duplicate step IDs'; end if;
  -- IDs cannot be taken from another chain.
  if exists (select 1 from public.prompt_chain_steps s join jsonb_array_elements(steps) j on s.id = (j.value->>'id')::uuid where s.prompt_chain_id <> chain_id) then raise exception 'Invalid step ID'; end if;
  delete from public.prompt_chain_steps s where s.prompt_chain_id = chain_id and not exists (select 1 from jsonb_array_elements(steps) j where (j.value->>'id')::uuid = s.id);
  -- Move all surviving positions out of the destination range before swapping.
  update public.prompt_chain_steps set position = position + 100000 where prompt_chain_id = chain_id;
  for item in select value from jsonb_array_elements(steps) loop
    idx := idx + 1;
    if length(btrim(item->>'name')) not between 1 and 120 or length(btrim(item->>'prompt_template')) not between 1 and 12000 then raise exception 'Invalid step name or prompt'; end if;
    if not exists (select 1 from public.llm_models m join public.llm_providers p on p.id=m.provider_id where m.id=(item->>'llm_model_id')::uuid and m.is_active and p.is_active and p.slug='google' and m.model_identifier ~ '^gemini-[a-zA-Z0-9._-]+$' and (not (item->>'include_image')::boolean or m.supports_images)) then raise exception 'Choose an active, compatible Google model'; end if;
    insert into public.prompt_chain_steps (id,prompt_chain_id,position,name,prompt_template,llm_model_id,include_image,include_user_context,use_terms,use_community_examples,use_curated_examples)
    values ((item->>'id')::uuid,chain_id,idx,btrim(item->>'name'),btrim(item->>'prompt_template'),(item->>'llm_model_id')::uuid,(item->>'include_image')::boolean,(item->>'include_user_context')::boolean,(item->>'use_terms')::boolean,(item->>'use_community_examples')::boolean,(item->>'use_curated_examples')::boolean)
    on conflict (id) do update set position=excluded.position,name=excluded.name,prompt_template=excluded.prompt_template,llm_model_id=excluded.llm_model_id,include_image=excluded.include_image,include_user_context=excluded.include_user_context,use_terms=excluded.use_terms,use_community_examples=excluded.use_community_examples,use_curated_examples=excluded.use_curated_examples;
  end loop;
  update public.prompt_chains set updated_at=now() where id=chain_id;
end;
$$;
revoke all on function public.studio_save_steps(uuid,jsonb,jsonb) from public, anon;
grant execute on function public.studio_save_steps(uuid,jsonb,jsonb) to authenticated;
