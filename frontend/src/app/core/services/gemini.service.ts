import { Injectable } from '@angular/core';
import { SettingsService } from './settings.service';

@Injectable({ providedIn: 'root' })
export class GeminiService {
    /**
     * Combine captions using Gemini API and custom prompt
     */
    async combineCaptions(captions: string[], isVi: boolean = false): Promise<string> {
      const settings = this.settingsService.get();
      if (!settings.gemini_api_key) {
        throw new Error('Gemini API key not configured. Open Settings to add your key.');
      }
      const promptTemplate = settings.gemini_combine_prompt || 'Combine the following captions into a single, coherent description. Only return the combined text, nothing else.\n\nCaptions: {{captions}}';
      const prompt = promptTemplate.replace(/\{\{captions\}\}/g, captions.join('\n'));
      const url = `${this.API_BASE}/${settings.gemini_model}:generateContent?key=${settings.gemini_api_key}`;
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            temperature: 0.3,
            maxOutputTokens: 2048,
          }
        })
      });
      if (!response.ok) {
        const errBody = await response.json().catch(() => ({}));
        const msg = errBody?.error?.message || response.statusText;
        throw new Error(`Gemini API error: ${msg}`);
      }
      const data = await response.json();
      const result = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
      return result.trim();
    }
  private readonly API_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';

  constructor(private settingsService: SettingsService) {}

  /**
   * Translate text using Gemini API.
   * @param text The text to translate
   * @param direction 'en_to_vi' or 'vi_to_en'
   * @returns Translated text
   */
  async translate(text: string, direction: 'en_to_vi' | 'vi_to_en'): Promise<string> {
    if (!text.trim()) return '';

    const settings = this.settingsService.get();
    if (!settings.gemini_api_key) {
      throw new Error('Gemini API key not configured. Open Settings to add your key.');
    }

    const promptTemplate = direction === 'en_to_vi'
      ? settings.translate_prompt_en_to_vi
      : settings.translate_prompt_vi_to_en;

    const prompt = promptTemplate.replace(/\{\{text\}\}/g, text);

    const url = `${this.API_BASE}/${settings.gemini_model}:generateContent?key=${settings.gemini_api_key}`;

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.3,
          maxOutputTokens: 2048,
        }
      })
    });

    if (!response.ok) {
      const errBody = await response.json().catch(() => ({}));
      const msg = errBody?.error?.message || response.statusText;
      throw new Error(`Gemini API error: ${msg}`);
    }

    const data = await response.json();
    const result = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
    return result.trim();
  }

  /**
   * Translate EN→VI
   */
  translateToVi(text: string): Promise<string> {
    return this.translate(text, 'en_to_vi');
  }

  /**
   * Translate VI→EN
   */
  translateToEn(text: string): Promise<string> {
    return this.translate(text, 'vi_to_en');
  }

  /**
   * Check if Gemini is configured (has API key)
   */
  isConfigured(): boolean {
    return !!this.settingsService.get().gemini_api_key;
  }

  /**
   * Combine captions with knowledge base context for richer descriptions.
   * The knowledge context provides domain-specific information from the KB hierarchy.
   */
  async combineCaptionsWithKnowledge(captions: string[], kbContext: string, isVi: boolean = false): Promise<string> {
    const settings = this.settingsService.get();
    if (!settings.gemini_api_key) {
      throw new Error('Gemini API key not configured. Open Settings to add your key.');
    }

    // Build prompt that combines visual description with knowledge
    const lang = isVi ? 'Vietnamese' : 'English';
    const captionsText = captions.filter(c => !c.startsWith('[Knowledge') && !c.startsWith('[Ngữ cảnh')).join('\n');
    
    let prompt: string;
    if (kbContext && kbContext.trim()) {
      prompt = `You are creating a rich, contextual description for a video segment in ${lang}.

Visual Description:
${captionsText}

Domain Knowledge Context (from knowledge base hierarchy):
${kbContext}

Instructions:
- Combine the visual description with the domain knowledge to create a comprehensive, coherent description
- Use the knowledge context to add relevant technical or domain-specific details that enrich the visual description
- The final description should flow naturally and not feel like separate pieces
- Keep it concise but informative
- Output only the combined description in ${lang}, nothing else`;
    } else {
      // No KB context, just combine captions
      prompt = `Combine the following descriptions into a single, coherent ${lang} description. Only return the combined text, nothing else.\n\n${captionsText}`;
    }

    const url = `${this.API_BASE}/${settings.gemini_model}:generateContent?key=${settings.gemini_api_key}`;
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.4,
          maxOutputTokens: 2048,
        }
      })
    });

    if (!response.ok) {
      const errBody = await response.json().catch(() => ({}));
      const msg = errBody?.error?.message || response.statusText;
      throw new Error(`Gemini API error: ${msg}`);
    }

    const data = await response.json();
    const result = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
    return result.trim();
  }
}
