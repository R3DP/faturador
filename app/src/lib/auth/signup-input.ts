import { z } from 'zod'

const emailSchema = z.string().trim().min(1).max(320).email()
const passwordSchema = z.string().min(8).max(200)

const signUpInputSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
  fullName: z.string().trim().min(1).max(200),
})

type SignUpInput = z.infer<typeof signUpInputSchema>

export type ParseSignUpInputResult =
  | { success: true; data: SignUpInput }
  | { success: false; error: string }

/**
 * Valida uma solicitação de cadastro antes de qualquer chamada de autenticação.
 */
export function parseSignUpInput(input: unknown): ParseSignUpInputResult {
  const parsed = signUpInputSchema.safeParse(input)
  if (!parsed.success) {
    return {
      success: false,
      error:
        parsed.error.issues[0]?.message ??
        'Confira o formulário e tente novamente.',
    }
  }
  return { success: true, data: parsed.data }
}
