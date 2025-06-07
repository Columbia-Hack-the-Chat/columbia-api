import { BaileysEventMap, WASocket, WAMessage } from 'baileys'
import { config } from '../config/index.js'
import { generateResponse } from '../ai/openai.js'
import { createLogger } from '../logger/index.js'
import { supabase } from '../db/client.js'
import { extraerComentarioYPuntajeConIA } from '../ai/feedbackParser.js'


const logger = createLogger('MessageHandler')

// Detecta si el mensaje es una respuesta posterior al mensaje de entrega
function esRespuestaAPostEntrega(message: WAMessage): boolean {
    return !!message.message?.conversation || !!message.message?.extendedTextMessage
}

// Setup del handler de mensajes
export function setupMessageHandler(sock: WASocket) {
    sock.ev.on('messages.upsert', async ({ messages, type }: BaileysEventMap['messages.upsert']) => {
        if (type !== 'notify') return

        for (const message of messages) {
            if (!message.message) continue
            if (message.key.fromMe) continue

            await handleMessage(sock, message)
        }
    })
}

// Lógica principal para cada mensaje recibido
async function handleMessage(sock: WASocket, message: WAMessage) {
    try {
        const remoteJid = message.key.remoteJid
        if (!remoteJid) return

        const textContent =
            message.message?.conversation || message.message?.extendedTextMessage?.text || ''
        if (!textContent) return

  const { comment, rating } = await extraerComentarioYPuntajeConIA(textContent.trim());

  logger.info('Message analyzed by AI', {
    originalText: textContent,
    extractedComment: comment,
    extractedRating: rating
  });

        // IA solo si es una respuesta post entrega
        if (config.bot.aiEnabled && esRespuestaAPostEntrega(message)) {
            const customerPhone = remoteJid.replace('@s.whatsapp.net', '')

            const { data: customer, error: customerError } = await supabase
                .from('customers')
                .select('id')
                .eq('phone', customerPhone)
                .maybeSingle()

            if (customerError || !customer) {
                logger.warn('Cliente no encontrado en base de datos', { phone: customerPhone })
                return
            }

            const { data: order, error: orderError } = await supabase
                .from('orders')
                .select('*')
                .eq('customer_id', customer.id)
                .order('created_at', { ascending: false })
                .limit(1)
                .single()

            if (orderError || !order) {
                logger.warn('Orden no encontrada para el cliente', { customerId: customer.id })
                return
            }

            const prompt = textContent.trim()

            const customPrompt = `

            Sos parte del equipo de atención al cliente de un pequeño emprendimiento. 
            Tu trabajo es responder de forma cálida, cercana y humana a los mensajes que dejan los clientes después de recibir su pedido.

            No hablás como un robot. No uses frases genéricas como “gracias por tu mensaje”. 
            Mostrá gratitud real, validá lo que dicen y conversá con tono relajado, como si estuvieras en WhatsApp. 

            Siempre que el cliente dé una opinión (positiva o negativa), pedile amablemente que la califique del 1 al 5. 
            Si ya lo hizo, registralo mentalmente y agradecé.
            Si no lo hizo, insistí una vez más de forma sutil pero clara, como: "¿Y si tuvieras que ponerle un puntaje del 1 al 5? 😄"

            Usá emojis solo si el cliente los usó primero.

            Tu estilo:
            - Cercano y honesto, como si fueras parte real del equipo.
            - Breve, cálido, directo.
            - Nunca des respuestas genéricas ni largas.

            mensaje del cliente: "${prompt}"
            `

            try {
                const aiReply = await generateResponse(customPrompt)
                await sock.sendMessage(remoteJid, { text: aiReply })

                logger.info('AI response sent', {
                    to: remoteJid,
                    response: aiReply, comment, rating,

                     comentarioDetectado: comment,
                     puntuacionDetectada: rating,
                })


            } catch (error) {
                logger.error('Error generating AI response', error)
                await sock.sendMessage(remoteJid, {
                    text: 'Hubo un error al generar la respuesta automática. Podés responder manualmente por ahora.'
                })
            }
              
              
            return
        }


    } catch (error) {
        logger.error('Error handling message', error, {
            messageId: message.key.id,
            from: message.key.remoteJid
        })
    }
}
