BEGIN;
INSERT INTO auth.users(id,email) VALUES ('10000000-0000-4000-8000-000000000001','owner@example.test'),('10000000-0000-4000-8000-000000000002','other@example.test');
INSERT INTO businesses(id,name) VALUES ('20000000-0000-4000-8000-000000000001','Test business'),('20000000-0000-4000-8000-000000000002','Other business');
INSERT INTO business_members(business_id,user_id,role) VALUES
 ('20000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','owner'),
 ('20000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000002','owner');
INSERT INTO clients(id,business_id,name) VALUES
 ('30000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','Client'),
 ('30000000-0000-4000-8000-000000000002','20000000-0000-4000-8000-000000000002','Other client');
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000001',true);
DO $$
DECLARE b uuid:='20000000-0000-4000-8000-000000000001'; p uuid; t uuid; r jsonb; request uuid:=gen_random_uuid();
BEGIN
 INSERT INTO billing_policies(business_id,client_id,name,currency,hourly_rate,usage_multiplier,budget)
 VALUES(b,'30000000-0000-4000-8000-000000000001','Agreed pricing','USD',100,1.5,50) RETURNING id INTO p;
 r:=task_operation(b,request,'create',jsonb_build_object('policy_id',p,'title','Test task'));
 t:=(r->'task'->>'id')::uuid;
 IF task_operation(b,request,'create',jsonb_build_object('policy_id',p,'title','Test task'))<>r THEN RAISE EXCEPTION 'A repetição da tarefa alterou o resultado'; END IF;
 PERFORM task_operation(b,gen_random_uuid(),'start',jsonb_build_object('task_id',t));
 PERFORM task_operation(b,gen_random_uuid(),'usage',jsonb_build_object('task_id',t,'provider','example','provider_request_id','req-1','cost',2,'currency','USD','source','Provider usage response'));
 BEGIN
   PERFORM task_operation(b,gen_random_uuid(),'usage',jsonb_build_object('task_id',t,'provider','example','provider_request_id','req-1','cost',2,'currency','USD','source','Provider usage response'));
   RAISE EXCEPTION 'TEST FAILED: foi aceita uma utilização duplicada';
 EXCEPTION WHEN unique_violation THEN NULL; END;
 BEGIN
   PERFORM task_operation(b,gen_random_uuid(),'usage',jsonb_build_object('task_id',t,'provider','example','provider_request_id','req-2','cost',2,'currency','EUR','source','Provider usage response'));
   RAISE EXCEPTION 'TEST FAILED: foi aceita uma mistura de moedas';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM NOT LIKE 'Usage currency%' THEN RAISE; END IF; END;
 BEGIN
   PERFORM task_operation(b,gen_random_uuid(),'usage',jsonb_build_object('task_id',t,'provider','example','provider_request_id','req-3','cost',100,'currency','USD','source','Provider usage response'));
   RAISE EXCEPTION 'TEST FAILED: o limite do orçamento foi excedido';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM NOT LIKE 'Usage would exceed%' THEN RAISE; END IF; END;
 r:=task_operation(b,gen_random_uuid(),'complete',jsonb_build_object('task_id',t));
 IF (r->>'usage_amount')::numeric<>3 THEN RAISE EXCEPTION 'Margem de utilização incorreta'; END IF;
 r:=task_operation(b,gen_random_uuid(),'invoice',jsonb_build_object('task_id',t));
 IF (r->'task'->>'invoice_id') IS NULL THEN RAISE EXCEPTION 'Nenhuma fatura de rascunho foi criada'; END IF;
 IF (SELECT total FROM invoices WHERE id=(r->'task'->>'invoice_id')::uuid)<>3 THEN RAISE EXCEPTION 'Fatura da tarefa incorreta'; END IF;
 DELETE FROM invoices WHERE id=(r->'task'->>'invoice_id')::uuid;
 IF (SELECT status FROM work_tasks WHERE id=t)<>'completed' THEN RAISE EXCEPTION 'A exclusão do rascunho não liberou a tarefa'; END IF;
 r:=task_operation(b,gen_random_uuid(),'invoice',jsonb_build_object('task_id',t));
 IF (r->'task'->>'invoice_id') IS NULL THEN RAISE EXCEPTION 'Não foi possível aprovar novamente a tarefa liberada'; END IF;

END $$;
-- Simula um agente interrompido sem esperar dez minutos na suíte de testes.
DO $$
DECLARE r jsonb; p uuid;
BEGIN
 SELECT id INTO p FROM billing_policies WHERE business_id='20000000-0000-4000-8000-000000000001' LIMIT 1;
 r:=task_operation('20000000-0000-4000-8000-000000000001',gen_random_uuid(),'create',jsonb_build_object('policy_id',p,'title','Lease test'));
 PERFORM set_config('billr.test_task_id',r->'task'->>'id',true);
 PERFORM task_operation('20000000-0000-4000-8000-000000000001',gen_random_uuid(),'start',jsonb_build_object('task_id',current_setting('billr.test_task_id')));
END $$;
RESET ROLE;
UPDATE work_tasks SET last_heartbeat_at=clock_timestamp()-interval '10 minutes' WHERE id=current_setting('billr.test_task_id')::uuid;
SET LOCAL ROLE authenticated;
DO $$
DECLARE r jsonb; request uuid:=gen_random_uuid(); input jsonb:=jsonb_build_object('task_id',current_setting('billr.test_task_id'));
BEGIN
 r:=task_operation('20000000-0000-4000-8000-000000000001',request,'heartbeat',input);
 IF (r->'task'->>'active_seconds')::bigint<>120 THEN RAISE EXCEPTION 'A concessão expirada cobrou mais de 120 segundos'; END IF;
 IF task_operation('20000000-0000-4000-8000-000000000001',request,'heartbeat',input)<>r THEN RAISE EXCEPTION 'A repetição do heartbeat alterou o custo'; END IF;
 PERFORM task_operation('20000000-0000-4000-8000-000000000001',gen_random_uuid(),'pause',input);
END $$;
RESET ROLE;
UPDATE work_tasks SET last_heartbeat_at=clock_timestamp()-interval '10 minutes' WHERE id=current_setting('billr.test_task_id')::uuid;
SET LOCAL ROLE authenticated;
DO $$
DECLARE r jsonb;
BEGIN
 r:=task_operation('20000000-0000-4000-8000-000000000001',gen_random_uuid(),'complete',jsonb_build_object('task_id',current_setting('billr.test_task_id')));
 IF (r->'task'->>'active_seconds')::bigint<>120 THEN RAISE EXCEPTION 'O tempo pausado foi faturado'; END IF;
END $$;
ROLLBACK;
