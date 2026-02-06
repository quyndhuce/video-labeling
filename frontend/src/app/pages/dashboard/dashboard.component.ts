import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { MatToolbarModule } from '@angular/material/toolbar';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatCardModule } from '@angular/material/card';
import { MatChipsModule } from '@angular/material/chips';
import { MatMenuModule } from '@angular/material/menu';
import { MatDialogModule, MatDialog } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatTooltipModule } from '@angular/material/tooltip';
import { AuthService } from '../../core/services/auth.service';
import { ProjectService } from '../../core/services/project.service';
import { Project } from '../../core/models';

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [
    CommonModule, FormsModule,
    MatToolbarModule, MatButtonModule, MatIconModule, MatCardModule,
    MatChipsModule, MatMenuModule, MatDialogModule, MatFormFieldModule,
    MatInputModule, MatSnackBarModule, MatProgressSpinnerModule, MatTooltipModule
  ],
  template: `
    <!-- Navbar -->
    <nav class="navbar">
      <div class="nav-left">
        <div class="nav-logo">
          <mat-icon>videocam</mat-icon>
          <span>Video Annotator</span>
        </div>
      </div>
      <div class="nav-right">
        <div class="user-info" [matMenuTriggerFor]="userMenu">
          <div class="user-avatar" [style.background]="user()?.avatar_color || '#4A90D9'">
            {{ user()?.full_name?.charAt(0) || user()?.username?.charAt(0) || 'U' }}
          </div>
          <span class="user-name">{{ user()?.full_name || user()?.username }}</span>
          <mat-icon>arrow_drop_down</mat-icon>
        </div>
        <mat-menu #userMenu="matMenu">
          <button mat-menu-item (click)="logout()">
            <mat-icon>logout</mat-icon>
            <span>Logout</span>
          </button>
        </mat-menu>
      </div>
    </nav>

    <!-- Main Content -->
    <div class="dashboard-content">
      <div class="page-header">
        <div>
          <h1>My Projects</h1>
          <p>Manage your video annotation projects</p>
        </div>
        <button mat-raised-button class="create-btn" (click)="showCreateDialog = true">
          <mat-icon>add</mat-icon>
          New Project
        </button>
      </div>

      <!-- Loading -->
      <div *ngIf="loading" class="loading-container">
        <mat-spinner diameter="40"></mat-spinner>
      </div>

      <!-- Projects Grid -->
      <div *ngIf="!loading" class="projects-grid">
        <div *ngFor="let project of projects" class="project-card" (click)="openProject(project)">
          <div class="card-header">
            <div class="card-icon" [style.background]="getProjectColor(project)">
              <mat-icon>folder</mat-icon>
            </div>
            <button mat-icon-button [matMenuTriggerFor]="projectMenu" (click)="$event.stopPropagation()">
              <mat-icon>more_vert</mat-icon>
            </button>
            <mat-menu #projectMenu="matMenu">
              <button mat-menu-item (click)="deleteProject(project)">
                <mat-icon color="warn">delete</mat-icon>
                <span>Delete</span>
              </button>
            </mat-menu>
          </div>
          <h3>{{ project.name }}</h3>
          <p class="card-desc">{{ project.description || 'No description' }}</p>
          <div class="card-stats">
            <div class="stat">
              <mat-icon>segment</mat-icon>
              <span>{{ project.subpart_count || 0 }} parts</span>
            </div>
            <div class="stat">
              <mat-icon>movie</mat-icon>
              <span>{{ project.video_count || 0 }} videos</span>
            </div>
          </div>
          <div class="card-footer">
            <span class="status-badge" [class]="project.status">{{ project.status }}</span>
            <span class="date">{{ project.created_at | date:'mediumDate' }}</span>
          </div>
        </div>

        <!-- Empty State -->
        <div *ngIf="projects.length === 0" class="empty-state">
          <mat-icon>folder_open</mat-icon>
          <h3>No projects yet</h3>
          <p>Create your first annotation project to get started</p>
          <button mat-raised-button class="create-btn" (click)="showCreateDialog = true">
            <mat-icon>add</mat-icon>
            Create Project
          </button>
        </div>
      </div>
    </div>

    <!-- Create Project Dialog -->
    <div class="dialog-overlay" *ngIf="showCreateDialog" (click)="showCreateDialog = false">
      <div class="dialog-card" (click)="$event.stopPropagation()">
        <h2>Create New Project</h2>
        <mat-form-field appearance="outline">
          <mat-label>Project Name</mat-label>
          <input matInput [(ngModel)]="newProjectName" placeholder="Enter project name">
        </mat-form-field>
        <mat-form-field appearance="outline">
          <mat-label>Description</mat-label>
          <textarea matInput [(ngModel)]="newProjectDesc" rows="3" placeholder="Enter project description"></textarea>
        </mat-form-field>
        <div class="dialog-actions">
          <button mat-button (click)="showCreateDialog = false">Cancel</button>
          <button mat-raised-button class="create-btn" (click)="createProject()" [disabled]="!newProjectName">Create</button>
        </div>
      </div>
    </div>
  `,
  styles: [`
    :host {
      display: block;
      min-height: 100vh;
      background: #0f1419;
    }

    .navbar {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 0 24px;
      height: 64px;
      background: rgba(15, 20, 25, 0.95);
      backdrop-filter: blur(12px);
      border-bottom: 1px solid rgba(255, 255, 255, 0.06);
      position: sticky;
      top: 0;
      z-index: 100;
    }

    .nav-logo {
      display: flex;
      align-items: center;
      gap: 10px;
      font-size: 18px;
      font-weight: 700;
      color: #f1f5f9;
    }

    .nav-logo mat-icon {
      color: #3b82f6;
      font-size: 28px;
      width: 28px;
      height: 28px;
    }

    .nav-right {
      display: flex;
      align-items: center;
      gap: 16px;
    }

    .user-info {
      display: flex;
      align-items: center;
      gap: 8px;
      cursor: pointer;
      padding: 6px 12px;
      border-radius: 12px;
      transition: background 0.2s;
    }

    .user-info:hover {
      background: rgba(255, 255, 255, 0.06);
    }

    .user-avatar {
      width: 32px;
      height: 32px;
      border-radius: 10px;
      display: flex;
      align-items: center;
      justify-content: center;
      color: white;
      font-weight: 700;
      font-size: 14px;
    }

    .user-name {
      font-size: 14px;
      font-weight: 500;
      color: #e1e8ed;
    }

    .dashboard-content {
      max-width: 1200px;
      margin: 0 auto;
      padding: 32px 24px;
    }

    .page-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 32px;
    }

    .page-header h1 {
      font-size: 28px;
      font-weight: 700;
      color: #f1f5f9;
    }

    .page-header p {
      color: #94a3b8;
      margin-top: 4px;
    }

    .create-btn {
      background: linear-gradient(135deg, #3b82f6, #8b5cf6) !important;
      color: white !important;
      border-radius: 12px !important;
      font-weight: 600 !important;
      display: inline-flex !important;
      align-items: center;
      gap: 6px;
      overflow: hidden;
    }

    .create-btn .mat-icon {
      color: white !important;
      font-size: 18px;
      width: 18px;
      height: 18px;
    }

    .loading-container {
      display: flex;
      justify-content: center;
      padding: 64px;
    }

    .projects-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
      gap: 20px;
    }

    .project-card {
      background: #1e2432;
      border-radius: 16px;
      padding: 24px;
      cursor: pointer;
      border: 1px solid rgba(255, 255, 255, 0.06);
      transition: all 0.3s ease;
    }

    .project-card:hover {
      border-color: rgba(59, 130, 246, 0.3);
      transform: translateY(-2px);
      box-shadow: 0 8px 32px rgba(0, 0, 0, 0.3);
    }

    .card-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 16px;
    }

    .card-icon {
      width: 44px;
      height: 44px;
      border-radius: 12px;
      display: flex;
      align-items: center;
      justify-content: center;
      color: white;
    }

    .card-icon mat-icon {
      font-size: 22px;
    }

    h3 {
      font-size: 18px;
      font-weight: 600;
      color: #f1f5f9;
      margin-bottom: 8px;
    }

    .card-desc {
      color: #94a3b8;
      font-size: 13px;
      line-height: 1.5;
      margin-bottom: 16px;
      display: -webkit-box;
      -webkit-line-clamp: 2;
      -webkit-box-orient: vertical;
      overflow: hidden;
    }

    .card-stats {
      display: flex;
      gap: 16px;
      margin-bottom: 16px;
    }

    .stat {
      display: flex;
      align-items: center;
      gap: 6px;
      color: #94a3b8;
      font-size: 13px;
    }

    .stat mat-icon {
      font-size: 16px;
      width: 16px;
      height: 16px;
    }

    .card-footer {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding-top: 12px;
      border-top: 1px solid rgba(255, 255, 255, 0.06);
    }

    .status-badge {
      font-size: 12px;
      font-weight: 600;
      padding: 4px 10px;
      border-radius: 20px;
      text-transform: capitalize;
    }

    .status-badge.active {
      background: rgba(16, 185, 129, 0.15);
      color: #10b981;
    }

    .status-badge.completed {
      background: rgba(59, 130, 246, 0.15);
      color: #3b82f6;
    }

    .status-badge.archived {
      background: rgba(148, 163, 184, 0.15);
      color: #94a3b8;
    }

    .date {
      font-size: 12px;
      color: #64748b;
    }

    .empty-state {
      grid-column: 1 / -1;
      text-align: center;
      padding: 80px 20px;
    }

    .empty-state mat-icon {
      font-size: 64px;
      width: 64px;
      height: 64px;
      color: #374151;
      margin-bottom: 16px;
    }

    .empty-state h3 {
      color: #94a3b8;
    }

    .empty-state p {
      color: #64748b;
      margin-bottom: 24px;
    }

    .dialog-overlay {
      position: fixed;
      inset: 0;
      background: rgba(0, 0, 0, 0.6);
      backdrop-filter: blur(4px);
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 1000;
    }

    .dialog-card {
      background: #1e2432;
      border-radius: 20px;
      padding: 32px;
      width: 480px;
      border: 1px solid rgba(255, 255, 255, 0.08);
      box-shadow: 0 24px 48px rgba(0, 0, 0, 0.4);
    }

    .dialog-card h2 {
      font-size: 20px;
      font-weight: 700;
      color: #f1f5f9;
      margin-bottom: 24px;
    }

    .dialog-actions {
      display: flex;
      justify-content: flex-end;
      gap: 12px;
      margin-top: 8px;
    }
  `]
})
export class DashboardComponent implements OnInit {
  projects: Project[] = [];
  loading = true;
  showCreateDialog = false;
  newProjectName = '';
  newProjectDesc = '';

