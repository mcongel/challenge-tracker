-- The third pot: retirement accounts. Positions and lots reuse the parked
-- machinery, but retirement money lives behind its own wall — never in the
-- pile's total, concentration cap, trim fuel, income projections, or pile
-- taxes (a Roth has no taxable events), and never in the score.
--
-- kind 'retirement' joins the enum; retirement_flavor labels the tax
-- treatment (roth / traditional / 401k...) — display only in v1.

alter table challenge.accounts
  drop constraint accounts_kind_check;

alter table challenge.accounts
  add constraint accounts_kind_check
  check (kind in ('challenge', 'outside', 'bank', 'retirement'));

alter table challenge.accounts
  add column retirement_flavor text;
