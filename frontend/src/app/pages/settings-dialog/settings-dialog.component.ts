import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatDialogModule, MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatTabsModule } from '@angular/material/tabs';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { SettingsService, AppSettings } from '../../core/services/settings.service';

@Component({
  selector: 'app-settings-dialog',
  standalone: true,
  imports: [
    CommonModule, FormsModule,
    MatDialogModule, MatFormFieldModule, MatInputModule,
    MatSelectModule, MatButtonModule, MatIconModule, MatTabsModule,
    MatSnackBarModule, MatProgressSpinnerModule
  ],
  template: `
    <h2 mat-dialog-title>
      <mat-icon>settings</mat-icon> Settings
    </h2>
    <mat-dialog-content>
      <mat-tab-group>
        <!-- Server Tab -->
        <mat-tab label="Server">
          <div class="settings-section">
            <p class="section-desc">Configure the DAM (Describe Anything Model) + SAM2 server for AI segmentation and auto-captioning.</p>

            <mat-form-field appearance="outline" class="full-width">
              <mat-label>DAM Server URL</mat-label>
              <input matInput [(ngModel)]="damServerUrl"
                     placeholder="http://192.168.88.31:8688">
              <mat-icon matPrefix>dns</mat-icon>
            </mat-form-field>

            <div class="server-actions">
              <button mat-stroked-button (click)="testConnection()" [disabled]="testingConnection">
                <mat-icon *ngIf="!testingConnection">wifi_tethering</mat-icon>
                <mat-spinner *ngIf="testingConnection" diameter="18"></mat-spinner>
                {{ testingConnection ? 'Testing...' : 'Test Connection' }}
              </button>
              <span class="connection-status" *ngIf="connectionStatus" [class]="connectionStatus">
                <mat-icon>{{ connectionStatus === 'ok' ? 'check_circle' : 'error' }}</mat-icon>
                {{ connectionMessage }}
              </span>
            </div>
          </div>
        </mat-tab>

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

            <mat-form-field appearance="outline" class="full-width">
              <mat-label>Gemini Combine Prompt</mat-label>
              <textarea matInput [(ngModel)]="form.gemini_combine_prompt" rows="5" cdkTextareaAutosize></textarea>
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
    .section-desc {
      color: #999; font-size: 13px; margin-bottom: 16px; line-height: 1.5;
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
    .server-actions {
      display: flex; align-items: center; gap: 12px; flex-wrap: wrap;
    }
    .server-actions button {
      display: flex; align-items: center; gap: 6px;
    }
    .server-actions mat-spinner { display: inline-block; }
    .connection-status {
      display: flex; align-items: center; gap: 4px;
      font-size: 13px; padding: 4px 10px;
      border-radius: 4px;
    }
    .connection-status.ok {
      color: #4caf50; background: rgba(76, 175, 80, 0.1);
    }
    .connection-status.error {
      color: #f44336; background: rgba(244, 67, 54, 0.1);
    }
    .connection-status mat-icon { font-size: 18px; width: 18px; height: 18px; }
    mat-dialog-actions {
      padding: 12px 24px;
    }
  `]
})
export class SettingsDialogComponent implements OnInit {
  form: AppSettings;
  damServerUrl = '';
  showApiKey = false;
  testingConnection = false;
  connectionStatus: 'ok' | 'error' | '' = '';
  connectionMessage = '';

  constructor(
    public dialogRef: MatDialogRef<SettingsDialogComponent>,
    private settingsService: SettingsService,
    private snackBar: MatSnackBar
  ) {
    this.form = { ...this.settingsService.get() };
  }

  ngOnInit(): void {
    // Load DAM URL from backend
    this.settingsService.getDamUrl().subscribe({
      next: (res) => { this.damServerUrl = res.dam_server_url; },
      error: () => { this.damServerUrl = this.form.dam_server_url || ''; }
    });
  }

  testConnection(): void {
    if (!this.damServerUrl.trim()) {
      this.connectionStatus = 'error';
      this.connectionMessage = 'Please enter a URL';
      return;
    }
    this.testingConnection = true;
    this.connectionStatus = '';
    this.connectionMessage = '';

    this.settingsService.testDamConnection(this.damServerUrl.trim()).subscribe({
      next: (res) => {
        this.testingConnection = false;
        this.connectionStatus = 'ok';
        this.connectionMessage = res.message || 'Connected!';
      },
      error: (err) => {
        this.testingConnection = false;
        this.connectionStatus = 'error';
        this.connectionMessage = err.error?.message || 'Connection failed';
      }
    });
  }

  resetPrompts(): void {
    const defaults = this.settingsService.getDefaults();
    this.form.translate_prompt_en_to_vi = defaults.translate_prompt_en_to_vi;
    this.form.translate_prompt_vi_to_en = defaults.translate_prompt_vi_to_en;
  }

  save(): void {
    // Save local settings (Gemini, prompts)
    this.settingsService.save(this.form);

    // Save DAM URL to backend DB
    const url = this.damServerUrl.trim();
    if (url) {
      this.settingsService.saveDamUrl(url).subscribe({
        next: () => {
          this.snackBar.open('Settings saved', '', { duration: 2000, panelClass: 'snack-success' });
          this.dialogRef.close(true);
        },
        error: () => {
          this.snackBar.open('Gemini settings saved, but failed to save DAM URL', '', { duration: 3000, panelClass: 'snack-error' });
          this.dialogRef.close(true);
        }
      });
    } else {
      this.dialogRef.close(true);
    }
  }
}
