/** Exibida sempre que uma conta nova é recusada. Módulo simples, importado pelas páginas do cliente. */
export const SIGNUP_CLOSED_MESSAGE =
  'O cadastro neste Faturador está fechado. Peça à pessoa responsável para permitir seu acesso.'

/**
 * Exibida quando o banco de dados não consegue informar se uma conta pode usar
 * este Faturador. A conta é recusada de qualquer forma, mas a mensagem não diz que
 * o cadastro está fechado, pois isso pode não ser verdade.
 */
export const ACCESS_CHECK_FAILED_MESSAGE =
  'Não foi possível verificar o acesso a esta instalação. Tente novamente daqui a pouco.'
