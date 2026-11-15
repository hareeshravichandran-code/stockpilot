-- K-145: rules can match on the account's last digits (card bills and EMIs change amount every month)
alter table user_sms_rules add column if not exists account_ref text;
alter table user_sms_rules add column if not exists ref_kind text;     -- 'card' | 'loan': which words the SMS must also have
update recurring_events e set rules_seeded = false
 where e.kind in ('card_due','emi')
   and not exists (select 1 from user_sms_rules r where r.event_id = e.id and not r.is_deleted);
