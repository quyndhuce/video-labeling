import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { MatToolbarModule } from '@angular/material/toolbar';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatTabsModule } from '@angular/material/tabs';
import { MatChipsModule } from '@angular/material/chips';
import { MatMenuModule } from '@angular/material/menu';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatBadgeModule } from '@angular/material/badge';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { AuthService } from '../../core/services/auth.service';
import { ProjectService } from '../../core/services/project.service';
import { VideoService } from '../../core/services/video.service';
import { SettingsDialogComponent } from '../settings-dialog/settings-dialog.component';
import { Project, SubPart, VideoItem, User, Tag } from '../../core/models';

@Component({
  selector: 'app-project-detail',
  standalone: true,
  imports: [
    CommonModule, FormsModule,
    MatToolbarModule, MatButtonModule, MatIconModule, MatTabsModule,
    MatChipsModule, MatMenuModule, MatFormFieldModule, MatInputModule,
    MatSelectModule, MatSnackBarModule, MatProgressSpinnerModule,
    MatProgressBarModule, MatTooltipModule, MatBadgeModule, MatDialogModule
  ],
  template: `
    <!-- Navbar -->
    <nav class="navbar">
      <div class="nav-left">
        <button mat-icon-button (click)="goBack()">
          <mat-icon>arrow_back</mat-icon>
        </button>
        <div class="nav-title">
          <h2>{{ project?.name }}</h2>
          <span class="status-badge" [class]="project?.status">{{ project?.status }}</span>
          <button mat-icon-button matTooltip="Edit Project" (click)="openEditProjectDialog()" *ngIf="project">
            <mat-icon>edit</mat-icon>
          </button>
          <button mat-icon-button matTooltip="Manage Tags" (click)="openTagManager()" *ngIf="project">
            <mat-icon>label</mat-icon>
          </button>
        </div>
      </div>
      <div class="nav-right">
        <div class="user-info" [matMenuTriggerFor]="userMenu">
          <div class="user-avatar" [style.background]="user()?.avatar_color || '#4A90D9'">
            {{ user()?.full_name?.charAt(0) || 'U' }}
          </div>
          <mat-icon>arrow_drop_down</mat-icon>
        </div>
        <mat-menu #userMenu="matMenu">
          <button mat-menu-item (click)="openSettings()">
            <mat-icon>settings</mat-icon>
            <span>Settings</span>
          </button>
          <button mat-menu-item (click)="logout()">
            <mat-icon>logout</mat-icon>
            <span>Logout</span>
          </button>
        </mat-menu>
      </div>
    </nav>

    <div class="content" *ngIf="project">
      <!-- Breadcrumb -->
      <div class="breadcrumb">
        <span class="crumb clickable" (click)="selectedSubpart = null; subpartVideos = []">
          <mat-icon>folder</mat-icon> {{ project.name }}
        </span>
        <ng-container *ngIf="selectedSubpart">
          <mat-icon class="crumb-sep">chevron_right</mat-icon>
          <span class="crumb active">
            <mat-icon>dashboard</mat-icon> {{ selectedSubpart.name }}
          </span>
        </ng-container>
      </div>

      <!-- ========== SUB PARTS VIEW ========== -->
      <div *ngIf="!selectedSubpart" class="subparts-view">
        <div class="section-header">
          <h3>Sub Parts ({{ project.subparts?.length || 0 }})</h3>
          <button mat-raised-button class="primary-btn" (click)="showSubpartDialog = true">
            <mat-icon>add</mat-icon> Add Sub Part
          </button>
        </div>

        <!-- Subpart Filters -->
        <div class="filter-bar" *ngIf="project.subparts?.length">
          <button class="filter-chip" [class.active]="subpartFilter === 'all'" (click)="setSubpartFilter('all')">
            All <span class="filter-count">{{ project.subparts?.length }}</span>
          </button>
          <button class="filter-chip" [class.active]="subpartFilter === 'active'" (click)="setSubpartFilter('active')">
            <span class="dot active"></span> Active <span class="filter-count">{{ getSubpartCountByStatus('active') }}</span>
          </button>
          <button class="filter-chip" [class.active]="subpartFilter === 'pending'" (click)="setSubpartFilter('pending')">
            <span class="dot pending"></span> Pending <span class="filter-count">{{ getSubpartCountByStatus('pending') }}</span>
          </button>
          <button class="filter-chip" [class.active]="subpartFilter === 'completed'" (click)="setSubpartFilter('completed')">
            <span class="dot completed"></span> Completed <span class="filter-count">{{ getSubpartCountByStatus('completed') }}</span>
          </button>
        </div>

        <div class="subparts-grid">
          <div *ngFor="let sp of paginatedSubparts; let i = index"
               class="subpart-card" (click)="selectSubpart(sp)">
            <div class="sp-header">
              <div class="sp-order">{{ (subpartPage - 1) * subpartPageSize + i + 1 }}</div>
              <div class="sp-info">
                <h4>{{ sp.name }}</h4>
                <p>{{ sp.description || 'No description' }}</p>
              </div>
              <div class="sp-actions" (click)="$event.stopPropagation()">
                <span class="status-badge" [class]="sp.status">{{ sp.status }}</span>
                <button mat-icon-button [matMenuTriggerFor]="spMenu">
                  <mat-icon>more_vert</mat-icon>
                </button>
                <mat-menu #spMenu="matMenu">
                  <button mat-menu-item (click)="openEditSubpartDialog(sp)">
                    <mat-icon>edit</mat-icon>
                    <span>Edit</span>
                  </button>
                  <button mat-menu-item (click)="deleteSubpart(sp)">
                    <mat-icon color="warn">delete</mat-icon>
                    <span>Delete</span>
                  </button>
                </mat-menu>
              </div>
            </div>
            <div class="sp-users">
              <mat-icon>people</mat-icon>
              <div *ngIf="sp.assigned_user_details?.length; else noUsers" class="user-chips">
                <div *ngFor="let u of sp.assigned_user_details" class="user-chip"
                  [style.background]="u.avatar_color || '#4A90D9'">
                  <span class="chip-avatar">{{ u.full_name?.charAt(0) || u.username?.charAt(0) }}</span>
                  <span class="chip-name">{{ u.full_name || u.username }}</span>
                </div>
              </div>
              <ng-template #noUsers>
                <span class="no-users">No users assigned</span>
              </ng-template>
            </div>
            <div class="sp-reviewer" *ngIf="sp.reviewer_details">
              <mat-icon>verified_user</mat-icon>
              <span class="reviewer-label">Reviewer:</span>
              <div class="user-chip reviewer-chip"
                   [style.background]="sp.reviewer_details.avatar_color || '#e8590c'">
                <span class="chip-avatar">{{ sp.reviewer_details.full_name?.charAt(0) || sp.reviewer_details.username?.charAt(0) }}</span>
                <span class="chip-name">{{ sp.reviewer_details.full_name || sp.reviewer_details.username }}</span>
              </div>
            </div>
            <div class="sp-reviewer" *ngIf="!sp.reviewer_details && !sp.reviewer">
              <mat-icon>verified_user</mat-icon>
              <span class="no-users">No reviewer assigned</span>
            </div>
            <div class="sp-footer">
              <div class="sp-stat">
                <mat-icon>movie</mat-icon>
                <span>{{ sp.video_count || 0 }} videos</span>
              </div>
              <mat-icon class="sp-arrow">arrow_forward</mat-icon>
            </div>
          </div>

          <div *ngIf="!project.subparts?.length" class="empty-section">
            <mat-icon>dashboard_customize</mat-icon>
            <p>No sub parts yet. Create one to start organizing videos.</p>
            <button mat-raised-button class="primary-btn" (click)="showSubpartDialog = true">
              <mat-icon>add</mat-icon> Create Sub Part
            </button>
          </div>
          <div *ngIf="project.subparts?.length && !filteredSubparts.length" class="empty-section">
            <mat-icon>filter_list_off</mat-icon>
            <p>No sub parts match the selected filter.</p>
          </div>
        </div>

        <!-- Subpart Pagination -->
        <div class="pagination-bar" *ngIf="subpartTotalPages > 1">
          <button mat-icon-button [disabled]="subpartPage <= 1" (click)="subpartPage = 1">
            <mat-icon>first_page</mat-icon>
          </button>
          <button mat-icon-button [disabled]="subpartPage <= 1" (click)="subpartPage = subpartPage - 1">
            <mat-icon>chevron_left</mat-icon>
          </button>
          <span class="page-info">Page {{ subpartPage }} of {{ subpartTotalPages }}</span>
          <button mat-icon-button [disabled]="subpartPage >= subpartTotalPages" (click)="subpartPage = subpartPage + 1">
            <mat-icon>chevron_right</mat-icon>
          </button>
          <button mat-icon-button [disabled]="subpartPage >= subpartTotalPages" (click)="subpartPage = subpartTotalPages">
            <mat-icon>last_page</mat-icon>
          </button>
          <span class="page-size-label">{{ filteredSubparts.length }} total</span>
        </div>
      </div>

      <!-- ========== SUBPART VIDEOS VIEW ========== -->
      <div *ngIf="selectedSubpart" class="videos-view">
        <div class="section-header">
          <div class="section-title-group">
            <h3>{{ selectedSubpart.name }}</h3>
            <span class="video-count-badge" *ngIf="videoFilter === 'all'">{{ subpartVideos.length }} videos</span>
            <span class="video-count-badge" *ngIf="videoFilter !== 'all'">{{ filteredVideos.length }} / {{ subpartVideos.length }} videos</span>
          </div>
          <div class="header-actions">
            <button mat-raised-button class="primary-btn" (click)="triggerUpload()">
              <mat-icon>cloud_upload</mat-icon> Upload Video
            </button>
            <input type="file" #fileInput accept="video/*" (change)="onFileSelected($event)" style="display:none" multiple>
          </div>
        </div>

        <!-- Upload Progress -->
        <div *ngIf="uploading" class="upload-progress">
          <mat-progress-bar mode="indeterminate"></mat-progress-bar>
          <span>Uploading video...</span>
        </div>

        <!-- Stats Summary -->
        <div *ngIf="subpartVideos.length" class="stats-summary">
          <div class="stat-item">
            <mat-icon>movie</mat-icon>
            <div class="stat-text">
              <span class="stat-value">{{ subpartVideos.length }}</span>
              <span class="stat-label">Videos</span>
            </div>
          </div>
          <div class="stat-item">
            <mat-icon>content_cut</mat-icon>
            <div class="stat-text">
              <span class="stat-value">{{ getTotalSegments() }}</span>
              <span class="stat-label">Segments</span>
            </div>
          </div>
          <div class="stat-item">
            <mat-icon>crop_free</mat-icon>
            <div class="stat-text">
              <span class="stat-value">{{ getTotalObjects() }}</span>
              <span class="stat-label">Objects</span>
            </div>
          </div>
          <div class="stat-item">
            <mat-icon>subtitles</mat-icon>
            <div class="stat-text">
              <span class="stat-value">{{ getTotalCaptions() }}</span>
              <span class="stat-label">Captions</span>
            </div>
          </div>
        </div>

        <!-- Video Filters -->
        <div class="filter-bar" *ngIf="subpartVideos.length > 0">
          <button class="filter-chip" [class.active]="videoFilter === 'all'" (click)="setVideoFilter('all')">
            All <span class="filter-count">{{ subpartVideos.length }}</span>
          </button>
          <button class="filter-chip" [class.active]="videoFilter === 'not_submitted'" (click)="setVideoFilter('not_submitted')">
            <mat-icon class="filter-icon">radio_button_unchecked</mat-icon> Not Submitted
            <span class="filter-count">{{ getVideoCountByStatus('not_submitted') }}</span>
          </button>
          <button class="filter-chip" [class.active]="videoFilter === 'pending_review'" (click)="setVideoFilter('pending_review')">
            <mat-icon class="filter-icon">hourglass_empty</mat-icon> Pending
            <span class="filter-count">{{ getVideoCountByStatus('pending_review') }}</span>
          </button>
          <button class="filter-chip" [class.active]="videoFilter === 'approved'" (click)="setVideoFilter('approved')">
            <mat-icon class="filter-icon">check_circle</mat-icon> Approved
            <span class="filter-count">{{ getVideoCountByStatus('approved') }}</span>
          </button>
          <button class="filter-chip" [class.active]="videoFilter === 'rejected'" (click)="setVideoFilter('rejected')">
            <mat-icon class="filter-icon">cancel</mat-icon> Rejected
            <span class="filter-count">{{ getVideoCountByStatus('rejected') }}</span>
          </button>
        </div>

        <div class="videos-grid">
          <div *ngFor="let video of paginatedVideos" class="video-card" (click)="openEditor(video)">
            <div class="video-thumb">
              <img *ngIf="video.thumbnail_url" [src]="video.thumbnail_url" alt="thumbnail" class="thumb-img">
              <mat-icon *ngIf="!video.thumbnail_url">play_circle</mat-icon>
              <div class="thumb-play-icon">
                <mat-icon>play_circle_filled</mat-icon>
              </div>
              <div class="video-duration">{{ formatDuration(video.duration) }}</div>
            </div>
            <div class="video-info">
              <h4 [matTooltip]="video.original_name">{{ video.original_name }}</h4>
              <div class="video-tags" *ngIf="getVideoTags(video).length">
                <span class="tag-chip" *ngFor="let tag of getVideoTags(video)"
                      [style.background]="tag.color + '22'" [style.color]="tag.color"
                      [style.border-color]="tag.color + '44'">
                  {{ tag.name }}
                </span>
              </div>
              <!-- Annotators -->
              <div class="video-annotators" *ngIf="video.annotators?.length">
                <mat-icon>people</mat-icon>
                <div *ngFor="let uid of video.annotators" class="user-chip small"
                     [style.background]="getUserById(uid)?.avatar_color || '#4A90D9'"
                     [matTooltip]="getUserById(uid)?.full_name || getUserById(uid)?.username || ''">
                  {{ (getUserById(uid)?.full_name || getUserById(uid)?.username || '?').charAt(0) }}
                </div>
              </div>
              <div class="video-stats">
                <div class="stat-row">
                  <div class="mini-stat" [class.ok]="(video.segments_count || 0) > 0"
                       [matTooltip]="(video.segments_count || 0) + ' segments'">
                    <mat-icon>content_cut</mat-icon>
                    <span>{{ video.segments_count || 0 }}</span>
                  </div>
                  <div class="mini-stat" [class.ok]="(video.objects_count || 0) > 0"
                       [matTooltip]="(video.objects_count || 0) + ' objects'">
                    <mat-icon>crop_free</mat-icon>
                    <span>{{ video.objects_count || 0 }}</span>
                  </div>
                  <div class="mini-stat"
                       [class.ok]="(video.captions_count || 0) > 0"
                       [class.warn]="(video.objects_count || 0) > 0 && (video.captions_count || 0) < (video.objects_count || 0)"
                       [matTooltip]="getCaptionTooltip(video)">
                    <mat-icon>subtitles</mat-icon>
                    <span>{{ video.captions_count || 0 }}<span *ngIf="(video.objects_count || 0) > 0">/{{ video.objects_count }}</span></span>
                  </div>
                </div>
                <div class="annotation-bar">
                  <div class="bar-fill" [style.width.%]="getAnnotationProgress(video)"
                       [class.complete]="getAnnotationProgress(video) === 100"
                       [class.partial]="getAnnotationProgress(video) > 0 && getAnnotationProgress(video) < 100">
                  </div>
                </div>
              </div>
              <div class="video-footer">
                <div class="step-indicator">
                  <div class="step" [class.active]="video.current_step >= 1" [class.completed]="video.current_step > 1"
                       matTooltip="Segmentation">1</div>
                  <div class="step-line" [class.completed]="video.current_step > 1"></div>
                  <div class="step" [class.active]="video.current_step >= 2" [class.completed]="video.current_step > 2"
                       matTooltip="Object Regions">2</div>
                  <div class="step-line" [class.completed]="video.current_step > 2"></div>
                  <div class="step" [class.active]="video.current_step >= 3" [class.completed]="video.current_step > 3"
                       matTooltip="Captioning">3</div>
                </div>
                <div class="video-actions-row">
                  <button mat-icon-button (click)="openAnnotatorDialog(video); $event.stopPropagation()"
                          matTooltip="Assign Annotators">
                    <mat-icon>person_add</mat-icon>
                  </button>
                  <button mat-icon-button (click)="openVideoTagDialog(video); $event.stopPropagation()"
                          matTooltip="Edit Tags">
                    <mat-icon>label</mat-icon>
                  </button>
                  <button mat-icon-button (click)="deleteVideo(video); $event.stopPropagation()"
                          matTooltip="Delete video">
                    <mat-icon>delete</mat-icon>
                  </button>
                </div>
              </div>
              <!-- Review Status Bar -->
              <div class="review-bar" *ngIf="selectedSubpart?.reviewer">
                <div class="review-status-row">
                  <span class="review-badge" [class]="video.review_status || 'not_submitted'">
                    <mat-icon>{{ getReviewIcon(video.review_status) }}</mat-icon>
                    {{ getReviewLabel(video.review_status) }}
                  </span>
                  <span class="review-spacer"></span>
                  <!-- Annotator: Submit for Review -->
                  <button *ngIf="canSubmitForReview(video)" mat-stroked-button class="submit-review-btn"
                          (click)="submitForReview(video); $event.stopPropagation()" matTooltip="Submit for cross-check review">
                    <mat-icon>send</mat-icon> Submit
                  </button>
                  <!-- Reviewer: Approve / Reject -->
                  <ng-container *ngIf="canReview(video)">
                    <button mat-stroked-button class="approve-btn"
                            (click)="reviewAction(video, 'approve'); $event.stopPropagation()">
                      <mat-icon>check_circle</mat-icon> Approve
                    </button>
                    <button mat-stroked-button class="reject-btn"
                            (click)="openRejectDialog(video); $event.stopPropagation()">
                      <mat-icon>cancel</mat-icon> Reject
                    </button>
                  </ng-container>
                </div>
                <div class="review-comment-text" *ngIf="video.review_comment"
                     [class.rejected]="video.review_status === 'rejected'">
                  <mat-icon>comment</mat-icon>
                  <span>{{ video.review_comment }}</span>
                </div>
              </div>
            </div>
          </div>

          <div *ngIf="subpartVideos.length === 0 && !loadingVideos" class="empty-section">
            <mat-icon>video_library</mat-icon>
            <p>No videos in this sub part yet.</p>
            <button mat-raised-button class="primary-btn" (click)="triggerUpload()">
              <mat-icon>cloud_upload</mat-icon> Upload Video
            </button>
          </div>

          <div *ngIf="subpartVideos.length > 0 && !filteredVideos.length" class="empty-section">
            <mat-icon>filter_list_off</mat-icon>
            <p>No videos match the selected filter.</p>
          </div>

          <div *ngIf="loadingVideos" class="empty-section">
            <mat-spinner diameter="36"></mat-spinner>
          </div>
        </div>

        <!-- Video Pagination -->
        <div class="pagination-bar" *ngIf="videoTotalPages > 1">
          <button mat-icon-button [disabled]="videoPage <= 1" (click)="videoPage = 1">
            <mat-icon>first_page</mat-icon>
          </button>
          <button mat-icon-button [disabled]="videoPage <= 1" (click)="videoPage = videoPage - 1">
            <mat-icon>chevron_left</mat-icon>
          </button>
          <span class="page-info">Page {{ videoPage }} of {{ videoTotalPages }}</span>
          <button mat-icon-button [disabled]="videoPage >= videoTotalPages" (click)="videoPage = videoPage + 1">
            <mat-icon>chevron_right</mat-icon>
          </button>
          <button mat-icon-button [disabled]="videoPage >= videoTotalPages" (click)="videoPage = videoTotalPages">
            <mat-icon>last_page</mat-icon>
          </button>
          <span class="page-size-label">{{ filteredVideos.length }} total</span>
        </div>
      </div>
    </div>

    <!-- Loading -->
    <div *ngIf="!project" class="loading-page">
      <mat-spinner diameter="40"></mat-spinner>
    </div>

    <!-- Create Subpart Dialog -->
    <div class="dialog-overlay" *ngIf="showSubpartDialog" (click)="showSubpartDialog = false">
      <div class="dialog-card" (click)="$event.stopPropagation()">
        <h2>Add Sub Part</h2>
        <mat-form-field appearance="outline">
          <mat-label>Name</mat-label>
          <input matInput [(ngModel)]="newSubpartName" placeholder="Sub part name">
        </mat-form-field>
        <mat-form-field appearance="outline">
          <mat-label>Description</mat-label>
          <textarea matInput [(ngModel)]="newSubpartDesc" rows="2"></textarea>
        </mat-form-field>
        <mat-form-field appearance="outline">
          <mat-label>Assign Users</mat-label>
          <mat-select [(ngModel)]="selectedUsers" multiple>
            <mat-option *ngFor="let u of allUsers" [value]="u.id">
              {{ u.full_name || u.username }}
            </mat-option>
          </mat-select>
        </mat-form-field>
        <mat-form-field appearance="outline">
          <mat-label>Cross-Check Reviewer</mat-label>
          <mat-select [(ngModel)]="selectedReviewer">
            <mat-option [value]="''">— None —</mat-option>
            <mat-option *ngFor="let u of allUsers" [value]="u.id">
              {{ u.full_name || u.username }}
            </mat-option>
          </mat-select>
        </mat-form-field>
        <div class="dialog-actions">
          <button mat-button (click)="showSubpartDialog = false">Cancel</button>
          <button mat-raised-button class="primary-btn" (click)="createSubpart()" [disabled]="!newSubpartName">Create</button>
        </div>
      </div>
    </div>

    <!-- Edit Project Dialog -->
    <div class="dialog-overlay" *ngIf="showEditProjectDialog" (click)="showEditProjectDialog = false">
      <div class="dialog-card" (click)="$event.stopPropagation()">
        <h2>Edit Project</h2>
        <mat-form-field appearance="outline">
          <mat-label>Name</mat-label>
          <input matInput [(ngModel)]="editProjectName">
        </mat-form-field>
        <mat-form-field appearance="outline">
          <mat-label>Description</mat-label>
          <textarea matInput [(ngModel)]="editProjectDesc" rows="3"></textarea>
        </mat-form-field>
        <mat-form-field appearance="outline">
          <mat-label>Status</mat-label>
          <mat-select [(ngModel)]="editProjectStatus">
            <mat-option value="active">Active</mat-option>
            <mat-option value="pending">Pending</mat-option>
            <mat-option value="completed">Completed</mat-option>
          </mat-select>
        </mat-form-field>
        <div class="dialog-actions">
          <button mat-button (click)="showEditProjectDialog = false">Cancel</button>
          <button mat-raised-button class="primary-btn" (click)="saveEditProject()" [disabled]="!editProjectName">Save</button>
        </div>
      </div>
    </div>

    <!-- Edit Subpart Dialog -->
    <div class="dialog-overlay" *ngIf="showEditSubpartDialog" (click)="showEditSubpartDialog = false">
      <div class="dialog-card" (click)="$event.stopPropagation()">
        <h2>Edit Sub Part</h2>
        <mat-form-field appearance="outline">
          <mat-label>Name</mat-label>
          <input matInput [(ngModel)]="editSubpartName">
        </mat-form-field>
        <mat-form-field appearance="outline">
          <mat-label>Description</mat-label>
          <textarea matInput [(ngModel)]="editSubpartDesc" rows="2"></textarea>
        </mat-form-field>
        <mat-form-field appearance="outline">
          <mat-label>Status</mat-label>
          <mat-select [(ngModel)]="editSubpartStatus">
            <mat-option value="active">Active</mat-option>
            <mat-option value="pending">Pending</mat-option>
            <mat-option value="completed">Completed</mat-option>
          </mat-select>
        </mat-form-field>
        <mat-form-field appearance="outline">
          <mat-label>Assigned Users</mat-label>
          <mat-select [(ngModel)]="editSubpartUsers" multiple>
            <mat-option *ngFor="let u of allUsers" [value]="u.id">
              {{ u.full_name || u.username }}
            </mat-option>
          </mat-select>
        </mat-form-field>
        <mat-form-field appearance="outline">
          <mat-label>Cross-Check Reviewer</mat-label>
          <mat-select [(ngModel)]="editSubpartReviewer">
            <mat-option [value]="''">— None —</mat-option>
            <mat-option *ngFor="let u of allUsers" [value]="u.id">
              {{ u.full_name || u.username }}
            </mat-option>
          </mat-select>
        </mat-form-field>
        <div class="dialog-actions">
          <button mat-button (click)="showEditSubpartDialog = false">Cancel</button>
          <button mat-raised-button class="primary-btn" (click)="saveEditSubpart()" [disabled]="!editSubpartName">Save</button>
        </div>
      </div>
    </div>

    <!-- Tag Manager Dialog -->
    <div class="dialog-overlay" *ngIf="showTagManager" (click)="showTagManager = false">
      <div class="dialog-card tag-manager-card" (click)="$event.stopPropagation()">
        <h2>Manage Tags</h2>
        <div class="tag-create-row">
          <input class="tag-input" [(ngModel)]="newTagName" placeholder="Tag name" (keydown.enter)="createTag()">
          <input type="color" class="tag-color-input" [(ngModel)]="newTagColor">
          <button mat-mini-fab class="primary-btn" (click)="createTag()" [disabled]="!newTagName">
            <mat-icon>add</mat-icon>
          </button>
        </div>
        <div class="tags-list">
          <div *ngFor="let tag of projectTags" class="tag-row">
            <span class="tag-dot" [style.background]="tag.color"></span>
            <span class="tag-name" *ngIf="editingTagId !== tag.id">{{ tag.name }}</span>
            <input *ngIf="editingTagId === tag.id" class="tag-input tag-edit-input"
                   [(ngModel)]="editingTagName" (keydown.enter)="saveEditTag(tag)"
                   (keydown.escape)="editingTagId = ''">
            <span class="tag-spacer"></span>
            <button mat-icon-button *ngIf="editingTagId !== tag.id" (click)="startEditTag(tag)" matTooltip="Edit">
              <mat-icon>edit</mat-icon>
            </button>
            <button mat-icon-button *ngIf="editingTagId === tag.id" (click)="saveEditTag(tag)" matTooltip="Save">
              <mat-icon>check</mat-icon>
            </button>
            <button mat-icon-button (click)="deleteTag(tag)" matTooltip="Delete">
              <mat-icon>delete</mat-icon>
            </button>
          </div>
          <div *ngIf="!projectTags.length" class="empty-tags">
            <span>No tags yet. Create one above.</span>
          </div>
        </div>
        <div class="dialog-actions">
          <button mat-raised-button (click)="showTagManager = false">Close</button>
        </div>
      </div>
    </div>

    <!-- Video Tag Assignment Dialog -->
    <div class="dialog-overlay" *ngIf="showVideoTagDialog" (click)="showVideoTagDialog = false">
      <div class="dialog-card" (click)="$event.stopPropagation()">
        <h2>Assign Tags</h2>
        <p class="dialog-subtitle">{{ editingVideo?.original_name }}</p>
        <div class="tag-select-list">
          <div *ngFor="let tag of projectTags" class="tag-select-row"
               (click)="toggleVideoTag(tag.id)" [class.selected]="videoTagIds.includes(tag.id)">
            <span class="tag-dot" [style.background]="tag.color"></span>
            <span class="tag-name">{{ tag.name }}</span>
            <mat-icon *ngIf="videoTagIds.includes(tag.id)" class="tag-check">check_circle</mat-icon>
          </div>
          <div *ngIf="!projectTags.length" class="empty-tags">
            <span>No tags available. Create tags first from the tag manager.</span>
          </div>
        </div>
        <div class="dialog-actions">
          <button mat-button (click)="showVideoTagDialog = false">Cancel</button>
          <button mat-raised-button class="primary-btn" (click)="saveVideoTags()">Save</button>
        </div>
      </div>
    </div>

    <!-- Annotator Assignment Dialog -->
    <div class="dialog-overlay" *ngIf="showAnnotatorDialog" (click)="showAnnotatorDialog = false">
      <div class="dialog-card" (click)="$event.stopPropagation()">
        <h2>Assign Annotators</h2>
        <p class="dialog-subtitle">{{ annotatorVideo?.original_name }}</p>
        <mat-form-field appearance="outline">
          <mat-label>Annotators</mat-label>
          <mat-select [(ngModel)]="annotatorVideoIds" multiple>
            <mat-option *ngFor="let u of allUsers" [value]="u.id">
              {{ u.full_name || u.username }}
            </mat-option>
          </mat-select>
        </mat-form-field>
        <div class="dialog-actions">
          <button mat-button (click)="showAnnotatorDialog = false">Cancel</button>
          <button mat-raised-button class="primary-btn" (click)="saveAnnotators()">Save</button>
        </div>
      </div>
    </div>

    <!-- Review Reject Dialog -->
    <div class="dialog-overlay" *ngIf="showRejectDialog" (click)="showRejectDialog = false">
      <div class="dialog-card" (click)="$event.stopPropagation()">
        <h2>Reject Video</h2>
        <p class="dialog-subtitle">{{ rejectingVideo?.original_name }}</p>
        <mat-form-field appearance="outline">
          <mat-label>Reason / Comment</mat-label>
          <textarea matInput [(ngModel)]="rejectComment" rows="4"
                    placeholder="Describe what needs to be fixed..."></textarea>
        </mat-form-field>
        <div class="dialog-actions">
          <button mat-button (click)="showRejectDialog = false">Cancel</button>
          <button mat-raised-button class="reject-btn" (click)="confirmReject()">
            <mat-icon>cancel</mat-icon> Reject
          </button>
        </div>
      </div>
    </div>
  `,
  styles: [`
    :host { display: block; min-height: 100vh; background: #0f1419; }

    .navbar {
      display: flex; align-items: center; justify-content: space-between;
      padding: 0 24px; height: 64px; background: rgba(15, 20, 25, 0.95);
      border-bottom: 1px solid rgba(255,255,255,0.06); position: sticky; top: 0; z-index: 100;
    }

    .nav-left { display: flex; align-items: center; gap: 12px; }
    .nav-title { display: flex; align-items: center; gap: 12px; }
    .nav-title h2 { font-size: 18px; font-weight: 600; color: #f1f5f9; }
    .nav-right { display: flex; align-items: center; gap: 12px; }

    .user-info {
      display: flex; align-items: center; gap: 6px; cursor: pointer;
      padding: 6px 10px; border-radius: 10px;
    }
    .user-info:hover { background: rgba(255,255,255,0.06); }
    .user-avatar {
      width: 32px; height: 32px; border-radius: 10px;
      display: flex; align-items: center; justify-content: center;
      color: white; font-weight: 700; font-size: 14px;
    }

    .status-badge {
      font-size: 11px; font-weight: 600; padding: 3px 8px;
      border-radius: 16px; text-transform: capitalize;
    }
    .status-badge.active { background: rgba(16,185,129,0.15); color: #10b981; }
    .status-badge.pending { background: rgba(245,158,11,0.15); color: #f59e0b; }
    .status-badge.completed { background: rgba(59,130,246,0.15); color: #3b82f6; }

    .content { max-width: 1200px; margin: 0 auto; padding: 24px; }

    /* Breadcrumb */
    .breadcrumb {
      display: flex; align-items: center; gap: 8px; margin-bottom: 24px;
      padding: 12px 16px; background: #1a1f2e; border-radius: 10px;
      border: 1px solid rgba(255,255,255,0.04);
    }
    .crumb {
      display: flex; align-items: center; gap: 6px; color: #94a3b8;
      font-size: 14px; font-weight: 500;
    }
    .crumb.clickable { cursor: pointer; }
    .crumb.clickable:hover { color: #3b82f6; }
    .crumb.active { color: #f1f5f9; font-weight: 600; }
    .crumb mat-icon { font-size: 18px; width: 18px; height: 18px; }
    .crumb-sep { color: #475569; font-size: 18px; width: 18px; height: 18px; }

    .section-header {
      display: flex; align-items: center; justify-content: space-between; margin-bottom: 24px;
    }
    .section-header h3 { font-size: 20px; font-weight: 600; color: #f1f5f9; }
    .section-title-group { display: flex; align-items: center; gap: 12px; }
    .video-count-badge {
      font-size: 12px; font-weight: 600; padding: 4px 10px;
      border-radius: 16px; background: rgba(59,130,246,0.15); color: #3b82f6;
    }

    .primary-btn {
      background: linear-gradient(135deg, #3b82f6, #8b5cf6) !important;
      color: white !important; border-radius: 10px !important; font-weight: 600 !important;
      display: inline-flex !important; align-items: center; gap: 6px; overflow: hidden;
    }
    .primary-btn .mat-icon { color: white !important; font-size: 18px; width: 18px; height: 18px; }

    /* Subparts Grid */
    .subparts-grid {
      display: grid; grid-template-columns: repeat(auto-fill, minmax(380px, 1fr)); gap: 16px;
    }

    .subpart-card {
      background: #1e2432; border-radius: 12px; padding: 20px;
      border: 1px solid rgba(255,255,255,0.06); cursor: pointer;
      transition: all 0.2s;
    }
    .subpart-card:hover {
      border-color: rgba(59,130,246,0.3); transform: translateY(-2px);
      box-shadow: 0 8px 24px rgba(0,0,0,0.3);
    }

    .sp-header { display: flex; align-items: flex-start; gap: 16px; }
    .sp-order {
      width: 36px; height: 36px; border-radius: 10px;
      background: rgba(59,130,246,0.15); color: #3b82f6;
      display: flex; align-items: center; justify-content: center;
      font-weight: 700; flex-shrink: 0;
    }
    .sp-info { flex: 1; }
    .sp-info h4 { font-size: 16px; font-weight: 600; color: #f1f5f9; }
    .sp-info p { color: #94a3b8; font-size: 13px; margin-top: 4px; }
    .sp-actions { display: flex; align-items: center; gap: 8px; }

    .sp-users {
      display: flex; align-items: center; gap: 8px; margin-top: 12px;
      padding-top: 12px; border-top: 1px solid rgba(255,255,255,0.04);
    }
    .sp-users > mat-icon { color: #64748b; font-size: 18px; }
    .user-chips { display: flex; gap: 6px; flex-wrap: wrap; }
    .user-chip {
      display: flex; align-items: center; gap: 6px; padding: 2px 10px 2px 2px;
      border-radius: 16px; font-size: 12px; color: white; font-weight: 600;
    }
    .user-chip .chip-avatar {
      width: 22px; height: 22px; border-radius: 50%;
      display: flex; align-items: center; justify-content: center;
      background: rgba(0,0,0,0.2); font-size: 11px; font-weight: 700;
      flex-shrink: 0; line-height: 1;
    }
    .user-chip .chip-name { font-weight: 500; }
    .no-users { color: #64748b; font-size: 13px; }

    .sp-footer {
      display: flex; align-items: center; justify-content: space-between;
      margin-top: 12px; padding-top: 12px; border-top: 1px solid rgba(255,255,255,0.04);
    }
    .sp-stat { display: flex; align-items: center; gap: 6px; color: #94a3b8; font-size: 13px; }
    .sp-stat mat-icon { font-size: 16px; width: 16px; height: 16px; color: #64748b; }
    .sp-arrow { color: #475569; transition: color 0.2s; }
    .subpart-card:hover .sp-arrow { color: #3b82f6; }

    /* Stats Summary */
    .stats-summary {
      display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin-bottom: 24px;
    }
    .stat-item {
      display: flex; align-items: center; gap: 12px; padding: 16px;
      background: #1a1f2e; border-radius: 10px; border: 1px solid rgba(255,255,255,0.04);
    }
    .stat-item mat-icon { color: #3b82f6; font-size: 24px; width: 24px; height: 24px; }
    .stat-text { display: flex; flex-direction: column; }
    .stat-value { font-size: 20px; font-weight: 700; color: #f1f5f9; }
    .stat-label { font-size: 11px; color: #64748b; text-transform: uppercase; letter-spacing: 0.5px; }

    .upload-progress {
      display: flex; flex-direction: column; gap: 8px; margin-bottom: 16px;
      padding: 12px; background: rgba(59,130,246,0.1); border-radius: 10px;
    }
    .upload-progress span { color: #94a3b8; font-size: 13px; }

    /* Videos Grid */
    .videos-grid {
      display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 16px;
    }

    .video-card {
      background: #1e2432; border-radius: 12px; overflow: hidden;
      border: 1px solid rgba(255,255,255,0.06); cursor: pointer;
      transition: all 0.2s;
    }
    .video-card:hover {
      border-color: rgba(59,130,246,0.3); transform: translateY(-2px);
      box-shadow: 0 8px 24px rgba(0,0,0,0.3);
    }

    .video-thumb {
      height: 160px; background: #151922; display: flex;
      align-items: center; justify-content: center; position: relative;
      overflow: hidden;
    }
    .video-thumb > mat-icon { font-size: 48px; width: 48px; height: 48px; color: #4b5563; }
    .thumb-img {
      width: 100%; height: 100%; object-fit: cover;
    }
    .thumb-play-icon {
      position: absolute; inset: 0; display: flex;
      align-items: center; justify-content: center;
      background: rgba(0,0,0,0.25); opacity: 0;
      transition: opacity 0.2s;
    }
    .thumb-play-icon mat-icon {
      font-size: 48px; width: 48px; height: 48px;
      color: rgba(255,255,255,0.9);
    }
    .video-card:hover .thumb-play-icon { opacity: 1; }
    .video-duration {
      position: absolute; bottom: 8px; right: 8px; background: rgba(0,0,0,0.8);
      color: white; padding: 2px 8px; border-radius: 4px; font-size: 12px; font-weight: 600;
    }

    .video-info { padding: 16px; }
    .video-info h4 {
      font-size: 14px; font-weight: 600; color: #f1f5f9;
      white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    }

    /* Annotation Stats */
    .video-stats { margin-top: 12px; }
    .stat-row { display: flex; gap: 12px; margin-bottom: 8px; }
    .mini-stat {
      display: flex; align-items: center; gap: 4px;
      color: #64748b; font-size: 12px; font-weight: 500;
    }
    .mini-stat mat-icon { font-size: 14px; width: 14px; height: 14px; }
    .mini-stat.ok { color: #10b981; }
    .mini-stat.ok mat-icon { color: #10b981; }
    .mini-stat.warn { color: #f59e0b; }
    .mini-stat.warn mat-icon { color: #f59e0b; }

    .annotation-bar {
      height: 4px; background: #2a3040; border-radius: 2px; overflow: hidden;
    }
    .bar-fill {
      height: 100%; border-radius: 2px; transition: width 0.3s;
      background: #475569;
    }
    .bar-fill.partial { background: linear-gradient(90deg, #f59e0b, #f97316); }
    .bar-fill.complete { background: linear-gradient(90deg, #10b981, #34d399); }

    .video-footer {
      display: flex; align-items: center; justify-content: space-between;
      margin-top: 12px; padding-top: 12px; border-top: 1px solid rgba(255,255,255,0.04);
    }

    .step-indicator { display: flex; align-items: center; gap: 4px; }
    .step {
      width: 24px; height: 24px; border-radius: 50%; font-size: 11px; font-weight: 700;
      display: flex; align-items: center; justify-content: center;
      background: #2a3040; color: #64748b;
    }
    .step.active { background: rgba(59,130,246,0.2); color: #3b82f6; }
    .step.completed { background: #10b981; color: white; }
    .step-line { width: 16px; height: 2px; background: #2a3040; }
    .step-line.completed { background: #10b981; }

    .empty-section {
      text-align: center; padding: 48px; grid-column: 1 / -1;
    }
    .empty-section mat-icon { font-size: 48px; width: 48px; height: 48px; color: #374151; margin-bottom: 12px; }
    .empty-section p { color: #64748b; margin-bottom: 16px; }

    .loading-page { display: flex; justify-content: center; align-items: center; height: 60vh; }

    .dialog-overlay {
      position: fixed; inset: 0; background: rgba(0,0,0,0.6);
      backdrop-filter: blur(4px); display: flex; align-items: center;
      justify-content: center; z-index: 1000;
    }
    .dialog-card {
      background: #1e2432; border-radius: 20px; padding: 32px; width: 480px;
      border: 1px solid rgba(255,255,255,0.08);
    }
    .dialog-card h2 { font-size: 20px; font-weight: 700; color: #f1f5f9; margin-bottom: 24px; }
    .dialog-actions { display: flex; justify-content: flex-end; gap: 12px; margin-top: 8px; }

    .header-actions { display: flex; gap: 8px; }

    /* Filter Bar */
    .filter-bar {
      display: flex; align-items: center; gap: 8px; margin-bottom: 16px;
      flex-wrap: wrap;
    }
    .filter-chip {
      display: inline-flex; align-items: center; gap: 6px;
      padding: 6px 14px; border-radius: 20px; font-size: 13px; font-weight: 500;
      background: #1a1f2e; color: #94a3b8; border: 1px solid rgba(255,255,255,0.06);
      cursor: pointer; transition: all 0.2s; white-space: nowrap;
    }
    .filter-chip:hover { background: #232a3b; color: #cbd5e1; border-color: rgba(255,255,255,0.12); }
    .filter-chip.active {
      background: rgba(59,130,246,0.15); color: #3b82f6;
      border-color: rgba(59,130,246,0.4); font-weight: 600;
    }
    .filter-chip .dot {
      width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0;
    }
    .filter-chip .dot.active { background: #10b981; }
    .filter-chip .dot.pending { background: #f59e0b; }
    .filter-chip .dot.completed { background: #3b82f6; }
    .filter-chip .filter-icon {
      font-size: 15px; width: 15px; height: 15px;
    }
    .filter-count {
      font-size: 11px; font-weight: 700; padding: 1px 6px;
      border-radius: 10px; background: rgba(255,255,255,0.08); min-width: 18px;
      text-align: center; line-height: 1.4;
    }
    .filter-chip.active .filter-count {
      background: rgba(59,130,246,0.25);
    }

    /* Pagination Bar */
    .pagination-bar {
      display: flex; align-items: center; justify-content: center; gap: 4px;
      margin-top: 20px; padding: 12px 16px;
      background: #1a1f2e; border-radius: 10px;
      border: 1px solid rgba(255,255,255,0.04);
    }
    .pagination-bar button { color: #94a3b8; }
    .pagination-bar button:disabled { color: #374151; }
    .pagination-bar button:not(:disabled):hover { color: #3b82f6; }
    .page-info {
      font-size: 13px; font-weight: 500; color: #94a3b8;
      padding: 0 12px; min-width: 100px; text-align: center;
    }
    .page-size-label {
      font-size: 12px; color: #64748b; margin-left: 12px;
      padding-left: 12px; border-left: 1px solid rgba(255,255,255,0.06);
    }

    @media (max-width: 768px) {
      .stats-summary { grid-template-columns: repeat(2, 1fr); }
      .subparts-grid { grid-template-columns: 1fr; }
      .filter-bar { gap: 6px; }
      .filter-chip { padding: 4px 10px; font-size: 12px; }
    }

    /* Video Tags */
    .video-tags {
      display: flex; flex-wrap: wrap; gap: 4px; margin-top: 6px;
    }
    .tag-chip {
      font-size: 11px; font-weight: 600; padding: 2px 8px;
      border-radius: 12px; border: 1px solid; white-space: nowrap;
    }

    /* Video Annotators */
    .video-annotators {
      display: flex; align-items: center; gap: 4px; margin-top: 6px;
    }
    .video-annotators mat-icon {
      font-size: 14px; width: 14px; height: 14px; color: #64748b;
    }
    .user-chip.small {
      width: 24px; height: 24px; border-radius: 50%; padding: 0;
      display: flex; align-items: center; justify-content: center;
      color: white; font-weight: 700; font-size: 11px; line-height: 1;
    }

    /* Tag Manager */
    .tag-manager-card { width: 520px; }
    .tag-create-row {
      display: flex; align-items: center; gap: 8px; margin-bottom: 16px;
    }
    .tag-input {
      flex: 1; padding: 8px 12px; border-radius: 8px;
      border: 1px solid rgba(255,255,255,0.12); background: #151922;
      color: #f1f5f9; font-size: 14px; outline: none;
    }
    .tag-input:focus { border-color: #3b82f6; }
    .tag-color-input {
      width: 36px; height: 36px; border: none; border-radius: 8px;
      cursor: pointer; background: transparent; padding: 0;
    }
    .tags-list { max-height: 300px; overflow-y: auto; }
    .tag-row {
      display: flex; align-items: center; gap: 10px; padding: 8px 4px;
      border-bottom: 1px solid rgba(255,255,255,0.04);
    }
    .tag-dot { width: 12px; height: 12px; border-radius: 50%; flex-shrink: 0; }
    .tag-name { color: #f1f5f9; font-size: 14px; font-weight: 500; }
    .tag-spacer { flex: 1; }
    .tag-edit-input { width: 140px; flex: unset; }
    .empty-tags { text-align: center; padding: 24px; color: #64748b; }

    /* Video Tag Dialog */
    .dialog-subtitle {
      color: #94a3b8; font-size: 13px; margin: -16px 0 16px;
      white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    }
    .tag-select-list { max-height: 300px; overflow-y: auto; }
    .tag-select-row {
      display: flex; align-items: center; gap: 10px; padding: 10px 12px;
      border-radius: 8px; cursor: pointer; transition: background 0.15s;
    }
    .tag-select-row:hover { background: rgba(255,255,255,0.04); }
    .tag-select-row.selected { background: rgba(59,130,246,0.1); }
    .tag-check { color: #3b82f6; font-size: 20px; width: 20px; height: 20px; margin-left: auto; }

    /* Reviewer on subpart card */
    .sp-reviewer {
      display: flex; align-items: center; gap: 8px; margin-top: 8px;
      padding-top: 8px; border-top: 1px solid rgba(255,255,255,0.04);
    }
    .sp-reviewer > mat-icon { color: #e8590c; font-size: 18px; width: 18px; height: 18px; }
    .reviewer-label { color: #94a3b8; font-size: 12px; font-weight: 500; }
    .reviewer-chip { font-size: 11px; }

    /* Review bar on video card */
    .review-bar {
      padding: 8px 16px 12px; border-top: 1px solid rgba(255,255,255,0.04);
    }
    .review-status-row {
      display: flex; align-items: center; gap: 6px; flex-wrap: wrap;
    }
    .review-spacer { flex: 1; }
    .video-actions-row { display: flex; align-items: center; }

    .review-badge {
      display: inline-flex; align-items: center; gap: 4px;
      font-size: 11px; font-weight: 600; padding: 3px 10px;
      border-radius: 16px;
    }
    .review-badge mat-icon { font-size: 14px; width: 14px; height: 14px; }
    .review-badge.not_submitted { background: rgba(100,116,139,0.15); color: #94a3b8; }
    .review-badge.pending_review { background: rgba(245,158,11,0.15); color: #f59e0b; }
    .review-badge.approved { background: rgba(16,185,129,0.15); color: #10b981; }
    .review-badge.rejected { background: rgba(239,68,68,0.15); color: #ef4444; }

    .submit-review-btn {
      font-size: 11px !important; padding: 0 10px !important; height: 28px !important;
      line-height: 28px !important; border-color: #3b82f6 !important; color: #3b82f6 !important;
      display: inline-flex !important; align-items: center; gap: 4px;
    }
    .submit-review-btn mat-icon { font-size: 14px; width: 14px; height: 14px; }

    .approve-btn {
      font-size: 11px !important; padding: 0 10px !important; height: 28px !important;
      line-height: 28px !important; border-color: #10b981 !important; color: #10b981 !important;
      display: inline-flex !important; align-items: center; gap: 4px;
    }
    .approve-btn mat-icon { font-size: 14px; width: 14px; height: 14px; color: #10b981; }

    .reject-btn {
      font-size: 11px !important; padding: 0 10px !important; height: 28px !important;
      line-height: 28px !important; border-color: #ef4444 !important; color: #ef4444 !important;
      display: inline-flex !important; align-items: center; gap: 4px;
    }
    .reject-btn mat-icon { font-size: 14px; width: 14px; height: 14px; color: #ef4444; }

    .review-comment-text {
      display: flex; align-items: flex-start; gap: 6px; margin-top: 8px;
      padding: 8px 10px; border-radius: 8px; background: rgba(255,255,255,0.03);
      font-size: 12px; color: #94a3b8; line-height: 1.4;
    }
    .review-comment-text.rejected { background: rgba(239,68,68,0.08); color: #fca5a5; }
    .review-comment-text mat-icon { font-size: 14px; width: 14px; height: 14px; flex-shrink: 0; margin-top: 1px; }
  `]
})
export class ProjectDetailComponent implements OnInit {
  project: Project | null = null;
  subpartVideos: VideoItem[] = [];
  allUsers: User[] = [];
  uploading = false;
  loadingVideos = false;
  showSubpartDialog = false;
  newSubpartName = '';
  newSubpartDesc = '';
  selectedUsers: string[] = [];
  selectedSubpart: SubPart | null = null;
  user = this.authService.user;

