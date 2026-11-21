-- Contratos: os cálculos do cronograma, as três
-- invariantes financeiras, as RPCs do ciclo de vida e o limite entre organizações.
--
-- O bloco marcado CASOS COMPARTILHADOS abaixo contém a mesma lista de divisões verificada em
-- src/lib/engagements/schedule.test.ts, que testa a expansão em TypeScript exibida na
-- prévia da interface. Se houver divergência entre elas, um destes arquivos falhará; esse
-- é o objetivo: uma prévia incorreta do que será gravado é pior do que
-- não exibir prévia alguma.
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
INSERT INTO clients(id,business_id,name,currency) VALUES
 ('30000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','Client','USD'),
 ('30000000-0000-4000-8000-000000000002','20000000-0000-4000-8000-000000000002','Other client','USD');
INSERT INTO api_keys(id,user_id,business_id,label,key_hash,permissions) VALUES
 ('50000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','Agent','hash-engagement-agent',ARRAY['read','write']),
 ('50000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','Reader','hash-engagement-reader',ARRAY['read']);

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000001',true);

-- 1. CASOS COMPARTILHADOS: expansão do cronograma, centavo por centavo.
DO $$
DECLARE
 v jsonb;
 v_amounts numeric[];
BEGIN
 -- divisão 50/50 de 1000
 SELECT array_agg((e->>'amount')::numeric ORDER BY (e->>'position')::int) INTO v_amounts
   FROM jsonb_array_elements(expand_engagement_schedule('percent_split',1000,'[{"percent":50},{"percent":50}]')) e;
 IF v_amounts <> ARRAY[500,500]::numeric[] THEN RAISE EXCEPTION 'A divisão 50/50 de 1000 resultou em %', v_amounts; END IF;

 -- divisão 30/70 de 999,99: o arredondamento fica na última parcela
 SELECT array_agg((e->>'amount')::numeric ORDER BY (e->>'position')::int) INTO v_amounts
   FROM jsonb_array_elements(expand_engagement_schedule('percent_split',999.99,'[{"percent":30},{"percent":70}]')) e;
 IF v_amounts <> ARRAY[300.00,699.99]::numeric[] THEN RAISE EXCEPTION 'A divisão 30/70 de 999,99 resultou em %', v_amounts; END IF;

 -- três parcelas percentuais de 100
 SELECT array_agg((e->>'amount')::numeric ORDER BY (e->>'position')::int) INTO v_amounts
   FROM jsonb_array_elements(expand_engagement_schedule('percent_split',100,'[{"percent":33.33},{"percent":33.33},{"percent":33.34}]')) e;
 IF v_amounts <> ARRAY[33.33,33.33,33.34]::numeric[] THEN RAISE EXCEPTION 'As três parcelas percentuais de 100 resultaram em %', v_amounts; END IF;

 -- 3 parcelas iguais de 100
 SELECT array_agg((e->>'amount')::numeric ORDER BY (e->>'position')::int) INTO v_amounts
   FROM jsonb_array_elements(expand_engagement_schedule('equal_installments',100,'[]',3)) e;
 IF v_amounts <> ARRAY[33.33,33.33,33.34]::numeric[] THEN RAISE EXCEPTION 'As 3 parcelas iguais de 100 resultaram em %', v_amounts; END IF;

 -- 3 parcelas iguais de 1000
 SELECT array_agg((e->>'amount')::numeric ORDER BY (e->>'position')::int) INTO v_amounts
   FROM jsonb_array_elements(expand_engagement_schedule('equal_installments',1000,'[]',3)) e;
 IF v_amounts <> ARRAY[333.33,333.33,333.34]::numeric[] THEN RAISE EXCEPTION 'As 3 parcelas iguais de 1000 resultaram em %', v_amounts; END IF;

 -- 7 parcelas iguais de 100
 SELECT array_agg((e->>'amount')::numeric ORDER BY (e->>'position')::int) INTO v_amounts
   FROM jsonb_array_elements(expand_engagement_schedule('equal_installments',100,'[]',7)) e;
 IF v_amounts <> ARRAY[14.29,14.29,14.29,14.29,14.29,14.29,14.26]::numeric[] THEN RAISE EXCEPTION 'As 7 parcelas iguais de 100 resultaram em %', v_amounts; END IF;

 -- 10 parcelas iguais de 1000,05: cada meio centavo arredonda para cima e a última parcela absorve a diferença
 SELECT array_agg((e->>'amount')::numeric ORDER BY (e->>'position')::int) INTO v_amounts
   FROM jsonb_array_elements(expand_engagement_schedule('equal_installments',1000.05,'[]',10)) e;
 IF v_amounts <> ARRAY[100.01,100.01,100.01,100.01,100.01,100.01,100.01,100.01,100.01,99.96]::numeric[]
   THEN RAISE EXCEPTION 'As 10 parcelas iguais de 1000,05 resultaram em %', v_amounts; END IF;

 -- 10 parcelas iguais de 0,10
 SELECT array_agg((e->>'amount')::numeric ORDER BY (e->>'position')::int) INTO v_amounts
   FROM jsonb_array_elements(expand_engagement_schedule('equal_installments',0.1,'[]',10)) e;
 IF v_amounts <> ARRAY[0.01,0.01,0.01,0.01,0.01,0.01,0.01,0.01,0.01,0.01]::numeric[]
   THEN RAISE EXCEPTION 'As 10 parcelas iguais de 0,10 resultaram em %', v_amounts; END IF;

 -- Regras de vencimento padrão: início, marcos intermediários e conclusão no final.
 v := expand_engagement_schedule('equal_installments',400,'[]',4);
 IF (v->0->>'due_rule')<>'on_start' OR (v->1->>'due_rule')<>'on_milestone'
    OR (v->2->>'due_rule')<>'on_milestone' OR (v->3->>'due_rule')<>'on_complete'
   THEN RAISE EXCEPTION 'As regras de vencimento padrão foram alteradas: %', v; END IF;
 IF (v->0->>'label')<>'Installment 1 of 4' THEN RAISE EXCEPTION 'As parcelas sem rótulo perderam seus nomes: %', v; END IF;

 -- Uma única parcela vence na conclusão; um contrato manual aguarda uma ação humana.
 IF (expand_engagement_schedule('milestones',400,'[{"amount":400}]')->0->>'due_rule')<>'on_complete'
   THEN RAISE EXCEPTION 'Uma única parcela não vence na conclusão'; END IF;
 IF (expand_engagement_schedule('manual',400,'[{"amount":100},{"amount":300}]')->0->>'due_rule')<>'manual'
   THEN RAISE EXCEPTION 'Um contrato manual foi liberado automaticamente'; END IF;

 -- A data só se aplica a uma parcela com vencimento on_date.
 v := expand_engagement_schedule('milestones',100,'[{"amount":100,"due_rule":"on_complete","due_on":"2026-10-01"}]');
 IF (v->0->>'due_on') IS NOT NULL THEN RAISE EXCEPTION 'Uma data antiga permaneceu em uma parcela sem vencimento por data'; END IF;
 v := expand_engagement_schedule('milestones',100,'[{"amount":100,"due_rule":"on_date","due_on":"2026-10-01"}]');
 IF (v->0->>'due_on')<>'2026-10-01' THEN RAISE EXCEPTION 'Uma parcela com vencimento por data perdeu a data'; END IF;
