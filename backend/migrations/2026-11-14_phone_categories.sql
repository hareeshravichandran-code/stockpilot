-- Categories the phone has but the server lacked (uploads failed the category foreign key). Additive.
insert into expense_categories (id,user_id,name,type,icon,color,is_system,parent_id) values
('p_education',null,'Education','EXPENSE','📚','#74B9FF',true,null),
('p_insurance',null,'Insurance','EXPENSE','🛡️','#FD79A8',true,null),
('p_gadgets',null,'Electronics & Gadgets','EXPENSE','💻','#FDCB6E',true,null),
('p_electronic',null,'Electronics Service','EXPENSE','🖥️','#FD79A8',true,null),
('p_transfer',null,'Transfers','BOTH','🔁','#8A7D6A',true,null),
('health_ins',null,'Health Insurance','EXPENSE','🛡️','#C02121',true,'p_health'),
('watch_acc',null,'Watch / Accessories','EXPENSE','⌚','#D69214',true,'p_dress'),
('cc_bill',null,'Credit card bill payment','BOTH','💳','#8A7D6A',true,'p_transfer'),
('self_transfer',null,'Own account transfer','BOTH','🔁','#8A7D6A',true,'p_transfer')
on conflict (id) do nothing;
