-- Contas da instalação: a primeira conta passa a ser dona da instalação; depois disso,
-- ninguém novo entra sem autorização do servidor, e uma conta que nunca foi
-- autorizada não pode criar uma empresa nem chamando a RPC diretamente.
BEGIN;
DELETE FROM public.install_accounts;
INSERT INTO auth.users(id,email,created_at) VALUES
 ('60000000-0000-4000-8000-000000000001','first@install.test', now() - interval '1 day'),
 ('60000000-0000-4000-8000-000000000002','second@install.test', now()),
 ('60000000-0000-4000-8000-000000000003','teammate@install.test', now());

DO $$
BEGIN
  IF has_function_privilege('anon', 'public.admit_install_account(uuid, boolean)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.admit_install_account(uuid, boolean)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.install_has_account()', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.install_has_account()', 'EXECUTE') THEN
    RAISE EXCEPTION 'TEST FAILED: uma função de cliente consegue acessar as funções de contas da instalação';
  END IF;
  IF has_table_privilege('anon', 'public.install_accounts', 'SELECT')
     OR has_table_privilege('authenticated', 'public.install_accounts', 'SELECT')
     OR has_table_privilege('authenticated', 'public.install_accounts', 'INSERT') THEN
    RAISE EXCEPTION 'TEST FAILED: uma função de cliente consegue ler ou alterar install_accounts';
  END IF;

  IF public.install_has_account() THEN
    RAISE EXCEPTION 'TEST FAILED: uma instalação vazia informa que já existe uma conta';
  END IF;
  IF public.admit_install_account('60000000-0000-4000-8000-000000000001', false) IS NOT TRUE THEN
    RAISE EXCEPTION 'TEST FAILED: a primeira conta foi recusada';
  END IF;
  IF NOT public.install_has_account() THEN
    RAISE EXCEPTION 'TEST FAILED: o proprietário não foi registrado';
  END IF;
  IF public.admit_install_account('60000000-0000-4000-8000-000000000002', false) IS NOT FALSE THEN
    RAISE EXCEPTION 'TEST FAILED: uma segunda conta entrou com o cadastro fechado';
  END IF;
  IF public.admit_install_account('60000000-0000-4000-8000-000000000001', false) IS NOT TRUE THEN
    RAISE EXCEPTION 'TEST FAILED: o proprietário foi recusado em uma autenticação posterior';
  END IF;
  IF public.admit_install_account('60000000-0000-4000-8000-000000000002', true) IS NOT TRUE THEN
    RAISE EXCEPTION 'TEST FAILED: o cadastro aberto não autorizou uma nova conta';
  END IF;
  IF public.admit_install_account('60000000-0000-4000-8000-000000000002', false) IS NOT TRUE THEN
    RAISE EXCEPTION 'TEST FAILED: uma conta autorizada perdeu acesso quando o cadastro foi fechado novamente';
  END IF;
  IF public.admit_install_account('70000000-0000-4000-8000-000000000009', false) IS NOT NULL THEN
    RAISE EXCEPTION 'TEST FAILED: um usuário desconhecido recebeu uma decisão';
  END IF;
END $$;

-- Um colega adicionado pelo proprietário a uma empresa é autorizado mesmo com o cadastro fechado.
INSERT INTO public.businesses(id,name) VALUES ('61000000-0000-4000-8000-000000000001','Fieldstone Digital');
INSERT INTO public.business_members(business_id,user_id,role) VALUES
 ('61000000-0000-4000-8000-000000000001','60000000-0000-4000-8000-000000000001','owner'),
 ('61000000-0000-4000-8000-000000000001','60000000-0000-4000-8000-000000000003','member');
DO $$
BEGIN
  IF public.admit_install_account('60000000-0000-4000-8000-000000000003', false) IS NOT TRUE THEN
    RAISE EXCEPTION 'TEST FAILED: um membro da empresa foi recusado';
  END IF;
END $$;

-- Uma conta que nunca foi autorizada não pode criar uma empresa.
DELETE FROM public.install_accounts WHERE user_id = '60000000-0000-4000-8000-000000000002';
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims','{"sub":"60000000-0000-4000-8000-000000000002","role":"authenticated"}',true);
DO $$
BEGIN
  BEGIN
    PERFORM public.create_business_with_owner('Not allowed', NULL);
    RAISE EXCEPTION 'TEST FAILED: uma conta recusada criou uma empresa';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'signup_closed' THEN RAISE; END IF;
  END;
END $$;
SELECT set_config('request.jwt.claims','{"sub":"60000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
DO $$
BEGIN
  IF (public.create_business_with_owner('Harbor & Lane Studio', NULL)).name <> 'Harbor & Lane Studio' THEN
    RAISE EXCEPTION 'TEST FAILED: o proprietário não conseguiu criar uma empresa';
  END IF;
END $$;
RESET ROLE;
ROLLBACK;