END $$;

-- 2. CASOS COMPARTILHADOS: cada recusa, com o mesmo código lançado pelo TypeScript.
DO $$
DECLARE
 v_case record;
BEGIN
 FOR v_case IN SELECT * FROM (VALUES
   ('percent_must_total_100','percent_split',1000::numeric,'[{"percent":30},{"percent":60}]'::jsonb,NULL::int),
   ('invalid_percent','percent_split',1000,'[{"percent":100},{}]',NULL),
   ('entries_must_total_engagement','milestones',10000,'[{"amount":2500},{"amount":2500}]',NULL),
   ('entry_amount_required','milestones',100,'[{"label":"Kickoff"}]',NULL),
   ('invalid_total','equal_installments',0,'[]',2),
   ('invalid_total','equal_installments',-100,'[]',2),
   ('invalid_installments','equal_installments',100,'[]',NULL),
   ('invalid_installments','equal_installments',100,'[]',101),
   ('entries_required','milestones',100,'[]',NULL),
   ('due_on_required','milestones',100,'[{"amount":100,"due_rule":"on_date"}]',NULL),
   ('invalid_entry_amount','equal_installments',0.01,'[]',3),
   ('invalid_billing_mode','retainer',100,'[]',2)
 ) AS t(code,mode,total,entries,installments) LOOP
  BEGIN
   PERFORM expand_engagement_schedule(v_case.mode,v_case.total,v_case.entries,v_case.installments);
   RAISE EXCEPTION 'TEST FAILED: esperado % para % %', v_case.code, v_case.mode, v_case.entries;
  EXCEPTION WHEN raise_exception THEN
   IF SQLERRM <> v_case.code THEN RAISE EXCEPTION 'Esperado % mas recebido % para % %', v_case.code, SQLERRM, v_case.mode, v_case.entries; END IF;
  END;
 END LOOP;
END $$;

-- 3. Os modelos de cronograma iniciais são os mesmos fornecidos pelo app
-- (DEFAULT_SCHEDULE_TEMPLATES em src/lib/engagements/schedule.ts).
DO $$
DECLARE v jsonb;
BEGIN
 SELECT schedule_templates INTO v FROM businesses WHERE id='20000000-0000-4000-8000-000000000001';
 IF jsonb_array_length(v)<>4 THEN RAISE EXCEPTION 'Uma nova empresa não recebeu os quatro modelos de cronograma'; END IF;
 IF (SELECT array_agg(t->>'key' ORDER BY ord) FROM jsonb_array_elements(v) WITH ORDINALITY AS x(t,ord))
    <> ARRAY['50_50','30_70','design_build_launch','10_equal']
   THEN RAISE EXCEPTION 'Os modelos iniciais não correspondem aos esperados pelo app: %', v; END IF;
 IF (v->0->'entries'->0->>'percent')<>'50' OR (v->1->'entries'->0->>'percent')<>'30'
   THEN RAISE EXCEPTION 'Os modelos de entrada perderam seus percentuais'; END IF;
 IF (v->2->>'installments')<>'3' OR (v->3->>'installments')<>'10'
   THEN RAISE EXCEPTION 'Os modelos de parcelas perderam suas quantidades'; END IF;
END $$;

-- 4. Criação de um contrato, repetição da solicitação e cronograma gravado.
DO $$
DECLARE
 b uuid:='20000000-0000-4000-8000-000000000001'; c uuid:='30000000-0000-4000-8000-000000000001';
 req uuid:=gen_random_uuid(); r jsonb; eng uuid; s record;
BEGIN
 r:=create_engagement_with_schedule(req,b,c,'Website rebuild',12000,'USD','percent_split',
   '[{"label":"Deposit","percent":50,"due_rule":"on_start"},{"label":"On completion","percent":50,"due_rule":"on_complete"}]');
 eng:=(r->'engagement'->>'id')::uuid;
 PERFORM set_config('billr.engagement',eng::text,true);

 IF (r->'engagement'->>'status')<>'draft' THEN RAISE EXCEPTION 'Um novo contrato não começou como rascunho'; END IF;
 IF (r->'engagement'->>'created_via')<>'web' THEN RAISE EXCEPTION 'Uma gravação pelo navegador não foi registrada como web'; END IF;
 IF jsonb_array_length(r->'entries')<>2 THEN RAISE EXCEPTION 'O cronograma não foi gravado'; END IF;
 IF (r->'entries'->0->>'amount')::numeric<>6000 OR (r->'entries'->1->>'amount')::numeric<>6000
   THEN RAISE EXCEPTION 'A divisão 50/50 não gravou 6000 duas vezes: %', r->'entries'; END IF;
 IF (r->'entries'->0->>'status')<>'pending' THEN RAISE EXCEPTION 'Um contrato em rascunho faturou uma parcela antecipadamente'; END IF;
 IF (r->>'replayed')<>'false' THEN RAISE EXCEPTION 'A primeira chamada foi identificada como repetição'; END IF;

 -- Valores derivados da view.
 SELECT * INTO s FROM engagement_summary WHERE engagement_id=eng;
 IF s.amount_billed<>0 OR s.amount_remaining<>12000 OR s.ready_count<>0
   THEN RAISE EXCEPTION 'O resumo de um contrato recém-criado está incorreto: % % %', s.amount_billed, s.amount_remaining, s.ready_count; END IF;

 -- Uma repetição retorna o mesmo contrato e não cria nada.
 r:=create_engagement_with_schedule(req,b,c,'Website rebuild',12000,'USD','percent_split',
   '[{"label":"Deposit","percent":50,"due_rule":"on_start"},{"label":"On completion","percent":50,"due_rule":"on_complete"}]');
 IF (r->'engagement'->>'id')::uuid<>eng THEN RAISE EXCEPTION 'Uma repetição criou um segundo contrato'; END IF;
 IF (r->>'replayed')<>'true' THEN RAISE EXCEPTION 'A repetição não foi identificada como tal'; END IF;
 IF (SELECT COUNT(*) FROM engagements WHERE business_id=b)<>1 THEN RAISE EXCEPTION 'A repetição gravou uma segunda linha'; END IF;

 -- O mesmo request id com dados diferentes gera um erro, não uma segunda gravação.
 BEGIN
  PERFORM create_engagement_with_schedule(req,b,c,'Website rebuild',24000,'USD','percent_split',
    '[{"percent":50},{"percent":50}]');
  RAISE EXCEPTION 'TEST FAILED: um request id foi reutilizado com dados diferentes';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'request_id_reused' THEN RAISE; END IF; END;

 -- O cliente de outra organização não pode ser acessado, e a resposta não revela sua existência.
 BEGIN
  PERFORM create_engagement_with_schedule(gen_random_uuid(),b,'30000000-0000-4000-8000-000000000002','Cross tenant',100,'USD','equal_installments','[]',2);
  RAISE EXCEPTION 'TEST FAILED: foi criado um contrato para o cliente de outra empresa';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'client_not_found' THEN RAISE; END IF; END;

 -- Um cronograma cuja soma não fecha nunca chega à tabela.
 BEGIN
  PERFORM create_engagement_with_schedule(gen_random_uuid(),b,c,'Bad split',1000,'USD','percent_split','[{"percent":30},{"percent":30}]');
  RAISE EXCEPTION 'TEST FAILED: foi aceita uma divisão percentual cuja soma não fecha';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'percent_must_total_100' THEN RAISE; END IF; END;
