import { Component, OnInit, ViewChild, ElementRef, AfterViewInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatSliderModule } from '@angular/material/slider';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatMenuModule } from '@angular/material/menu';
import { MatTabsModule } from '@angular/material/tabs';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { VideoService } from '../../core/services/video.service';
import { AuthService } from '../../core/services/auth.service';
import { VideoItem, VideoSegment, ObjectRegion, Caption } from '../../core/models';

@Component({
  selector: 'app-video-editor',
  standalone: true,
  imports: [
    CommonModule, FormsModule,
    MatButtonModule, MatIconModule, MatSliderModule, MatFormFieldModule,
    MatInputModule, MatSelectModule, MatSnackBarModule, MatProgressSpinnerModule,
    MatTooltipModule, MatMenuModule, MatTabsModule, MatProgressBarModule
  ],
  template: `
    <!-- Top Toolbar -->
    <div class="editor-toolbar">
      <div class="toolbar-left">
        <button mat-icon-button (click)="goBack()" matTooltip="Back">
          <mat-icon>arrow_back</mat-icon>
        </button>
        <div class="file-name">
          <mat-icon>movie</mat-icon>
          <span>{{ video?.original_name }}</span>
        </div>
      </div>
      <div class="toolbar-center">
        <div class="step-tabs">
          <button *ngFor="let step of steps; let i = index"
            class="step-tab" [class.active]="currentStep === i + 1"
            [class.completed]="currentStep > i + 1"
            (click)="setStep(i + 1)">
            <span class="step-num">{{ i + 1 }}</span>
            <span class="step-label">{{ step }}</span>
          </button>
        </div>
      </div>
      <div class="toolbar-right">
        <button mat-raised-button class="export-btn" (click)="exportAnnotations()" matTooltip="Export annotations">
          <mat-icon>download</mat-icon> Export
        </button>
      </div>
    </div>

    <!-- Review & Annotators Info Bar -->
    <div class="info-bar" *ngIf="video">
      <div class="info-bar-left">
        <!-- Annotators -->
        <div class="annotators-info" *ngIf="video.annotator_details?.length">
          <mat-icon>people</mat-icon>
          <span class="info-label">Annotators:</span>
          <div class="annotator-chips">
            <div *ngFor="let u of video.annotator_details" class="annotator-chip"
                 [style.background]="u.avatar_color || '#4A90D9'">
              <span class="chip-avatar">{{ u.full_name?.charAt(0) || u.username?.charAt(0) }}</span>
              <span class="chip-name">{{ u.full_name || u.username }}</span>
            </div>
          </div>
        </div>
        <!-- Reviewer -->
        <div class="reviewer-info" *ngIf="video.reviewer_details">
          <mat-icon>verified_user</mat-icon>
          <span class="info-label">Reviewer:</span>
          <div class="annotator-chip" [style.background]="video.reviewer_details.avatar_color || '#e8590c'">
            <span class="chip-avatar">{{ video.reviewer_details.full_name?.charAt(0) || video.reviewer_details.username?.charAt(0) }}</span>
            <span class="chip-name">{{ video.reviewer_details.full_name || video.reviewer_details.username }}</span>
          </div>
        </div>
      </div>
      <div class="info-bar-right">
        <!-- Review Status -->
        <span class="ed-review-badge" [class]="video.review_status || 'not_submitted'">
          <mat-icon>{{ getReviewIcon(video.review_status) }}</mat-icon>
          {{ getReviewLabel(video.review_status) }}
        </span>
        <!-- Annotator: Submit for Review -->
        <button *ngIf="canSubmitForReview()" mat-stroked-button class="ed-submit-btn"
                (click)="submitForReview()">
          <mat-icon>send</mat-icon> Submit for Review
        </button>
        <!-- Reviewer: Approve / Reject -->
        <ng-container *ngIf="canReview()">
          <button mat-stroked-button class="ed-approve-btn" (click)="approveVideo()">
            <mat-icon>check_circle</mat-icon> Approve
          </button>
          <button mat-stroked-button class="ed-reject-btn" (click)="showEditorRejectDialog = true">
            <mat-icon>cancel</mat-icon> Reject
          </button>
        </ng-container>
      </div>
    </div>
    <!-- Review Comment Banner -->
    <div class="review-comment-banner" *ngIf="video?.review_comment"
         [class.rejected]="video.review_status === 'rejected'">
      <mat-icon>comment</mat-icon>
      <span>{{ video.review_comment }}</span>
    </div>

    <div class="editor-body" *ngIf="video">
      <!-- Hidden video for frame extraction (shared across steps) -->
      <video #segVideoPlayer [src]="video.url" style="display:none"></video>

      <!-- =================== STEP 1: VIDEO SEGMENTATION =================== -->
      <div class="step-content" *ngIf="currentStep === 1">
        <div class="editor-layout">
          <!-- Video Player -->
          <div class="player-section">
            <div class="video-container">
              <video #videoPlayer
                [src]="video.url"
                (loadedmetadata)="onVideoLoaded()"
                (timeupdate)="onTimeUpdate()"
                (click)="togglePlay()">
              </video>
              <div class="play-overlay" *ngIf="!isPlaying" (click)="togglePlay()">
                <mat-icon>play_arrow</mat-icon>
              </div>
            </div>

            <!-- Player Controls -->
            <div class="player-controls">
              <button mat-icon-button (click)="togglePlay()">
                <mat-icon>{{ isPlaying ? 'pause' : 'play_arrow' }}</mat-icon>
              </button>
              <span class="time-display">{{ formatTime(currentTime) }}</span>
              <div class="seek-bar" (click)="seekTo($event)" #seekBar>
                <div class="seek-fill" [style.width.%]="(currentTime / duration) * 100"></div>
                <div class="seek-thumb" [style.left.%]="(currentTime / duration) * 100"></div>
                <!-- Segment markers -->
                <div *ngFor="let seg of segments; let i = index" class="segment-marker"
                  [style.left.%]="(seg.start_time / duration) * 100"
                  [style.width.%]="((seg.end_time - seg.start_time) / duration) * 100"
                  [style.background]="getSegmentColor(i) + '60'"
                  [style.borderColor]="getSegmentColor(i)"
                  [class.active]="selectedSegment?.id === seg.id"
                  (click)="selectSegment(seg); $event.stopPropagation()">
                </div>
                <!-- Pending segment start marker -->
                <div *ngIf="segmentStart !== null" class="pending-start-marker"
                  [style.left.%]="(segmentStart / duration) * 100"
                  [style.background]="getSegmentColor(segments.length)">
                </div>
                <!-- Pending segment range (when both start and end are set) -->
                <div *ngIf="segmentStart !== null && segmentEnd !== null" class="pending-segment-marker"
                  [style.left.%]="(getPendingStart() / duration) * 100"
                  [style.width.%]="((getPendingEnd() - getPendingStart()) / duration) * 100"
                  [style.background]="getSegmentColor(segments.length) + '50'"
                  [style.borderColor]="getSegmentColor(segments.length)">
                </div>
              </div>
              <span class="time-display">{{ formatTime(duration) }}</span>
              <button mat-icon-button (click)="toggleMute()">
                <mat-icon>{{ isMuted ? 'volume_off' : 'volume_up' }}</mat-icon>
              </button>
            </div>

            <!-- Segment Actions -->
            <div class="segment-actions">
              <button mat-raised-button class="action-btn" (click)="markSegmentStart()">
                <mat-icon>first_page</mat-icon> Mark Start
              </button>
              <button mat-raised-button class="action-btn" (click)="markSegmentEnd()">
                <mat-icon>last_page</mat-icon> Mark End
              </button>
              <button mat-raised-button class="primary-btn" (click)="addSegment()" [disabled]="segmentStart === null">
                <mat-icon>add</mat-icon> Add Segment
              </button>
              <div class="spacer"></div>
              <button mat-raised-button class="action-btn" (click)="autoSplit()">
                <mat-icon>auto_fix_high</mat-icon> Auto Split
              </button>
            </div>
          </div>

          <!-- Resize Divider -->
          <div class="resize-divider" (mousedown)="startPanelResize($event)"></div>
          <!-- Segments Panel -->
          <div class="segments-panel" [style.width.px]="panelWidth">
            <div class="panel-header">
              <h3>Segments</h3>
              <span class="count-badge">{{ segments.length }}</span>
            </div>
            <div class="segments-list">
              <div *ngFor="let seg of segments; let i = index"
                class="segment-item" [class.active]="selectedSegment?.id === seg.id"
                (click)="selectSegment(seg)">
                <div class="seg-color" [style.background]="getSegmentColor(i)"></div>
                <div class="seg-info">
                  <input class="seg-name-input" [(ngModel)]="seg.name"
                    (blur)="updateSegmentName(seg)" (click)="$event.stopPropagation()">
                  <span class="seg-time">{{ formatTime(seg.start_time) }} - {{ formatTime(seg.end_time) }}</span>
                </div>
                <button mat-icon-button (click)="deleteSegment(seg); $event.stopPropagation()">
                  <mat-icon>close</mat-icon>
                </button>
              </div>
              <div *ngIf="segments.length === 0" class="empty-segments">
                <p>No segments yet</p>
                <p class="hint">Use Mark Start/End to create segments</p>
              </div>
            </div>
          </div>
        </div>

        <!-- Timeline -->
        <div class="timeline-section">
          <div class="timeline-header">
            <mat-icon>timeline</mat-icon>
            <span>Timeline</span>
          </div>
          <div class="timeline-track" #timelineTrack (click)="seekFromTimeline($event)">
            <div class="timeline-cursor" [style.left.%]="(currentTime / duration) * 100"></div>
            <div *ngFor="let seg of segments; let i = index"
              class="timeline-segment"
              [style.left.%]="(seg.start_time / duration) * 100"
              [style.width.%]="((seg.end_time - seg.start_time) / duration) * 100"
              [style.background]="getSegmentColor(i) + '80'"
              [style.borderColor]="getSegmentColor(i)"
              [class.active]="selectedSegment?.id === seg.id"
              (click)="selectSegment(seg); $event.stopPropagation()">
              <span class="tl-seg-name">{{ seg.name }}</span>
            </div>
            <!-- Pending segment start marker on timeline -->
            <div *ngIf="segmentStart !== null" class="timeline-pending-start"
              [style.left.%]="(segmentStart / duration) * 100"
              [style.background]="getSegmentColor(segments.length)">
            </div>
            <!-- Pending segment range on timeline -->
            <div *ngIf="segmentStart !== null && segmentEnd !== null"
              class="timeline-segment pending"
              [style.left.%]="(getPendingStart() / duration) * 100"
              [style.width.%]="((getPendingEnd() - getPendingStart()) / duration) * 100"
              [style.background]="getSegmentColor(segments.length) + '50'"
              [style.borderColor]="getSegmentColor(segments.length)">
              <span class="tl-seg-name">New Segment</span>
            </div>
            <!-- Time markers -->
            <div class="time-markers">
              <span *ngFor="let t of timeMarkers" class="time-marker" [style.left.%]="(t / duration) * 100">
                {{ formatTime(t) }}
              </span>
            </div>
          </div>
        </div>
      </div>

      <!-- =================== STEP 2: OBJECT SEGMENTATION =================== -->
      <div class="step-content" *ngIf="currentStep === 2">
        <div class="editor-layout">
          <!-- Canvas Section -->
          <div class="canvas-section">
            <div class="canvas-toolbar">
              <span class="segment-label" *ngIf="selectedSegment">
                {{ selectedSegment.name }} ({{ formatTime(selectedSegment.start_time) }} - {{ formatTime(selectedSegment.end_time) }})
              </span>
              <div class="brush-tools">
                <button mat-icon-button [class.active]="brushMode === 'draw'"
                  (click)="brushMode = 'draw'" matTooltip="Draw brush">
                  <mat-icon>brush</mat-icon>
                </button>
                <button mat-icon-button [class.active]="brushMode === 'erase'"
                  (click)="brushMode = 'erase'" matTooltip="Eraser">
                  <mat-icon>auto_fix_off</mat-icon>
                </button>
                <div class="brush-size">
                  <mat-icon>circle</mat-icon>
                  <input type="range" min="5" max="80" [(ngModel)]="brushSize">
                  <span>{{ brushSize }}px</span>
                </div>
                <button mat-icon-button (click)="clearCanvas()" matTooltip="Clear">
                  <mat-icon>delete_sweep</mat-icon>
                </button>
              </div>
              <div class="canvas-actions">
                <button mat-raised-button class="primary-btn" (click)="runSegmentation()" [disabled]="segmenting">
                  <mat-spinner *ngIf="segmenting" diameter="16"></mat-spinner>
                  <mat-icon *ngIf="!segmenting">auto_awesome</mat-icon>
                  {{ segmenting ? 'Processing...' : 'Segment' }}
                </button>
                <button *ngIf="selectedRegion" mat-raised-button class="action-btn update-btn" (click)="saveOrUpdateRegion()" [disabled]="!hasDrawing">
                  <mat-icon>update</mat-icon> Update Region
                </button>
                <button *ngIf="!selectedRegion && hasDrawing" mat-raised-button class="action-btn" (click)="saveOrUpdateRegion()">
                  <mat-icon>save</mat-icon> Save Region
                </button>
                <button mat-stroked-button class="new-obj-btn" (click)="startNewRegion()" matTooltip="Deselect current region and start a new one">
                  <mat-icon>add_circle_outline</mat-icon> New Object
                </button>
              </div>
            </div>

            <div class="canvas-container" (wheel)="onCanvasWheel($event)">
              <div class="canvas-zoom-wrapper" [style.transform]="'scale(' + zoomLevel + ') translate(' + panX + 'px,' + panY + 'px)'"
                   (mousedown)="onCanvasMouseDown($event)"
                   (mousemove)="onCanvasMouseMove($event)"
                   (mouseup)="onCanvasMouseUp($event)"
                   (mouseleave)="onCanvasMouseUp($event)">
                <canvas #frameCanvas class="frame-canvas"></canvas>
                <canvas #drawCanvas class="draw-canvas"></canvas>
                <canvas #maskCanvas class="mask-canvas"></canvas>
              </div>

              <!-- Zoom controls -->
              <div class="zoom-controls">
                <button mat-icon-button (click)="zoomIn()" matTooltip="Zoom in">
                  <mat-icon>zoom_in</mat-icon>
                </button>
                <span class="zoom-level">{{ (zoomLevel * 100).toFixed(0) }}%</span>
                <button mat-icon-button (click)="zoomOut()" matTooltip="Zoom out">
                  <mat-icon>zoom_out</mat-icon>
                </button>
                <button mat-icon-button (click)="zoomReset()" matTooltip="Reset zoom" *ngIf="zoomLevel !== 1">
                  <mat-icon>center_focus_strong</mat-icon>
                </button>
              </div>

              <!-- Frame navigation -->
              <div class="frame-nav">
                <button mat-icon-button (click)="prevFrame()" matTooltip="Previous frame">
                  <mat-icon>skip_previous</mat-icon>
                </button>
                <span>Frame at {{ formatTime(frameTime) }}</span>
                <button mat-icon-button (click)="nextFrame()" matTooltip="Next frame">
                  <mat-icon>skip_next</mat-icon>
                </button>
              </div>
            </div>

          </div>

          <!-- Resize Divider -->
          <div class="resize-divider" (mousedown)="startPanelResize($event)"></div>
          <!-- Regions Panel -->
          <div class="regions-panel" [style.width.px]="panelWidth">
            <div class="panel-header">
              <h3>Segments</h3>
            </div>
            <div class="mini-segments">
              <div *ngFor="let seg of segments; let i = index"
                class="mini-seg" [class.active]="selectedSegment?.id === seg.id"
                (click)="selectSegmentForAnnotation(seg)">
                <div class="seg-color" [style.background]="getSegmentColor(i)"></div>
                <span>{{ seg.name }}</span>
                <span class="region-count">{{ segmentRegionCounts[seg.id] || 0 }}</span>
              </div>
            </div>

            <div class="panel-header mt-16">
              <h3>Regions</h3>
              <span class="count-badge">{{ regions.length }}</span>
            </div>
            <div class="regions-list">
              <div *ngFor="let region of regions"
                class="region-item" [class.active]="selectedRegion?.id === region.id"
                (click)="selectRegion(region)">
                <input type="color" class="region-color-input" [ngModel]="region.color"
                  (ngModelChange)="region.color = $event; updateRegionProps(region)"
                  (click)="$event.stopPropagation()">
                <div class="region-info">
                  <input class="seg-name-input" [(ngModel)]="region.label"
                    (blur)="updateRegionProps(region)" (click)="$event.stopPropagation()">
                  <span class="region-time">&#64; {{ formatTime(region.frame_time) }}</span>
                </div>
                <div class="region-actions">
                  <mat-icon *ngIf="region.caption" class="has-caption" matTooltip="Has caption">description</mat-icon>
                  <button mat-icon-button (click)="deleteRegion(region); $event.stopPropagation()">
                    <mat-icon>close</mat-icon>
                  </button>
                </div>
              </div>
              <div *ngIf="regions.length === 0" class="empty-segments">
                <p>No regions yet</p>
                <p class="hint">Draw on the frame and click Segment</p>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- =================== STEP 3: CAPTIONING =================== -->
      <div class="step-content" *ngIf="currentStep === 3">
        <div class="editor-layout">
          <!-- Caption Editor -->
          <div class="caption-section">
            <div class="caption-header">
              <h3 *ngIf="selectedRegion">
                Captioning: <span [style.color]="selectedRegion.color">{{ selectedRegion.label }}</span>
                in {{ selectedSegment?.name }}
              </h3>
              <h3 *ngIf="!selectedRegion">Select a region to add captions</h3>
            </div>

            <div class="caption-preview" *ngIf="selectedRegion">
              <div class="preview-canvas-wrap">
                <canvas #captionCanvas class="caption-canvas"></canvas>
              </div>
            </div>

            <div class="caption-levels" *ngIf="selectedRegion">
              <div class="caption-level">
                <div class="level-header">
                  <div class="level-badge visual">L1</div>
                  <div>
                    <h4>Visual Caption</h4>
                    <p>Describe what the object looks like visually</p>
                  </div>
                </div>
                <mat-form-field appearance="outline">
                  <textarea matInput [(ngModel)]="captionData.visual_caption" rows="3"
                    placeholder="e.g., A red sedan car with tinted windows parked on the street"></textarea>
                </mat-form-field>
              </div>

              <div class="caption-level">
                <div class="level-header">
                  <div class="level-badge contextual">L2</div>
                  <div>
                    <h4>Contextual Caption</h4>
                    <p>Describe what the object is and its context</p>
                  </div>
                </div>
                <mat-form-field appearance="outline">
                  <textarea matInput [(ngModel)]="captionData.contextual_caption" rows="3"
                    placeholder="e.g., The car is waiting at a traffic light on a busy intersection"></textarea>
                </mat-form-field>
              </div>

              <div class="caption-level">
                <div class="level-header">
                  <div class="level-badge knowledge">L3</div>
                  <div>
                    <h4>Knowledge Caption</h4>
                    <p>Domain knowledge about the object</p>
                  </div>
                </div>
                <mat-form-field appearance="outline">
                  <textarea matInput [(ngModel)]="captionData.knowledge_caption" rows="3"
                    placeholder="e.g., This appears to be a Toyota Camry 2020 model, a popular mid-size sedan"></textarea>
                </mat-form-field>
              </div>

              <div class="caption-level combined">
                <div class="level-header">
                  <div class="level-badge combined-badge">✦</div>
                  <div>
                    <h4>Combined Caption</h4>
                    <p>Final combined description from all levels</p>
                  </div>
                </div>
                <mat-form-field appearance="outline">
                  <textarea matInput [(ngModel)]="captionData.combined_caption" rows="4"
                    placeholder="Combined description incorporating all caption levels..."></textarea>
                </mat-form-field>
                <button mat-stroked-button class="auto-combine-btn" (click)="autoCombineCaptions()">
                  <mat-icon>auto_awesome</mat-icon> Auto Combine
                </button>
              </div>

              <div class="caption-actions">
                <button mat-raised-button class="primary-btn" (click)="saveCaption()">
                  <mat-icon>save</mat-icon> Save Caption
                </button>
              </div>
            </div>
          </div>

          <!-- Resize Divider -->
          <div class="resize-divider" (mousedown)="startPanelResize($event)"></div>
          <!-- Segments & Regions Panel -->
          <div class="caption-sidebar" [style.width.px]="panelWidth">
            <div class="panel-header">
              <h3>Segments</h3>
            </div>
            <div class="caption-segments">
              <div *ngFor="let seg of segments; let i = index" class="caption-seg-group">
                <div class="caption-seg-header" [class.active]="selectedSegment?.id === seg.id"
                  (click)="selectSegmentForCaption(seg)">
                  <div class="seg-color" [style.background]="getSegmentColor(i)"></div>
                  <span>{{ seg.name }}</span>
                  <mat-icon>{{ selectedSegment?.id === seg.id ? 'expand_less' : 'expand_more' }}</mat-icon>
                </div>
                <div class="caption-regions" *ngIf="selectedSegment?.id === seg.id">
                  <div *ngFor="let region of regions"
                    class="caption-region-item"
                    [class.active]="selectedRegion?.id === region.id"
                    (click)="selectRegionForCaption(region)">
                    <div class="region-color-dot" [style.background]="region.color"></div>
                    <span>{{ region.label }}</span>
                    <mat-icon *ngIf="region.caption" class="has-caption-icon">check_circle</mat-icon>
                  </div>
                  <div *ngIf="regions.length === 0" class="no-regions">
                    No regions in this segment
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Loading -->
    <div *ngIf="!video" class="loading-page">
      <mat-spinner diameter="40"></mat-spinner>
    </div>

    <!-- Reject Dialog -->
    <div class="ed-dialog-overlay" *ngIf="showEditorRejectDialog" (click)="showEditorRejectDialog = false">
      <div class="ed-dialog-card" (click)="$event.stopPropagation()">
        <h2>Reject Video</h2>
        <p class="ed-dialog-subtitle">{{ video?.original_name }}</p>
        <div class="ed-textarea-wrap">
          <textarea [(ngModel)]="editorRejectComment" rows="4"
                    placeholder="Describe what needs to be fixed..."></textarea>
        </div>
        <div class="ed-dialog-actions">
          <button mat-button (click)="showEditorRejectDialog = false">Cancel</button>
          <button mat-raised-button class="ed-reject-btn" (click)="rejectVideo()">
            <mat-icon>cancel</mat-icon> Reject
          </button>
        </div>
      </div>
    </div>
  `,
  styleUrls: ['./video-editor.component.scss']
})
export class VideoEditorComponent implements OnInit, AfterViewInit, OnDestroy {
  @ViewChild('videoPlayer') videoPlayerRef!: ElementRef<HTMLVideoElement>;
  @ViewChild('segVideoPlayer') segVideoPlayerRef!: ElementRef<HTMLVideoElement>;
  @ViewChild('seekBar') seekBarRef!: ElementRef;
  @ViewChild('timelineTrack') timelineTrackRef!: ElementRef;
  @ViewChild('frameCanvas') frameCanvasRef!: ElementRef<HTMLCanvasElement>;
  @ViewChild('drawCanvas') drawCanvasRef!: ElementRef<HTMLCanvasElement>;
  @ViewChild('maskCanvas') maskCanvasRef!: ElementRef<HTMLCanvasElement>;
  @ViewChild('captionCanvas') captionCanvasRef!: ElementRef<HTMLCanvasElement>;

