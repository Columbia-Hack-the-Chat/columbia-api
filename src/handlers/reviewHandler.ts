import express from 'express';
import { supabase } from '../db/client.js';
import { ReviewWithRelations } from '../db/types.js';

const router = express.Router();

// Interfaz para la respuesta de reviews
interface ReviewResponse {
  reviews: ReviewWithRelations[];
  total_NPS: number;
}

// Función para calcular el NPS
function calculateNPS(ratings: number[]): number {
  if (ratings.length === 0) return 0;

  const promoters = ratings.filter(rating => rating >= 9).length;
  const detractors = ratings.filter(rating => rating <= 6).length;
  const total = ratings.length;

  return ((promoters - detractors) / total) * 100;
}

// Endpoint para obtener todas las reviews
router.get('/reviews', async (req, res) => {
  try {
    // Obtener todas las reviews que tengan rating o comment
    const { data: reviews, error: reviewsError } = await supabase
      .from('reviews')
      .select(`
        id,
        order_id,
        customer_id,
        rating,
        comment,
        status,
        created_at,
        customer:customers!inner (
          name,
          email
        ),
        order:orders!inner (
          order_id,
          total
        )
      `)
      .not('rating', 'is', null)
      .or('comment.not.is.null')
      .order('created_at', { ascending: false });

    if (reviewsError) {
      console.error('Error al obtener las reviews:', reviewsError);
      return res.status(500).json({
        error: 'Error al obtener las reviews'
      });
    }

    // Transformar la respuesta para asegurar el formato correcto
    const formattedReviews = reviews.map(review => ({
      ...review,
      customer: review.customer[0],
      order: review.order[0]
    }));

    // Calcular el NPS
    const ratings = formattedReviews
      .filter(review => review.rating !== null)
      .map(review => review.rating);
    
    const total_NPS = calculateNPS(ratings);

    // Construir la respuesta
    const response: ReviewResponse = {
      reviews: formattedReviews,
      total_NPS
    };

    return res.status(200).json(response);

  } catch (error) {
    console.error('Error en el endpoint de reviews:', error);
    return res.status(500).json({
      error: 'Error interno del servidor'
    });
  }
});

export default router; 