END $$;

-- 5. O cronograma precisa fechar: o gatilho de validação diferida do saldo.
DO $$
DECLARE eng uuid:=current_setting('billr.engagement')::uuid; v_entry uuid;
BEGIN
 SELECT id INTO v_entry FROM engagement_entries WHERE engagement_id=eng ORDER BY position LIMIT 1;

 -- Alterar o valor de uma parcela desequilibra o contrato, e a verificação no commit
 -- (forçada aqui com SET CONSTRAINTS) deve rejeitar a alteração.
 BEGIN
  UPDATE engagement_entries SET amount=7000 WHERE id=v_entry;
  SET CONSTRAINTS ALL IMMEDIATE;
  RAISE EXCEPTION 'TEST FAILED: uma parcela foi alterada e o cronograma ficou desequilibrado';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'engagement_schedule_unbalanced' THEN RAISE; END IF; END;

 -- Excluir uma parcela também desequilibra o contrato.
 BEGIN
  DELETE FROM engagement_entries WHERE id=v_entry;
  SET CONSTRAINTS ALL IMMEDIATE;
  RAISE EXCEPTION 'TEST FAILED: uma parcela foi excluída e o cronograma ficou desequilibrado';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'engagement_schedule_unbalanced' THEN RAISE; END IF; END;

 -- Alterar o total sem ajustar o cronograma também deve ser rejeitado.
 BEGIN
  UPDATE engagements SET total=13000 WHERE id=eng;
  SET CONSTRAINTS ALL IMMEDIATE;
  RAISE EXCEPTION 'TEST FAILED: o total foi alterado sem ajustar o cronograma';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'engagement_schedule_unbalanced' THEN RAISE; END IF; END;

 -- É permitido reescrever todo o cronograma dentro de uma transação: é por isso
 -- que a validação do gatilho é diferida, e não feita a cada linha.
 UPDATE engagement_entries SET amount=5000 WHERE id=v_entry;
 UPDATE engagement_entries SET amount=7000 WHERE engagement_id=eng AND id<>v_entry;
 SET CONSTRAINTS ALL IMMEDIATE;
 IF (SELECT SUM(amount) FROM engagement_entries WHERE engagement_id=eng)<>12000
   THEN RAISE EXCEPTION 'A soma do cronograma reescrito não fecha'; END IF;
 -- Restaura os valores originais.
 UPDATE engagement_entries SET amount=6000 WHERE engagement_id=eng;
 SET CONSTRAINTS ALL IMMEDIATE;

 -- Duas parcelas não podem ocupar a mesma posição.
 BEGIN
  UPDATE engagement_entries SET position=0 WHERE engagement_id=eng AND position=1;
  RAISE EXCEPTION 'TEST FAILED: duas parcelas ocupam a mesma posição';
 EXCEPTION WHEN unique_violation THEN NULL; END;

 -- Devolve a verificação do saldo ao momento do commit para o restante deste arquivo:
 -- SET CONSTRAINTS vale para toda a transação; se permanecesse imediato,
 -- seria impossível gravar o cronograma linha por linha nos testes seguintes.
 SET CONSTRAINTS ALL DEFERRED;
END $$;

-- 6. Ciclo de vida: ativar libera a entrada, concluir um marco libera sua parcela,
-- e concluir o contrato libera o restante e informa o saldo.
DO $$
DECLARE
 b uuid:='20000000-0000-4000-8000-000000000001'; c uuid:='30000000-0000-4000-8000-000000000001';
 eng uuid; r jsonb; e1 uuid; e2 uuid; e3 uuid; s record;
BEGIN
 r:=create_engagement_with_schedule(gen_random_uuid(),b,c,'Brand refresh',9000,'USD','milestones',
   '[{"label":"Kickoff","amount":3000,"due_rule":"on_start"},
     {"label":"Concepts","amount":3000,"due_rule":"on_milestone"},
     {"label":"Handover","amount":3000,"due_rule":"on_complete"}]');
 eng:=(r->'engagement'->>'id')::uuid;
 SELECT id INTO e1 FROM engagement_entries WHERE engagement_id=eng AND position=0;
 SELECT id INTO e2 FROM engagement_entries WHERE engagement_id=eng AND position=1;
 SELECT id INTO e3 FROM engagement_entries WHERE engagement_id=eng AND position=2;
 PERFORM set_config('billr.lifecycle',eng::text,true);

 -- Iniciar o trabalho deixa a entrada inicial pronta para faturar, e nenhuma outra.
 r:=set_engagement_status(gen_random_uuid(),eng,'active');
 IF (SELECT status FROM engagement_entries WHERE id=e1)<>'ready_to_bill' THEN RAISE EXCEPTION 'Iniciar o contrato não liberou a entrada inicial'; END IF;
 IF (SELECT status FROM engagement_entries WHERE id=e2)<>'pending' THEN RAISE EXCEPTION 'Iniciar o contrato liberou um marco antes da hora'; END IF;
 IF jsonb_array_length(r->'promoted_entry_ids')<>1 THEN RAISE EXCEPTION 'As parcelas liberadas não foram informadas'; END IF;

 -- A conclusão do marco deixa essa parcela pronta para faturar.
 r:=mark_entry_complete(gen_random_uuid(),e2);
 IF (r->>'became_ready_to_bill')<>'true' THEN RAISE EXCEPTION 'Um marco concluído não ficou pronto para faturar'; END IF;
 IF (SELECT status FROM engagement_entries WHERE id=e2)<>'ready_to_bill' THEN RAISE EXCEPTION 'A parcela do marco não está pronta para faturar'; END IF;
 IF (SELECT completed_at FROM engagement_entries WHERE id=e2) IS NULL THEN RAISE EXCEPTION 'O marco não foi marcado como concluído'; END IF;

 -- Uma parcela com regra de conclusão mantém sua regra: marcá-la como concluída registra
 -- o fato sem alterar o cronograma.
 r:=mark_entry_complete(gen_random_uuid(),e3);
 IF (r->>'became_ready_to_bill')<>'false' THEN RAISE EXCEPTION 'Uma parcela on_complete foi liberada manualmente'; END IF;
 IF (SELECT status FROM engagement_entries WHERE id=e3)<>'pending' THEN RAISE EXCEPTION 'Uma parcela on_complete saiu de pendente antes da hora'; END IF;

 SELECT * INTO s FROM engagement_summary WHERE engagement_id=eng;
 IF s.ready_count<>2 OR s.ready_amount<>6000 THEN RAISE EXCEPTION 'O resumo de parcelas prontas para faturar está incorreto: % %', s.ready_count, s.ready_amount; END IF;
 IF jsonb_array_length(s.next_ready_entries)<>2 THEN RAISE EXCEPTION 'next_ready_entries não lista os itens prontos para faturar'; END IF;

 -- Concluir o contrato libera o restante e avisa sobre valores ainda não faturados.
 r:=set_engagement_status(gen_random_uuid(),eng,'completed');
 IF (SELECT status FROM engagement_entries WHERE id=e3)<>'ready_to_bill' THEN RAISE EXCEPTION 'A conclusão não liberou a parcela final'; END IF;
 IF (r->>'amount_remaining')::numeric<>9000 THEN RAISE EXCEPTION 'A conclusão informou incorretamente o saldo restante'; END IF;
 IF r->>'warning' IS NULL THEN RAISE EXCEPTION 'A conclusão não alertou sobre valores ainda não faturados'; END IF;

 -- Um contrato encerrado permanece encerrado.
 BEGIN
  PERFORM set_engagement_status(gen_random_uuid(),eng,'active');
  RAISE EXCEPTION 'TEST FAILED: um contrato concluído foi reaberto';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'engagement_closed' THEN RAISE; END IF; END;
