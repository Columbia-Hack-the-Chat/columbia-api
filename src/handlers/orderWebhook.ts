import express from 'express';
import dotenv from 'dotenv';
import { getSocket } from '../socket/manager.js';
import { supabase } from '../db/client.js';
import { Customer, Order } from '../db/types.js';

dotenv.config();

const router = express.Router();

// Interfaz para la estructura de la orden
interface OrderData {
  orderId: string;
  customer: {
    email: string;
    name: string;
    phone: string;
  };
  product: string[];
  total: number;
  createdAt: string;
  reviewStatus: string;
}

// Utilidad para enviar mensajes por WhatsApp
async function sendWhatsAppMessage(phone: string, message: string) {
  const sock = getSocket();
  if (!sock) {
    throw new Error('Socket de WhatsApp no está disponible');
  }

  const formattedPhone = phone.replace(/\D/g, '') + '@s.whatsapp.net';

  try {
    await sock.sendMessage(formattedPhone, { text: message });
    console.log(`Mensaje enviado exitosamente a ${phone}`);
  } catch (error) {
    console.error('Error al enviar mensaje de WhatsApp:', error);
    throw error;
  }
}

// Ruta del webhook
router.post('/webhook/order', async (req, res) => {
  try {
    const orderData: OrderData = req.body;

    if (!orderData.orderId || !orderData.customer.phone) {
      return res.status(400).json({ error: 'Faltan datos requeridos: orderId o phone' });
    }

    // Buscar si el cliente ya existe
    const { data: existingCustomer, error: findError } = await supabase
      .from('customers')
      .select('*')
      .eq('phone', orderData.customer.phone)
      .maybeSingle();

    let customerId: number;

    if (findError) {
      console.error('Error al buscar cliente:', findError);
      return res.status(500).json({ error: 'Error al verificar el cliente existente' });
    }

    if (existingCustomer) {
      customerId = existingCustomer.id;
    } else {
      // Crear nuevo cliente
      const { data: newCustomer, error: createError } = await supabase
        .from('customers')
        .insert([
          {
            email: orderData.customer.email,
            name: orderData.customer.name,
            phone: orderData.customer.phone,
            created_at: new Date().toISOString()
          }
        ])
        .select()
        .single();

      if (createError) {
        console.error('Error al crear el cliente:', createError);
        return res.status(500).json({ error: 'Error al crear cliente nuevo' });
      }

      customerId = newCustomer.id;
    }

    // Crear la orden con estado pendiente y activa
    const { data: savedOrder, error: orderError } = await supabase
      .from('orders')
      .insert([
        {
          order_id: parseInt(orderData.orderId),
          customer_id: customerId,
          product: orderData.product,
          total: orderData.total,
          created_at: orderData.createdAt,
          review_status: orderData.reviewStatus || 'pending'
        }
      ])
      .select()
      .single();

    if (orderError) {
      console.error('Error al guardar la orden:', orderError);
      return res.status(500).json({ error: 'Error al procesar la orden' });
    }

    // Enviar mensaje de WhatsApp si el review_status es pending
    if (savedOrder.review_status === 'pending') {
      const message = `¡Hola ${orderData.customer.name}! 😊 Esperamos que estés disfrutando tu compra. Nos encantaría saber cómo fue tu experiencia. ¿Podés calificarnos de 0 a 5 estrellas? También podés dejar un comentario, ¡tus opiniones nos ayudan a mejorar cada día! 💬⭐️`;

      try {
        await sendWhatsAppMessage(orderData.customer.phone, message);
      } catch (whatsappError) {
        console.error('Error al enviar mensaje de WhatsApp:', whatsappError);
      }
    } else {
      console.log(`No se envió mensaje: review_status=${savedOrder.review_status}`);
    }

    return res.status(200).json({
      message: 'Orden procesada exitosamente',
      orderId: savedOrder.order_id,
      customerId
    });

  } catch (error) {
    console.error('Error en el webhook:', error);
    return res.status(500).json({ error: 'Error interno del servidor' });
  }
});

export default router;
