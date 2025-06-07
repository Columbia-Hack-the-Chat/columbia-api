import { BaileysEventMap, WASocket, WAMessage } from 'baileys'
import { config } from '../config/index.js'
import { generateResponse } from '../ai/openai.js'
import { createLogger } from '../logger/index.js'
import { supabase } from '../db/client.js'

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

        logger.info('Message received', {
            from: remoteJid,
            text: textContent,
            messageId: message.key.id
        })

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
El cliente acaba de recibir su pedido y respondió lo siguiente:

"${prompt}"

Redactá una respuesta amable, cercana y empática, como si fueras parte de un pequeño negocio que se alegra mucho de que todo haya salido bien.
No uses emojis a menos que el cliente los haya usado.
Respondé en menos de 3 líneas.
            `

            try {
                const aiReply = await generateResponse(customPrompt)
                await sock.sendMessage(remoteJid, { text: aiReply })

                logger.info('AI response sent', {
                    to: remoteJid,
                    response: aiReply
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
