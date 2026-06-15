import { Injectable, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, tap } from 'rxjs';

export interface AppSettings {
  gemini_api_key: string;
  gemini_model: string;
  translate_prompt_en_to_vi: string;
  translate_prompt_vi_to_en: string;
  gemini_combine_prompt: string;
  timezone: string;  // e.g., 'Asia/Ho_Chi_Minh', 'UTC'
}

const STORAGE_KEY = 'annotator_settings';
const DAM_URL_STORAGE_KEY = 'dam_server_url_local';
const DAM_MAX_DIM_STORAGE_KEY = 'dam_max_image_side_local';
const DAM_MAX_DIM_DEFAULT = 512;

const DEFAULT_SETTINGS: AppSettings = {
  gemini_api_key: '',
  gemini_model: 'gemini-2.0-flash',
  translate_prompt_en_to_vi:
    'Translate the following English text to Vietnamese. Keep technical terms as-is. Only return the translated text, nothing else.\n\nText: {{text}}',
  translate_prompt_vi_to_en:
    'Translate the following Vietnamese text to English. Keep technical terms as-is. Only return the translated text, nothing else.\n\nText: {{text}}',
  gemini_combine_prompt:
    `You are an expert local tour guide with years of experience. Your task is to combine the provided input captions and knowledge base facts into a single, captivating, and coherent description.

CRITICAL INSTRUCTIONS:
1. Retain ALL Knowledge: You must keep all entities, facts, and details provided in the input captions and knowledge base. Do not omit any information.
2. Essential Elements: The final description must implicitly contain the following elements. You are FREE to arrange them in any order that feels most natural, engaging, and contextually appropriate. Do not use bullet points or explicit labels:
   - [Core Entity]: The official name and category of the destination, festival, or subject.
   - [Location Entity]: Address, spatial context, or geographic location.
   - [Visual Components]: Detailed visual objects, architectural parts, colors, and shapes.
   - [Dynamic & Human Entity]: People, ongoing activities, movements, or events happening.
   - [Travel Experience Entity]: Cultural/historical values, atmosphere, vibe, and emotional resonance.
3. Tone & Persona: Write in the engaging, knowledgeable, and welcoming tone of a seasoned local tour guide presenting to tourists. The text should flow naturally with smooth transitions.
4. Language: Generate the response in the exact language of the input captions (e.g., Vietnamese).

OUTPUT STRICTLY AND ONLY the final combined description text. Do not include any introductory phrases, explanations, or labels.

Input Captions (visual & contextual):
{{captions}}

Knowledge Base Facts:
{{kb_context}}`,
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

  private applyRemoteSettings(remote: Partial<AppSettings>): void {
    // Strip dam_server_url if it accidentally comes from backend
    const { ...cleanedRemote } = remote as any;
    delete cleanedRemote.dam_server_url;
    
    const updated = {
      ...this.settings(),
      ...cleanedRemote,
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
    this.settings.set(updated);
  }

  get(): AppSettings {
    return this.settings();
  }

  getDefaults(): AppSettings {
    return { ...DEFAULT_SETTINGS };
  }

  getAllSettings(): Observable<AppSettings> {
    return this.http.get<AppSettings>(`${this.SETTINGS_API}`);
  }

  saveAllSettings(payload: AppSettings): Observable<AppSettings> {
    return this.http.put<AppSettings>(`${this.SETTINGS_API}`, payload).pipe(
      tap(remote => this.applyRemoteSettings(remote))
    );
  }

  syncAllFromBackend(): Observable<AppSettings> {
    return this.getAllSettings().pipe(
      tap(remote => this.applyRemoteSettings(remote))
    );
  }

  // ---- Independent DAM Server URL Logic ----

  getLocalDamUrl(): string {
    return localStorage.getItem(DAM_URL_STORAGE_KEY) || '';
  }

  saveLocalDamUrl(url: string): void {
    localStorage.setItem(DAM_URL_STORAGE_KEY, url);
  }

  /**
   * Max longest-side (px) for frames sent to DAM. Null = native (no downscale).
   * Default: 768. Stored per-browser in localStorage.
   */
  getDamMaxImageSide(): number | null {
    const raw = localStorage.getItem(DAM_MAX_DIM_STORAGE_KEY);
    if (raw === null) return DAM_MAX_DIM_DEFAULT;
    if (raw === '' || raw === '0') return null;
    const n = parseInt(raw, 10);
    return Number.isFinite(n) && n > 0 ? n : DAM_MAX_DIM_DEFAULT;
  }

  saveDamMaxImageSide(value: number | null): void {
    if (value === null || value === 0) {
      localStorage.setItem(DAM_MAX_DIM_STORAGE_KEY, '0');
    } else {
      localStorage.setItem(DAM_MAX_DIM_STORAGE_KEY, String(value));
    }
  }

  // Backend Sync (If needed for shared config, but local takes precedence)
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

  getGeminiSettings(): Observable<Pick<AppSettings, 'gemini_api_key' | 'gemini_model'>> {
    return this.http.get<Pick<AppSettings, 'gemini_api_key' | 'gemini_model'>>(`${this.SETTINGS_API}/gemini`);
  }

  saveGeminiSettings(payload: Pick<AppSettings, 'gemini_api_key' | 'gemini_model'>): Observable<any> {
    return this.http.put(`${this.SETTINGS_API}/gemini`, payload).pipe(
      tap(() => this.applyRemoteSettings(payload))
    );
  }

  syncGeminiFromBackend(): Observable<Pick<AppSettings, 'gemini_api_key' | 'gemini_model'>> {
    return this.getGeminiSettings().pipe(
      tap(remote => this.applyRemoteSettings(remote))
    );
  }
}
