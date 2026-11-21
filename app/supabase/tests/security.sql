-- Verificações de regressão do modelo de segurança do banco. Cada bloco reproduz
-- uma ação que um invasor ou cliente desatualizado poderia tentar, e deve continuar sendo rejeitada.
BEGIN;

INSERT INTO auth.users(id,email) VALUES
 ('50000000-0000-4000-8000-000000000001','alice@security.test'),
 ('50000000-0000-4000-8000-000000000002','mallory@security.test'),
 ('50000000-0000-4000-8000-000000000003','drifter@security.test');
INSERT INTO businesses(id,name) VALUES
 ('51000000-0000-4000-8000-000000000001','Alice Co'),
 ('51000000-0000-4000-8000-000000000002','Mallory Co');
INSERT INTO business_members(business_id,user_id,role) VALUES
 ('51000000-0000-4000-8000-000000000001','50000000-0000-4000-8000-000000000001','owner'),
 ('51000000-0000-4000-8000-000000000002','50000000-0000-4000-8000-000000000002','owner');
INSERT INTO install_accounts(user_id) VALUES
 ('50000000-0000-4000-8000-000000000001'),
 ('50000000-0000-4000-8000-000000000002');
INSERT INTO clients(id,business_id,name,notes) VALUES
 ('52000000-0000-4000-8000-000000000001','51000000-0000-4000-8000-000000000001','Alice Client','private note');
INSERT INTO engagements(id,business_id,client_id,name,total,billing_mode,status) VALUES
 ('54000000-0000-4000-8000-000000000001','51000000-0000-4000-8000-000000000001',
  '52000000-0000-4000-8000-000000000001','Alice Engagement',1000,'equal_installments','active');
INSERT INTO engagement_entries(id,engagement_id,business_id,position,label,amount,due_rule,status) VALUES
 ('55000000-0000-4000-8000-000000000001','54000000-0000-4000-8000-000000000001',
  '51000000-0000-4000-8000-000000000001',0,'Deposit',500,'on_start','ready_to_bill');
INSERT INTO stripe_events(id,type) VALUES ('evt_security_fixture','payment_intent.succeeded');
INSERT INTO rate_limit_counters(bucket,window_start,hits,expires_at)
 VALUES ('security-fixture',date_trunc('hour',now()),1,now()+INTERVAL '1 hour');
INSERT INTO api_keys(id,user_id,business_id,label,key_hash,key_prefix,permissions)
 VALUES ('53000000-0000-4000-8000-000000000001','50000000-0000-4000-8000-000000000001',
         '51000000-0000-4000-8000-000000000001','alice key','security-hash-alice','billr_sk_sec',ARRAY['read','write']);
-- Dados de teste para o cálculo dos itens e o status público do orçamento.
INSERT INTO invoices(id,business_id,client_id,invoice_number,status,issue_date,due_date,
                     currency,subtotal,total,balance_due) VALUES
 ('56000000-0000-4000-8000-000000000001','51000000-0000-4000-8000-000000000001',
  '52000000-0000-4000-8000-000000000001','INV-9001','draft',CURRENT_DATE,CURRENT_DATE+30,'USD',0,0,0),
 ('56000000-0000-4000-8000-000000000002','51000000-0000-4000-8000-000000000001',
  '52000000-0000-4000-8000-000000000001','INV-9002','draft',CURRENT_DATE,CURRENT_DATE+30,'USD',1000,1000,1000);
-- Marcada como enviada depois, pois guard_document_client só congela os valores
-- quando o documento deixa de ser rascunho.
UPDATE invoices SET status='sent' WHERE id='56000000-0000-4000-8000-000000000002';
INSERT INTO estimates(id,public_id,business_id,client_id,estimate_number,status,total) VALUES
 ('57000000-0000-4000-8000-000000000001','pub0000000000000000000000000001',
  '51000000-0000-4000-8000-000000000001','52000000-0000-4000-8000-000000000001','EST-9001','sent',500),
 ('57000000-0000-4000-8000-000000000002','pub0000000000000000000000000002',
  '51000000-0000-4000-8000-000000000001','52000000-0000-4000-8000-000000000001','EST-9002','declined',500),
 ('57000000-0000-4000-8000-000000000003','pub0000000000000000000000000003',
  '51000000-0000-4000-8000-000000000001','52000000-0000-4000-8000-000000000001','EST-9003','expired',500);