  // Edit Project
  showEditProjectDialog = false;
  editProjectName = '';
  editProjectDesc = '';
  editProjectStatus = '';

  // Edit Subpart
  showEditSubpartDialog = false;
  editSubpartId = '';
  editSubpartName = '';
  editSubpartDesc = '';
  editSubpartStatus = '';
  editSubpartUsers: string[] = [];

  // Tags
  projectTags: Tag[] = [];
  showTagManager = false;
  newTagName = '';
  newTagColor = '#3b82f6';
  editingTagId = '';
  editingTagName = '';

  // Video Tags
  showVideoTagDialog = false;
  editingVideo: VideoItem | null = null;
  videoTagIds: string[] = [];

  // Review
  showRejectDialog = false;
  rejectingVideo: VideoItem | null = null;
  rejectComment = '';
  selectedReviewer = '';
  editSubpartReviewer = '';

  // Annotator Assignment
  showAnnotatorDialog = false;
  annotatorVideo: VideoItem | null = null;
  annotatorVideoIds: string[] = [];

  // Subpart filter & pagination
  subpartFilter = 'all';
  subpartPage = 1;
  subpartPageSize = 12;

  // Video filter & pagination
  videoFilter = 'all';
  videoPage = 1;
  videoPageSize = 12;

  constructor(
    private route: ActivatedRoute,
    private router: Router,
    private authService: AuthService,
    private projectService: ProjectService,
    private videoService: VideoService,
    private dialog: MatDialog,
    private snackBar: MatSnackBar
  ) {}

