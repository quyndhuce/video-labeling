import { Component, Inject, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatDialogModule, MatDialogRef, MAT_DIALOG_DATA } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatSnackBar } from '@angular/material/snack-bar';
import { Subscription, interval } from 'rxjs';
import { BatchReviewPreview, BatchReviewTask } from '../../../core/models';
import { VideoService } from '../../../core/services/video.service';

type DialogStep = 'setup' | 'preview' | 'running' | 'done';

@Component({
  selector: 'app-batch-caption-review-dialog',
  standalone: true,
  imports: [
    CommonModule, FormsModule, MatDialogModule, MatButtonModule, MatIconModule,
    MatCheckboxModule, MatFormFieldModule, MatInputModule, MatSelectModule, MatProgressBarModule
  ],
  templateUrl: './batch-caption-review-dialog.component.html',
  styleUrls: ['./batch-caption-review-dialog.component.scss']
})
export class BatchCaptionReviewDialogComponent implements OnDestroy {
  step: DialogStep = 'setup';
  loadingPreview = false;
  preview: BatchReviewPreview | null = null;
  selected = new Set<string>();
  showRawJson = false;

  // Video filtering
  selectedVideoId = 'all';
  uniqueVideos: { id: string; name: string }[] = [];
  filteredItems: any[] = [];

  // Video range limits
  videoStart: number | null = null;
  videoEnd: number | null = null;
  totalVideos: number | null = null;

  apiKey = '';
  model = 'gemini-2.5-flash';
  starting = false;
  task: BatchReviewTask | null = null;
  private pollingSub: Subscription | null = null;

  constructor(
    private dialogRef: MatDialogRef<BatchCaptionReviewDialogComponent>,
    @Inject(MAT_DIALOG_DATA) public data: { projectId: string; subpartId?: string | null },
    private videoService: VideoService,
    private snackBar: MatSnackBar
  ) {}

  generatePreview(): void {
    this.loadingPreview = true;
    this.videoService.getBatchReviewPreview(
      this.data.projectId,
      undefined,
      this.data.subpartId || undefined,
      this.videoStart !== null ? this.videoStart : undefined,
      this.videoEnd !== null ? this.videoEnd : undefined
    ).subscribe({
      next: (res) => {
        this.preview = res;
        this.selected = new Set(res.items.map(i => i.caption_id));
        
        // Extract unique videos
        const videoMap = new Map<string, string>();
        res.items.forEach(item => {
          if (item.video_id) {
            videoMap.set(item.video_id, item.video_name || 'Unnamed Video');
          }
        });
        this.uniqueVideos = Array.from(videoMap.entries()).map(([id, name]) => ({ id, name }));
        this.totalVideos = res.total_videos || null;
        
        this.selectedVideoId = 'all';
        this.filteredItems = res.items;
        this.step = 'preview';
        this.loadingPreview = false;
      },
      error: (err) => {
        this.loadingPreview = false;
        this.snackBar.open('Failed to generate preview: ' + err.message, 'Close', { duration: 4000 });
      }
    });
  }

  onVideoFilterChange(): void {
    if (!this.preview) return;
    if (this.selectedVideoId === 'all') {
      this.filteredItems = this.preview.items;
    } else {
      this.filteredItems = this.preview.items.filter(i => i.video_id === this.selectedVideoId);
    }
  }

  selectAllVisible(): void {
    this.filteredItems.forEach(item => {
      this.selected.add(item.caption_id);
    });
  }

  deselectAllVisible(): void {
    this.filteredItems.forEach(item => {
      this.selected.delete(item.caption_id);
    });
  }

  toggleItem(captionId: string): void {
    if (this.selected.has(captionId)) {
      this.selected.delete(captionId);
    } else {
      this.selected.add(captionId);
    }
  }

  isSelected(captionId: string): boolean {
    return this.selected.has(captionId);
  }

  get selectedCount(): number {
    return this.selected.size;
  }

  get previewJson(): string {
    return this.preview ? JSON.stringify(this.preview, null, 2) : '';
  }

  close(): void {
    this.dialogRef.close();
  }

  ngOnDestroy(): void {
    this.pollingSub?.unsubscribe();
  }

  startReview(): void {
    if (!this.apiKey.trim() || this.selectedCount === 0) return;

    this.starting = true;
    this.videoService.startBatchReview(
      this.data.projectId,
      this.preview?.video_id ?? null,
      Array.from(this.selected),
      this.apiKey.trim(),
      this.model
    ).subscribe({
      next: (res) => {
        this.starting = false;
        this.step = 'running';
        this.pollingSub = interval(2000).subscribe(() => this.pollStatus(res.task_id));
        this.pollStatus(res.task_id);
      },
      error: (err) => {
        this.starting = false;
        this.snackBar.open('Failed to start review: ' + err.message, 'Close', { duration: 4000 });
      }
    });
  }

  private pollStatus(taskId: string): void {
    this.videoService.getBatchReviewStatus(taskId).subscribe({
      next: (task) => {
        this.task = task;
        if (task.status === 'completed' || task.status === 'failed') {
          this.pollingSub?.unsubscribe();
          this.step = 'done';
        }
      },
      error: (err) => {
        this.pollingSub?.unsubscribe();
        this.snackBar.open('Lost connection to review job: ' + err.message, 'Close', { duration: 4000 });
      }
    });
  }
}
