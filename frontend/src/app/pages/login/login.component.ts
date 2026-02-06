import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { MatCardModule } from '@angular/material/card';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { AuthService } from '../../core/services/auth.service';

@Component({
  selector: 'app-login',
  standalone: true,
  imports: [
    CommonModule, FormsModule, RouterLink,
    MatCardModule, MatFormFieldModule, MatInputModule,
    MatButtonModule, MatIconModule, MatSnackBarModule, MatProgressSpinnerModule
  ],
  template: `
    <div class="auth-container">
      <div class="auth-bg">
        <div class="bg-gradient"></div>
        <div class="bg-pattern"></div>
      </div>
      <div class="auth-card">
        <div class="auth-header">
          <div class="logo">
            <mat-icon class="logo-icon">videocam</mat-icon>
          </div>
          <h1>Video Annotator</h1>
          <p>Sign in to continue to your workspace</p>
        </div>

        <form (ngSubmit)="onLogin()" class="auth-form">
          <mat-form-field appearance="outline">
            <mat-label>Username</mat-label>
            <input matInput [(ngModel)]="username" name="username" required>
            <mat-icon matPrefix>person</mat-icon>
          </mat-form-field>

          <mat-form-field appearance="outline">
            <mat-label>Password</mat-label>
            <input matInput [type]="hidePassword ? 'password' : 'text'" [(ngModel)]="password" name="password" required>
            <mat-icon matPrefix>lock</mat-icon>
            <button mat-icon-button matSuffix (click)="hidePassword = !hidePassword" type="button">
              <mat-icon>{{hidePassword ? 'visibility_off' : 'visibility'}}</mat-icon>
            </button>
          </mat-form-field>

          <button mat-raised-button color="primary" type="submit" [disabled]="loading" class="submit-btn">
            <mat-spinner *ngIf="loading" diameter="20"></mat-spinner>
            <span *ngIf="!loading">Sign In</span>
          </button>
        </form>

        <div class="auth-footer">
          <span>Don't have an account?</span>
          <a routerLink="/register">Create one</a>
        </div>
      </div>
    </div>
  `,
  styles: [`
    .auth-container {
      display: flex;
      align-items: center;
      justify-content: center;
      min-height: 100vh;
      position: relative;
      overflow: hidden;
    }

    .auth-bg {
      position: absolute;
      inset: 0;
      z-index: 0;
    }

    .bg-gradient {
      position: absolute;
      inset: 0;
      background: linear-gradient(135deg, #0f1419 0%, #1a1f3a 50%, #0f1419 100%);
    }

    .bg-pattern {
      position: absolute;
      inset: 0;
      background-image: radial-gradient(circle at 25% 25%, rgba(59, 130, 246, 0.1) 0%, transparent 50%),
                        radial-gradient(circle at 75% 75%, rgba(168, 85, 247, 0.1) 0%, transparent 50%);
    }

    .auth-card {
      position: relative;
      z-index: 1;
      width: 420px;
      padding: 48px;
      background: rgba(30, 36, 50, 0.9);
      backdrop-filter: blur(20px);
      border-radius: 24px;
      border: 1px solid rgba(255, 255, 255, 0.08);
      box-shadow: 0 32px 64px rgba(0, 0, 0, 0.4);
    }

    .auth-header {
      text-align: center;
      margin-bottom: 32px;
    }

    .logo {
      width: 64px;
      height: 64px;
      border-radius: 16px;
      background: linear-gradient(135deg, #3b82f6, #8b5cf6);
      display: flex;
      align-items: center;
      justify-content: center;
      margin: 0 auto 16px;
    }

    .logo-icon {
      font-size: 32px;
      width: 32px;
      height: 32px;
      color: white;
    }

    h1 {
      font-size: 24px;
      font-weight: 700;
      color: #f1f5f9;
      margin-bottom: 8px;
    }

    .auth-header p {
      color: #94a3b8;
      font-size: 14px;
    }

    .auth-form {
      display: flex;
      flex-direction: column;
      gap: 4px;
    }

    .submit-btn {
      height: 48px;
      font-size: 16px;
      font-weight: 600;
      border-radius: 12px;
      margin-top: 8px;
      background: linear-gradient(135deg, #3b82f6, #8b5cf6) !important;
    }

    .auth-footer {
      text-align: center;
      margin-top: 24px;
      font-size: 14px;
      color: #94a3b8;
    }

    .auth-footer a {
      color: #3b82f6;
      text-decoration: none;
      font-weight: 600;
      margin-left: 6px;
    }

    .auth-footer a:hover {
      text-decoration: underline;
    }

    ::ng-deep .auth-form .mat-mdc-form-field .mdc-outlined-text-field {
      --mdc-outlined-text-field-container-shape: 12px;
    }
  `]
})
export class LoginComponent {
  username = '';
  password = '';
  hidePassword = true;
  loading = false;

  constructor(
    private authService: AuthService,
    private router: Router,
    private snackBar: MatSnackBar
  ) {
    if (this.authService.isLoggedIn()) {
      this.router.navigate(['/dashboard']);
    }
  }

  onLogin(): void {
    if (!this.username || !this.password) {
      this.snackBar.open('Please fill in all fields', 'Close', { duration: 3000, panelClass: 'snack-error' });
      return;
    }

    this.loading = true;
    this.authService.login({ username: this.username, password: this.password }).subscribe({
      next: () => {
        this.router.navigate(['/dashboard']);
      },
      error: (err) => {
        this.loading = false;
        this.snackBar.open(err.error?.error || 'Login failed', 'Close', { duration: 3000, panelClass: 'snack-error' });
      }
    });
  }
}