  ngOnInit(): void {
    const id = this.route.snapshot.paramMap.get('id')!;
    this.loadProject(id);
    this.loadUsers();
  }

  // ---- Subpart Filter & Pagination ----
  get filteredSubparts(): SubPart[] {
    if (!this.project?.subparts) return [];
    if (this.subpartFilter === 'all') return this.project.subparts;
    return this.project.subparts.filter(sp => sp.status === this.subpartFilter);
  }

  get paginatedSubparts(): SubPart[] {
    const start = (this.subpartPage - 1) * this.subpartPageSize;
    return this.filteredSubparts.slice(start, start + this.subpartPageSize);
  }

  get subpartTotalPages(): number {
    return Math.ceil(this.filteredSubparts.length / this.subpartPageSize) || 1;
  }

  setSubpartFilter(filter: string): void {
    this.subpartFilter = filter;
    this.subpartPage = 1;
  }

  getSubpartCountByStatus(status: string): number {
    return this.project?.subparts?.filter(sp => sp.status === status).length || 0;
  }

  // ---- Video Filter & Pagination ----
  get filteredVideos(): VideoItem[] {
    if (this.videoFilter === 'all') return this.subpartVideos;
    return this.subpartVideos.filter(v => (v.review_status || 'not_submitted') === this.videoFilter);
  }

