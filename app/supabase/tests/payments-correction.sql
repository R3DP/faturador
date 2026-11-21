-- Correções de pagamentos: update_payment e void_payment.
--
-- O problema que este teste cobre: um agente preencheu retroativamente faturas já pagas, usando
-- como payment_date o dia do preenchimento; por isso, todos esses pagamentos
-- caíram no mesmo mês do relatório de receita. O primeiro bloco abaixo reproduz exatamente
-- essa correção de ponta a ponta: altera a data e confirma a mudança de mês.
BEGIN;
INSERT INTO auth.users(id,email) VALUES
 ('10000000-0000-4000-8000-000000000001','owner@example.test'),
 ('10000000-0000-4000-8000-000000000002','other@example.test');
INSERT INTO businesses(id,name) VALUES
 ('20000000-0000-4000-8000-000000000001','Test business'),
 ('20000000-0000-4000-8000-000000000002','Other business');
INSERT INTO business_members(business_id,user_id,role) VALUES
 ('20000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','owner'),
 ('20000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000002','owner');
INSERT INTO clients(id,business_id,name) VALUES
 ('30000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','Client'),
 ('30000000-0000-4000-8000-000000000002','20000000-0000-4000-8000-000000000002','Other client');
INSERT INTO api_keys(id,user_id,business_id,label,key_hash,permissions) VALUES
 ('50000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','Agent','hash-agent',ARRAY['read','write','payments']),
 ('50000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','Reader','hash-reader',ARRAY['read']);

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000001',true);

-- 1. A data incorreta do pagamento é corrigida, e o relatório de receita acompanha a mudança.
DO $$
DECLARE
 b uuid:='20000000-0000-4000-8000-000000000001'; c uuid:='30000000-0000-4000-8000-000000000001';
 inv jsonb; pay uuid; r jsonb; report jsonb; wrong date:=DATE '2026-09-21'; right_day date:=DATE '2026-06-15';
