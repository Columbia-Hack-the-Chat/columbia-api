import OpenAI from 'openai';
import { config } from '../config/index.js';

let client: OpenAI | null = null;

if (config.ai.apiKey) {
    client = new OpenAI({ apiKey: config.ai.apiKey });
}

export async function generateResponse(
  userPrompt: string,
  systemPrompt?: string,
  expectJson: boolean = false
): Promise<string> {
    if (!client) {
        throw new Error('OpenAI API key is missing. Set OPENAI_API_KEY to enable AI responses.');
    }

    const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [];
    
    if (systemPrompt) {
        messages.push({ role: 'system', content: systemPrompt });
    }
    
    messages.push({ role: 'user', content: userPrompt });

    const completionOptions: any = {
        model: 'gpt-3.5-turbo',
        messages,
        temperature: 0.7, // Más creatividad para respuestas naturales
        max_tokens: 150,
        top_p: 0.9, // Para más variedad en las respuestas
        frequency_penalty: 0.3, // Evita repetir frases
        presence_penalty: 0.3 // Fomenta nuevas ideas
    };

    // Solo agregar response_format si se espera JSON Y el prompt contiene "json"
    if (expectJson && (userPrompt.toLowerCase().includes('json') || systemPrompt?.toLowerCase().includes('json'))) {
        completionOptions.response_format = { type: 'json_object' };
    }

    const chat = await client.chat.completions.create(completionOptions);

    return chat.choices[0]?.message?.content?.trim() || '';
}

// Función específica para análisis que requiere JSON
export async function generateJsonResponse(
  userPrompt: string,
  systemPrompt?: string
): Promise<string> {
    if (!client) {
        throw new Error('OpenAI API key is missing. Set OPENAI_API_KEY to enable AI responses.');
    }

    const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [];
    
    if (systemPrompt) {
        messages.push({ role: 'system', content: systemPrompt });
    }
    
    messages.push({ role: 'user', content: userPrompt });

    const chat = await client.chat.completions.create({
        model: 'gpt-3.5-turbo',
        messages,
        temperature: 0.3, // Más determinista para análisis
        max_tokens: 150,
        response_format: { type: 'json_object' }
    });

    return chat.choices[0]?.message?.content?.trim() || '';
}