  get paginatedVideos(): VideoItem[] {
    const start = (this.videoPage - 1) * this.videoPageSize;
    return this.filteredVideos.slice(start, start + this.videoPageSize);
  }

  get videoTotalPages(): number {
    return Math.ceil(this.filteredVideos.length / this.videoPageSize) || 1;
  }

  setVideoFilter(filter: string): void {
    this.videoFilter = filter;
    this.videoPage = 1;
  }

  getVideoCountByStatus(status: string): number {
    return this.subpartVideos.filter(v => (v.review_status || 'not_submitted') === status).length;
  }

  loadProject(id: string): void {
    this.projectService.getProject(id).subscribe({
      next: (p) => {
        this.project = p;
        this.loadProjectTags(p.id);
        // Auto-select subpart if query param present
        const subpartId = this.route.snapshot.queryParamMap.get('subpartId');
        if (subpartId && p.subparts?.length) {
          const sp = p.subparts.find(s => s.id === subpartId);
          if (sp) this.selectSubpart(sp);
        }
      },
      error: () => this.router.navigate(['/dashboard'])
    });
  }

  loadUsers(): void {
    this.authService.getUsers().subscribe({
      next: (users) => this.allUsers = users
    });
  }

  selectSubpart(sp: SubPart): void {
    this.selectedSubpart = sp;
    this.videoFilter = 'all';
    this.videoPage = 1;
    this.loadSubpartVideos(sp.id);
  }

