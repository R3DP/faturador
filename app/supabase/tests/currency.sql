-- Moeda do trabalho: o tempo registrado recebe a moeda do cliente,
-- o trabalho faturado mantém essa moeda mesmo se a moeda do cliente mudar depois,
-- e moedas malformadas são rejeitadas.
BEGIN;
INSERT INTO auth.users(id,email) VALUES ('10000000-0000-4000-8000-000000000001','owner@example.test');
INSERT INTO businesses(id,name) VALUES ('20000000-0000-4000-8000-000000000001','Test business');
INSERT INTO business_members(business_id,user_id,role) VALUES
 ('20000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','owner');
INSERT INTO clients(id,business_id,name) VALUES
 ('30000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','Client');
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000001',true);
DO $$
DECLARE t uuid; invoice jsonb;
BEGIN
 INSERT INTO time_entries(business_id,client_id,description,date,duration_seconds,hourly_rate,is_billable)
 VALUES('20000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001','Billed time',CURRENT_DATE,36,100,true)
 RETURNING id INTO t;
 IF (SELECT currency FROM time_entries WHERE id=t) IS DISTINCT FROM
    (SELECT currency FROM clients WHERE id='30000000-0000-4000-8000-000000000001') THEN
  RAISE EXCEPTION 'TEST FAILED: o novo registro de tempo não recebeu a moeda do cliente';
 END IF;
 invoice:=create_invoice_document('20000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001','{}','[]',gen_random_uuid(),ARRAY[t]);
 UPDATE clients SET currency='EUR' WHERE id='30000000-0000-4000-8000-000000000001';
 IF NOT EXISTS(SELECT 1 FROM time_entries WHERE id=t AND currency='USD' AND amount=1 AND is_billed) THEN
  RAISE EXCEPTION 'TEST FAILED: o tempo faturado mudou de moeda ou valor junto com o cliente';
 END IF;
 BEGIN
  INSERT INTO time_entries(business_id,client_id,description,date,duration_seconds,hourly_rate,currency)
  VALUES('20000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001','Bad currency',CURRENT_DATE,60,100,'usd');
  RAISE EXCEPTION 'TEST FAILED: foi aceita uma moeda em letras minúsculas';
 EXCEPTION WHEN OTHERS THEN IF SQLERRM LIKE 'TEST FAILED:%' THEN RAISE; END IF; END;
END $$;
RESET ROLE;
DO $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgname='guard_time_entry' AND tgenabled='O') THEN
  RAISE EXCEPTION 'TEST FAILED: o trabalho faturado não está protegido por guard_time_entry';
 END IF;
END $$;
ROLLBACK;
