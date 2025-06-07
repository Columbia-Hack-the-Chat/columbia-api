// ai/feedbackParser.ts
import { generateJsonResponse } from './openai.js';
import { config } from '../config/index.js';

/**
 * Extrae inteligentemente el comentario y puntaje usando IA
 * Maneja casos complejos como:
 * - "Quería dar 5 pero merece 2"
 * - "Producto 4/5, servicio 2/5"
 * - "⭐⭐⭐⭐⭐ (excelente)"
 */
export async function extraerComentarioYPuntajeConIA(text: string): Promise<{
  comment: string;
  rating: number | null;
}> {
  // Si la IA está desactivada, usa el parser básico
  if (!config.bot.aiEnabled) {
    return extraerComentarioYPuntaje(text);
  }

  try {
    const systemPrompt = `
    Eres un analizador de feedback especializado. Tu única tarea es:
    1. Identificar el puntaje REAL (0-5) que el cliente quiere dar
    2. Extraer el comentario principal

    Reglas estrictas:
    - Si hay múltiples puntajes, usar el MENOR
    - Si el cliente cambia de opinión (ej: "quería 5 pero doy 3"), usar la FINAL
    - Ignorar puntajes hipotéticos sin confirmación
    - Si no hay puntaje claro, usar null
    - Respuesta DEBE ser SOLO JSON válido: {"rating": number|null, "comment": string}

    Ejemplos correctos:
    {"rating": 4, "comment": "Buen producto"}
    {"rating": null, "comment": "El servicio fue regular"}
    `;

    const userPrompt = `Analiza este texto y responde en formato JSON: "${text}"`;

    const aiResponse = await generateJsonResponse(userPrompt, systemPrompt);
    
    // Limpieza básica de la respuesta
    const cleanResponse = aiResponse
      .replace(/```json/g, '')
      .replace(/```/g, '')
      .trim();

    try {
      const result = JSON.parse(cleanResponse);
      
      // Validación y normalización del resultado
      return {
        rating: isValidRating(result.rating) ? Math.min(5, Math.max(1, Number(result.rating))) : null,
        comment: result.comment ? cleanComment(result.comment) : cleanComment(text)
      };
    } catch (e) {
      console.error('Error parsing AI response:', aiResponse);
      return fallbackParser(text);
    }
  } catch (error) {
    console.error('Error in AI analysis:', error);
    return fallbackParser(text);
  }
}

// Helper functions
function isValidRating(rating: any): boolean {
  return rating !== null && rating !== undefined && !isNaN(rating) && rating >= 1 && rating <= 5;
}

function cleanComment(comment: string): string {
  return comment
    .replace(/[1-5]\/5|\b[1-5]\b|⭐/g, '') // Elimina puntajes residuales
    .replace(/\s{2,}/g, ' ')                // Elimina espacios múltiples
    .trim();
}

// Parser tradicional mejorado
function fallbackParser(text: string): {
  comment: string;
  rating: number | null;
} {
  // Busca el último número mencionado (más probable sea el real)
  const ratingMatches = [...text.matchAll(/(?:^|\s)([1-5])(?:\s*\/\s*5|\s*estrellas?\b|⭐|\b)/gi)];
  const lastRatingMatch = ratingMatches[ratingMatches.length - 1];
  
  const rating = lastRatingMatch ? parseInt(lastRatingMatch[1]) : null;
  
  return {
    rating,
    comment: rating ? cleanComment(text.replace(lastRatingMatch[0], '')) : cleanComment(text)
  };
}

// Versión básica exportada
export function extraerComentarioYPuntaje(text: string): {
  comment: string;
  rating: number | null;
} {
  return fallbackParser(text);
}