BEGIN
 inv:=create_invoice_document(b,c,'{}','[{"description":"Backfilled work","quantity":1,"rate":100}]',gen_random_uuid());
 r:=record_payment_once((inv->>'id')::uuid,100,wrong,gen_random_uuid());
 pay:=(r->>'payment_id')::uuid;
 IF (SELECT status FROM invoices WHERE id=(inv->>'id')::uuid)<>'paid' THEN RAISE EXCEPTION 'A preparação não marcou a fatura como paga'; END IF;
 IF (SELECT source FROM payments WHERE id=pay)<>'manual' THEN RAISE EXCEPTION 'Um pagamento pelo navegador não foi registrado como manual'; END IF;

 report:=get_report_summary(b,DATE '2026-09-01',DATE '2026-09-30',NULL,NULL,'month','USD');
 IF (report->'totals'->'current'->>'collected')::numeric<>100 THEN RAISE EXCEPTION 'Preparação: o valor não ficou em setembro'; END IF;

 r:=update_payment(pay,'fix-'||pay::text,right_day);
 IF (r->'payment'->>'payment_date')<>right_day::text THEN RAISE EXCEPTION 'update_payment não alterou a data'; END IF;
 IF (SELECT updated_at FROM payments WHERE id=pay) IS NULL THEN RAISE EXCEPTION 'update_payment não registrou updated_at'; END IF;

 report:=get_report_summary(b,DATE '2026-09-01',DATE '2026-09-30',NULL,NULL,'month','USD');
 IF (report->'totals'->'current'->>'collected')::numeric<>0 THEN RAISE EXCEPTION 'O valor não saiu do mês incorreto'; END IF;
 report:=get_report_summary(b,DATE '2026-06-01',DATE '2026-06-30',NULL,NULL,'month','USD');
 IF (report->'totals'->'current'->>'collected')::numeric<>100 THEN RAISE EXCEPTION 'O valor não foi lançado no mês correto'; END IF;

 -- 2. A repetição do request_id retorna a mesma resposta e não aplica a alteração duas vezes.
 IF (update_payment(pay,'fix-'||pay::text,right_day)->>'replayed')<>'true' THEN RAISE EXCEPTION 'A repetição não foi identificada como tal'; END IF;
 IF (SELECT COUNT(*) FROM payment_audit WHERE payment_id=pay)<>1 THEN RAISE EXCEPTION 'A repetição criou um segundo registro de auditoria'; END IF;
 BEGIN
  PERFORM update_payment(pay,'fix-'||pay::text,DATE '2026-07-01');
  RAISE EXCEPTION 'TEST FAILED: um request ID foi reutilizado com dados diferentes';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'request_id_reused' THEN RAISE; END IF; END;

 -- 3. O registro de auditoria contém o pagamento completo, antes e depois da alteração.
 IF NOT EXISTS(
   SELECT 1 FROM payment_audit a
    WHERE a.payment_id=pay AND a.action='update'
      AND a.invoice_id=(inv->>'id')::uuid AND a.business_id=b
      AND a.actor_user_id='10000000-0000-4000-8000-000000000001' AND a.actor_key_id IS NULL
      AND (a.before->>'payment_date')=wrong::text AND (a.after->>'payment_date')=right_day::text
 ) THEN RAISE EXCEPTION 'O registro de auditoria não descreve a correção'; END IF;

 -- 4. Reduzir o valor do pagamento muda o status de pago para parcial.
 r:=update_payment(pay,'reduce-'||pay::text,NULL,NULL,NULL,NULL,40);
 IF (r->'invoice'->>'status')<>'partial' THEN RAISE EXCEPTION 'A redução do valor não reabriu a fatura'; END IF;
 IF (r->'invoice'->>'amount_paid')::numeric<>40 OR (r->'invoice'->>'balance_due')::numeric<>60 THEN RAISE EXCEPTION 'Os campos de valores da fatura não foram recalculados'; END IF;
 IF (SELECT paid_at FROM invoices WHERE id=(inv->>'id')::uuid) IS NOT NULL THEN RAISE EXCEPTION 'paid_at permaneceu preenchido após a reabertura'; END IF;

 -- 5. Um valor superior ao total da fatura é rejeitado.
 BEGIN
  PERFORM update_payment(pay,'toobig-'||pay::text,NULL,NULL,NULL,NULL,101);
  RAISE EXCEPTION 'TEST FAILED: foi aceito um pagamento acima do total';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'amount_exceeds_invoice_total' THEN RAISE; END IF; END;

 -- 6. O estorno reabre todo o saldo, e o registro permanece marcado com o motivo.
 r:=void_payment(pay,'void-'||pay::text,'Recorded against the wrong invoice');
 IF (r->'invoice'->>'status')<>'sent' THEN RAISE EXCEPTION 'O estorno do pagamento não reabriu a fatura'; END IF;
 IF (r->'invoice'->>'balance_due')::numeric<>100 OR (r->'invoice'->>'amount_paid')::numeric<>0 THEN RAISE EXCEPTION 'O estorno não zerou o livro de pagamentos'; END IF;
 IF NOT EXISTS(SELECT 1 FROM payments WHERE id=pay AND voided_at IS NOT NULL AND void_reason='Recorded against the wrong invoice') THEN RAISE EXCEPTION 'O registro estornado foi excluído ou perdeu o motivo'; END IF;
 IF (SELECT COALESCE(SUM(amount),0) FROM payments WHERE invoice_id=(inv->>'id')::uuid AND voided_at IS NULL)<>0 THEN RAISE EXCEPTION 'Um pagamento estornado ainda está sendo contabilizado'; END IF;

 report:=get_report_summary(b,DATE '2026-06-01',DATE '2026-06-30',NULL,NULL,'month','USD');
 IF (report->'totals'->'current'->>'collected')::numeric<>0 THEN RAISE EXCEPTION 'Um pagamento estornado ainda aparece no relatório de receita'; END IF;
 IF (dashboard_summary(b,'USD')->>'totalRevenue')::numeric<>0 THEN RAISE EXCEPTION 'Um pagamento estornado ainda aparece na receita do painel'; END IF;

 -- 7. Um pagamento estornado não pode ser alterado nem estornado novamente.
 BEGIN
  PERFORM update_payment(pay,'again-'||pay::text,DATE '2026-05-01');
  RAISE EXCEPTION 'TEST FAILED: um pagamento estornado foi alterado';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'payment_already_voided' THEN RAISE; END IF; END;
 BEGIN
  PERFORM void_payment(pay,'again-'||pay::text,'Second void');
  RAISE EXCEPTION 'TEST FAILED: um pagamento foi estornado duas vezes';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'payment_already_voided' THEN RAISE; END IF; END;
 BEGIN
  PERFORM void_payment(pay,'noreason-'||pay::text,'   ');
  RAISE EXCEPTION 'TEST FAILED: um pagamento foi estornado sem motivo';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'void_reason_required' THEN RAISE; END IF; END;

 PERFORM set_config('billr.test_invoice',inv->>'id',true);
END $$;

