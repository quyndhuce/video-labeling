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
  templateUrl: './project-detail.component.html',
  styleUrls: ['./project-detail.component.scss']
})
export class ProjectDetailComponent implements OnInit {
  Math = Math;
  project: Project | null = null;
  subpartVideos: VideoItem[] = [];
  allUsers: User[] = [];
  uploading = false;
  loadingVideos = false;
  uploadProgress = 0;
  uploadCurrentFile = '';
  uploadTotalFiles = 0;
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
        
        // Just reload the project subparts list, keep current view (stay on subparts list)
        this.projectService.getProject(this.project!.id).subscribe({
          next: (p) => {
            this.project = p;
            this.loadProjectTags(p.id);
            // Don't auto-select, stay on the subparts view
          }
        });
        
        this.snackBar.open('Sub part created!', 'Close', { duration: 2000, panelClass: 'snack-success' });
      }
    });
  }

  deleteSubpart(sp: SubPart): void {
    if (!this.project || !confirm(`Delete "${sp.name}"? All videos in this sub part will be unlinked.`)) return;
    this.projectService.deleteSubpart(this.project.id, sp.id).subscribe({
      next: () => {
        // If we're viewing the deleted subpart, go back to subparts list
        if (this.selectedSubpart?.id === sp.id) {
          this.selectedSubpart = null;
          this.subpartVideos = [];
        }
        // Reload project to update subparts list
        this.projectService.getProject(this.project!.id).subscribe({
          next: (p) => {
            this.project = p;
            this.loadProjectTags(p.id);
          }
        });
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
    const files = Array.from(input.files);
    this.uploadTotalFiles = files.length;
    let uploadedCount = 0;
    let failedCount = 0;

    // Upload each file sequentially
    const uploadNext = (index: number) => {
      if (index >= files.length) {
        this.uploading = false;
        this.uploadProgress = 0;
        this.uploadCurrentFile = '';
        this.uploadTotalFiles = 0;
        
        // Reload only current subpart videos, don't navigate
        this.loadSubpartVideos(this.selectedSubpart!.id);
        input.value = '';
        
        if (uploadedCount > 0 && failedCount === 0) {
          this.snackBar.open(`${uploadedCount} video${uploadedCount > 1 ? 's' : ''} uploaded!`, 'Close', { duration: 2000, panelClass: 'snack-success' });
        } else if (uploadedCount > 0 && failedCount > 0) {
          this.snackBar.open(`Uploaded ${uploadedCount}, failed ${failedCount}`, 'Close', { duration: 3000, panelClass: 'snack-warn' });
        } else if (failedCount > 0) {
          this.snackBar.open(`Upload failed for ${failedCount} file${failedCount > 1 ? 's' : ''}`, 'Close', { duration: 3000, panelClass: 'snack-error' });
        }
        return;
      }

      const file = files[index];
      this.uploadCurrentFile = file.name;
      this.uploadProgress = Math.round(((index) / files.length) * 100);

      this.generateThumbnail(file).then((thumbnail) => {
        this.videoService.uploadVideo(this.project!.id, file, this.selectedSubpart!.id, undefined, thumbnail).subscribe({
          next: () => {
            uploadedCount++;
            this.uploadProgress = Math.round(((index + 1) / files.length) * 100);
            uploadNext(index + 1);
          },
          error: () => {
            failedCount++;
            this.uploadProgress = Math.round(((index + 1) / files.length) * 100);
            uploadNext(index + 1);
          }
        });
      });
    };

    uploadNext(0);
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
    // If no segments or objects, progress is 0
    if (!video.segments_count || !video.objects_count) return 0;
    // If objects but no captions, 50%
    if (!video.captions_count || video.captions_count === 0) return 50;
    // If objects and captions, percent = (captions_count / objects_count) * 100, max 100
    const percent = Math.min(100, Math.round((video.captions_count / video.objects_count) * 100));
    return percent;
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
        // Reload project to update subparts list
        this.projectService.getProject(this.project!.id).subscribe({
          next: (p) => {
            this.project = p;
            this.loadProjectTags(p.id);
            // If currently viewing this subpart, reload its videos
            if (this.selectedSubpart?.id === this.editSubpartId) {
              this.loadSubpartVideos(this.editSubpartId);
            }
          }
        });
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