  user = this.authService.user;

  private colors = ['#3b82f6', '#8b5cf6', '#ec4899', '#10b981', '#f59e0b', '#ef4444', '#06b6d4'];

  constructor(
    private authService: AuthService,
    private projectService: ProjectService,
    private router: Router,
    private snackBar: MatSnackBar
  ) {}

  ngOnInit(): void {
    this.loadProjects();
  }

  loadProjects(): void {
    this.loading = true;
    this.projectService.getProjects().subscribe({
      next: (projects) => {
        this.projects = projects;
        this.loading = false;
      },
      error: () => {
        this.loading = false;
        this.snackBar.open('Failed to load projects', 'Close', { duration: 3000, panelClass: 'snack-error' });
      }
    });
  }

  createProject(): void {
    if (!this.newProjectName) return;

    this.projectService.createProject({
      name: this.newProjectName,
      description: this.newProjectDesc
    }).subscribe({
      next: (project) => {
        this.showCreateDialog = false;
        this.newProjectName = '';
        this.newProjectDesc = '';
        this.loadProjects();
        this.snackBar.open('Project created!', 'Close', { duration: 2000, panelClass: 'snack-success' });
      },
      error: () => {
        this.snackBar.open('Failed to create project', 'Close', { duration: 3000, panelClass: 'snack-error' });
      }
    });
  }

  openProject(project: Project): void {
    this.router.navigate(['/projects', project.id]);
  }

  deleteProject(project: Project): void {
    if (confirm(`Delete project "${project.name}"? This cannot be undone.`)) {
      this.projectService.deleteProject(project.id).subscribe({
        next: () => {
          this.loadProjects();
          this.snackBar.open('Project deleted', 'Close', { duration: 2000, panelClass: 'snack-success' });
        }
      });
    }
  }

  getProjectColor(project: Project): string {
    const index = this.projects.indexOf(project) % this.colors.length;
    return this.colors[index];
  }

  logout(): void {
    this.authService.logout();
  }
}
