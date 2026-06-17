import { Component, OnInit, OnDestroy } from '@angular/core';
import { Subscription, interval } from 'rxjs';
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
import { ImageService } from '../../core/services/image.service';
import { SettingsDialogComponent } from '../settings-dialog/settings-dialog.component';
import { Project, SubPart, VideoItem, ImageItem, User, Tag } from '../../core/models';
import { generateThumbnail } from '../../core/utils/video-thumbnail';

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
export class ProjectDetailComponent implements OnInit, OnDestroy {
  Math = Math;
  project: Project | null = null;
  subpartVideos: VideoItem[] = [];
  subpartImages: ImageItem[] = [];
  allUsers: User[] = [];
  uploading = false;
  loadingVideos = false;
  loadingImages = false;
  uploadProgress = 0;
  uploadCurrentFile = '';
  uploadTotalFiles = 0;
  showSubpartDialog = false;
  newSubpartName = '';
  newSubpartDesc = '';
  selectedUsers: string[] = [];
  selectedSubpart: SubPart | null = null;
  user = this.authService.user;

  // Export State
  exportTaskId: string | null = null;
  isExporting = false;
  exportProgress = 0;
  exportStatusText = '';
  private pollingSubscription?: Subscription;


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

  // Rename Dialog
  renamingVideo: VideoItem | null = null;
  renameValue = '';

  selectedReviewer = '';
  selectedReviewers: string[] = [];
  editSubpartReviewer = '';
  editSubpartReviewers: string[] = [];

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

  // Image filter & pagination
  imageFilter = 'all';
  imagePage = 1;
  imagePageSize = 12;

  // URL-sync gate: avoid writing to the URL during initial restoration.
  private urlSyncReady = false;
  indexingImages = false;
  imageIndexProgress = 0;
  imageIndexCurrent = 0;
  imageIndexTotal = 0;
  imageIndexSummary = '';

  constructor(
    private route: ActivatedRoute,
    private router: Router,
    private authService: AuthService,
    private projectService: ProjectService,
    private videoService: VideoService,
    private imageService: ImageService,
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
    this.syncUrlState();
  }

  setSubpartPage(p: number): void {
    this.subpartPage = this.clampPage(p, this.subpartTotalPages);
    this.syncUrlState();
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
    this.syncUrlState();
  }

  setVideoPage(p: number): void {
    this.videoPage = this.clampPage(p, this.videoTotalPages);
    this.syncUrlState();
  }

  getVideoCountByStatus(status: string): number {
    return this.subpartVideos.filter(v => (v.review_status || 'not_submitted') === status).length;
  }

  // ---- Image Filter & Pagination ----
  get filteredImages(): ImageItem[] {
    if (this.imageFilter === 'all') return this.subpartImages;
    return this.subpartImages.filter(img => (img.review_status || 'not_submitted') === this.imageFilter);
  }

  get paginatedImages(): ImageItem[] {
    const start = (this.imagePage - 1) * this.imagePageSize;
    return this.filteredImages.slice(start, start + this.imagePageSize);
  }

  get imageTotalPages(): number {
    return Math.ceil(this.filteredImages.length / this.imagePageSize) || 1;
  }

  setImageFilter(filter: string): void {
    this.imageFilter = filter;
    this.imagePage = 1;
    this.syncUrlState();
  }

  setImagePage(p: number): void {
    this.imagePage = this.clampPage(p, this.imageTotalPages);
    this.syncUrlState();
  }

  private clampPage(p: number, total: number): number {
    if (!Number.isFinite(p) || p < 1) return 1;
    return Math.min(Math.max(1, Math.floor(p)), Math.max(1, total));
  }

