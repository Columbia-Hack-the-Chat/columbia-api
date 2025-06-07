// ai/feedbackParser.ts

/**
 * Extrae el comentario del cliente y el puntaje (1 a 5) si está presente.
 * Ejemplo de input: "Hola, todo perfecto. Le doy un 5 ⭐"
 */
export function extraerComentarioYPuntaje(text: string): {
  comment: string
  rating: number | null
} {
  // Busca números del 1 al 5 que estén solos o acompañados de palabras como "estrellas", "/5", etc.
  const regex = /(?:^|\s)([1-5])(?:\s*\/\s*5|\s*estrellas?\b|\b)?(?:\s|$)/i
  const match = text.match(regex)

  const rating = match ? parseInt(match[1]) : null
  const comment = match ? text.replace(match[0], '').trim() : text.trim()

  return { comment, rating }


}

