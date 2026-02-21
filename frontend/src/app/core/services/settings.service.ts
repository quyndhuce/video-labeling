import { Injectable, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';

export interface AppSettings {
  gemini_api_key: string;
  gemini_model: string;
  translate_prompt_en_to_vi: string;
  translate_prompt_vi_to_en: string;
  dam_server_url: string;
  gemini_combine_prompt: string;
  timezone: string;  // e.g., 'Asia/Ho_Chi_Minh', 'UTC'
}

const STORAGE_KEY = 'annotator_settings';

const DEFAULT_SETTINGS: AppSettings = {
  gemini_api_key: '',
  gemini_model: 'gemini-2.0-flash',
  translate_prompt_en_to_vi:
    'Translate the following English text to Vietnamese. Keep technical terms as-is. Only return the translated text, nothing else.\n\nText: {{text}}',
  translate_prompt_vi_to_en:
    'Translate the following Vietnamese text to English. Keep technical terms as-is. Only return the translated text, nothing else.\n\nText: {{text}}',
  dam_server_url: '',
  gemini_combine_prompt:
    'Combine the following captions into a single, coherent description. Only return the combined text, nothing else.\n\nCaptions: {{captions}}',
  timezone: 'Asia/Ho_Chi_Minh',  // Default to Vietnam timezone
};

@Injectable({ providedIn: 'root' })
export class SettingsService {
  private readonly SETTINGS_API = '/api/settings';
  settings = signal<AppSettings>(this.loadSettings());

  constructor(private http: HttpClient) {}

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

  // ---- DAM Server URL (synced with backend DB) ----

  getDamUrl(): Observable<{ dam_server_url: string }> {
    return this.http.get<{ dam_server_url: string }>(`${this.SETTINGS_API}/dam-url`);
  }

  saveDamUrl(url: string): Observable<any> {
    return this.http.put(`${this.SETTINGS_API}/dam-url`, { dam_server_url: url });
  }

  testDamConnection(url: string): Observable<{ status: string; message: string; details?: any }> {
    return this.http.post<{ status: string; message: string; details?: any }>(
      `${this.SETTINGS_API}/dam-url/test`, { dam_server_url: url }
    );
  }
}