-- 8. Pagamentos Stripe não podem ser alterados pelo app: para cartões, use reembolsos.
RESET ROLE;
SET LOCAL ROLE service_role;
SELECT set_config('request.jwt.claim.role','service_role',true);
DO $$
DECLARE v_invoice uuid:=current_setting('billr.test_invoice')::uuid; pay uuid;
BEGIN
 PERFORM record_stripe_payment(v_invoice,100,CURRENT_DATE,'pi_correction_test');
 SELECT id INTO pay FROM payments WHERE stripe_payment_id='pi_correction_test';
 IF (SELECT source FROM payments WHERE id=pay)<>'stripe' THEN RAISE EXCEPTION 'Um pagamento Stripe não foi identificado como stripe'; END IF;
 BEGIN
  PERFORM update_payment(pay,'stripe-edit','2026-01-01',NULL,NULL,NULL,NULL,'50000000-0000-4000-8000-000000000001');
  RAISE EXCEPTION 'TEST FAILED: um pagamento Stripe foi alterado';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'stripe_payment_locked' THEN RAISE; END IF; END;
 BEGIN
  PERFORM void_payment(pay,'stripe-void','Wrong','50000000-0000-4000-8000-000000000001');
  RAISE EXCEPTION 'TEST FAILED: um pagamento Stripe foi estornado';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'stripe_payment_locked' THEN RAISE; END IF; END;
 PERFORM set_config('billr.stripe_payment',pay::text,true);
END $$;

-- 9. No fluxo MCP, o agente é o proprietário da chave de API, e a chave precisa ter a
-- permissão payments. Uma chave sem essa permissão é recusada, mesmo que
-- a camada HTTP já a tenha autenticado.
DO $$
DECLARE b uuid:='20000000-0000-4000-8000-000000000001'; c uuid:='30000000-0000-4000-8000-000000000001';
 inv jsonb; pay uuid; r jsonb;
BEGIN
 inv:=create_invoice_document(b,c,'{}','[{"description":"Agent work","quantity":1,"rate":80}]',gen_random_uuid());
 r:=record_payment_once((inv->>'id')::uuid,80,CURRENT_DATE,gen_random_uuid(),'bank_transfer',NULL,NULL,'agent','50000000-0000-4000-8000-000000000001');
 pay:=(r->>'payment_id')::uuid;
 IF (SELECT source FROM payments WHERE id=pay)<>'agent' THEN RAISE EXCEPTION 'Um pagamento de agente não foi identificado como agent'; END IF;
 BEGIN
  PERFORM update_payment(pay,'agent-edit',DATE '2026-03-03',NULL,NULL,NULL,NULL,'50000000-0000-4000-8000-000000000002');
  RAISE EXCEPTION 'TEST FAILED: uma chave somente de leitura alterou um pagamento';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'key_cannot_edit_payments' THEN RAISE; END IF; END;
 BEGIN
  PERFORM update_payment(pay,'agent-edit',DATE '2026-03-03');
  RAISE EXCEPTION 'TEST FAILED: uma chamada com função de serviço sem chave foi aceita';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'invalid_actor' THEN RAISE; END IF; END;
 r:=update_payment(pay,'agent-edit',DATE '2026-03-03',NULL,NULL,NULL,NULL,'50000000-0000-4000-8000-000000000001');
 IF (r->'payment'->>'payment_date')<>'2026-03-03' THEN RAISE EXCEPTION 'A correção feita pelo agente não foi aplicada'; END IF;
 IF NOT EXISTS(SELECT 1 FROM payment_audit WHERE payment_id=pay
   AND actor_key_id='50000000-0000-4000-8000-000000000001'
   AND actor_user_id='10000000-0000-4000-8000-000000000001')
 THEN RAISE EXCEPTION 'O registro de auditoria do agente não identifica a chave e seu proprietário'; END IF;
END $$;

-- 10. Um membro de outra organização não pode acessar o pagamento, e o erro não
-- revela que ele existe.
RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.role','',true);
SELECT set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000002',true);
DO $$
DECLARE pay uuid:=current_setting('billr.stripe_payment')::uuid;
BEGIN
 BEGIN
  PERFORM update_payment(pay,'cross-tenant',DATE '2026-01-01');
  RAISE EXCEPTION 'TEST FAILED: outra organização alterou um pagamento';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'payment_not_found' THEN RAISE; END IF; END;
 BEGIN
  PERFORM void_payment(pay,'cross-tenant','Not mine');
  RAISE EXCEPTION 'TEST FAILED: outra organização estornou um pagamento';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'payment_not_found' THEN RAISE; END IF; END;
 IF EXISTS(SELECT 1 FROM payment_audit) THEN RAISE EXCEPTION 'A RLS revelou a trilha de auditoria de outra empresa'; END IF;
END $$;
ROLLBACK;
