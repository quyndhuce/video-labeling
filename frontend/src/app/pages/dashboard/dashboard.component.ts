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
import { VideoService } from '../../core/services/video.service';
import { SettingsDialogComponent } from '../settings-dialog/settings-dialog.component';
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
  templateUrl: './dashboard.component.html',
  styleUrls: ['./dashboard.component.scss']
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
    private videoService: VideoService,
    private router: Router,
    private dialog: MatDialog,
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

  exportProject(project: Project): void {
    this.snackBar.open('Exporting project... please wait', '', { duration: 5000 });
    this.videoService.exportProjectAnnotations(project.id).subscribe({
      next: (data) => {
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `dataset_${project.name}.json`;
        a.click();
        URL.revokeObjectURL(url);
        this.snackBar.open('Project dataset exported!', '', { duration: 2000, panelClass: 'snack-success' });
      },
      error: () => {
        this.snackBar.open('Failed to export project', '', { duration: 3000, panelClass: 'snack-error' });
      }
    });
  }

  getProjectColor(project: Project): string {
    const index = this.projects.indexOf(project) % this.colors.length;
    return this.colors[index];
  }

  openSettings(): void {
    this.dialog.open(SettingsDialogComponent, {
      width: '600px',
      panelClass: 'settings-dialog'
    });
  }

  logout(): void {
    this.authService.logout();
  }
}