END $$;

-- 7. Renúncia de valores e efeito sobre o saldo restante.
DO $$
DECLARE
 eng uuid:=current_setting('billr.lifecycle')::uuid; e3 uuid; r jsonb; req uuid:=gen_random_uuid(); s record;
BEGIN
 SELECT id INTO e3 FROM engagement_entries WHERE engagement_id=eng AND position=2;

 BEGIN
  PERFORM waive_entry(gen_random_uuid(),e3,'   ');
  RAISE EXCEPTION 'TEST FAILED: foi aberta mão de um valor sem informar o motivo';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'waive_reason_required' THEN RAISE; END IF; END;

 r:=waive_entry(req,e3,'Client absorbed the handover work');
 IF (r->'entry'->>'status')<>'waived' THEN RAISE EXCEPTION 'A parcela não foi marcada como dispensada'; END IF;
 SELECT * INTO s FROM engagement_summary WHERE engagement_id=eng;
 IF s.amount_waived<>3000 OR s.amount_remaining<>6000
   THEN RAISE EXCEPTION 'O valor dispensado não foi retirado do saldo restante: % %', s.amount_waived, s.amount_remaining; END IF;
 IF (SELECT SUM(amount) FROM engagement_entries WHERE engagement_id=eng)<>9000
   THEN RAISE EXCEPTION 'A renúncia alterou o cronograma acordado'; END IF;

 -- Repetições retornam a resposta original, sem registrar outra renúncia.
 IF (waive_entry(req,e3,'Client absorbed the handover work')->>'replayed')<>'true'
   THEN RAISE EXCEPTION 'A repetição da renúncia não foi identificada como tal'; END IF;
 BEGIN
  PERFORM waive_entry(gen_random_uuid(),e3,'Second waiver');
  RAISE EXCEPTION 'TEST FAILED: uma parcela foi dispensada duas vezes';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'entry_waived' THEN RAISE; END IF; END;
END $$;

-- 8. Valor faturado permanece faturado: uma parcela vinculada a uma fatura fica bloqueada e não pode ser excluída.
DO $$
DECLARE
 b uuid:='20000000-0000-4000-8000-000000000001'; c uuid:='30000000-0000-4000-8000-000000000001';
 eng uuid:=current_setting('billr.lifecycle')::uuid; e1 uuid; inv jsonb; s record;
BEGIN
 SELECT id INTO e1 FROM engagement_entries WHERE engagement_id=eng AND position=0;
 inv:=create_invoice_document(b,c,'{}','[{"description":"Kickoff","quantity":1,"rate":3000}]',gen_random_uuid());

 -- Este é o vínculo que create_invoice, na parte B, gravará.
 UPDATE engagement_entries SET status='invoiced', invoice_id=(inv->>'id')::uuid WHERE id=e1;

 SELECT * INTO s FROM engagement_summary WHERE engagement_id=eng;
 IF s.amount_billed<>3000 OR s.amount_remaining<>3000
   THEN RAISE EXCEPTION 'O valor faturado não foi contabilizado: % %', s.amount_billed, s.amount_remaining; END IF;

 BEGIN
  UPDATE engagement_entries SET amount=4000 WHERE id=e1;
  RAISE EXCEPTION 'TEST FAILED: um valor faturado foi alterado';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'entry_invoiced_immutable' THEN RAISE; END IF; END;

 BEGIN
  DELETE FROM engagement_entries WHERE id=e1;
  RAISE EXCEPTION 'TEST FAILED: uma parcela faturada foi excluída';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'entry_invoiced_immutable' THEN RAISE; END IF; END;

 BEGIN
  UPDATE engagement_entries SET invoice_id=NULL, status='pending' WHERE id=e1;
  RAISE EXCEPTION 'TEST FAILED: uma parcela faturada foi desfaturada';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'entry_invoiced_immutable' THEN RAISE; END IF; END;

 BEGIN
  PERFORM waive_entry(gen_random_uuid(),e1,'Trying to waive billed money');
  RAISE EXCEPTION 'TEST FAILED: um valor faturado foi dispensado';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'entry_already_invoiced' THEN RAISE; END IF; END;

 -- Uma parcela não pode indicar que foi faturada sem identificar a fatura.
 BEGIN
  UPDATE engagement_entries SET status='invoiced' WHERE engagement_id=eng AND position=1;
  RAISE EXCEPTION 'TEST FAILED: uma parcela foi faturada sem fatura';
 EXCEPTION WHEN check_violation THEN NULL; END;
END $$;

-- 9. Um contrato cancelado não gera novas cobranças.
DO $$
DECLARE
 b uuid:='20000000-0000-4000-8000-000000000001'; c uuid:='30000000-0000-4000-8000-000000000001';
 eng uuid; e1 uuid; inv jsonb;
BEGIN
 eng:=(create_engagement_with_schedule(gen_random_uuid(),b,c,'Cancelled work',2000,'USD','equal_installments','[]',2)->'engagement'->>'id')::uuid;
 SELECT id INTO e1 FROM engagement_entries WHERE engagement_id=eng AND position=0;
 PERFORM set_engagement_status(gen_random_uuid(),eng,'active');
 PERFORM set_engagement_status(gen_random_uuid(),eng,'cancelled');

 inv:=create_invoice_document(b,c,'{}','[{"description":"Work","quantity":1,"rate":1000}]',gen_random_uuid());
 BEGIN
  UPDATE engagement_entries SET status='invoiced', invoice_id=(inv->>'id')::uuid WHERE id=e1;
  RAISE EXCEPTION 'TEST FAILED: um contrato cancelado foi faturado';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'engagement_cancelled' THEN RAISE; END IF; END;
END $$;

-- 10. Varredura de vencimentos agendados, chamada pelos fluxos de leitura no lugar de um cron.
DO $$
DECLARE
 b uuid:='20000000-0000-4000-8000-000000000001'; c uuid:='30000000-0000-4000-8000-000000000001';
 eng uuid; draft uuid; past uuid; future uuid; r jsonb;
