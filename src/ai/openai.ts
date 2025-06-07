import OpenAI from 'openai';
import { config } from '../config/index.js';

let client: OpenAI | null = null;

if (config.ai.apiKey) {
    client = new OpenAI({ apiKey: config.ai.apiKey });
}

export async function generateResponse(
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
        temperature: 0.3,
        max_tokens: 150
        // Removido: response_format: { type: 'json_object' }
    });

    return chat.choices[0]?.message?.content?.trim() || '';
}