  video: VideoItem | null = null;
  steps = ['Segment Video', 'Object Region', 'Captioning'];
  currentStep = 1;

  // Player
  isPlaying = false;
  isMuted = false;
  currentTime = 0;
  duration = 0;
  timeMarkers: number[] = [];

  // Segments
  segments: VideoSegment[] = [];
  selectedSegment: VideoSegment | null = null;
  segmentStart: number | null = null;
  segmentEnd: number | null = null;

  // Regions
  regions: ObjectRegion[] = [];
  selectedRegion: ObjectRegion | null = null;
  brushMode: 'draw' | 'erase' = 'draw';
  brushSize = 25;
  isDrawing = false;
  hasDrawing = false;
  segmenting = false;
  frameTime = 0;
  currentRegionLabel = 'Object';
  currentRegionColor = '#FF4444';
  lastSegmentedMask = '';
  segmentRegionCounts: { [key: string]: number } = {};
  private regionColors = ['#FF4444', '#3b82f6', '#10b981', '#f59e0b', '#8b5cf6', '#ec4899', '#06b6d4', '#84cc16', '#f97316', '#14b8a6'];
  private regionColorIndex = 0;

  // Zoom & Pan
  zoomLevel = 1;
  panX = 0;
  panY = 0;
  private isPanning = false;
  private panStartX = 0;
  private panStartY = 0;
  private panOriginX = 0;
  private panOriginY = 0;