  loadSubpartVideos(subpartId: string): void {
    this.loadingVideos = true;
    this.videoService.getSubpartVideos(subpartId).subscribe({
      next: (videos) => {
        this.subpartVideos = videos;
        this.loadingVideos = false;
      },
      error: () => {
        this.loadingVideos = false;
      }
    });
  }

  createSubpart(): void {
    if (!this.project || !this.newSubpartName) return;
    this.projectService.createSubpart(this.project.id, {
      name: this.newSubpartName,
      description: this.newSubpartDesc,
      assigned_users: this.selectedUsers,
      reviewer: this.selectedReviewer || undefined
    } as any).subscribe({
      next: (newSubpart: any) => {
        this.showSubpartDialog = false;
        this.newSubpartName = '';
        this.newSubpartDesc = '';
        this.selectedUsers = [];
        this.selectedReviewer = '';
        this.loadProject(this.project!.id);
        this.snackBar.open('Sub part created!', 'Close', { duration: 2000, panelClass: 'snack-success' });
        // Navigate to the new subpart's video list
        this.selectSubpart(newSubpart as SubPart);
      }
    });
  }

  deleteSubpart(sp: SubPart): void {
    if (!this.project || !confirm(`Delete "${sp.name}"? All videos in this sub part will be unlinked.`)) return;
    this.projectService.deleteSubpart(this.project.id, sp.id).subscribe({
      next: () => {
        this.loadProject(this.project!.id);
        this.snackBar.open('Sub part deleted', 'Close', { duration: 2000, panelClass: 'snack-success' });
      }
    });
  }

