import { Injectable, signal } from '@angular/core';

export interface AppSettings {
  gemini_api_key: string;
  gemini_model: string;
  translate_prompt_en_to_vi: string;
  translate_prompt_vi_to_en: string;
}

const STORAGE_KEY = 'annotator_settings';

const DEFAULT_SETTINGS: AppSettings = {
  gemini_api_key: '',
  gemini_model: 'gemini-2.0-flash',
  translate_prompt_en_to_vi:
    'Translate the following English text to Vietnamese. Keep technical terms as-is. Only return the translated text, nothing else.\n\nText: {{text}}',
  translate_prompt_vi_to_en:
    'Translate the following Vietnamese text to English. Keep technical terms as-is. Only return the translated text, nothing else.\n\nText: {{text}}',
};

@Injectable({ providedIn: 'root' })
export class SettingsService {
  settings = signal<AppSettings>(this.loadSettings());

  private loadSettings(): AppSettings {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
      }
    } catch {}
    return { ...DEFAULT_SETTINGS };
  }

  save(partial: Partial<AppSettings>): void {
    const current = this.settings();
    const updated = { ...current, ...partial };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
    this.settings.set(updated);
  }

  get(): AppSettings {
    return this.settings();
  }

  getDefaults(): AppSettings {
    return { ...DEFAULT_SETTINGS };
  }
}