  // Captions
  captionData: Caption = {
    visual_caption: '',
    contextual_caption: '',
    knowledge_caption: '',
    combined_caption: ''
  };

  // Panel resize
  panelWidth = 300;
  private isResizingPanel = false;

  // Review
  showEditorRejectDialog = false;
  editorRejectComment = '';
  private resizeMouseMove: ((e: MouseEvent) => void) | null = null;
  private resizeMouseUp: (() => void) | null = null;

  private segColors = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#06b6d4', '#84cc16'];

  constructor(
    private route: ActivatedRoute,
    private router: Router,
    private videoService: VideoService,
    private authService: AuthService,
    private snackBar: MatSnackBar
  ) {}

  ngOnInit(): void {
    const videoId = this.route.snapshot.paramMap.get('videoId')!;
    this.loadVideo(videoId);
  }

  ngAfterViewInit(): void {}

  ngOnDestroy(): void {
    if (this.videoPlayerRef?.nativeElement) {
      this.videoPlayerRef.nativeElement.pause();
    }
    this.stopPanelResize();
  }

  startPanelResize(event: MouseEvent): void {
    event.preventDefault();
    this.isResizingPanel = true;
    const startX = event.clientX;
    const startWidth = this.panelWidth;

    this.resizeMouseMove = (e: MouseEvent) => {
      const delta = startX - e.clientX;
      this.panelWidth = Math.max(200, Math.min(600, startWidth + delta));
    };
    this.resizeMouseUp = () => {
      this.isResizingPanel = false;
      this.stopPanelResize();
    };

    document.addEventListener('mousemove', this.resizeMouseMove);
    document.addEventListener('mouseup', this.resizeMouseUp);
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  }

