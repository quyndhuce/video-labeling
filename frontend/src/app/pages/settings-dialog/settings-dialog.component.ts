import { Component, Inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatDialogModule, MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatTabsModule } from '@angular/material/tabs';
import { SettingsService, AppSettings } from '../../core/services/settings.service';

@Component({
  selector: 'app-settings-dialog',
  standalone: true,
  imports: [
    CommonModule, FormsModule,
    MatDialogModule, MatFormFieldModule, MatInputModule,
    MatSelectModule, MatButtonModule, MatIconModule, MatTabsModule
  ],
  template: `
    <h2 mat-dialog-title>
      <mat-icon>settings</mat-icon> Settings
    </h2>
    <mat-dialog-content>
      <mat-tab-group>
        <!-- Gemini API Tab -->
        <mat-tab label="Gemini API">
          <div class="settings-section">
            <mat-form-field appearance="outline" class="full-width">
              <mat-label>Gemini API Key</mat-label>
              <input matInput [(ngModel)]="form.gemini_api_key"
                     [type]="showApiKey ? 'text' : 'password'"
                     placeholder="AIza...">
              <button mat-icon-button matSuffix (click)="showApiKey = !showApiKey">
                <mat-icon>{{ showApiKey ? 'visibility_off' : 'visibility' }}</mat-icon>
              </button>
            </mat-form-field>

            <mat-form-field appearance="outline" class="full-width">
              <mat-label>Model</mat-label>
              <mat-select [(ngModel)]="form.gemini_model">
                <mat-option value="gemini-2.0-flash">Gemini 2.0 Flash</mat-option>
                <mat-option value="gemini-2.0-flash-lite">Gemini 2.0 Flash Lite</mat-option>
                <mat-option value="gemini-1.5-flash">Gemini 1.5 Flash</mat-option>
                <mat-option value="gemini-1.5-pro">Gemini 1.5 Pro</mat-option>
              </mat-select>
            </mat-form-field>
          </div>
        </mat-tab>

        <!-- Translation Prompts Tab -->
        <mat-tab label="Translation Prompts">
          <div class="settings-section">
            <p class="prompt-hint">
              Use <code>{{'{{text}}'}}</code> as placeholder for the text to translate.
            </p>

            <mat-form-field appearance="outline" class="full-width">
              <mat-label>🇬🇧 EN → 🇻🇳 VI Prompt</mat-label>
              <textarea matInput [(ngModel)]="form.translate_prompt_en_to_vi"
                        rows="5" cdkTextareaAutosize></textarea>
            </mat-form-field>

            <mat-form-field appearance="outline" class="full-width">
              <mat-label>🇻🇳 VI → 🇬🇧 EN Prompt</mat-label>
              <textarea matInput [(ngModel)]="form.translate_prompt_vi_to_en"
                        rows="5" cdkTextareaAutosize></textarea>
            </mat-form-field>

            <button mat-stroked-button (click)="resetPrompts()">
              <mat-icon>restart_alt</mat-icon> Reset to Defaults
            </button>
          </div>
        </mat-tab>
      </mat-tab-group>
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button (click)="dialogRef.close()">Cancel</button>
      <button mat-raised-button color="primary" (click)="save()">
        <mat-icon>save</mat-icon> Save
      </button>
    </mat-dialog-actions>
  `,
  styles: [`
    :host { display: block; }
    h2[mat-dialog-title] {
      display: flex; align-items: center; gap: 8px;
      margin: 0; padding: 16px 24px;
    }
    mat-dialog-content {
      min-width: 500px;
      max-height: 70vh;
    }
    .settings-section {
      padding: 16px 4px;
    }
    .full-width {
      width: 100%;
    }
    .prompt-hint {
      color: #888; font-size: 13px; margin-bottom: 12px;
    }
    .prompt-hint code {
      background: #333; color: #4fc3f7; padding: 2px 6px;
      border-radius: 3px; font-size: 12px;
    }
    mat-dialog-actions {
      padding: 12px 24px;
    }
  `]
})
export class SettingsDialogComponent {
  form: AppSettings;
  showApiKey = false;

  constructor(
    public dialogRef: MatDialogRef<SettingsDialogComponent>,
    private settingsService: SettingsService
  ) {
    this.form = { ...this.settingsService.get() };
  }

  resetPrompts(): void {
    const defaults = this.settingsService.getDefaults();
    this.form.translate_prompt_en_to_vi = defaults.translate_prompt_en_to_vi;
    this.form.translate_prompt_vi_to_en = defaults.translate_prompt_vi_to_en;
  }

  save(): void {
    this.settingsService.save(this.form);
    this.dialogRef.close(true);
  }
}