-- ---------------------------------------------------------------------------
-- Verificações estruturais, executadas como proprietário das migrações.
-- ---------------------------------------------------------------------------
DO $$
DECLARE v_bad TEXT;
BEGIN
  SELECT string_agg(c.relname, ', ' ORDER BY c.relname) INTO v_bad
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public' AND c.relkind = 'r' AND NOT c.relrowsecurity;
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'TEST FAILED: tabelas sem RLS: %', v_bad;
  END IF;

  -- Somente as três RPCs públicas de documentos e as duas funções auxiliares chamadas pelas políticas RLS como a função consultante.
  SELECT string_agg(p.proname, ', ' ORDER BY p.proname) INTO v_bad
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public'
     AND has_function_privilege('anon', p.oid, 'EXECUTE')
     AND p.proname NOT IN ('get_public_invoice','get_public_estimate','respond_to_estimate',
                           'user_has_business_access','user_is_business_admin');
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'TEST FAILED: anon consegue executar %', v_bad;
  END IF;

  -- Todas as funções em public fixam seu search_path, sejam definer ou não.
  SELECT string_agg(p.proname, ', ' ORDER BY p.proname) INTO v_bad
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public'
     AND 'search_path=public, pg_temp' <> ALL(COALESCE(p.proconfig, ARRAY['(none)']));
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'TEST FAILED: search_path não fixado em %', v_bad;
  END IF;

  -- Nenhuma função de cliente acessa uma tabela exclusiva do servidor.
  SELECT string_agg(t || '/' || r, ', ') INTO v_bad
    FROM unnest(ARRAY['stripe_events','rate_limit_counters','oauth_clients',
                      'oauth_authorization_codes','oauth_refresh_tokens','install_accounts']) t
    CROSS JOIN unnest(ARRAY['anon','authenticated']) r
   WHERE has_table_privilege(r, ('public.'||t)::regclass, 'SELECT')
      OR has_table_privilege(r, ('public.'||t)::regclass, 'INSERT')
      OR has_table_privilege(r, ('public.'||t)::regclass, 'UPDATE')
      OR has_table_privilege(r, ('public.'||t)::regclass, 'DELETE');
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'TEST FAILED: tabelas exclusivas do servidor com permissões concedidas: %', v_bad;
  END IF;

  -- As projeções públicas do snapshot continuam sendo listas de permissões. Uma coluna adicionada a
  -- businesses ou clients nunca deve ampliar os dados públicos retornados.
  IF public.public_business_snapshot(
       '{"name":"Shown","tax_id":"HIDDEN","internal_note":"HIDDEN","schedule_templates":[{"key":"HIDDEN"}],"next_invoice_number":42}'::JSONB)
     <> '{"name":"Shown"}'::JSONB THEN
    RAISE EXCEPTION 'TEST FAILED: o snapshot da empresa expôs um campo privado';
  END IF;
  IF public.public_client_snapshot(
       '{"name":"Shown","notes":"HIDDEN","business_id":"HIDDEN","total_paid":99,
         "outstanding_balance":1,"tax_id":"HIDDEN"}'::JSONB)
     <> '{"name":"Shown"}'::JSONB THEN
    RAISE EXCEPTION 'TEST FAILED: o snapshot do cliente expôs um campo privado';
  END IF;

  -- As correções de payments continuam restritas a RPCs, assim como a criação de empresas.
  IF EXISTS (SELECT 1 FROM pg_policy WHERE polrelid='public.payments'::regclass AND polcmd IN ('w','d','*')) THEN
    RAISE EXCEPTION 'TEST FAILED: payments tem uma política UPDATE/DELETE/ALL';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_policy WHERE polrelid='public.businesses'::regclass AND polcmd IN ('a','*')) THEN
    RAISE EXCEPTION 'TEST FAILED: businesses tem uma política INSERT/ALL';
  END IF;

  -- A política UPDATE de logos precisa restringir o caminho do objeto, não apenas o proprietário.
  IF NOT EXISTS (
    SELECT 1 FROM pg_policy p JOIN pg_class c ON c.oid = p.polrelid
     WHERE c.relname = 'objects' AND p.polcmd = 'w'
       AND pg_get_expr(p.polwithcheck, p.polrelid) LIKE '%business_members%'
       AND pg_get_expr(p.polqual, p.polrelid) LIKE '%business_members%'
       AND pg_get_expr(p.polqual, p.polrelid) LIKE '%logos%'
  ) THEN
    RAISE EXCEPTION 'TEST FAILED: a política UPDATE de logos perdeu a restrição por pasta';
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- Como anon: nada além das RPCs públicas de documentos.
-- ---------------------------------------------------------------------------
SET LOCAL ROLE anon;
SELECT set_config('request.jwt.claims','{"role":"anon"}',true);
SELECT set_config('request.jwt.claim.role','anon',true);
DO $$
BEGIN
  BEGIN
    PERFORM 1 FROM stripe_events;
    RAISE EXCEPTION 'TEST FAILED: anon leu stripe_events';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;

  BEGIN
    DELETE FROM stripe_events;
    RAISE EXCEPTION 'TEST FAILED: anon excluiu stripe_events';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;

  BEGIN
    INSERT INTO stripe_events(id,type) VALUES ('evt_forged','x');
    RAISE EXCEPTION 'TEST FAILED: anon forjou um evento Stripe';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;

  BEGIN
    PERFORM 1 FROM rate_limit_counters;
    RAISE EXCEPTION 'TEST FAILED: anon leu rate_limit_counters';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;

  BEGIN
    INSERT INTO businesses(name) VALUES ('anon business');
    RAISE EXCEPTION 'TEST FAILED: anon criou um registro de empresa';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;

  BEGIN
    PERFORM public.create_business_with_owner('anon business','a@b.test');
    RAISE EXCEPTION 'TEST FAILED: anon chamou create_business_with_owner';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;

  BEGIN
    PERFORM public.get_report_summary('51000000-0000-4000-8000-000000000001',CURRENT_DATE-30,CURRENT_DATE);
    RAISE EXCEPTION 'TEST FAILED: anon chamou get_report_summary';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;