  triggerUpload(): void {
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    input?.click();
  }

  onFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    if (!input.files?.length || !this.project || !this.selectedSubpart) return;

    this.uploading = true;
    const file = input.files[0];

    // Generate thumbnail from video
    this.generateThumbnail(file).then((thumbnail) => {
      this.videoService.uploadVideo(this.project!.id, file, this.selectedSubpart!.id, undefined, thumbnail).subscribe({
        next: () => {
          this.uploading = false;
          this.loadSubpartVideos(this.selectedSubpart!.id);
          this.loadProject(this.project!.id);
          this.snackBar.open('Video uploaded!', 'Close', { duration: 2000, panelClass: 'snack-success' });
          input.value = '';
        },
        error: () => {
          this.uploading = false;
          this.snackBar.open('Upload failed', 'Close', { duration: 3000, panelClass: 'snack-error' });
        }
      });
    });
  }

  generateThumbnail(file: File): Promise<Blob | undefined> {
    return new Promise((resolve) => {
      const video = document.createElement('video');
      video.preload = 'metadata';
      video.muted = true;
      video.playsInline = true;
      const url = URL.createObjectURL(file);
      video.src = url;

      video.onloadeddata = () => {
        // Seek to 1s or 25% of duration (whichever is smaller)
        video.currentTime = Math.min(1, video.duration * 0.25);
      };

      video.onseeked = () => {
        const canvas = document.createElement('canvas');
        const w = 320;
        const h = (video.videoHeight / video.videoWidth) * w || 180;
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d')!;
        ctx.drawImage(video, 0, 0, w, h);
        canvas.toBlob((blob) => {
          URL.revokeObjectURL(url);
          resolve(blob || undefined);
        }, 'image/jpeg', 0.8);
      };

      video.onerror = () => {
        URL.revokeObjectURL(url);
        resolve(undefined);
      };
    });
  }

  deleteVideo(video: VideoItem): void {
    if (!confirm(`Delete "${video.original_name}"?`)) return;
    this.videoService.deleteVideo(video.id).subscribe({
      next: () => {
        if (this.selectedSubpart) {
          this.loadSubpartVideos(this.selectedSubpart.id);
          this.loadProject(this.project!.id);
        }
        this.snackBar.open('Video deleted', 'Close', { duration: 2000, panelClass: 'snack-success' });
      }
    });
  }

  openEditor(video: VideoItem): void {
    const queryParams: any = {};
    if (this.selectedSubpart) queryParams.subpartId = this.selectedSubpart.id;
    this.router.navigate(['/editor', video.id], { queryParams });
  }

  // --- Stats helpers ---
  getTotalSegments(): number {
    return this.subpartVideos.reduce((sum, v) => sum + (v.segments_count || 0), 0);
  }

  getTotalObjects(): number {
    return this.subpartVideos.reduce((sum, v) => sum + (v.objects_count || 0), 0);
  }

  getTotalCaptions(): number {
    return this.subpartVideos.reduce((sum, v) => sum + (v.captions_count || 0), 0);
  }

  getAnnotationProgress(video: VideoItem): number {
    const steps = 3;
    let progress = 0;
    if ((video.segments_count || 0) > 0) progress += 1;
    if ((video.objects_count || 0) > 0) progress += 1;
    if ((video.objects_count || 0) > 0 && (video.captions_count || 0) >= (video.objects_count || 0)) {
      progress += 1;
    } else if ((video.captions_count || 0) > 0) {
      progress += 0.5;
    }
    return Math.round((progress / steps) * 100);
  }

  getCaptionTooltip(video: VideoItem): string {
    const obj = video.objects_count || 0;
    const cap = video.captions_count || 0;
    if (obj === 0) return 'No objects yet';
    if (cap >= obj) return `All objects captioned (${cap}/${obj})`;
    return `${cap}/${obj} objects captioned - incomplete`;
  }

  formatDuration(seconds: number): string {
    if (!seconds) return '0:00';
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${s.toString().padStart(2, '0')}`;
  }

  formatSize(bytes: number): string {
    if (!bytes) return '0 B';
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${sizes[i]}`;
  }

  goBack(): void {
    if (this.selectedSubpart) {
      this.selectedSubpart = null;
      this.subpartVideos = [];
    } else {
      this.router.navigate(['/dashboard']);
    }
  }

  // ---- Edit Project ----
  openEditProjectDialog(): void {
    if (!this.project) return;
    this.editProjectName = this.project.name;
    this.editProjectDesc = this.project.description;
    this.editProjectStatus = this.project.status;
    this.showEditProjectDialog = true;
  }

  saveEditProject(): void {
    if (!this.project || !this.editProjectName) return;
    this.projectService.updateProject(this.project.id, {
      name: this.editProjectName,
      description: this.editProjectDesc,
      status: this.editProjectStatus
    } as any).subscribe({
      next: () => {
        this.showEditProjectDialog = false;
        this.loadProject(this.project!.id);
        this.snackBar.open('Project updated!', 'Close', { duration: 2000, panelClass: 'snack-success' });
      }
    });
  }

  // ---- Edit Subpart ----
  openEditSubpartDialog(sp: SubPart): void {
    this.editSubpartId = sp.id;
    this.editSubpartName = sp.name;
    this.editSubpartDesc = sp.description;
    this.editSubpartStatus = sp.status;
    this.editSubpartUsers = sp.assigned_users || [];
    this.editSubpartReviewer = sp.reviewer || '';
    this.showEditSubpartDialog = true;
  }

  saveEditSubpart(): void {
    if (!this.project || !this.editSubpartId || !this.editSubpartName) return;
    this.projectService.updateSubpart(this.project.id, this.editSubpartId, {
      name: this.editSubpartName,
      description: this.editSubpartDesc,
      status: this.editSubpartStatus,
      assigned_users: this.editSubpartUsers,
      reviewer: this.editSubpartReviewer || null
    } as any).subscribe({
      next: () => {
        this.showEditSubpartDialog = false;
        this.loadProject(this.project!.id);
        this.snackBar.open('Sub part updated!', 'Close', { duration: 2000, panelClass: 'snack-success' });
      }
    });
  }

  // ---- Tags ----
  loadProjectTags(projectId: string): void {
    this.projectService.getTags(projectId).subscribe({
      next: (tags) => this.projectTags = tags
    });
  }

  openTagManager(): void {
    this.showTagManager = true;
    this.newTagName = '';
    this.editingTagId = '';
  }

  createTag(): void {
    if (!this.project || !this.newTagName) return;
    this.projectService.createTag(this.project.id, {
      name: this.newTagName,
      color: this.newTagColor
    }).subscribe({
      next: (tag) => {
        this.projectTags.push(tag);
        this.newTagName = '';
        this.newTagColor = '#3b82f6';
      },
      error: (err) => {
        this.snackBar.open(err.error?.error || 'Failed to create tag', 'Close', { duration: 3000 });
      }
    });
  }

  startEditTag(tag: Tag): void {
    this.editingTagId = tag.id;
    this.editingTagName = tag.name;
  }

  saveEditTag(tag: Tag): void {
    if (!this.editingTagName) return;
    this.projectService.updateTag(tag.id, { name: this.editingTagName }).subscribe({
      next: (updated) => {
        const idx = this.projectTags.findIndex(t => t.id === tag.id);
        if (idx >= 0) this.projectTags[idx] = updated;
        this.editingTagId = '';
      },
      error: (err) => {
        this.snackBar.open(err.error?.error || 'Failed to update tag', 'Close', { duration: 3000 });
      }
    });
  }

  deleteTag(tag: Tag): void {
    if (!confirm(`Delete tag "${tag.name}"? It will be removed from all videos.`)) return;
    this.projectService.deleteTag(tag.id).subscribe({
      next: () => {
        this.projectTags = this.projectTags.filter(t => t.id !== tag.id);
        // Remove from loaded videos
        for (const v of this.subpartVideos) {
          if (v.tags) v.tags = v.tags.filter(id => id !== tag.id);
        }
      }
    });
  }

  // ---- Video Tags ----
  openVideoTagDialog(video: VideoItem): void {
    this.editingVideo = video;
    this.videoTagIds = [...(video.tags || [])];
    this.showVideoTagDialog = true;
  }

  toggleVideoTag(tagId: string): void {
    const idx = this.videoTagIds.indexOf(tagId);
    if (idx >= 0) {
      this.videoTagIds.splice(idx, 1);
    } else {
      this.videoTagIds.push(tagId);
    }
  }

  saveVideoTags(): void {
    if (!this.editingVideo) return;
    this.videoService.updateVideo(this.editingVideo.id, { tags: this.videoTagIds } as any).subscribe({
      next: () => {
        if (this.editingVideo) {
          this.editingVideo.tags = [...this.videoTagIds];
        }
        this.showVideoTagDialog = false;
        this.snackBar.open('Tags updated!', 'Close', { duration: 2000, panelClass: 'snack-success' });
      }
    });
  }

  getVideoTags(video: VideoItem): Tag[] {
    if (!video.tags?.length) return [];
    return this.projectTags.filter(t => video.tags!.includes(t.id));
  }

  // ---- Review ----
  getReviewIcon(status?: string): string {
    switch (status) {
      case 'pending_review': return 'hourglass_empty';
      case 'approved': return 'check_circle';
      case 'rejected': return 'cancel';
      default: return 'radio_button_unchecked';
    }
  }

  getReviewLabel(status?: string): string {
    switch (status) {
      case 'pending_review': return 'Pending Review';
      case 'approved': return 'Approved';
      case 'rejected': return 'Rejected';
      default: return 'Not Submitted';
    }
  }

  canSubmitForReview(video: VideoItem): boolean {
    const status = video.review_status || 'not_submitted';
    return status === 'not_submitted' || status === 'rejected';
  }

  canReview(video: VideoItem): boolean {
    if (!this.selectedSubpart?.reviewer) return false;
    const currentUserId = this.user()?.id;
    return currentUserId === this.selectedSubpart.reviewer && video.review_status === 'pending_review';
  }

  submitForReview(video: VideoItem): void {
    if (!confirm(`Submit "${video.original_name}" for cross-check review?`)) return;
    this.videoService.submitForReview(video.id).subscribe({
      next: () => {
        video.review_status = 'pending_review';
        video.review_comment = '';
        this.snackBar.open('Submitted for review!', 'Close', { duration: 2000, panelClass: 'snack-success' });
      },
      error: () => {
        this.snackBar.open('Failed to submit', 'Close', { duration: 3000, panelClass: 'snack-error' });
      }
    });
  }

  reviewAction(video: VideoItem, action: 'approve' | 'reject'): void {
    this.videoService.reviewVideo(video.id, action).subscribe({
      next: (res) => {
        video.review_status = res.review_status;
        video.review_comment = res.review_comment || '';
        this.snackBar.open(`Video ${action}d!`, 'Close', { duration: 2000, panelClass: 'snack-success' });
      }
    });
  }

  openRejectDialog(video: VideoItem): void {
    this.rejectingVideo = video;
    this.rejectComment = '';
    this.showRejectDialog = true;
  }

  confirmReject(): void {
    if (!this.rejectingVideo) return;
    this.videoService.reviewVideo(this.rejectingVideo.id, 'reject', this.rejectComment).subscribe({
      next: (res) => {
        if (this.rejectingVideo) {
          this.rejectingVideo.review_status = res.review_status;
          this.rejectingVideo.review_comment = res.review_comment || '';
        }
        this.showRejectDialog = false;
        this.snackBar.open('Video rejected', 'Close', { duration: 2000, panelClass: 'snack-success' });
      }
    });
  }

  // ---- Annotator Assignment ----
  getUserById(id: string): User | undefined {
    return this.allUsers.find(u => u.id === id);
  }

  openAnnotatorDialog(video: VideoItem): void {
    this.annotatorVideo = video;
    this.annotatorVideoIds = [...(video.annotators || [])];
    this.showAnnotatorDialog = true;
  }

  saveAnnotators(): void {
    if (!this.annotatorVideo) return;
    this.videoService.updateVideo(this.annotatorVideo.id, { annotators: this.annotatorVideoIds } as any).subscribe({
      next: () => {
        if (this.annotatorVideo) {
          this.annotatorVideo.annotators = [...this.annotatorVideoIds];
        }
        this.showAnnotatorDialog = false;
        this.snackBar.open('Annotators updated!', 'Close', { duration: 2000, panelClass: 'snack-success' });
      }
    });
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
