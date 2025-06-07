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
        customer:customers (
          id,
          name,
          email,
          phone,
          created_at
        ),
        order:orders (
          id,
          order_id,
          customer_id,
          product,
          total,
          created_at,
          review_status
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
    const formattedReviews = reviews.map(review => {
      // Validar que existan los datos del customer y order
      if (!review.customer || !review.order) {
        console.error('Datos incompletos para la review:', review.id);
        return null;
      }

      const customer = Array.isArray(review.customer) ? review.customer[0] : review.customer;
      const order = Array.isArray(review.order) ? review.order[0] : review.order;

      if (!customer || !order) {
        console.error('Datos de customer u order no encontrados para la review:', review.id);
        return null;
      }

      return {
        id: review.id,
        order_id: review.order_id,
        customer_id: review.customer_id,
        rating: review.rating,
        comment: review.comment,
        status: review.status,
        created_at: review.created_at,
        customer: {
          id: customer.id,
          name: customer.name,
          email: customer.email,
          phone: customer.phone,
          created_at: customer.created_at
        },
        order: {
          id: order.id,
          order_id: order.order_id,
          customer_id: order.customer_id,
          product: order.product,
          total: order.total,
          created_at: order.created_at,
          review_status: order.review_status
        }
      };
    }).filter(review => review !== null) as ReviewWithRelations[];

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