  private stopPanelResize(): void {
    if (this.resizeMouseMove) {
      document.removeEventListener('mousemove', this.resizeMouseMove);
      this.resizeMouseMove = null;
    }
    if (this.resizeMouseUp) {
      document.removeEventListener('mouseup', this.resizeMouseUp);
      this.resizeMouseUp = null;
    }
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
  }

  loadVideo(id: string): void {
    this.videoService.getVideo(id).subscribe({
      next: (video) => {
        this.video = video;
        this.currentStep = video.current_step || 1;
        this.segments = video.segments || [];
        if (this.segments.length > 0) {
          this.selectedSegment = this.segments[0];
        }

        // Initialize the current step (load frame, regions, counts)
        this.initCurrentStep();
      },
      error: () => this.router.navigate(['/dashboard'])
    });
  }

  /** Run once after loadVideo or setStep to bootstrap the active step */
  private initCurrentStep(): void {
    if (this.currentStep === 2) {
      if (!this.selectedSegment && this.segments.length > 0) {
        this.selectedSegment = this.segments[0];
      }
      if (this.selectedSegment) {
        this.frameTime = this.selectedSegment.start_time;
        setTimeout(() => this.loadFrameForSegmentation(), 400);
        this.loadRegions();
      }
      this.loadAllRegionCounts();
    }

    if (this.currentStep === 3) {
      if (!this.selectedSegment && this.segments.length > 0) {
        this.selectedSegment = this.segments[0];
      }
      if (this.selectedSegment) {
        this.loadRegions();
      }
      this.loadAllRegionCounts();
    }
  }

  // ============ Player Controls ============
  onVideoLoaded(): void {
    const player = this.videoPlayerRef.nativeElement;
    this.duration = player.duration;
    this.generateTimeMarkers();

    // Update video with correct duration
    if (this.video && this.video.duration !== this.duration) {
      this.videoService.updateVideo(this.video.id, {
        duration: this.duration,
        width: player.videoWidth,
        height: player.videoHeight
      } as any).subscribe();
    }
  }

  onTimeUpdate(): void {
    this.currentTime = this.videoPlayerRef.nativeElement.currentTime;
  }

  togglePlay(): void {
    const player = this.videoPlayerRef.nativeElement;
    if (player.paused) {
      player.play();
      this.isPlaying = true;
    } else {
      player.pause();
      this.isPlaying = false;
    }
  }

  toggleMute(): void {
    this.videoPlayerRef.nativeElement.muted = !this.videoPlayerRef.nativeElement.muted;
    this.isMuted = this.videoPlayerRef.nativeElement.muted;
  }

  seekTo(event: MouseEvent): void {
    const bar = this.seekBarRef.nativeElement;
    const rect = bar.getBoundingClientRect();
    const pct = (event.clientX - rect.left) / rect.width;
    this.videoPlayerRef.nativeElement.currentTime = pct * this.duration;
  }

  seekFromTimeline(event: MouseEvent): void {
    const track = this.timelineTrackRef.nativeElement;
    const rect = track.getBoundingClientRect();
    const pct = (event.clientX - rect.left) / rect.width;
    this.videoPlayerRef.nativeElement.currentTime = pct * this.duration;
  }

  generateTimeMarkers(): void {
    const count = Math.min(10, Math.floor(this.duration / 5));
    this.timeMarkers = [];
    for (let i = 0; i <= count; i++) {
      this.timeMarkers.push((this.duration / count) * i);
    }
  }

