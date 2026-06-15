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
import { DamService } from '../../core/services/dam.service';

@Component({
  selector: 'app-settings-dialog',
  standalone: true,
  imports: [
    CommonModule, FormsModule,
    MatDialogModule, MatFormFieldModule, MatInputModule,
    MatSelectModule, MatButtonModule, MatIconModule, MatTabsModule,
    MatSnackBarModule, MatProgressSpinnerModule
  ],
  templateUrl: './settings-dialog.component.html',
  styleUrls: ['./settings-dialog.component.scss']
})
export class SettingsDialogComponent implements OnInit {
  form: AppSettings;
  damServerUrl = '';
  // null = "Native" (no downscale). Bound as string in the <mat-select>.
  damMaxImageSide: string = '512';
  showApiKey = false;
  testingConnection = false;
  connectionStatus: 'ok' | 'error' | '' = '';
  connectionMessage = '';

  constructor(
    public dialogRef: MatDialogRef<SettingsDialogComponent>,
    private settingsService: SettingsService,
    private dam: DamService,
    private snackBar: MatSnackBar
  ) {
    this.form = { ...this.settingsService.get() };
    this.damServerUrl = this.settingsService.getLocalDamUrl() || 'http://localhost:8000';
    const stored = this.settingsService.getDamMaxImageSide();
    this.damMaxImageSide = stored === null ? 'native' : String(stored);
  }

  ngOnInit(): void {
    // Sync non-DAM settings (Gemini, prompts, timezone) from backend so they
    // persist across browsers. DAM URL stays local-only.
    this.settingsService.syncAllFromBackend().subscribe({
      next: (remote) => {
        this.form = { ...remote };
      },
      error: () => {
        // Backend unreachable: keep the local form as-is.
      }
    });
  }

  testConnection(): void {
    const url = this.damServerUrl.trim();
    if (!url) {
      this.connectionStatus = 'error';
      this.connectionMessage = 'Please enter a URL';
      return;
    }
    this.testingConnection = true;
    this.connectionStatus = '';
    this.connectionMessage = '';

    this.dam.testConnection(url).subscribe({
      next: (res) => {
        this.testingConnection = false;
        this.connectionStatus = 'ok';
        this.connectionMessage = res.message || 'Connected!';
      },
      error: (err) => {
        this.testingConnection = false;
        this.connectionStatus = 'error';
        this.connectionMessage = err?.message || 'Connection failed';
      }
    });
  }

  resetPrompts(): void {
    const defaults = this.settingsService.getDefaults();
    this.form.translate_prompt_en_to_vi = defaults.translate_prompt_en_to_vi;
    this.form.translate_prompt_vi_to_en = defaults.translate_prompt_vi_to_en;
    this.form.gemini_combine_prompt = defaults.gemini_combine_prompt;
  }

  save(): void {
    const localDamUrl = this.damServerUrl.trim() || 'http://localhost:8000';

    // Persist DAM URL to its dedicated local storage key
    this.settingsService.saveLocalDamUrl(localDamUrl);

    // Persist max image side (local-only).
    const maxSide = this.damMaxImageSide === 'native' ? null : parseInt(this.damMaxImageSide, 10);
    this.settingsService.saveDamMaxImageSide(Number.isFinite(maxSide as number) ? (maxSide as number) : null);

    // Build a backend payload for the shared settings
    const payload: AppSettings = {
      ...this.form,
      gemini_api_key: (this.form.gemini_api_key || '').trim(),
      gemini_model: (this.form.gemini_model || '').trim() || 'gemini-2.0-flash',
    };

    this.settingsService.saveAllSettings(payload).subscribe({
      next: () => {
        this.snackBar.open('Settings saved', '', { duration: 2000, panelClass: 'snack-success' });
        this.dialogRef.close(true);
      },
      error: () => {
        this.snackBar.open('Saved locally; backend save failed', '', { duration: 3000, panelClass: 'snack-error' });
        this.dialogRef.close(true);
      }
    });
  }
}
