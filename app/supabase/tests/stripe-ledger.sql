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
DECLARE b uuid:='20000000-0000-4000-8000-000000000001'; c uuid:='30000000-0000-4000-8000-000000000001'; i jsonb;
BEGIN
 i:=create_invoice_document(b,c,'{}','[{"description":"Stripe ledger test","quantity":1,"rate":10}]',gen_random_uuid());
 PERFORM set_config('billr.test_invoice',i->>'id',true);
 i:=create_invoice_document(b,c,'{}','[{"description":"Replayed success","quantity":1,"rate":10}]',gen_random_uuid());
 PERFORM set_config('billr.test_invoice_replay',i->>'id',true);
 i:=create_invoice_document(b,c,'{}','[{"description":"Late first success","quantity":1,"rate":10}]',gen_random_uuid());
 PERFORM set_config('billr.test_invoice_late',i->>'id',true);
 BEGIN
  PERFORM record_stripe_payment((i->>'id')::uuid,10,CURRENT_DATE,'pi_forged');
  RAISE EXCEPTION 'TEST FAILED: um usuário autenticado registrou um pagamento Stripe';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;
SET LOCAL ROLE service_role;
SELECT set_config('request.jwt.claim.role','service_role',true);
DO $$
DECLARE v_invoice_id uuid:=current_setting('billr.test_invoice')::uuid;
BEGIN
 PERFORM record_stripe_payment(v_invoice_id,10,CURRENT_DATE,'pi_local_test');
 PERFORM record_stripe_payment(v_invoice_id,10,CURRENT_DATE,'pi_local_test');
 IF (SELECT COUNT(*) FROM payments WHERE invoice_id=v_invoice_id)<>1 THEN RAISE EXCEPTION 'Pagamento Stripe duplicado'; END IF;
 IF (SELECT status FROM invoices WHERE invoices.id=v_invoice_id)<>'paid' THEN RAISE EXCEPTION 'A atualização do status para pago não foi atômica'; END IF;
 PERFORM record_stripe_payment(v_invoice_id,-3,CURRENT_DATE,'re_local_test');
 PERFORM record_stripe_payment(v_invoice_id,-3,CURRENT_DATE,'re_local_test');
 IF (SELECT amount_paid FROM invoices WHERE invoices.id=v_invoice_id)<>7 OR(SELECT balance_due FROM invoices WHERE invoices.id=v_invoice_id)<>3 THEN RAISE EXCEPTION 'O livro de reembolsos não fecha'; END IF;
 BEGIN
  PERFORM record_stripe_payment(v_invoice_id,8,CURRENT_DATE,'pi_local_test');
  RAISE EXCEPTION 'TEST FAILED: foi aceito um valor conflitante do provedor';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM NOT LIKE 'Provider payment ID conflicts%' THEN RAISE; END IF; END;
END $$;
-- Um sucesso só assume o ponteiro de tentativa da fatura quando ele está vazio. Uma
-- fatura que já avançou para um PaymentIntent mais recente continua apontando para ele quando
-- chega um sucesso de uma intenção anterior, tenha ele já sido
-- registrado (repetição) ou esteja sendo registrado agora (entrega atrasada).
DO $$
DECLARE v_replay uuid:=current_setting('billr.test_invoice_replay')::uuid;
        v_late uuid:=current_setting('billr.test_invoice_late')::uuid;
BEGIN
 PERFORM record_stripe_payment(v_replay,4,CURRENT_DATE,'pi_old');
 IF (SELECT stripe_payment_intent_id FROM invoices WHERE id=v_replay) IS DISTINCT FROM 'pi_old' THEN
  RAISE EXCEPTION 'TEST FAILED: o sucesso não assumiu um ponteiro vazio';
 END IF;
 UPDATE invoices SET stripe_payment_intent_id='pi_new' WHERE id=v_replay;
 PERFORM record_stripe_payment(v_replay,4,CURRENT_DATE,'pi_old');
 IF (SELECT stripe_payment_intent_id FROM invoices WHERE id=v_replay) IS DISTINCT FROM 'pi_new' THEN
  RAISE EXCEPTION 'TEST FAILED: a repetição do sucesso alterou o ponteiro pi_new';
 END IF;
 IF (SELECT COUNT(*) FROM payments WHERE invoice_id=v_replay)<>1 THEN RAISE EXCEPTION 'TEST FAILED: a repetição do sucesso duplicou o valor'; END IF;

 UPDATE invoices SET stripe_payment_intent_id='pi_new' WHERE id=v_late;
 PERFORM record_stripe_payment(v_late,4,CURRENT_DATE,'pi_old_late');
 IF (SELECT stripe_payment_intent_id FROM invoices WHERE id=v_late) IS DISTINCT FROM 'pi_new' THEN
  RAISE EXCEPTION 'TEST FAILED: um sucesso atrasado de uma intenção anterior alterou o ponteiro pi_new';
 END IF;
 IF (SELECT amount_paid FROM invoices WHERE id=v_late)<>4 THEN RAISE EXCEPTION 'TEST FAILED: o sucesso atrasado não foi registrado'; END IF;
END $$;
ROLLBACK;
