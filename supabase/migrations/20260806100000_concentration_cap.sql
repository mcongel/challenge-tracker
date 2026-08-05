-- The Semi/AI concentration cap is editable per spec (default 50%).
insert into challenge.app_settings (key, value)
values ('concentration_cap', to_jsonb(0.5))
on conflict (key) do nothing;