  formatTime(seconds: number): string {
    if (!seconds || isNaN(seconds)) return '0:00';
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${s.toString().padStart(2, '0')}`;
  }

  // ============ Segment Operations ============
  markSegmentStart(): void {
    this.segmentStart = this.currentTime;
    this.segmentEnd = null;
    this.snackBar.open(`▶ Start marked at ${this.formatTime(this.currentTime)}`, '', { duration: 1500 });
  }

  markSegmentEnd(): void {
    if (this.segmentStart === null) {
      this.snackBar.open('Mark the start point first', '', { duration: 1500 });
      return;
    }
    this.segmentEnd = this.currentTime;
    this.snackBar.open(
      `◼ Segment: ${this.formatTime(this.getPendingStart())} → ${this.formatTime(this.getPendingEnd())}`,
      '', { duration: 2000 }
    );
  }

  getPendingStart(): number {
    if (this.segmentStart === null) return 0;
    if (this.segmentEnd === null) return this.segmentStart;
    return Math.min(this.segmentStart, this.segmentEnd);
  }

  getPendingEnd(): number {
    if (this.segmentEnd === null) return this.segmentStart || 0;
    if (this.segmentStart === null) return this.segmentEnd;
    return Math.max(this.segmentStart, this.segmentEnd);
  }

  addSegment(): void {
    if (this.segmentStart === null || !this.video) return;
    const end = this.segmentEnd !== null ? this.segmentEnd : this.duration;
    const start = Math.min(this.segmentStart, end);
    const endTime = Math.max(this.segmentStart, end);

    this.videoService.createSegment(this.video.id, {
      name: `Segment ${this.segments.length + 1}`,
      start_time: start,
      end_time: endTime
    }).subscribe({
      next: (seg) => {
        this.segments.push(seg);
        this.segmentStart = null;
        this.segmentEnd = null;
        this.snackBar.open('Segment added!', '', { duration: 1500, panelClass: 'snack-success' });
      }
    });
  }

  autoSplit(): void {
    if (!this.video) return;
    const segCount = Math.max(2, Math.ceil(this.duration / 10));
    const segDuration = this.duration / segCount;
    const newSegments: Partial<VideoSegment>[] = [];

    for (let i = 0; i < segCount; i++) {
      newSegments.push({
        name: `Segment ${i + 1}`,
        start_time: i * segDuration,
        end_time: (i + 1) * segDuration
      });
    }

    this.videoService.createSegmentsBatch(this.video.id, newSegments, true).subscribe({
      next: (segments) => {
        this.segments = segments;
        this.snackBar.open(`Created ${segments.length} segments`, '', { duration: 2000, panelClass: 'snack-success' });
      }
    });
  }

  selectSegment(seg: VideoSegment): void {
    this.selectedSegment = seg;
    if (this.videoPlayerRef?.nativeElement) {
      this.videoPlayerRef.nativeElement.currentTime = seg.start_time;
    }
  }

  updateSegmentName(seg: VideoSegment): void {
    this.videoService.updateSegment(seg.id, { name: seg.name }).subscribe();
  }

  deleteSegment(seg: VideoSegment): void {
    this.videoService.deleteSegment(seg.id).subscribe({
      next: () => {
        this.segments = this.segments.filter(s => s.id !== seg.id);
        if (this.selectedSegment?.id === seg.id) {
          this.selectedSegment = this.segments[0] || null;
        }
        this.snackBar.open('Segment deleted', '', { duration: 1500 });
      }
    });
  }

  getSegmentColor(index: number): string {
    return this.segColors[index % this.segColors.length];
  }

  // ============ Step Navigation ============
  setStep(step: number): void {
    this.currentStep = step;
    if (this.video) {
      this.videoService.updateVideo(this.video.id, { current_step: step } as any).subscribe();
    }
    this.initCurrentStep();
  }

  // ============ Object Segmentation (Step 2) ============
  selectSegmentForAnnotation(seg: VideoSegment): void {
    this.selectedSegment = seg;
    this.selectedRegion = null;
    this.frameTime = seg.start_time;
    setTimeout(() => {
      this.loadFrameForSegmentation(() => {
        this.loadRegionsAndShowAll();
      });
    }, 100);
  }

  loadRegionsAndShowAll(): void {
    if (!this.selectedSegment) return;
    this.videoService.getSegmentRegions(this.selectedSegment.id).subscribe({
      next: (regions) => {
        this.regions = regions;
        this.segmentRegionCounts[this.selectedSegment!.id] = regions.length;
        this.autoSetNextRegionColor();
        this.drawAllRegionOverlays();
      }
    });
  }

  loadRegions(): void {
    if (!this.selectedSegment) return;
    this.videoService.getSegmentRegions(this.selectedSegment.id).subscribe({
      next: (regions) => {
        this.regions = regions;
        this.segmentRegionCounts[this.selectedSegment!.id] = regions.length;
        this.autoSetNextRegionColor();
      }
    });
  }

  loadAllRegionCounts(): void {
    this.segments.forEach(seg => {
      this.videoService.getSegmentRegions(seg.id).subscribe({
        next: (regions) => this.segmentRegionCounts[seg.id] = regions.length
      });
    });
  }

  loadFrameForSegmentation(onLoaded?: () => void): void {
    if (!this.segVideoPlayerRef || !this.frameCanvasRef || !this.drawCanvasRef) return;

    const video = this.segVideoPlayerRef.nativeElement;
    const frameCanvas = this.frameCanvasRef.nativeElement;
    const drawCanvas = this.drawCanvasRef.nativeElement;
    const maskCanvas = this.maskCanvasRef?.nativeElement;

    video.currentTime = this.frameTime;
    video.onseeked = () => {
      const w = 800;
      const h = (video.videoHeight / video.videoWidth) * w || 450;

      frameCanvas.width = drawCanvas.width = w;
      frameCanvas.height = drawCanvas.height = h;
      if (maskCanvas) {
        maskCanvas.width = w;
        maskCanvas.height = h;
      }

      const ctx = frameCanvas.getContext('2d')!;
      ctx.drawImage(video, 0, 0, w, h);

      // Clear draw canvas
      const dCtx = drawCanvas.getContext('2d')!;
      dCtx.clearRect(0, 0, w, h);
      this.hasDrawing = false;

      if (onLoaded) onLoaded();
    };
    video.load();
    setTimeout(() => { video.currentTime = this.frameTime; }, 300);
  }

  // ---- Zoom & Pan ----
  onCanvasWheel(event: WheelEvent): void {
    event.preventDefault();
    const delta = event.deltaY > 0 ? -0.1 : 0.1;
    this.zoomLevel = Math.min(5, Math.max(0.25, this.zoomLevel + delta));
  }

  zoomIn(): void {
    this.zoomLevel = Math.min(5, this.zoomLevel + 0.25);
  }

  zoomOut(): void {
    this.zoomLevel = Math.max(0.25, this.zoomLevel - 0.25);
  }

  zoomReset(): void {
    this.zoomLevel = 1;
    this.panX = 0;
    this.panY = 0;
  }

  onCanvasMouseDown(event: MouseEvent): void {
    // Middle-click or Space+click for panning, otherwise draw
    if (event.button === 1 || (event.button === 0 && event.altKey)) {
      event.preventDefault();
      this.isPanning = true;
      this.panStartX = event.clientX;
      this.panStartY = event.clientY;
      this.panOriginX = this.panX;
      this.panOriginY = this.panY;
    } else if (event.button === 0) {
      this.isDrawing = true;
      this.drawAtEvent(event);
    }
  }

  onCanvasMouseMove(event: MouseEvent): void {
    if (this.isPanning) {
      const dx = (event.clientX - this.panStartX) / this.zoomLevel;
      const dy = (event.clientY - this.panStartY) / this.zoomLevel;
      this.panX = this.panOriginX + dx;
      this.panY = this.panOriginY + dy;
    } else if (this.isDrawing) {
      this.drawAtEvent(event);
    }
  }

  onCanvasMouseUp(event: MouseEvent): void {
    this.isPanning = false;
    this.isDrawing = false;
  }

  startDrawing(event: MouseEvent): void {
    this.isDrawing = true;
    this.drawAtEvent(event);
  }

  private drawAtEvent(event: MouseEvent): void {
    if (!this.drawCanvasRef) return;

    const canvas = this.drawCanvasRef.nativeElement;
    const ctx = canvas.getContext('2d')!;
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    const x = (event.clientX - rect.left) * scaleX;
    const y = (event.clientY - rect.top) * scaleY;

    ctx.globalCompositeOperation = this.brushMode === 'draw' ? 'source-over' : 'destination-out';
    ctx.beginPath();
    ctx.arc(x, y, this.brushSize / 2, 0, Math.PI * 2);

    if (this.brushMode === 'draw') {
      ctx.fillStyle = this.currentRegionColor + '66';
    }
    ctx.fill();

    this.hasDrawing = true;
  }

  draw(event: MouseEvent): void {
    this.drawAtEvent(event);
  }

  stopDrawing(): void {
    this.isDrawing = false;
  }

  clearCanvas(): void {
    if (!this.drawCanvasRef) return;
    const canvas = this.drawCanvasRef.nativeElement;
    const ctx = canvas.getContext('2d')!;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    this.hasDrawing = false;

    if (this.maskCanvasRef) {
      const maskCtx = this.maskCanvasRef.nativeElement.getContext('2d')!;
      maskCtx.clearRect(0, 0, this.maskCanvasRef.nativeElement.width, this.maskCanvasRef.nativeElement.height);
    }
  }

  runSegmentation(): void {
    if (!this.drawCanvasRef || !this.hasDrawing) return;

    this.segmenting = true;
    const brushMask = this.drawCanvasRef.nativeElement.toDataURL('image/png');
    const frameImage = this.frameCanvasRef?.nativeElement.toDataURL('image/png');

    this.videoService.segmentObject(brushMask, frameImage).subscribe({
      next: (result) => {
        this.segmenting = false;
        this.lastSegmentedMask = result.segmented_mask || '';
        // Display segmented mask as colored overlay
        if (this.maskCanvasRef && result.segmented_mask) {
          this.drawMaskOverlay(result.segmented_mask, this.currentRegionColor);
        }
        this.snackBar.open(`Segmentation complete! Confidence: ${(result.confidence * 100).toFixed(0)}%`, '', {
          duration: 2000, panelClass: 'snack-success'
        });
      },
      error: () => {
        this.segmenting = false;
        this.snackBar.open('Segmentation failed', '', { duration: 2000, panelClass: 'snack-error' });
      }
    });
  }

  /** Draw all regions' masks on the overlay canvas */
  drawAllRegionOverlays(highlightRegionId?: string): void {
    if (!this.maskCanvasRef) return;
    const maskCanvas = this.maskCanvasRef.nativeElement;
    const ctx = maskCanvas.getContext('2d')!;
    ctx.clearRect(0, 0, maskCanvas.width, maskCanvas.height);

    const regionsWithMask = this.regions.filter(r => r.segmented_mask);
    if (regionsWithMask.length === 0) return;

    let loaded = 0;
    for (const region of regionsWithMask) {
      const alpha = highlightRegionId
        ? (region.id === highlightRegionId ? 140 : 50)
        : 90;
      this.drawSingleMaskOnOverlay(ctx, maskCanvas.width, maskCanvas.height,
        region.segmented_mask!, region.color, alpha, () => {
          loaded++;
          // After all loaded, draw labels
          if (loaded === regionsWithMask.length) {
            this.drawRegionLabels(ctx, regionsWithMask, maskCanvas.width, maskCanvas.height);
          }
        });
    }
  }

  /** Draw a single mask onto the overlay canvas without clearing (additive) */
  private drawSingleMaskOnOverlay(
    ctx: CanvasRenderingContext2D, w: number, h: number,
    maskDataUrl: string, color: string, alpha: number, onDone?: () => void
  ): void {
    const img = new Image();
    img.onload = () => {
      const tempCanvas = document.createElement('canvas');
      tempCanvas.width = w;
      tempCanvas.height = h;
      const tempCtx = tempCanvas.getContext('2d')!;
      tempCtx.drawImage(img, 0, 0, w, h);
      const maskData = tempCtx.getImageData(0, 0, w, h);

      const r = parseInt(color.slice(1, 3), 16);
      const g = parseInt(color.slice(3, 5), 16);
      const b = parseInt(color.slice(5, 7), 16);

      const overlay = tempCtx.createImageData(w, h);
      for (let i = 0; i < maskData.data.length; i += 4) {
        if (maskData.data[i] > 128) {
          overlay.data[i] = r;
          overlay.data[i + 1] = g;
          overlay.data[i + 2] = b;
          overlay.data[i + 3] = alpha;
        }
      }
      // Draw onto a temp canvas then composite onto the main ctx
      const tmpOverlay = document.createElement('canvas');
      tmpOverlay.width = w;
      tmpOverlay.height = h;
      const tmpCtx2 = tmpOverlay.getContext('2d')!;
      tmpCtx2.putImageData(overlay, 0, 0);

      ctx.globalCompositeOperation = 'source-over';
      ctx.drawImage(tmpOverlay, 0, 0);

      // Draw border outline
      for (let y = 1; y < h - 1; y++) {
        for (let x = 1; x < w - 1; x++) {
          const idx = (y * w + x) * 4;
          if (maskData.data[idx] > 128) {
            const top = maskData.data[((y - 1) * w + x) * 4];
            const bot = maskData.data[((y + 1) * w + x) * 4];
            const lft = maskData.data[(y * w + (x - 1)) * 4];
            const rgt = maskData.data[(y * w + (x + 1)) * 4];
            if (top <= 128 || bot <= 128 || lft <= 128 || rgt <= 128) {
              ctx.fillStyle = color;
              ctx.fillRect(x, y, 1, 1);
            }
          }
        }
      }
      if (onDone) onDone();
    };
    img.onerror = () => { if (onDone) onDone(); };
    img.src = maskDataUrl;
  }

  /** Draw labels at centroid of each region mask */
  private drawRegionLabels(ctx: CanvasRenderingContext2D, regions: ObjectRegion[], w: number, h: number): void {
    ctx.globalCompositeOperation = 'source-over';
    for (const region of regions) {
      if (!region.segmented_mask) continue;
      // Simple centroid: use stored label position or skip heavy computation
      // We'll rely on the colored overlay being enough identification
    }
  }

  drawMaskOverlay(maskDataUrl: string, color: string): void {
    if (!this.maskCanvasRef) return;
    const maskCanvas = this.maskCanvasRef.nativeElement;
    const ctx = maskCanvas.getContext('2d')!;

    const img = new Image();
    img.onload = () => {
      ctx.clearRect(0, 0, maskCanvas.width, maskCanvas.height);
      // Draw mask to a temp canvas to get pixel data
      const tempCanvas = document.createElement('canvas');
      tempCanvas.width = maskCanvas.width;
      tempCanvas.height = maskCanvas.height;
      const tempCtx = tempCanvas.getContext('2d')!;
      tempCtx.drawImage(img, 0, 0, maskCanvas.width, maskCanvas.height);
      const maskData = tempCtx.getImageData(0, 0, maskCanvas.width, maskCanvas.height);

      // Parse color hex to RGB
      const r = parseInt(color.slice(1, 3), 16);
      const g = parseInt(color.slice(3, 5), 16);
      const b = parseInt(color.slice(5, 7), 16);

      // Create colored overlay: where mask is white, fill with region color
      const overlay = ctx.createImageData(maskCanvas.width, maskCanvas.height);
      for (let i = 0; i < maskData.data.length; i += 4) {
        const brightness = maskData.data[i]; // grayscale mask
        if (brightness > 128) {
          overlay.data[i] = r;
          overlay.data[i + 1] = g;
          overlay.data[i + 2] = b;
          overlay.data[i + 3] = 120; // semi-transparent
        } else {
          overlay.data[i + 3] = 0; // fully transparent
        }
      }
      ctx.putImageData(overlay, 0, 0);

      // Draw a border outline around the mask
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.globalCompositeOperation = 'source-over';
      // Trace outline using edge detection on the mask
      for (let y = 1; y < maskCanvas.height - 1; y++) {
        for (let x = 1; x < maskCanvas.width - 1; x++) {
          const idx = (y * maskCanvas.width + x) * 4;
          const val = maskData.data[idx];
          if (val > 128) {
            // Check neighbors
            const top = maskData.data[((y - 1) * maskCanvas.width + x) * 4];
            const bot = maskData.data[((y + 1) * maskCanvas.width + x) * 4];
            const lft = maskData.data[(y * maskCanvas.width + (x - 1)) * 4];
            const rgt = maskData.data[(y * maskCanvas.width + (x + 1)) * 4];
            if (top <= 128 || bot <= 128 || lft <= 128 || rgt <= 128) {
              ctx.fillStyle = color;
              ctx.fillRect(x, y, 1, 1);
            }
          }
        }
      }
    };
    img.src = maskDataUrl;
  }

  saveOrUpdateRegion(): void {
    if (!this.selectedSegment || !this.drawCanvasRef) return;

    const brushMask = this.drawCanvasRef.nativeElement.toDataURL('image/png');
    // Use SAM2 result if available, otherwise convert brush strokes to a binary mask
    const newSegmentedMask = this.lastSegmentedMask || this.brushToBinaryMask();

    if (this.selectedRegion) {
      // --- UPDATE existing region: merge old mask + new mask ---
      const oldMask = this.selectedRegion.segmented_mask;
      this.mergeMasks(oldMask, newSegmentedMask).then(mergedMask => {
        this.videoService.updateRegion(this.selectedRegion!.id, {
          frame_time: this.frameTime,
          brush_mask: brushMask,
          segmented_mask: mergedMask,
          label: this.currentRegionLabel,
          color: this.currentRegionColor
        }).subscribe({
          next: () => {
            const idx = this.regions.findIndex(r => r.id === this.selectedRegion!.id);
            if (idx !== -1) {
              this.regions[idx].frame_time = this.frameTime;
              this.regions[idx].brush_mask = brushMask;
              this.regions[idx].segmented_mask = mergedMask;
              this.regions[idx].label = this.currentRegionLabel;
              this.regions[idx].color = this.currentRegionColor;
            }
            this.lastSegmentedMask = '';
            this.hasDrawing = false;
            this.clearDrawCanvas();
            // Redraw all overlays with updated region highlighted
            this.drawAllRegionOverlays(this.selectedRegion!.id);
            this.snackBar.open('Region updated!', '', { duration: 1500, panelClass: 'snack-success' });
          }
        });
      });
    } else {
      // --- CREATE new region ---
      this.videoService.createRegion(this.selectedSegment.id, {
        frame_time: this.frameTime,
        brush_mask: brushMask,
        segmented_mask: newSegmentedMask,
        label: this.currentRegionLabel,
        color: this.currentRegionColor
      } as any).subscribe({
        next: (region) => {
          region.segmented_mask = newSegmentedMask;
          this.regions.push(region);
          if (this.selectedSegment) {
            this.segmentRegionCounts[this.selectedSegment.id] = this.regions.length;
          }
          this.clearCanvas();
          this.lastSegmentedMask = '';
          this.autoSetNextRegionColor();
          // Redraw all overlays to show newly added region
          this.drawAllRegionOverlays();
          this.snackBar.open('Region saved!', '', { duration: 1500, panelClass: 'snack-success' });
        }
      });
    }
  }

  /** Merge two mask images: old mask + new mask combined via lighten blend */
  private mergeMasks(oldMaskUrl: string | undefined, newMaskUrl: string): Promise<string> {
    return new Promise((resolve) => {
      if (!oldMaskUrl) {
        resolve(newMaskUrl);
        return;
      }
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d')!;
      const oldImg = new Image();
      oldImg.onload = () => {
        canvas.width = oldImg.width;
        canvas.height = oldImg.height;
        // Draw old mask first
        ctx.drawImage(oldImg, 0, 0);
        // Draw new mask on top with 'lighten' to combine white areas
        const newImg = new Image();
        newImg.onload = () => {
          ctx.globalCompositeOperation = 'lighten';
          ctx.drawImage(newImg, 0, 0, canvas.width, canvas.height);
          resolve(canvas.toDataURL('image/png'));
        };
        newImg.onerror = () => resolve(newMaskUrl);
        newImg.src = newMaskUrl;
      };
      oldImg.onerror = () => resolve(newMaskUrl);
      oldImg.src = oldMaskUrl;
    });
  }

  /** Clear only the draw canvas (brush strokes), keeping frame & mask overlay */
  private clearDrawCanvas(): void {
    if (!this.drawCanvasRef) return;
    const canvas = this.drawCanvasRef.nativeElement;
    const ctx = canvas.getContext('2d');
    if (ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
  }

  /** Convert brush strokes (colored, semi-transparent) into a proper binary mask (white on black) */
  private brushToBinaryMask(): string {
    if (!this.drawCanvasRef) return '';
    const src = this.drawCanvasRef.nativeElement;
    const w = src.width;
    const h = src.height;
    const srcCtx = src.getContext('2d')!;
    const srcData = srcCtx.getImageData(0, 0, w, h);

    const tmpCanvas = document.createElement('canvas');
    tmpCanvas.width = w;
    tmpCanvas.height = h;
    const tmpCtx = tmpCanvas.getContext('2d')!;
    const outData = tmpCtx.createImageData(w, h);

    for (let i = 0; i < srcData.data.length; i += 4) {
      const alpha = srcData.data[i + 3];
      // Any pixel with alpha > 10 is considered drawn → white; else black
      if (alpha > 10) {
        outData.data[i] = 255;
        outData.data[i + 1] = 255;
        outData.data[i + 2] = 255;
        outData.data[i + 3] = 255;
      } else {
        outData.data[i] = 0;
        outData.data[i + 1] = 0;
        outData.data[i + 2] = 0;
        outData.data[i + 3] = 255;
      }
    }
    tmpCtx.putImageData(outData, 0, 0);
    return tmpCanvas.toDataURL('image/png');
  }

  startNewRegion(): void {
    this.selectedRegion = null;
    this.clearCanvas();
    this.lastSegmentedMask = '';
    this.autoSetNextRegionColor();
    if (this.selectedSegment) {
      this.frameTime = this.selectedSegment.start_time;
      this.loadFrameForSegmentation();
    }
  }

  autoSetNextRegionColor(): void {
    this.regionColorIndex = this.regions.length % this.regionColors.length;
    this.currentRegionColor = this.regionColors[this.regionColorIndex];
    this.currentRegionLabel = 'Object';
  }

  selectRegion(region: ObjectRegion): void {
    this.selectedRegion = region;
    this.frameTime = region.frame_time;
    this.currentRegionLabel = region.label;
    this.currentRegionColor = region.color;

    // Load the frame and show all overlays with selected one highlighted
    setTimeout(() => {
      this.loadFrameForSegmentation(() => {
        this.drawAllRegionOverlays(region.id);
      });
    }, 200);
  }

  deleteRegion(region: ObjectRegion): void {
    this.videoService.deleteRegion(region.id).subscribe({
      next: () => {
        this.regions = this.regions.filter(r => r.id !== region.id);
        if (this.selectedSegment) {
          this.segmentRegionCounts[this.selectedSegment.id] = this.regions.length;
        }
        if (this.selectedRegion?.id === region.id) {
          this.selectedRegion = null;
        }
        this.drawAllRegionOverlays();
        this.snackBar.open('Region deleted', '', { duration: 1500 });
      }
    });
  }

  updateRegionProps(region: ObjectRegion): void {
    this.videoService.updateRegion(region.id, {
      label: region.label,
      color: region.color
    }).subscribe();
  }

  prevFrame(): void {
    const minTime = this.selectedSegment ? this.selectedSegment.start_time : 0;
    this.frameTime = Math.max(minTime, this.frameTime - 1);
    this.loadFrameForSegmentation();
  }

  nextFrame(): void {
    const maxTime = this.selectedSegment ? this.selectedSegment.end_time : this.duration;
    this.frameTime = Math.min(maxTime, this.frameTime + 1);
    this.loadFrameForSegmentation();
  }

  // ============ Captioning (Step 3) ============
  selectSegmentForCaption(seg: VideoSegment): void {
    this.selectedSegment = seg;
    this.selectedRegion = null;
    this.loadRegions();
  }

  selectRegionForCaption(region: ObjectRegion): void {
    this.selectedRegion = region;
    this.loadRegionCaption(region);
    this.loadCaptionPreview(region);
  }

  loadRegionCaption(region: ObjectRegion): void {
    if (region.caption) {
      this.captionData = { ...region.caption };
    } else {
      this.videoService.getRegionCaption(region.id).subscribe({
        next: (caption) => {
          if (caption) {
            this.captionData = caption;
            region.caption = caption;
          } else {
            this.captionData = {
              visual_caption: '',
              contextual_caption: '',
              knowledge_caption: '',
              combined_caption: ''
            };
          }
        }
      });
    }
  }

  loadCaptionPreview(region: ObjectRegion): void {
    // Load frame preview with mask overlay for caption context
    setTimeout(() => {
      if (!this.captionCanvasRef || !this.segVideoPlayerRef) return;
      const video = this.segVideoPlayerRef.nativeElement;
      const canvas = this.captionCanvasRef.nativeElement;

      const drawFrame = () => {
        const w = 640;
        const h = (video.videoHeight / video.videoWidth) * w || 360;
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d')!;
        ctx.drawImage(video, 0, 0, w, h);

        // Draw mask overlay if available
        if (region.segmented_mask) {
          this.drawMaskOnCanvas(ctx, region.segmented_mask, region.color, w, h);
        }
      };

      // If the video is ready, seek directly; otherwise load first
      if (video.readyState >= 2) {
        video.onseeked = drawFrame;
        video.currentTime = region.frame_time;
      } else {
        video.onloadeddata = () => {
          video.onseeked = drawFrame;
          video.currentTime = region.frame_time;
        };
        video.load();
      }
    }, 200);
  }

  drawMaskOnCanvas(ctx: CanvasRenderingContext2D, maskDataUrl: string, color: string, w: number, h: number): void {
    const img = new Image();
    img.onload = () => {
      const tempCanvas = document.createElement('canvas');
      tempCanvas.width = w;
      tempCanvas.height = h;
      const tempCtx = tempCanvas.getContext('2d')!;
      tempCtx.drawImage(img, 0, 0, w, h);
      const maskData = tempCtx.getImageData(0, 0, w, h);

      const r = parseInt(color.slice(1, 3), 16);
      const g = parseInt(color.slice(3, 5), 16);
      const b = parseInt(color.slice(5, 7), 16);

      const overlayCanvas = document.createElement('canvas');
      overlayCanvas.width = w;
      overlayCanvas.height = h;
      const oCtx = overlayCanvas.getContext('2d')!;
      const overlay = oCtx.createImageData(w, h);
      for (let i = 0; i < maskData.data.length; i += 4) {
        if (maskData.data[i] > 128) {
          overlay.data[i] = r;
          overlay.data[i + 1] = g;
          overlay.data[i + 2] = b;
          overlay.data[i + 3] = 120;
        }
      }
      oCtx.putImageData(overlay, 0, 0);
      ctx.drawImage(overlayCanvas, 0, 0);

      // Draw edge outline
      for (let y = 1; y < h - 1; y++) {
        for (let x = 1; x < w - 1; x++) {
          const idx = (y * w + x) * 4;
          if (maskData.data[idx] > 128) {
            const top = maskData.data[((y - 1) * w + x) * 4];
            const bot = maskData.data[((y + 1) * w + x) * 4];
            const lft = maskData.data[(y * w + (x - 1)) * 4];
            const rgt = maskData.data[(y * w + (x + 1)) * 4];
            if (top <= 128 || bot <= 128 || lft <= 128 || rgt <= 128) {
              ctx.fillStyle = color;
              ctx.fillRect(x, y, 1, 1);
            }
          }
        }
      }
    };
    img.src = maskDataUrl;
  }

  autoCombineCaptions(): void {
    const parts: string[] = [];
    if (this.captionData.visual_caption) parts.push(this.captionData.visual_caption);
    if (this.captionData.contextual_caption) parts.push(this.captionData.contextual_caption);
    if (this.captionData.knowledge_caption) parts.push(this.captionData.knowledge_caption);
    this.captionData.combined_caption = parts.join('. ');
  }

  saveCaption(): void {
    if (!this.selectedSegment || !this.selectedRegion || !this.video) return;

    const data = {
      segment_id: this.selectedSegment.id,
      video_id: this.video.id,
      region_id: this.selectedRegion.id,
      visual_caption: this.captionData.visual_caption,
      contextual_caption: this.captionData.contextual_caption,
      knowledge_caption: this.captionData.knowledge_caption,
      combined_caption: this.captionData.combined_caption
    };

    if (this.captionData.id) {
      this.videoService.updateCaption(this.captionData.id, data).subscribe({
        next: (caption) => {
          this.captionData = caption;
          if (this.selectedRegion) this.selectedRegion.caption = caption;
          this.snackBar.open('Caption updated!', '', { duration: 1500, panelClass: 'snack-success' });
        }
      });
    } else {
      this.videoService.saveCaption(data).subscribe({
        next: (caption) => {
          this.captionData = caption;
          if (this.selectedRegion) this.selectedRegion.caption = caption;
          this.snackBar.open('Caption saved!', '', { duration: 1500, panelClass: 'snack-success' });
        }
      });
    }
  }

  exportAnnotations(): void {
    if (!this.video) return;
    this.videoService.exportAnnotations(this.video.id).subscribe({
      next: (data) => {
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `annotations_${this.video!.original_name}.json`;
        a.click();
        URL.revokeObjectURL(url);
        this.snackBar.open('Annotations exported!', '', { duration: 2000, panelClass: 'snack-success' });
      }
    });
  }

  goBack(): void {
    if (this.video?.project_id) {
      const queryParams: any = {};
      if (this.video.subpart_id) {
        queryParams.subpartId = this.video.subpart_id;
      }
      this.router.navigate(['/projects', this.video.project_id], { queryParams });
    } else {
      this.router.navigate(['/dashboard']);
    }
  }

  // ---- Review in Editor ----
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

  canSubmitForReview(): boolean {
    if (!this.video?.reviewer_id) return false;
    const status = this.video.review_status || 'not_submitted';
    return status === 'not_submitted' || status === 'rejected';
  }

  canReview(): boolean {
    if (!this.video?.reviewer_id) return false;
    const currentUserId = this.authService.user()?.id;
    return currentUserId === this.video.reviewer_id && this.video.review_status === 'pending_review';
  }

  submitForReview(): void {
    if (!this.video || !confirm('Submit this video for cross-check review?')) return;
    this.videoService.submitForReview(this.video.id).subscribe({
      next: () => {
        this.video!.review_status = 'pending_review';
        this.video!.review_comment = '';
        this.snackBar.open('Submitted for review!', '', { duration: 2000, panelClass: 'snack-success' });
      }
    });
  }

  approveVideo(): void {
    if (!this.video) return;
    this.videoService.reviewVideo(this.video.id, 'approve').subscribe({
      next: (res) => {
        this.video!.review_status = res.review_status;
        this.video!.review_comment = '';
        this.snackBar.open('Video approved!', '', { duration: 2000, panelClass: 'snack-success' });
      }
    });
  }

  rejectVideo(): void {
    if (!this.video) return;
    this.videoService.reviewVideo(this.video.id, 'reject', this.editorRejectComment).subscribe({
      next: (res) => {
        this.video!.review_status = res.review_status;
        this.video!.review_comment = res.review_comment || '';
        this.showEditorRejectDialog = false;
        this.snackBar.open('Video rejected', '', { duration: 2000, panelClass: 'snack-success' });
      }
    });
  }
}
