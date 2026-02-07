import { Injectable } from '@angular/core';
import { SettingsService } from './settings.service';

@Injectable({ providedIn: 'root' })
export class GeminiService {
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
}
