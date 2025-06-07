import { BaileysEventMap, WASocket, WAMessage } from 'baileys'
import { config } from '../config/index.js'
import { generateResponse } from '../ai/openai.js'
import { createLogger } from '../logger/index.js'
import { supabase } from '../db/client.js'
import { extraerComentarioYPuntajeConIA } from '../ai/feedbackParser.js'

const logger = createLogger('MessageHandler')

// Cache de conversaciones en memoria para mantener contexto
interface ConversationContext {
    customerPhone: string
    lastMessageTime: number
    messageCount: number
    hasGreeted: boolean
    hasAskedForRating: boolean
    receivedRating: boolean
    lastMessages: string[]
}

const conversationCache = new Map<string, ConversationContext>()

// Timeout pendientes para evitar múltiples respuestas
const pendingTimeouts = new Map<string, NodeJS.Timeout>()

// Detecta si el mensaje es una respuesta posterior al mensaje de entrega
function esRespuestaAPostEntrega(message: WAMessage): boolean {
    return !!message.message?.conversation || !!message.message?.extendedTextMessage
}

// Función para limpiar contextos antiguos (más de 24 horas)
function cleanOldContexts() {
    const now = Date.now()
    const maxAge = 24 * 60 * 60 * 1000 // 24 horas
    
    for (const [phone, context] of conversationCache.entries()) {
        if (now - context.lastMessageTime > maxAge) {
            conversationCache.delete(phone)
        }
    }
}

// Ejecutar limpieza cada hora
setInterval(cleanOldContexts, 60 * 60 * 1000)

// Función para obtener o crear contexto de conversación
function getOrCreateContext(customerPhone: string): ConversationContext {
    let context = conversationCache.get(customerPhone)
    
    if (!context) {
        context = {
            customerPhone,
            lastMessageTime: Date.now(),
            messageCount: 0,
            hasGreeted: false,
            hasAskedForRating: false,
            receivedRating: false,
            lastMessages: []
        }
        conversationCache.set(customerPhone, context)
    }
    
    return context
}

// Función para actualizar contexto después del mensaje
function updateContext(context: ConversationContext, message: string, extractedRating: number | null) {
    context.lastMessageTime = Date.now()
    context.messageCount++
    
    // Mantener solo los últimos 3 mensajes para contexto
    context.lastMessages.push(message)
    if (context.lastMessages.length > 3) {
        context.lastMessages.shift()
    }
    
    // Detectar si ya recibió rating
    if (extractedRating !== null) {
        context.receivedRating = true
    }
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

        const customerPhone = remoteJid.replace('@s.whatsapp.net', '')

        // Cancelar timeout anterior si existe
        const existingTimeout = pendingTimeouts.get(customerPhone)
        if (existingTimeout) {
            clearTimeout(existingTimeout)
            pendingTimeouts.delete(customerPhone)
        }

        // Crear nuevo timeout de 1 segundos
        const timeout = setTimeout(async () => {
            await processMessageWithDelay(sock, message, remoteJid, textContent, customerPhone)
            pendingTimeouts.delete(customerPhone)
        }, 1000)

        pendingTimeouts.set(customerPhone, timeout)

    } catch (error) {
        logger.error('Error handling message', error, {
            messageId: message.key.id,
            from: message.key.remoteJid
        })
    }
}

// Procesar mensaje después del delay
async function processMessageWithDelay(
    sock: WASocket, 
    message: WAMessage, 
    remoteJid: string, 
    textContent: string, 
    customerPhone: string
) {
    try {
        const { comment, rating } = await extraerComentarioYPuntajeConIA(textContent.trim());

        logger.info('Message analyzed by AI', {
            originalText: textContent,
            extractedComment: comment,
            extractedRating: rating
        });

        // IA solo si es una respuesta post entrega
        if (config.bot.aiEnabled && esRespuestaAPostEntrega(message)) {
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

            // Obtener y actualizar contexto
            const context = getOrCreateContext(customerPhone)
            updateContext(context, textContent.trim(), rating)

            // Construir prompt con contexto
            const contextualPrompt = buildContextualPrompt(textContent.trim(), context, comment, rating)

            try {
                const aiReply = await generateResponse(contextualPrompt)
                await sock.sendMessage(remoteJid, { text: aiReply })

                // Actualizar contexto post-respuesta
                if (!context.hasGreeted && aiReply.toLowerCase().includes('hola')) {
                    context.hasGreeted = true
                }
                if (aiReply.includes('0 al 5') || aiReply.includes('calific')) {
                    context.hasAskedForRating = true
                }

                logger.info('AI response sent', {
                    to: remoteJid,
                    response: aiReply,
                    comment,
                    rating,
                    contextInfo: {
                        messageCount: context.messageCount,
                        hasGreeted: context.hasGreeted,
                        hasAskedForRating: context.hasAskedForRating,
                        receivedRating: context.receivedRating
                    }
                })

                // Solo guardar si hay rating o comentario
                if (rating || comment) {
                    const { error: reviewError } = await supabase
                        .from('reviews')
                        .insert([
                            {
                                order_id: order.id,
                                customer_id: customer.id,
                                rating: rating || null,
                                comment: comment || null,
                                status: 'received',
                                created_at: new Date().toISOString()
                            }
                        ]);

                    if (reviewError) {
                        logger.error('Error al guardar la review:', reviewError);
                    } else {
                        logger.info('Review guardada exitosamente', {
                            orderId: order.id,
                            customerId: customer.id,
                            rating,
                            hasComment: !!comment
                        });

                        // Actualizar el estado de la orden
                        await supabase
                            .from('orders')
                            .update({ review_status: 'completed' })
                            .eq('id', order.id);
                    }
                }

            } catch (error) {
                logger.error('Error generating AI response', error)
                await sock.sendMessage(remoteJid, {
                    text: 'Hubo un error al generar la respuesta automática. Podés responder manualmente por ahora.'
                })
            }
        }

    } catch (error) {
        logger.error('Error processing delayed message', error)
    }
}

// Construir prompt contextual
function buildContextualPrompt(
    currentMessage: string, 
    context: ConversationContext, 
    comment: string, 
    rating: number | null
): string {
    const basePrompt = `
Sos parte del equipo de atención al cliente de un pequeño emprendimiento. 
Tu trabajo es responder de forma cálida, cercana y humana a los mensajes que dejan los clientes después de recibir su pedido.

CONTEXTO DE LA CONVERSACIÓN:
- Es el mensaje número ${context.messageCount} de este cliente
- ${context.hasGreeted ? 'YA saludaste antes' : 'Es la primera vez que hablas con este cliente'}
- ${context.hasAskedForRating ? 'YA pediste calificación antes' : 'Aún no pediste calificación'}
- ${context.receivedRating ? 'YA recibiste una calificación' : 'Aún no recibiste calificación'}
- Mensajes anteriores: ${context.lastMessages.slice(-2).join(' | ')}

REGLAS IMPORTANTES:
- NO repitas saludos si ya saludaste antes
- NO preguntes por calificación si ya la pediste o recibiste
- Mantené continuidad conversacional natural
- Si es el segundo mensaje o más, actúa como si ya estuvieras hablando

EXTRAÍDO DEL MENSAJE:
- Comentario: "${comment}"
- Calificación detectada: ${rating || 'ninguna'}

Tu estilo:
- Cercano y honesto, como si fueras parte real del equipo
- Breve, cálido, directo
- Nunca genérico ni robotico
- Responde como si fuera WhatsApp personal

Mensaje actual del cliente: "${currentMessage}"
`

    return basePrompt
}