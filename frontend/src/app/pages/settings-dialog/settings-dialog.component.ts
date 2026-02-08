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
  templateUrl: './settings-dialog.component.html',
  styleUrls: ['./settings-dialog.component.scss']
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