END $$;
RESET ROLE;

-- ---------------------------------------------------------------------------
-- Como Alice: o livro de pagamentos só pode crescer por meio das RPCs e apenas com valores positivos.
-- ---------------------------------------------------------------------------
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims','{"sub":"50000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
SELECT set_config('request.jwt.claim.sub','50000000-0000-4000-8000-000000000001',true);
SELECT set_config('request.jwt.claim.role','authenticated',true);
DO $$
DECLARE
  b UUID := '51000000-0000-4000-8000-000000000001';
  c UUID := '52000000-0000-4000-8000-000000000001';
  inv JSONB; v_invoice UUID; v_payment UUID; v_key UUID := '53000000-0000-4000-8000-000000000001';
  v_hash TEXT; v_perms TEXT[]; v_expires TIMESTAMPTZ;
BEGIN
  inv := create_invoice_document(b,c,'{}','[{"description":"Work","quantity":1,"rate":100}]',gen_random_uuid());
  v_invoice := (inv->>'id')::UUID;
  UPDATE invoices SET status='sent' WHERE id=v_invoice;
  PERFORM record_payment_once(v_invoice,40,CURRENT_DATE,gen_random_uuid());
  SELECT id INTO v_payment FROM payments WHERE invoice_id=v_invoice;

  -- record_invoice_payment é concedida a authenticated e só verifica se
  -- o valor não é zero; por isso, a regra de sinal precisa estar na tabela.
  BEGIN
    PERFORM record_invoice_payment(v_invoice,-25,CURRENT_DATE);
    RAISE EXCEPTION 'TEST FAILED: uma função de cliente registrou um pagamento negativo';
  EXCEPTION WHEN OTHERS THEN IF SQLERRM LIKE 'TEST FAILED:%' THEN RAISE; END IF; END;

  BEGIN
    INSERT INTO payments(business_id,invoice_id,client_id,amount,currency,payment_date)
    SELECT business_id,id,client_id,-25,currency,CURRENT_DATE FROM invoices WHERE id=v_invoice;
    RAISE EXCEPTION 'TEST FAILED: foi aceito um pagamento negativo direto';
  EXCEPTION WHEN OTHERS THEN IF SQLERRM LIKE 'TEST FAILED:%' THEN RAISE; END IF; END;

  -- As correções precisam passar por update_payment / void_payment, que gravam em
  -- payment_audit. Um UPDATE ou DELETE direto não tem política e não afeta nenhuma linha.
  UPDATE payments SET amount=1 WHERE id=v_payment;
  IF (SELECT amount FROM payments WHERE id=v_payment) <> 40 THEN
    RAISE EXCEPTION 'TEST FAILED: um pagamento foi alterado fora de update_payment';
  END IF;
  DELETE FROM payments WHERE id=v_payment;
  IF NOT EXISTS (SELECT 1 FROM payments WHERE id=v_payment) THEN
    RAISE EXCEPTION 'TEST FAILED: um pagamento foi excluído fora de void_payment';
  END IF;

  -- As correções autorizadas continuam funcionando e gerando um registro de auditoria.
  PERFORM void_payment(v_payment,'sec-void','wrong invoice');
  IF NOT EXISTS (SELECT 1 FROM payment_audit WHERE payment_id=v_payment AND action='void') THEN
    RAISE EXCEPTION 'TEST FAILED: void_payment deixou de gravar em payment_audit';
  END IF;

  -- Remover a política DELETE de payments não pode afetar mais nada:
  -- um rascunho sem pagamento ainda pode ser excluído.
  inv := create_invoice_document(b,c,'{}','[{"description":"Draft","quantity":1,"rate":10}]',gen_random_uuid());
  DELETE FROM invoices WHERE id=(inv->>'id')::UUID;
  IF EXISTS (SELECT 1 FROM invoices WHERE id=(inv->>'id')::UUID) THEN
    RAISE EXCEPTION 'TEST FAILED: não foi mais possível excluir um rascunho sem pagamento';
  END IF;

  -- A criação de empresas continua restrita à RPC.
  BEGIN
    INSERT INTO businesses(name) VALUES ('direct');
    RAISE EXCEPTION 'TEST FAILED: uma função de cliente inseriu um registro de empresa';
  EXCEPTION WHEN OTHERS THEN IF SQLERRM LIKE 'TEST FAILED:%' THEN RAISE; END IF; END;
  IF (create_business_with_owner('Fresh','f@example.test')).name <> 'Fresh' THEN
    RAISE EXCEPTION 'TEST FAILED: a RPC de criação não criou a empresa';
  END IF;

  -- Chaves de API: restritas ao próprio usuário, manuais, com expiração e imutáveis após a gravação.
  BEGIN
    INSERT INTO api_keys(user_id,business_id,label,key_hash,key_prefix,expires_at)
    VALUES ('50000000-0000-4000-8000-000000000001','51000000-0000-4000-8000-000000000002',
            'cross','sec-cross','p1',now()+INTERVAL '90 days');
    RAISE EXCEPTION 'TEST FAILED: uma chave foi vinculada a outra organização';
  EXCEPTION WHEN OTHERS THEN IF SQLERRM LIKE 'TEST FAILED:%' THEN RAISE; END IF; END;

  BEGIN
    INSERT INTO api_keys(user_id,label,key_hash,key_prefix,kind,expires_at)
    VALUES ('50000000-0000-4000-8000-000000000001','fake oauth','sec-oauth','p2','oauth',now()+INTERVAL '90 days');
    RAISE EXCEPTION 'TEST FAILED: uma função de cliente criou um registro de token OAuth';
  EXCEPTION WHEN OTHERS THEN IF SQLERRM LIKE 'TEST FAILED:%' THEN RAISE; END IF; END;

  BEGIN
    INSERT INTO api_keys(user_id,label,key_hash,key_prefix,expires_at)
    VALUES ('50000000-0000-4000-8000-000000000001','forever','sec-forever','p3',NULL);
    RAISE EXCEPTION 'TEST FAILED: foi aceita uma chave sem expiração';
  EXCEPTION WHEN OTHERS THEN IF SQLERRM LIKE 'TEST FAILED:%' THEN RAISE; END IF; END;

  SELECT key_hash,permissions,expires_at INTO v_hash,v_perms,v_expires FROM api_keys WHERE id=v_key;
  UPDATE api_keys
     SET permissions=ARRAY['read','write','send','delete','payments'],
         key_hash='attacker-chosen',
         business_id='51000000-0000-4000-8000-000000000002',
         expires_at=now()+INTERVAL '50 years'
   WHERE id=v_key;
  IF (SELECT key_hash FROM api_keys WHERE id=v_key) <> v_hash
     OR (SELECT permissions FROM api_keys WHERE id=v_key) <> v_perms
     OR (SELECT expires_at FROM api_keys WHERE id=v_key) <> v_expires
     OR (SELECT business_id FROM api_keys WHERE id=v_key) <> b THEN
    RAISE EXCEPTION 'TEST FAILED: o proprietário alterou uma chave existente';
  END IF;
  -- A revogação, única operação feita pelo app, continua funcionando.
  UPDATE api_keys SET revoked_at=now() WHERE id=v_key;
  IF (SELECT revoked_at FROM api_keys WHERE id=v_key) IS NULL THEN
    RAISE EXCEPTION 'TEST FAILED: o proprietário não conseguiu mais revogar a própria chave';
  END IF;

  -- A exceção de liberação ao excluir em guard_engagement_entry só pode ser
  -- ativada pelo gatilho de exclusão da fatura. Definir o GUC manualmente
  -- antes liberava uma parcela ainda vinculada a uma fatura ativa, permitindo que a mesma
  -- parcela de marco fosse faturada duas vezes.
  inv := create_invoice_document(b,c,'{}','[]',gen_random_uuid(),'{}'::UUID[],'{}'::UUID[],NULL,
                                 ARRAY['55000000-0000-4000-8000-000000000001']::UUID[]);
  IF (SELECT status FROM engagement_entries WHERE id='55000000-0000-4000-8000-000000000001') <> 'invoiced' THEN
    RAISE EXCEPTION 'TEST FAILED: a parcela do contrato não foi vinculada à fatura';
  END IF;
  PERFORM set_config('billr.releasing_invoice', (inv->>'id'), TRUE);
  BEGIN
    UPDATE engagement_entries
       SET status='ready_to_bill', invoice_id=NULL, invoice_line_id=NULL
     WHERE id='55000000-0000-4000-8000-000000000001';
    RAISE EXCEPTION 'TEST FAILED: definir o GUC manualmente liberou uma parcela faturada';
  EXCEPTION WHEN OTHERS THEN IF SQLERRM LIKE 'TEST FAILED:%' THEN RAISE; END IF; END;
  PERFORM set_config('billr.releasing_invoice', '', TRUE);
  -- Excluir o rascunho continua sendo a única ação que libera a parcela.
  DELETE FROM invoices WHERE id=(inv->>'id')::UUID;
  IF (SELECT status FROM engagement_entries WHERE id='55000000-0000-4000-8000-000000000001') <> 'ready_to_bill' THEN
    RAISE EXCEPTION 'TEST FAILED: excluir o rascunho deixou de liberar a parcela';
  END IF;
END $$;
RESET ROLE;

-- ---------------------------------------------------------------------------
-- Como Mallory: IDs de outra organização recebem a mesma resposta que IDs inexistentes.
-- ---------------------------------------------------------------------------
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims','{"sub":"50000000-0000-4000-8000-000000000002","role":"authenticated"}',true);
SELECT set_config('request.jwt.claim.sub','50000000-0000-4000-8000-000000000002',true);
SELECT set_config('request.jwt.claim.role','authenticated',true);
DO $$
DECLARE
  -- A parcela de Alice, consultada diretamente: a RLS a oculta desta sessão, como
  -- deve ser. O ID serve apenas como tentativa de descoberta.
  v_entry UUID := '55000000-0000-4000-8000-000000000001';
  v_real TEXT; v_fake TEXT;
BEGIN
  IF EXISTS (SELECT 1 FROM engagement_entries WHERE id=v_entry) THEN
    RAISE EXCEPTION 'TEST FAILED: uma parcela de contrato de outra organização está visível';
  END IF;

  BEGIN PERFORM mark_entry_complete(gen_random_uuid(), v_entry);
  EXCEPTION WHEN OTHERS THEN v_real := SQLERRM; END;
  BEGIN PERFORM mark_entry_complete(gen_random_uuid(), gen_random_uuid());
  EXCEPTION WHEN OTHERS THEN v_fake := SQLERRM; END;
  IF v_real IS DISTINCT FROM v_fake THEN
    RAISE EXCEPTION 'TEST FAILED: mark_entry_complete revela se o registro existe (% vs %)', v_real, v_fake;
  END IF;

  BEGIN PERFORM waive_entry(gen_random_uuid(), v_entry, 'reason');
  EXCEPTION WHEN OTHERS THEN v_real := SQLERRM; END;
  BEGIN PERFORM waive_entry(gen_random_uuid(), gen_random_uuid(), 'reason');
  EXCEPTION WHEN OTHERS THEN v_fake := SQLERRM; END;
  IF v_real IS DISTINCT FROM v_fake THEN
    RAISE EXCEPTION 'TEST FAILED: waive_entry revela se o registro existe (% vs %)', v_real, v_fake;
  END IF;

  -- Nenhum dado de Alice pode ser visto ou alterado.
  IF EXISTS (SELECT 1 FROM clients WHERE business_id='51000000-0000-4000-8000-000000000001')
     OR EXISTS (SELECT 1 FROM invoices WHERE business_id='51000000-0000-4000-8000-000000000001')
     OR EXISTS (SELECT 1 FROM payments WHERE business_id='51000000-0000-4000-8000-000000000001')
     OR EXISTS (SELECT 1 FROM api_keys WHERE key_prefix='billr_sk_sec')
     OR EXISTS (SELECT 1 FROM businesses WHERE id='51000000-0000-4000-8000-000000000001') THEN
    RAISE EXCEPTION 'TEST FAILED: registros de outra organização estão visíveis';
  END IF;

  BEGIN
    INSERT INTO business_members(business_id,user_id,role)
    VALUES ('51000000-0000-4000-8000-000000000001','50000000-0000-4000-8000-000000000002','owner');
    RAISE EXCEPTION 'TEST FAILED: um usuário entrou em uma empresa da qual não faz parte';
  EXCEPTION WHEN OTHERS THEN IF SQLERRM LIKE 'TEST FAILED:%' THEN RAISE; END IF; END;

  BEGIN
    PERFORM 1 FROM stripe_events;
    RAISE EXCEPTION 'TEST FAILED: authenticated leu stripe_events';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;

-- ---------------------------------------------------------------------------
-- replace_invoice_line_items calcula os valores.
-- Como Alice, proprietária da fatura: este não é um teste de isolamento entre organizações, mas um teste
-- aritmético. Cada bloco tenta gravar valores que não correspondem à soma das linhas.
-- ---------------------------------------------------------------------------
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims','{"sub":"50000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
SELECT set_config('request.jwt.claim.sub','50000000-0000-4000-8000-000000000001',true);
SELECT set_config('request.jwt.claim.role','authenticated',true);
DO $$
DECLARE
  v_draft UUID := '56000000-0000-4000-8000-000000000001';
  v_sent UUID := '56000000-0000-4000-8000-000000000002';
  v_amount NUMERIC; v_total NUMERIC; v_discount NUMERIC; v_count INTEGER;
BEGIN
  -- Uma linha informa 10 x 100, mas declara valor 3, junto de um
  -- total declarado de 12. Os dois valores incorretos devem ser substituídos pelos valores calculados.
  PERFORM replace_invoice_line_items(
    v_draft,
    '[{"description":"Consulting","quantity":10,"rate":100,"amount":3,"discount_percent":0}]'::JSONB,
    '{"subtotal":12,"total":12,"tax_rate":0,"shipping_amount":0,"discount_type":"percentage","discount_value":0}'::JSONB);
  SELECT amount INTO v_amount FROM invoice_line_items WHERE invoice_id=v_draft;
  SELECT total INTO v_total FROM invoices WHERE id=v_draft;
  IF v_amount <> 1000 THEN
    RAISE EXCEPTION 'TEST FAILED: o valor da linha veio dos dados enviados pela chamada (%)', v_amount;
  END IF;
  IF v_total <> 1000 THEN
    RAISE EXCEPTION 'TEST FAILED: o total da fatura veio dos dados enviados pela chamada (%)', v_total;
  END IF;

  -- O desconto de cada linha é calculado pelo percentual, não informado diretamente.
  PERFORM replace_invoice_line_items(
    v_draft,
    '[{"description":"Consulting","quantity":10,"rate":100,"amount":1000,"discount_percent":10,"discount_amount":999}]'::JSONB,
    '{"tax_rate":0,"shipping_amount":0,"discount_type":"percentage","discount_value":0}'::JSONB);
  SELECT amount, discount_amount INTO v_amount, v_discount
    FROM invoice_line_items WHERE invoice_id=v_draft;
  SELECT total INTO v_total FROM invoices WHERE id=v_draft;
  IF v_amount <> 900 OR v_discount <> 100 OR v_total <> 900 THEN
    RAISE EXCEPTION 'TEST FAILED: cálculo do desconto por linha incorreto (% / % / %)', v_amount, v_discount, v_total;
  END IF;

  -- Quantidade negativa, preço unitário negativo e percentual fora do intervalo são
  -- rejeitados antes que qualquer dado seja excluído.
  BEGIN
    PERFORM replace_invoice_line_items(v_draft,
      '[{"description":"Credit","quantity":-5,"rate":100}]'::JSONB, '{}'::JSONB);
    RAISE EXCEPTION 'TEST FAILED: foi aceita uma quantidade negativa';
  EXCEPTION WHEN SQLSTATE 'P0001' THEN
    IF SQLERRM LIKE 'TEST FAILED:%' THEN RAISE; END IF;
  END;
  BEGIN
    PERFORM replace_invoice_line_items(v_draft,
      '[{"description":"Credit","quantity":5,"rate":-100}]'::JSONB, '{}'::JSONB);
    RAISE EXCEPTION 'TEST FAILED: foi aceito um preço unitário negativo';
  EXCEPTION WHEN SQLSTATE 'P0001' THEN
    IF SQLERRM LIKE 'TEST FAILED:%' THEN RAISE; END IF;
  END;
  BEGIN
    PERFORM replace_invoice_line_items(v_draft,
      '[{"description":"Huge","quantity":99999999,"rate":99999999}]'::JSONB, '{}'::JSONB);
    RAISE EXCEPTION 'TEST FAILED: foi aceita uma linha sem limite válido';
  EXCEPTION WHEN SQLSTATE 'P0001' THEN
    IF SQLERRM LIKE 'TEST FAILED:%' THEN RAISE; END IF;
  END;
  BEGIN
    PERFORM replace_invoice_line_items(v_draft,
      '[{"description":"Off","quantity":1,"rate":100,"discount_percent":150}]'::JSONB, '{}'::JSONB);
    RAISE EXCEPTION 'TEST FAILED: foi aceito um desconto superior a 100 por cento';
  EXCEPTION WHEN SQLSTATE 'P0001' THEN
    IF SQLERRM LIKE 'TEST FAILED:%' THEN RAISE; END IF;
  END;

  SELECT count(*), max(amount) INTO v_count, v_amount
    FROM invoice_line_items WHERE invoice_id=v_draft;
  IF v_count <> 1 OR v_amount <> 900 THEN
    RAISE EXCEPTION 'TEST FAILED: um salvamento rejeitado ainda alterou os itens da linha (% registros)', v_count;
  END IF;

  -- O total recalculado é o que faz este teste valer para uma fatura enviada:
  -- alterar as linhas muda o total, e guard_document_client rejeita
  -- mudanças no total de documentos que não sejam rascunhos.
  BEGIN
    PERFORM replace_invoice_line_items(v_sent,
      '[{"description":"Rewritten","quantity":1,"rate":50}]'::JSONB,
      '{"tax_rate":0,"shipping_amount":0,"discount_type":"percentage","discount_value":0}'::JSONB);
    RAISE EXCEPTION 'TEST FAILED: o preço de uma fatura enviada foi alterado pelos itens';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE 'TEST FAILED:%' THEN RAISE; END IF;
  END;
  SELECT total INTO v_total FROM invoices WHERE id=v_sent;
  IF v_total <> 1000 THEN
    RAISE EXCEPTION 'TEST FAILED: o total da fatura enviada foi alterado (%)', v_total;
  END IF;
END $$;
RESET ROLE;

-- ---------------------------------------------------------------------------
-- get_public_estimate não exibe orçamentos recusados ou expirados a quem
-- possua o link.
-- ---------------------------------------------------------------------------
SET LOCAL ROLE anon;
DO $$
BEGIN
  IF get_public_estimate('pub0000000000000000000000000001') IS NULL THEN
    RAISE EXCEPTION 'TEST FAILED: um orçamento enviado deixou de estar disponível publicamente';
  END IF;
  IF get_public_estimate('pub0000000000000000000000000002') IS NOT NULL THEN
    RAISE EXCEPTION 'TEST FAILED: um orçamento recusado ainda está disponível publicamente';
  END IF;
  IF get_public_estimate('pub0000000000000000000000000003') IS NOT NULL THEN
    RAISE EXCEPTION 'TEST FAILED: um orçamento expirado ainda está disponível publicamente';
  END IF;
END $$;
RESET ROLE;

-- ---------------------------------------------------------------------------
-- Uma conta que não pertence a nenhuma empresa não pode criar chave de API, nem mesmo
-- uma sem escopo de empresa. Um membro ainda pode.
-- ---------------------------------------------------------------------------
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims','{"sub":"50000000-0000-4000-8000-000000000003","role":"authenticated"}',true);
SELECT set_config('request.jwt.claim.sub','50000000-0000-4000-8000-000000000003',true);
DO $$
BEGIN
  BEGIN
    INSERT INTO api_keys(user_id,label,key_hash,key_prefix,expires_at)
    VALUES ('50000000-0000-4000-8000-000000000003','stray','sec-stray','p5',now()+INTERVAL '90 days');
    RAISE EXCEPTION 'TEST FAILED: uma conta sem empresa criou uma chave de API';
  EXCEPTION WHEN OTHERS THEN IF SQLERRM LIKE 'TEST FAILED:%' THEN RAISE; END IF; END;
END $$;
SELECT set_config('request.jwt.claims','{"sub":"50000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
SELECT set_config('request.jwt.claim.sub','50000000-0000-4000-8000-000000000001',true);
INSERT INTO api_keys(user_id,label,key_hash,key_prefix,expires_at)
 VALUES ('50000000-0000-4000-8000-000000000001','member key','sec-member','p6',now()+INTERVAL '90 days');
RESET ROLE;

ROLLBACK;