BEGIN
 eng:=(create_engagement_with_schedule(gen_random_uuid(),b,c,'Retainer',2000,'USD','milestones',
   '[{"label":"Month one","amount":1000,"due_rule":"on_date","due_on":"2020-01-01"},
     {"label":"Month two","amount":1000,"due_rule":"on_date","due_on":"2999-01-01"}]')->'engagement'->>'id')::uuid;
 SELECT id INTO past FROM engagement_entries WHERE engagement_id=eng AND position=0;
 SELECT id INTO future FROM engagement_entries WHERE engagement_id=eng AND position=1;

 -- Um contrato em rascunho não gera cobrança sozinho, mesmo que a data já tenha passado.
 r:=promote_due_entries(b);
 IF (SELECT status FROM engagement_entries WHERE id=past)<>'pending' THEN RAISE EXCEPTION 'Um contrato em rascunho liberou uma parcela na varredura'; END IF;

 PERFORM set_engagement_status(gen_random_uuid(),eng,'active');
 r:=promote_due_entries(b);
 IF (SELECT status FROM engagement_entries WHERE id=past)<>'ready_to_bill' THEN RAISE EXCEPTION 'Uma data vencida não deixou a parcela pronta para faturar'; END IF;
 IF (SELECT status FROM engagement_entries WHERE id=future)<>'pending' THEN RAISE EXCEPTION 'Uma data futura foi processada antes da hora'; END IF;
 IF (r->>'promoted')::int<1 THEN RAISE EXCEPTION 'A varredura não informou o que liberou'; END IF;

 -- Executar a varredura novamente não altera nada; por isso, ela não precisa de request id.
 IF (promote_due_entries(b)->>'promoted')::int<>0 THEN RAISE EXCEPTION 'A varredura liberou a mesma parcela duas vezes'; END IF;
END $$;

-- 11. Parte B: faturamento de uma parcela em uma fatura real.
-- A entrada inicial é faturada, o saldo restante fica correto e a parcela final
-- só pode ser faturada uma vez.
DO $$
DECLARE
 b uuid:='20000000-0000-4000-8000-000000000001'; c uuid:='30000000-0000-4000-8000-000000000001';
 eng uuid; deposit uuid; final uuid; inv jsonb; inv2 jsonb; s record; req uuid:=gen_random_uuid();
 line record;
BEGIN
 eng:=(create_engagement_with_schedule(gen_random_uuid(),b,c,'Billed rebuild',10000,'USD','percent_split',
   '[{"label":"Deposit","percent":40,"due_rule":"on_start"},{"label":"On completion","percent":60,"due_rule":"on_complete"}]')
   ->'engagement'->>'id')::uuid;
 SELECT id INTO deposit FROM engagement_entries WHERE engagement_id=eng AND position=0;
 SELECT id INTO final FROM engagement_entries WHERE engagement_id=eng AND position=1;
 PERFORM set_config('billr.billed',eng::text,true);

 -- Um contrato em rascunho não pode ser faturado: o acordo ainda não começou.
 BEGIN
  PERFORM create_invoice_document(b,c,'{}','[]',gen_random_uuid(),'{}','{}',NULL,ARRAY[deposit]);
  RAISE EXCEPTION 'TEST FAILED: um contrato em rascunho foi faturado';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'engagement_not_billable' THEN RAISE; END IF; END;

 PERFORM set_engagement_status(gen_random_uuid(),eng,'active');

 -- A parcela que depende da conclusão ainda não foi liberada.
 BEGIN
  PERFORM create_invoice_document(b,c,'{}','[]',gen_random_uuid(),'{}','{}',NULL,ARRAY[final]);
  RAISE EXCEPTION 'TEST FAILED: uma parcela foi faturada antes de sua regra ser acionada';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'engagement_entry_not_ready' THEN RAISE; END IF; END;

 -- Fatura a entrada inicial: uma linha, no valor da parcela, identificada com o contrato.
 inv:=create_invoice_document(b,c,'{}','[]',req,'{}','{}',NULL,ARRAY[deposit]);
 IF (inv->>'total')::numeric<>4000 THEN RAISE EXCEPTION 'O total da fatura da entrada inicial é %', inv->>'total'; END IF;
 IF (SELECT COUNT(*) FROM invoice_line_items WHERE invoice_id=(inv->>'id')::uuid)<>1
   THEN RAISE EXCEPTION 'Faturar uma parcela não criou exatamente uma linha'; END IF;
 SELECT * INTO line FROM invoice_line_items WHERE invoice_id=(inv->>'id')::uuid;
 IF line.description<>'Billed rebuild: Deposit' THEN RAISE EXCEPTION 'A linha não foi identificada com o contrato: %', line.description; END IF;
 IF line.quantity<>1 OR line.rate<>4000 THEN RAISE EXCEPTION 'A linha não tem quantidade 1 e o valor da parcela'; END IF;

 -- A parcela agora aponta para a fatura E para a linha exata em que foi lançada.
 IF (SELECT status FROM engagement_entries WHERE id=deposit)<>'invoiced' THEN RAISE EXCEPTION 'A entrada inicial não foi marcada como faturada'; END IF;
 IF (SELECT invoice_id FROM engagement_entries WHERE id=deposit)<>(inv->>'id')::uuid THEN RAISE EXCEPTION 'A entrada inicial não identifica sua fatura'; END IF;
 IF (SELECT invoice_line_id FROM engagement_entries WHERE id=deposit)<>line.id THEN RAISE EXCEPTION 'A entrada inicial não identifica sua linha da fatura'; END IF;

 SELECT * INTO s FROM engagement_summary WHERE engagement_id=eng;
 IF s.amount_billed<>4000 OR s.amount_remaining<>6000
   THEN RAISE EXCEPTION 'O faturamento da entrada inicial deixou um saldo incorreto: % %', s.amount_billed, s.amount_remaining; END IF;

 -- A repetição do MESMO request id retorna a MESMA fatura e não altera
 -- nada: não cria outra fatura nem outro vínculo.
 inv2:=create_invoice_document(b,c,'{}','[]',req,'{}','{}',NULL,ARRAY[deposit]);
 IF (inv2->>'id')<>(inv->>'id') THEN RAISE EXCEPTION 'Uma repetição criou uma segunda fatura'; END IF;
 IF (SELECT COUNT(*) FROM invoice_line_items WHERE invoice_id=(inv->>'id')::uuid)<>1
   THEN RAISE EXCEPTION 'Uma repetição gravou a linha novamente'; END IF;
 IF (SELECT invoice_line_id FROM engagement_entries WHERE id=deposit)<>line.id
   THEN RAISE EXCEPTION 'Uma repetição alterou o vínculo da parcela'; END IF;

 -- Faturá-la novamente com um NOVO request é justamente o objetivo deste recurso.
 BEGIN
  PERFORM create_invoice_document(b,c,'{}','[]',gen_random_uuid(),'{}','{}',NULL,ARRAY[deposit]);
  RAISE EXCEPTION 'TEST FAILED: uma parcela foi faturada duas vezes';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'engagement_entry_already_invoiced' THEN RAISE; END IF; END;

 -- A parcela final é liberada na conclusão e então faturada uma vez, pelo saldo restante.
 PERFORM set_engagement_status(gen_random_uuid(),eng,'completed');
 inv2:=create_invoice_document(b,c,'{}','[]',gen_random_uuid(),'{}','{}',NULL,ARRAY[final]);
 IF (inv2->>'total')::numeric<>6000 THEN RAISE EXCEPTION 'O total da fatura final é %', inv2->>'total'; END IF;
 SELECT * INTO s FROM engagement_summary WHERE engagement_id=eng;
 IF s.amount_billed<>10000 OR s.amount_remaining<>0
   THEN RAISE EXCEPTION 'O contrato não foi faturado até zerar o saldo: % %', s.amount_billed, s.amount_remaining; END IF;

 -- Enviar a fatura não altera a parcela.
 UPDATE invoices SET status='sent' WHERE id=(inv2->>'id')::uuid;
 IF (SELECT status FROM engagement_entries WHERE id=final)<>'invoiced'
   THEN RAISE EXCEPTION 'O envio da fatura alterou a parcela'; END IF;
END $$;

-- 12. Parte B: situações que create_invoice deve rejeitar.
DO $$
DECLARE
 b uuid:='20000000-0000-4000-8000-000000000001'; c uuid:='30000000-0000-4000-8000-000000000001';
 eng uuid; other_eng uuid; entry uuid; other_entry uuid; manual_entry uuid; other_client uuid;
 cancelled_eng uuid; cancelled_entry uuid; inv jsonb;
BEGIN
 INSERT INTO clients(id,business_id,name,currency) VALUES (gen_random_uuid(),b,'Second client','USD')
 RETURNING id INTO other_client;

 eng:=(create_engagement_with_schedule(gen_random_uuid(),b,c,'Refusals',1000,'USD','equal_installments','[]',2,'active')
   ->'engagement'->>'id')::uuid;
 SELECT id INTO entry FROM engagement_entries WHERE engagement_id=eng AND position=0;

 -- O cronograma de outro cliente não pode ser faturado para este cliente.
 other_eng:=(create_engagement_with_schedule(gen_random_uuid(),b,other_client,'Other client work',500,'USD','equal_installments','[]',1,'active')
   ->'engagement'->>'id')::uuid;
 SELECT id INTO other_entry FROM engagement_entries WHERE engagement_id=other_eng AND position=0;
 UPDATE engagement_entries SET status='ready_to_bill' WHERE id=other_entry;
 BEGIN
  PERFORM create_invoice_document(b,c,'{}','[]',gen_random_uuid(),'{}','{}',NULL,ARRAY[other_entry]);
  RAISE EXCEPTION 'TEST FAILED: uma parcela foi faturada para o cliente errado';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'engagement_entry_client_mismatch' THEN RAISE; END IF; END;

 -- Uma moeda diferente da fatura é rejeitada, não convertida.
 BEGIN
  PERFORM create_invoice_document(b,c,'{"currency":"EUR"}','[]',gen_random_uuid(),'{}','{}',NULL,ARRAY[entry]);
  RAISE EXCEPTION 'TEST FAILED: um contrato foi faturado em outra moeda';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'engagement_entry_currency_mismatch' THEN RAISE; END IF; END;

 -- Enviar a mesma parcela duas vezes na chamada é erro, não deve gerar duas linhas.
 BEGIN
  PERFORM create_invoice_document(b,c,'{}','[]',gen_random_uuid(),'{}','{}',NULL,ARRAY[entry,entry]);
  RAISE EXCEPTION 'TEST FAILED: uma parcela foi faturada duas vezes na mesma fatura';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'duplicate_engagement_entry_ids' THEN RAISE; END IF; END;

 -- Uma parcela inexistente e a parcela de outra organização devem receber a mesma resposta.
 BEGIN
  PERFORM create_invoice_document(b,c,'{}','[]',gen_random_uuid(),'{}','{}',NULL,ARRAY['40000000-0000-4000-8000-0000000000fe'::uuid]);
  RAISE EXCEPTION 'TEST FAILED: uma parcela inexistente foi faturada';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'engagement_entry_not_found' THEN RAISE; END IF; END;

 -- Este fluxo também não pode cobrar um contrato cancelado.
 cancelled_eng:=(create_engagement_with_schedule(gen_random_uuid(),b,c,'Cancelled billing',800,'USD','equal_installments','[]',2,'active')
   ->'engagement'->>'id')::uuid;
 SELECT id INTO cancelled_entry FROM engagement_entries WHERE engagement_id=cancelled_eng AND position=0;
 PERFORM set_engagement_status(gen_random_uuid(),cancelled_eng,'cancelled');
 BEGIN
  PERFORM create_invoice_document(b,c,'{}','[]',gen_random_uuid(),'{}','{}',NULL,ARRAY[cancelled_entry]);
  RAISE EXCEPTION 'TEST FAILED: um contrato cancelado foi faturado';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'engagement_not_billable' THEN RAISE; END IF; END;

 -- Uma parcela manual pode ser faturada ainda pendente: emitir a fatura É a
 -- decisão humana que a regra de vencimento aguardava.
 manual_entry:=(create_engagement_with_schedule(gen_random_uuid(),b,c,'Manual work',600,'USD','manual',
   '[{"label":"When we agree","amount":600}]',NULL,'active')->'entries'->0->>'id')::uuid;
 IF (SELECT status FROM engagement_entries WHERE id=manual_entry)<>'pending'
   THEN RAISE EXCEPTION 'Uma parcela manual foi liberada automaticamente'; END IF;
 inv:=create_invoice_document(b,c,'{}','[]',gen_random_uuid(),'{}','{}',NULL,ARRAY[manual_entry]);
 IF (SELECT status FROM engagement_entries WHERE id=manual_entry)<>'invoiced'
   THEN RAISE EXCEPTION 'Não foi possível faturar uma parcela manual'; END IF;

 -- Parcelas e itens avulsos podem compartilhar a mesma fatura.
 inv:=create_invoice_document(b,c,'{}','[{"description":"Extra work","quantity":2,"rate":50}]',
   gen_random_uuid(),'{}','{}',NULL,ARRAY[entry]);
 IF (SELECT COUNT(*) FROM invoice_line_items WHERE invoice_id=(inv->>'id')::uuid)<>2
   THEN RAISE EXCEPTION 'Uma fatura mista não contém as duas linhas'; END IF;
 IF (inv->>'total')::numeric<>600 THEN RAISE EXCEPTION 'O total da fatura mista é %', inv->>'total'; END IF;
 IF (SELECT invoice_line_id FROM engagement_entries WHERE id=entry)
    <>(SELECT id FROM invoice_line_items WHERE invoice_id=(inv->>'id')::uuid AND sort_order=1)
   THEN RAISE EXCEPTION 'A parcela foi vinculada à linha errada da fatura mista'; END IF;
END $$;

-- 13. Parte B: excluir uma fatura em rascunho libera as parcelas vinculadas, e
-- nenhuma outra ação pode desfaturá-las.
DO $$
DECLARE
 b uuid:='20000000-0000-4000-8000-000000000001'; c uuid:='30000000-0000-4000-8000-000000000001';
 eng uuid; entry uuid; inv jsonb; s record;
BEGIN
 eng:=(create_engagement_with_schedule(gen_random_uuid(),b,c,'Released work',2400,'USD','equal_installments','[]',2,'active')
   ->'engagement'->>'id')::uuid;
 SELECT id INTO entry FROM engagement_entries WHERE engagement_id=eng AND position=0;

 inv:=create_invoice_document(b,c,'{}','[]',gen_random_uuid(),'{}','{}',NULL,ARRAY[entry]);
 SELECT * INTO s FROM engagement_summary WHERE engagement_id=eng;
 IF s.amount_billed<>1200 THEN RAISE EXCEPTION 'A parcela não foi faturada antes do teste de liberação'; END IF;

 -- Não é possível simular o fluxo de liberação de OUTRA fatura.
 BEGIN
  PERFORM set_config('billr.releasing_invoice',gen_random_uuid()::text,true);
  UPDATE engagement_entries SET status='ready_to_bill', invoice_id=NULL, invoice_line_id=NULL WHERE id=entry;
  RAISE EXCEPTION 'TEST FAILED: uma parcela foi liberada em relação à fatura errada';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'entry_invoiced_immutable' THEN RAISE; END IF; END;
 PERFORM set_config('billr.releasing_invoice','',true);

 -- Excluir o RASCUNHO libera a parcela e a devolve a pronta para faturar, não
 -- ao estado anterior: a regra que a liberou para faturamento já foi acionada.
 DELETE FROM invoices WHERE id=(inv->>'id')::uuid;
 IF (SELECT status FROM engagement_entries WHERE id=entry)<>'ready_to_bill'
   THEN RAISE EXCEPTION 'A exclusão do rascunho não liberou a parcela'; END IF;
 IF (SELECT invoice_id FROM engagement_entries WHERE id=entry) IS NOT NULL
    OR (SELECT invoice_line_id FROM engagement_entries WHERE id=entry) IS NOT NULL
   THEN RAISE EXCEPTION 'Uma parcela liberada ainda identifica uma fatura'; END IF;
 SELECT * INTO s FROM engagement_summary WHERE engagement_id=eng;
 IF s.amount_billed<>0 OR s.amount_remaining<>2400
   THEN RAISE EXCEPTION 'Uma parcela liberada não retornou ao saldo restante: % %', s.amount_billed, s.amount_remaining; END IF;

 -- Depois, ela pode ser faturada novamente - esse é o objetivo da liberação.
 inv:=create_invoice_document(b,c,'{}','[]',gen_random_uuid(),'{}','{}',NULL,ARRAY[entry]);
 IF (SELECT status FROM engagement_entries WHERE id=entry)<>'invoiced'
   THEN RAISE EXCEPTION 'Não foi possível faturar novamente uma parcela liberada'; END IF;

 -- Uma fatura ENVIADA não pode ser excluída (guard_document_delete); portanto, o
 -- fluxo de liberação nunca é executado para ela. Mesmo que essa proteção fosse removida,
 -- ON DELETE RESTRICT em engagement_entries.invoice_id ainda impediria a exclusão,
 -- evitando deixar valores faturados sem vínculo, como este bloco verifica.
 UPDATE invoices SET status='sent' WHERE id=(inv->>'id')::uuid;
 BEGIN
  DELETE FROM invoices WHERE id=(inv->>'id')::uuid;
  RAISE EXCEPTION 'TEST FAILED: foi excluída uma fatura enviada com uma parcela faturada';
 EXCEPTION WHEN raise_exception THEN
  IF SQLERRM LIKE 'TEST FAILED%' THEN RAISE; END IF; END;
 IF (SELECT status FROM engagement_entries WHERE id=entry)<>'invoiced'
   THEN RAISE EXCEPTION 'Uma exclusão recusada ainda liberou a parcela'; END IF;
END $$;

-- 14. Parte B: um orçamento aceito se transforma em contrato uma única vez.
DO $$
DECLARE
 b uuid:='20000000-0000-4000-8000-000000000001'; c uuid:='30000000-0000-4000-8000-000000000001';
 est uuid:=gen_random_uuid(); est2 uuid:=gen_random_uuid(); r jsonb; eng uuid; req uuid:=gen_random_uuid();
BEGIN
 INSERT INTO estimates(id,public_id,business_id,client_id,estimate_number,status,issue_date,currency,subtotal,total)
 VALUES (est,'pub-eng-1',b,c,'EST-9001','accepted',CURRENT_DATE,'EUR',7500,7500),
        (est2,'pub-eng-2',b,c,'EST-9002','accepted',CURRENT_DATE,'USD',3000,3000);
 INSERT INTO estimate_line_items(estimate_id,description,quantity,rate,amount,sort_order)
 VALUES (est,'Quoted work',1,7500,7500,0),(est2,'Other quoted work',1,3000,3000,0);

 r:=convert_estimate_to_engagement(req,est,'percent_split',
   '[{"label":"Deposit","percent":50,"due_rule":"on_start"},{"label":"On delivery","percent":50,"due_rule":"on_complete"}]');
 eng:=(r->'engagement'->>'id')::uuid;

 -- O valor acordado e a moeda vêm do orçamento, nunca de quem faz a chamada.
 IF (r->'engagement'->>'total')::numeric<>7500 THEN RAISE EXCEPTION 'A conversão perdeu o total do orçamento: %', r->'engagement'->>'total'; END IF;
 IF (r->'engagement'->>'currency')<>'EUR' THEN RAISE EXCEPTION 'A conversão perdeu a moeda do orçamento: %', r->'engagement'->>'currency'; END IF;
 IF (r->'engagement'->>'client_id')::uuid<>c THEN RAISE EXCEPTION 'A conversão perdeu o cliente'; END IF;
 IF (r->'engagement'->>'source_estimate_id')::uuid<>est THEN RAISE EXCEPTION 'O contrato não referencia o orçamento de origem'; END IF;
 IF (r->'engagement'->>'status')<>'draft' THEN RAISE EXCEPTION 'Um contrato convertido foi iniciado automaticamente'; END IF;
 IF jsonb_array_length(r->'entries')<>2 THEN RAISE EXCEPTION 'O cronograma convertido não foi gravado'; END IF;
 IF (r->'entries'->0->>'amount')::numeric<>3750 THEN RAISE EXCEPTION 'A divisão convertida está incorreta: %', r->'entries'; END IF;
 IF (SELECT SUM(amount) FROM engagement_entries WHERE engagement_id=eng)<>7500
   THEN RAISE EXCEPTION 'A soma do cronograma convertido não corresponde ao orçamento'; END IF;

 -- Uma repetição retorna a resposta original, sem criar outro contrato.
 IF (convert_estimate_to_engagement(req,est,'percent_split',
     '[{"label":"Deposit","percent":50,"due_rule":"on_start"},{"label":"On delivery","percent":50,"due_rule":"on_complete"}]')
     ->>'replayed')<>'true' THEN RAISE EXCEPTION 'A repetição da conversão não foi identificada como tal'; END IF;
 IF (SELECT COUNT(*) FROM engagements WHERE source_estimate_id=est)<>1
   THEN RAISE EXCEPTION 'Uma repetição converteu o orçamento duas vezes'; END IF;

 -- Uma segunda conversão do mesmo orçamento é rejeitada em ambos os fluxos.
 BEGIN
  PERFORM convert_estimate_to_engagement(gen_random_uuid(),est,'equal_installments','[]',2);
  RAISE EXCEPTION 'TEST FAILED: um orçamento gerou dois contratos';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'estimate_already_an_engagement' THEN RAISE; END IF; END;

 BEGIN
  PERFORM convert_estimate_to_invoice(est,'pub-eng-1-inv',CURRENT_DATE,CURRENT_DATE+30,'[{"description":"x","quantity":1,"rate":1,"amount":1}]',7500,7500);
  RAISE EXCEPTION 'TEST FAILED: um orçamento gerou um contrato E uma fatura';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'estimate_already_an_engagement' THEN RAISE; END IF; END;

 -- No sentido inverso: um orçamento já convertido em fatura não pode
 -- também virar um contrato.
 PERFORM convert_estimate_to_invoice(est2,'pub-eng-2-inv',CURRENT_DATE,CURRENT_DATE+30,'[{"description":"x","quantity":1,"rate":1,"amount":1}]',3000,3000);
 BEGIN
  PERFORM convert_estimate_to_engagement(gen_random_uuid(),est2,'equal_installments','[]',2);
  RAISE EXCEPTION 'TEST FAILED: um orçamento faturado também virou contrato';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'estimate_already_converted' THEN RAISE; END IF; END;

 -- E todo o cronograma do contrato convertido pode ser faturado.
 PERFORM set_engagement_status(gen_random_uuid(),eng,'active');
 IF (SELECT status FROM engagement_entries WHERE engagement_id=eng AND position=0)<>'ready_to_bill'
   THEN RAISE EXCEPTION 'Iniciar o contrato convertido não liberou a entrada inicial'; END IF;
END $$;

-- 15. Limite entre organizações, visto pelo proprietário de outra empresa.
RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000002',true);
DO $$
DECLARE eng uuid:=current_setting('billr.engagement')::uuid; e uuid;
BEGIN
 IF (SELECT COUNT(*) FROM engagements)<>0 THEN RAISE EXCEPTION 'Os contratos de outra empresa podem ser lidos'; END IF;
 IF (SELECT COUNT(*) FROM engagement_entries)<>0 THEN RAISE EXCEPTION 'O cronograma de outra empresa pode ser lido'; END IF;
 IF (SELECT COUNT(*) FROM engagement_summary)<>0 THEN RAISE EXCEPTION 'A view de resumo expõe dados entre empresas'; END IF;

 BEGIN
  PERFORM set_engagement_status(gen_random_uuid(),eng,'cancelled');
  RAISE EXCEPTION 'TEST FAILED: foi cancelado um contrato de outra empresa';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'engagement_not_found' THEN RAISE; END IF; END;

 BEGIN
  PERFORM promote_due_entries('20000000-0000-4000-8000-000000000001');
  RAISE EXCEPTION 'TEST FAILED: foi processado o cronograma de outra empresa';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'engagement_not_found' THEN RAISE; END IF; END;

 -- Um contrato inexistente e um contrato de outra pessoa devem retornar a mesma
 -- resposta, impedindo que a resposta seja usada para descobrir IDs.
 BEGIN
  PERFORM set_engagement_status(gen_random_uuid(),'40000000-0000-4000-8000-0000000000ff','cancelled');
  RAISE EXCEPTION 'TEST FAILED: a resposta para um contrato inexistente foi diferente';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'engagement_not_found' THEN RAISE; END IF; END;
END $$;

-- 16. Fluxo do agente: uma chave com permissão de escrita pode gerenciar contratos; uma chave somente de leitura
-- não pode, e uma chave desconhecida também não.
RESET ROLE;
SET LOCAL ROLE service_role;
SELECT set_config('request.jwt.claim.role','service_role',true);
DO $$
DECLARE
 b uuid:='20000000-0000-4000-8000-000000000001'; c uuid:='30000000-0000-4000-8000-000000000001';
 agent uuid:='50000000-0000-4000-8000-000000000001'; reader uuid:='50000000-0000-4000-8000-000000000002';
 r jsonb;
BEGIN
 r:=create_engagement_with_schedule(gen_random_uuid(),b,c,'Agent engagement',1000,'USD','equal_installments','[]',2,
   'draft',NULL,NULL,NULL,NULL,agent);
 IF (r->'engagement'->>'created_via')<>'agent' THEN RAISE EXCEPTION 'Uma gravação do agente não foi identificada como agent'; END IF;
 IF (r->'engagement'->>'created_by_key_id')<>agent::text THEN RAISE EXCEPTION 'A chave usada para gravar não foi registrada'; END IF;

 BEGIN
  PERFORM create_engagement_with_schedule(gen_random_uuid(),b,c,'Read only attempt',1000,'USD','equal_installments','[]',2,
    'draft',NULL,NULL,NULL,NULL,reader);
  RAISE EXCEPTION 'TEST FAILED: uma chave somente de leitura criou um contrato';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'key_cannot_manage_engagements' THEN RAISE; END IF; END;

 -- Uma chave somente de leitura ainda pode executar a varredura, pois ela faz parte da leitura.
 PERFORM promote_due_entries(b,reader);

 BEGIN
  PERFORM create_engagement_with_schedule(gen_random_uuid(),b,c,'No key',1000,'USD','equal_installments','[]',2);
  RAISE EXCEPTION 'TEST FAILED: a função de serviço gravou sem nenhuma chave';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'invalid_actor' THEN RAISE; END IF; END;
END $$;

-- 17. Permissões: anon não acessa nenhuma dessas funções, e authenticated acessa
-- exatamente a superfície pública.
DO $$
BEGIN
 IF has_function_privilege('anon','public.create_engagement_with_schedule(uuid,uuid,uuid,text,numeric,text,text,jsonb,integer,text,date,date,text,uuid,uuid)','EXECUTE')
    OR has_function_privilege('anon','public.set_engagement_status(uuid,uuid,text,uuid)','EXECUTE')
    OR has_function_privilege('anon','public.waive_entry(uuid,uuid,text,uuid)','EXECUTE')
    OR has_function_privilege('anon','public.promote_due_entries(uuid,uuid)','EXECUTE')
    OR has_function_privilege('anon','public.resolve_engagement_actor(uuid,uuid,text)','EXECUTE')
 THEN RAISE EXCEPTION 'Uma função de contrato pode ser chamada por anon'; END IF;
 IF has_table_privilege('anon','public.engagements','SELECT')
    OR has_table_privilege('anon','public.engagement_entries','SELECT')
    OR has_table_privilege('anon','public.engagement_summary','SELECT')
 THEN RAISE EXCEPTION 'anon consegue ler contratos'; END IF;
 IF NOT has_function_privilege('authenticated','public.mark_entry_complete(uuid,uuid,uuid)','EXECUTE')
 THEN RAISE EXCEPTION 'O app não consegue marcar um marco como concluído'; END IF;
END $$;

ROLLBACK;
