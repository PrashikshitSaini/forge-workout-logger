-- Re-research replaces a user's existing meal and all of its item rows in one
-- transaction. The ownership check prevents an arbitrary meal id from being
-- used to update another user's nutrition history.

create or replace function replace_meal(
  p_meal_id uuid,
  p_logged_on date,
  p_meal_type text,
  p_title text,
  p_original_input text,
  p_assumptions text[],
  p_items jsonb
)
returns uuid
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := (select auth.uid());
  v_meal_id uuid;
  v_item jsonb;
  v_position integer := 0;
begin
  if v_uid is null then
    raise exception 'not authenticated';
  end if;
  if coalesce(btrim(p_title), '') = '' or coalesce(btrim(p_original_input), '') = '' then
    raise exception 'meal title and input are required';
  end if;
  if p_meal_type not in ('breakfast', 'lunch', 'dinner', 'snack', 'meal') then
    raise exception 'invalid meal type';
  end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'at least one meal item is required';
  end if;

  select id into v_meal_id
  from meals
  where id = p_meal_id and user_id = v_uid
  for update;
  if v_meal_id is null then
    raise exception 'meal not found';
  end if;

  delete from meal_items where meal_id = v_meal_id and user_id = v_uid;

  update meals
  set
    logged_on = p_logged_on,
    meal_type = p_meal_type,
    title = btrim(p_title),
    original_input = btrim(p_original_input),
    assumptions = coalesce(p_assumptions, '{}')
  where id = v_meal_id and user_id = v_uid;

  for v_item in select value from jsonb_array_elements(p_items)
  loop
    insert into meal_items (
      user_id, meal_id, name, brand, quantity, calories, protein_g, carbs_g,
      fat_g, fiber_g, source_url, source_title, confidence, position
    ) values (
      v_uid,
      v_meal_id,
      btrim(v_item->>'name'),
      nullif(btrim(v_item->>'brand'), ''),
      btrim(v_item->>'quantity'),
      (v_item->>'calories')::numeric,
      (v_item->>'protein_g')::numeric,
      (v_item->>'carbs_g')::numeric,
      (v_item->>'fat_g')::numeric,
      nullif(v_item->>'fiber_g', '')::numeric,
      nullif(btrim(v_item->>'source_url'), ''),
      nullif(btrim(v_item->>'source_title'), ''),
      coalesce(nullif(v_item->>'confidence', ''), 'medium'),
      v_position
    );
    v_position := v_position + 1;
  end loop;

  return v_meal_id;
end $$;

grant execute on function replace_meal(uuid, date, text, text, text, text[], jsonb) to authenticated;
