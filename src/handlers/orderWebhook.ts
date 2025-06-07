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
  lineItems: Array<{
    sku: string;
    quantity: number;
  }>;
  total: number;
  createdAt: string;
}

// Función para enviar mensaje de WhatsApp
async function sendWhatsAppMessage(phone: string, message: string) {
  const sock = getSocket();
  if (!sock) {
    throw new Error('Socket de WhatsApp no está disponible');
  }

  // Formatear el número de teléfono al formato de WhatsApp
  const formattedPhone = phone.replace(/\D/g, '') + '@s.whatsapp.net';
  
  try {
    await sock.sendMessage(formattedPhone, { text: message });
    console.log(`Mensaje enviado exitosamente a ${phone}`);
  } catch (error) {
    console.error('Error al enviar mensaje de WhatsApp:', error);
    throw error;
  }
}

// Endpoint del webhook
router.post('/webhook/order', async (req, res) => {
  try {
    const orderData: OrderData = req.body;

    // Validar datos requeridos
    if (!orderData.orderId || !orderData.customer.phone) {
      return res.status(400).json({
        error: 'Faltan datos requeridos: orderId o phone'
      });
    }

    // 1. Primero, crear o actualizar el cliente
    const { data: customerData, error: customerError } = await supabase
      .from('customers')
      .upsert({
        email: orderData.customer.email,
        name: orderData.customer.name,
        phone: orderData.customer.phone,
        created_at: new Date().toISOString()
      })
      .select()
      .single();

    if (customerError) {
      console.error('Error al guardar el cliente:', customerError);
      return res.status(500).json({
        error: 'Error al procesar la información del cliente'
      });
    }

    // 2. Crear la orden
    const { data: savedOrder, error: orderError } = await supabase
      .from('orders')
      .insert([
        {
          order_id: parseInt(orderData.orderId),
          customer_id: customerData.id,
          product: orderData.lineItems.map(item => item.sku),
          total: orderData.total,
          created_at: orderData.createdAt,
          review_status: 'pending'
        }
      ])
      .select()
      .single();

    if (orderError) {
      console.error('Error al guardar la orden:', orderError);
      return res.status(500).json({
        error: 'Error al procesar la orden'
      });
    }

    // 3. Enviar mensaje de WhatsApp
    const message = `Hola ${orderData.customer.name}, entiendo que recibiste tu compra. Quería saber qué te pareció, dandonos un puntaje del 1 al 5 estrellas. Podes agregar comentarios para que sigamos mejorando`;
    
    try {
      await sendWhatsAppMessage("+5491154933738", message);
    } catch (whatsappError) {
      console.error('Error al enviar mensaje de WhatsApp:', whatsappError);
      // No retornamos error aquí para no afectar el flujo principal
    }

    // Respuesta exitosa
    return res.status(200).json({
      message: 'Orden procesada exitosamente',
      orderId: savedOrder.order_id,
      customerId: customerData.id
    });

  } catch (error) {
    console.error('Error en el webhook:', error);
    return res.status(500).json({
      error: 'Error interno del servidor'
    });
  }
});

export default router;