  private syncUrlState(): void {
    if (!this.urlSyncReady) return;
    const qp: { [k: string]: string | null } = {
      subpartId: this.selectedSubpart?.id || null,
      spF: this.subpartFilter === 'all' ? null : this.subpartFilter,
      spP: this.subpartPage > 1 ? String(this.subpartPage) : null,
      vF: this.videoFilter === 'all' ? null : this.videoFilter,
      vP: this.videoPage > 1 ? String(this.videoPage) : null,
      iF: this.imageFilter === 'all' ? null : this.imageFilter,
      iP: this.imagePage > 1 ? String(this.imagePage) : null,
    };
    this.router.navigate([], {
      relativeTo: this.route,
      queryParams: qp,
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
  }

  private restorePaginationFromUrl(): void {
    const params = this.route.snapshot.queryParamMap;
    const spF = params.get('spF');
    const vF = params.get('vF');
    const iF = params.get('iF');
    if (spF) this.subpartFilter = spF;
    if (vF) this.videoFilter = vF;
    if (iF) this.imageFilter = iF;
    // Pages get clamped after data loads — store the raw value here, the
    // template's totalPages getters compute against current filteredX length.
    const spP = +(params.get('spP') || 0);
    const vP = +(params.get('vP') || 0);
    const iP = +(params.get('iP') || 0);
    if (spP > 0) this.subpartPage = spP;
    if (vP > 0) this.videoPage = vP;
    if (iP > 0) this.imagePage = iP;
  }

  getImageCountByStatus(status: string): number {
    return this.subpartImages.filter(img => (img.review_status || 'not_submitted') === status).length;
  }

  isImageFullyIndexed(image: ImageItem): boolean {
    const regions = image.regions_count || 0;
    const objectIndexed = image.object_indexed_count || 0;
    const imageIndexed = !!image.indexed;
    return imageIndexed && (regions === 0 || objectIndexed >= regions);
  }

  getPendingIndexImages(): ImageItem[] {
    // Pending in toolbar means image-level index not done yet.
    // Object-level index status is shown separately per image as x/y.
    return this.subpartImages.filter((img) => !img.indexed);
  }

  // Helper to check project type
  isImageProject(): boolean {
    return this.project?.project_type === 'image';
  }

  loadProject(id: string): void {
    this.projectService.getProject(id).subscribe({
      next: (p) => {
        this.project = p;
        this.loadProjectTags(p.id);
        // Auto-select subpart if query param present. selectSubpart resets
        // filters/pages, so re-apply the URL-encoded values afterward and
        // only then open the gate that writes state back to the URL.
        const subpartId = this.route.snapshot.queryParamMap.get('subpartId');
        if (subpartId && p.subparts?.length) {
          const sp = p.subparts.find(s => s.id === subpartId);
          if (sp) this.selectSubpart(sp);
        }
        this.restorePaginationFromUrl();
        this.urlSyncReady = true;
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
    this.imageFilter = 'all';
    this.imagePage = 1;
    if (this.isImageProject()) {
      this.loadSubpartImages(sp.id);
    } else {
      this.loadSubpartVideos(sp.id);
    }
    this.syncUrlState();
  }

  loadSubpartVideos(subpartId: string): void {
    this.loadingVideos = true;
    this.videoService.getSubpartVideos(subpartId).subscribe({
      next: (videos) => {
        this.subpartVideos = videos;
        this.loadingVideos = false;
        // Snap a restored page back into range if the list shrank.
        this.videoPage = this.clampPage(this.videoPage, this.videoTotalPages);
      },
      error: () => {
        this.loadingVideos = false;
      }
    });
  }

  loadSubpartImages(subpartId: string): void {
    this.loadingImages = true;
    this.imageService.getSubpartImages(subpartId).subscribe({
      next: (images) => {
        this.subpartImages = images;
        this.loadingImages = false;
        this.imagePage = this.clampPage(this.imagePage, this.imageTotalPages);
      },
      error: () => {
        this.loadingImages = false;
      }
    });
  }

  createSubpart(): void {
    if (!this.project || !this.newSubpartName) return;
    this.projectService.createSubpart(this.project.id, {
      name: this.newSubpartName,
      description: this.newSubpartDesc,
      assigned_users: this.selectedUsers,
      reviewer: this.selectedReviewers[0] || this.selectedReviewer || undefined,
      reviewers: this.selectedReviewers
    } as any).subscribe({
      next: (newSubpart: any) => {
        this.showSubpartDialog = false;
        this.newSubpartName = '';
        this.newSubpartDesc = '';
        this.selectedUsers = [];
        this.selectedReviewer = '';
        this.selectedReviewers = [];
        
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
    const inputId = this.isImageProject() ? 'imageInput' : 'videoInput';
    const input = document.getElementById(inputId) as HTMLInputElement;
    input?.click();
  }

  onFileSelected(event: Event): void {
    if (this.isImageProject()) {
      this.onImageFileSelected(event);
    } else {
      this.onVideoFileSelected(event);
    }
  }

  onVideoFileSelected(event: Event): void {
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

      generateThumbnail(file).then((thumbnail) => {
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

  // ---- Image Upload ----
  onImageFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    if (!input.files?.length || !this.project || !this.selectedSubpart) return;

    this.uploading = true;
    const files = Array.from(input.files);
    this.uploadTotalFiles = files.length;
    let uploadedCount = 0;
    let failedCount = 0;

    const uploadNext = (index: number) => {
      if (index >= files.length) {
        this.uploading = false;
        this.uploadProgress = 0;
        this.uploadCurrentFile = '';
        this.uploadTotalFiles = 0;
        
        this.loadSubpartImages(this.selectedSubpart!.id);
        input.value = '';
        
        if (uploadedCount > 0 && failedCount === 0) {
          this.snackBar.open(`${uploadedCount} image${uploadedCount > 1 ? 's' : ''} uploaded!`, 'Close', { duration: 2000, panelClass: 'snack-success' });
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

      this.imageService.uploadImage(this.project!.id, file, this.selectedSubpart!.id).subscribe({
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
    };

    uploadNext(0);
  }

  deleteImage(image: ImageItem): void {
    if (!confirm(`Delete "${image.original_name}"?`)) return;
    this.imageService.deleteImage(image.id).subscribe({
      next: () => {
        if (this.selectedSubpart) {
          this.loadSubpartImages(this.selectedSubpart.id);
          this.loadProject(this.project!.id);
        }
        this.snackBar.open('Image deleted', 'Close', { duration: 2000, panelClass: 'snack-success' });
      }
    });
  }

  indexSingleImage(image: ImageItem, event?: Event): void {
    event?.stopPropagation();
    if (this.indexingImages) return;

    this.imageService.indexImage(image.id).subscribe({
      next: () => {
        this.snackBar.open(`Indexed ${image.original_name}`, 'Close', { duration: 2000, panelClass: 'snack-success' });
        if (this.selectedSubpart) {
          this.loadSubpartImages(this.selectedSubpart.id);
        }
      },
      error: () => {
        this.snackBar.open(`Failed to index ${image.original_name}`, 'Close', { duration: 3000, panelClass: 'snack-error' });
      }
    });
  }

  indexSubpartImages(onlyPending = true): void {
    if (this.indexingImages) return;
    const targets = (onlyPending ? this.getPendingIndexImages() : this.subpartImages).map(i => i.id);

    if (!targets.length) {
      this.snackBar.open('All images are already indexed', 'Close', { duration: 2000, panelClass: 'snack-success' });
      return;
    }

    this.indexingImages = true;
    this.imageIndexSummary = '';
    this.imageIndexProgress = 0;
    this.imageIndexCurrent = 0;
    this.imageIndexTotal = targets.length;

    this.imageService.indexImagesBatch(targets).subscribe({
      next: (res) => {
        const successCount = res?.success_count || 0;
        const total = res?.total || targets.length;
        this.imageIndexCurrent = total;
        this.imageIndexProgress = 100;
        this.imageIndexSummary = `Indexed ${successCount}/${total} images`;
        if (this.selectedSubpart) {
          this.loadSubpartImages(this.selectedSubpart.id);
        }
        this.snackBar.open(this.imageIndexSummary, 'Close', {
          duration: 2500,
          panelClass: successCount === total ? 'snack-success' : 'snack-warn'
        });
      },
      error: () => {
        this.imageIndexSummary = 'Batch indexing failed';
        this.snackBar.open(this.imageIndexSummary, 'Close', { duration: 3000, panelClass: 'snack-error' });
      },
      complete: () => {
        this.indexingImages = false;
      }
    });
  }

  openImageEditor(image: ImageItem): void {
    const queryParams: any = {};
    if (this.selectedSubpart) queryParams.subpartId = this.selectedSubpart.id;
    this.router.navigate(['/image-editor', image.id], { queryParams });
  }

  // ---- Image Stats helpers ----
  getTotalImageRegions(): number {
    return this.subpartImages.reduce((sum, img) => sum + (img.regions_count || 0), 0);
  }

  getTotalImageCaptions(): number {
    return this.subpartImages.reduce((sum, img) => sum + (img.captions_count || 0), 0);
  }

  getTotalImageQA(): number {
    return this.subpartImages.reduce((sum, img) => sum + (img.qa_count || 0), 0);
  }

  getImageAnnotationProgress(image: ImageItem): number {
    if (!image.regions_count) return 0;
    if (!image.captions_count || image.captions_count === 0) return 50;
    const percent = Math.min(100, Math.round((image.captions_count / image.regions_count) * 100));
    return percent;
  }

  getImageCaptionTooltip(image: ImageItem): string {
    const regions = image.regions_count || 0;
    const caps = image.captions_count || 0;
    if (regions === 0) return 'No regions yet';
    if (caps >= regions) return `All regions captioned (${caps}/${regions})`;
    return `${caps}/${regions} regions captioned - incomplete`;
  }

  formatImageSize(bytes: number): string {
    if (!bytes) return '0 B';
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${sizes[i]}`;
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

  openRenameDialog(video: VideoItem): void {
    this.renamingVideo = video;
    this.renameValue = video.original_name;
  }

  closeRenameDialog(): void {
    this.renamingVideo = null;
    this.renameValue = '';
  }

  saveRename(): void {
    if (!this.renamingVideo) return;
    const name = this.renameValue.trim();
    if (!name || name === this.renamingVideo.original_name) return;
    const video = this.renamingVideo;
    this.videoService.updateVideo(video.id, { original_name: name }).subscribe({
      next: () => {
        video.original_name = name;
        this.snackBar.open('Video renamed', 'Close', { duration: 2000, panelClass: 'snack-success' });
        this.closeRenameDialog();
        if (this.selectedSubpart) {
          this.loadSubpartVideos(this.selectedSubpart.id);
        }
      },
      error: (err) => {
        const msg = err?.error?.error || 'Failed to rename video';
        this.snackBar.open(msg, 'Close', { duration: 3000, panelClass: 'snack-error' });
      }
    });
  }

  openEditor(video: VideoItem): void {
    const queryParams: any = {};
    if (this.selectedSubpart) queryParams.subpartId = this.selectedSubpart.id;
    queryParams.vP = this.videoPage; // Pass current page
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
      this.subpartImages = [];
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
    this.editSubpartReviewers = sp.reviewers || [];
    this.showEditSubpartDialog = true;
  }

  saveEditSubpart(): void {
    if (!this.project || !this.editSubpartId || !this.editSubpartName) return;
    this.projectService.updateSubpart(this.project.id, this.editSubpartId, {
      name: this.editSubpartName,
      description: this.editSubpartDesc,
      status: this.editSubpartStatus,
      assigned_users: this.editSubpartUsers,
      reviewer: this.editSubpartReviewers[0] || this.editSubpartReviewer || null,
      reviewers: this.editSubpartReviewers
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

  ngOnDestroy() {
    if (this.pollingSubscription) {
      this.pollingSubscription.unsubscribe();
    }
  }

  exportZipBySubparts() {
    if (!this.project || this.isExporting) return;
    
    this.isExporting = true;
    this.exportProgress = 0;
    this.exportStatusText = 'Đang khởi tạo lấy danh sách video...';
    
    this.projectService.startExportSubparts(this.project.id).subscribe({
      next: (res) => {
        this.exportTaskId = res.task_id;
        this.pollingSubscription = interval(3000).subscribe(() => {
          this.checkTaskStatus(res.task_id);
        });
      },
      error: (err) => {
        this.isExporting = false;
        this.snackBar.open('Lỗi khi bắt đầu tạo export: ' + err.message, 'Đóng', { duration: 3000 });
      }
    });
  }

  checkTaskStatus(taskId: string) {
    this.projectService.checkExportStatus(taskId).subscribe({
      next: (res) => {
        this.exportProgress = res.progress || 0;

        if (res.status === 'processing') {
          this.exportStatusText = `Đang nén dữ liệu... ${res.progress}%`;
        } else if (res.status === 'completed') {
          this.exportStatusText = 'Hoàn tất! Bắt đầu tải file...';
          this.isExporting = false;
          if (this.pollingSubscription) this.pollingSubscription.unsubscribe();

          const downloadUrl = this.projectService.downloadExportFileUrl(taskId);
          window.open(downloadUrl, '_blank');
        } else if (res.status === 'failed') {
          this.exportStatusText = 'Lỗi nén file: ' + (res.error || 'Server error');
          this.isExporting = false;
          if (this.pollingSubscription) this.pollingSubscription.unsubscribe();
          this.snackBar.open(this.exportStatusText, 'Đóng');
        }
      },
      error: () => {}
    });
  }

  exportSegmentedClipsByProject() {
    if (!this.project || this.isExporting) return;

    this.isExporting = true;
    this.exportProgress = 0;
    this.exportStatusText = 'Đang khởi tạo cắt clip...';

    this.videoService.startBatchSegmentedExport(this.project.id).subscribe({
      next: (res) => {
        this.exportTaskId = res.task_id;
        this.pollingSubscription = interval(3000).subscribe(() => {
          this.checkSegmentedClipsStatus(res.task_id);
        });
      },
      error: (err) => {
        this.isExporting = false;
        this.snackBar.open('Lỗi khi bắt đầu cắt clip: ' + err.message, 'Đóng', { duration: 3000 });
      }
    });
  }

  checkSegmentedClipsStatus(taskId: string) {
    this.videoService.checkBatchSegmentedExportStatus(taskId).subscribe({
      next: (res) => {
        this.exportProgress = res.progress || 0;

        if (res.status === 'processing') {
          this.exportStatusText = `Đang cắt clip & nén... ${res.progress}%`;
        } else if (res.status === 'completed') {
          this.exportStatusText = 'Hoàn tất! Bắt đầu tải file...';
          this.isExporting = false;
          if (this.pollingSubscription) this.pollingSubscription.unsubscribe();

          // Anchor click instead of window.open: avoids popup blocker after
          // transient user activation expires during long-running export.
          const downloadUrl = this.videoService.getBatchSegmentedExportDownloadUrl(taskId);
          const a = document.createElement('a');
          a.href = downloadUrl;
          a.download = '';
          a.style.display = 'none';
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
        } else if (res.status === 'failed') {
          this.exportStatusText = 'Lỗi cắt clip: ' + (res.error || 'Server error');
          this.isExporting = false;
          if (this.pollingSubscription) this.pollingSubscription.unsubscribe();
          this.snackBar.open(this.exportStatusText, 'Đóng');
        }
      },
      error: () => {}
    });
  }

  exportLabeledVideosByProject() {
    if (!this.project || this.isExporting) return;

    this.isExporting = true;
    this.exportProgress = 0;
    this.exportStatusText = 'Đang chuẩn bị video đã đánh nhãn...';

    this.videoService.startLabeledVideosExport(this.project.id).subscribe({
      next: (res) => {
        this.exportTaskId = res.task_id;
        this.pollingSubscription = interval(3000).subscribe(() => {
          this.checkLabeledVideosStatus(res.task_id);
        });
      },
      error: (err) => {
        this.isExporting = false;
        this.snackBar.open('Lỗi khi bắt đầu export: ' + err.message, 'Đóng', { duration: 3000 });
      }
    });
  }

  checkLabeledVideosStatus(taskId: string) {
    this.videoService.checkLabeledVideosExportStatus(taskId).subscribe({
      next: (res) => {
        this.exportProgress = res.progress || 0;

        if (res.status === 'processing') {
          this.exportStatusText = `Đang đóng gói video + annotation... ${res.progress}%`;
        } else if (res.status === 'completed') {
          this.exportStatusText = 'Hoàn tất! Bắt đầu tải file...';
          this.isExporting = false;
          if (this.pollingSubscription) this.pollingSubscription.unsubscribe();

          const downloadUrl = this.videoService.getLabeledVideosExportDownloadUrl(taskId);
          const a = document.createElement('a');
          a.href = downloadUrl;
          a.download = '';
          a.style.display = 'none';
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
        } else if (res.status === 'failed') {
          this.exportStatusText = 'Lỗi export: ' + (res.error || 'Server error');
          this.isExporting = false;
          if (this.pollingSubscription) this.pollingSubscription.unsubscribe();
          this.snackBar.open(this.exportStatusText, 'Đóng');
        }
      },
      error: () => {}
    });
  }

  exportSegmentedKbByProject() {
    if (!this.project || this.isExporting) return;

    this.isExporting = true;
    this.exportProgress = 0;
    this.exportStatusText = 'Đang chuẩn bị video có Knowledge Base...';

    this.videoService.startSegmentedKbExport(this.project.id).subscribe({
      next: (res) => {
        this.exportTaskId = res.task_id;
        this.pollingSubscription = interval(3000).subscribe(() => {
          this.checkSegmentedKbStatus(res.task_id);
        });
      },
      error: (err) => {
        this.isExporting = false;
        this.snackBar.open('Lỗi khi bắt đầu export: ' + err.message, 'Đóng', { duration: 3000 });
      }
    });
  }

  checkSegmentedKbStatus(taskId: string) {
    this.videoService.checkSegmentedKbExportStatus(taskId).subscribe({
      next: (res) => {
        this.exportProgress = res.progress || 0;

        if (res.status === 'processing') {
          this.exportStatusText = `Đang đóng gói video + annotation... ${res.progress}%`;
        } else if (res.status === 'completed') {
          this.exportStatusText = 'Hoàn tất! Bắt đầu tải file...';
          this.isExporting = false;
          if (this.pollingSubscription) this.pollingSubscription.unsubscribe();

          const downloadUrl = this.videoService.getSegmentedKbExportDownloadUrl(taskId);
          const a = document.createElement('a');
          a.href = downloadUrl;
          a.download = '';
          a.style.display = 'none';
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
        } else if (res.status === 'failed') {
          this.exportStatusText = 'Lỗi export: ' + (res.error || 'Server error');
          this.isExporting = false;
          if (this.pollingSubscription) this.pollingSubscription.unsubscribe();
          this.snackBar.open(this.exportStatusText, 'Đóng');
        }
      },
      error: () => {}
    });
  }

}
