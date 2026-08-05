-- Rule 11: net contributed caps at $25,000. Config value, not a constant —
-- raising it (after beating VOO over a trailing 12 months) is an UPDATE here.
insert into challenge.app_settings (key, value)
values ('contribution_cap', to_jsonb(25000))
on conflict (key) do nothing;
