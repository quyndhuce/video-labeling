// ...existing code...
// (No duplicate class declaration)
import { Component, OnInit, ViewChild, ElementRef, AfterViewInit, OnDestroy, HostListener } from '@angular/core';
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
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { VideoService } from '../../core/services/video.service';
import { AuthService } from '../../core/services/auth.service';
import { GeminiService } from '../../core/services/gemini.service';
import { SettingsService } from '../../core/services/settings.service';
import { KnowledgeBaseService } from '../../core/services/knowledge-base.service';
import { SettingsDialogComponent } from '../settings-dialog/settings-dialog.component';
import { KnowledgeBaseSelectorComponent } from '../../core/components/knowledge-base-selector/knowledge-base-selector.component';
import { VideoItem, VideoSegment, ObjectRegion, Caption, Category } from '../../core/models';

@Component({
  selector: 'app-video-editor',
  standalone: true,
  imports: [
    CommonModule, FormsModule,
    MatButtonModule, MatIconModule, MatSliderModule, MatFormFieldModule,
    MatInputModule, MatSelectModule, MatSnackBarModule, MatProgressSpinnerModule,
    MatTooltipModule, MatMenuModule, MatTabsModule, MatProgressBarModule, MatDialogModule,
    KnowledgeBaseSelectorComponent
  ],
  templateUrl: './video-editor.component.html',
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
  @ViewChild('segmentPreviewVideo') segmentPreviewVideoRef!: ElementRef<HTMLVideoElement>;

  segmentPreviewSrc = '';
  segmentPreviewPlaying = false;
  segmentPreviewProgress = 0;
  segmentPreviewCurrentLabel = '0:00';
  segmentPreviewDurationLabel = '0:00';

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
  panMode = false;
  private isPanning = false;
  private panStartX = 0;
  private panStartY = 0;
  private panOriginX = 0;
  private panOriginY = 0;
  spaceHeld = false;

  // Captions
  captionData: Caption = {
    visual_caption: '',
    contextual_caption: '',
    knowledge_caption: '',
    combined_caption: '',
    visual_caption_vi: '',
    contextual_caption_vi: '',
    knowledge_caption_vi: '',
    combined_caption_vi: ''
  };
  segmentCaptionData: Caption = {
    contextual_caption: '',
    knowledge_caption: '',
    combined_caption: '',
    visual_caption: '',
    contextual_caption_vi: '',
    knowledge_caption_vi: '',
    combined_caption_vi: '',
    visual_caption_vi: ''
  };
  // Knowledge Base IDs for captions
  captionKBIds: string[] = [];
  segmentCaptionKBIds: string[] = [];
  generatingVisual = false;
  generatingContextual = false;
  generatingAll = false;

  // Panel resize
  panelWidth = 300;
  private isResizingPanel = false;

  // Review
  showEditorRejectDialog = false;
  editorRejectComment = '';
  private resizeMouseMove: ((e: MouseEvent) => void) | null = null;
  private resizeMouseUp: (() => void) | null = null;

  private segColors = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#06b6d4', '#84cc16'];

  translating = false;

  // Categories
  categories: Category[] = [];
  showCategoryManager = false;
  showCategoryDropdown = false;
  showInlineCategoryAdd = false;
  newCategoryName = '';
  newCategoryColor = '#3b82f6';
  newCategoryDesc = '';
  editingCategory: Category | null = null;

  constructor(
    private route: ActivatedRoute,
    private router: Router,
    private videoService: VideoService,
    private authService: AuthService,
    private geminiService: GeminiService,
    private settingsService: SettingsService,
    private kbService: KnowledgeBaseService,
    private dialog: MatDialog,
    private snackBar: MatSnackBar
  ) {}

  /**
   * Returns the color of a category by its id, or a default if not found.
   */
  getCategoryColor(categoryId: string | undefined | null): string {
    if (!categoryId) return '#888';
    const cat = this.categories.find(c => c.id === categoryId);
    return cat?.color || '#888';
  }

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
        this.selectedRegion = null;
        this.loadRegions();
        this.loadSegmentCaption(this.selectedSegment);
        this.loadSegmentPreview(this.selectedSegment);
      }
      this.loadAllRegionCounts();
      this.loadCategories();
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
      const h = Math.round((video.videoHeight / video.videoWidth) * w) || 450;

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

  @HostListener('window:keydown', ['$event'])
  onKeyDown(event: KeyboardEvent): void {
    // Ignore if user is typing in an input/textarea
    const tag = (event.target as HTMLElement)?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

    if (event.code === 'Space' && this.currentStep === 2) {
      event.preventDefault();
      this.spaceHeld = true;
    } else if (event.key === 'b' || event.key === 'B') {
      this.brushMode = 'draw'; this.panMode = false;
    } else if (event.key === 'e' || event.key === 'E') {
      this.brushMode = 'erase'; this.panMode = false;
    } else if (event.key === 'h' || event.key === 'H') {
      this.panMode = !this.panMode;
    }
  }

  @HostListener('window:keyup', ['$event'])
  onKeyUp(event: KeyboardEvent): void {
    if (event.code === 'Space') {
      this.spaceHeld = false;
      this.isPanning = false;
    }
  }

  onCanvasMouseDown(event: MouseEvent): void {
    // Middle-click, Alt+click, or panMode/Space for panning; otherwise draw
    if (event.button === 1 || (event.button === 0 && (event.altKey || this.panMode || this.spaceHeld))) {
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

    // Eraser also erases on the mask canvas (segmented mask overlay)
    if (this.brushMode === 'erase' && this.maskCanvasRef) {
      const maskCanvas = this.maskCanvasRef.nativeElement;
      const maskCtx = maskCanvas.getContext('2d')!;
      const maskScaleX = maskCanvas.width / rect.width;
      const maskScaleY = maskCanvas.height / rect.height;
      const mx = (event.clientX - rect.left) * maskScaleX;
      const my = (event.clientY - rect.top) * maskScaleY;

      maskCtx.globalCompositeOperation = 'destination-out';
      maskCtx.beginPath();
      maskCtx.arc(mx, my, this.brushSize / 2, 0, Math.PI * 2);
      maskCtx.fill();
      maskCtx.globalCompositeOperation = 'source-over';

      // Update lastSegmentedMask to reflect erased areas
      if (this.lastSegmentedMask) {
        this.lastSegmentedMask = maskCanvas.toDataURL('image/png');
      }
    }

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

    // Clear old mask of the region being updated
    this.lastSegmentedMask = '';
    if (this.maskCanvasRef) {
      const maskCanvas = this.maskCanvasRef.nativeElement;
      const maskCtx = maskCanvas.getContext('2d')!;
      maskCtx.clearRect(0, 0, maskCanvas.width, maskCanvas.height);
    }

    const brushMask = this.drawCanvasRef.nativeElement.toDataURL('image/png');
    const frameImage = this.frameCanvasRef?.nativeElement.toDataURL('image/png');

    this.videoService.segmentObject(brushMask, frameImage).subscribe({
      next: (result) => {
        this.segmenting = false;
        this.lastSegmentedMask = result.segmented_mask || '';

        // Clear brush strokes — only keep the segmented mask overlay
        if (this.drawCanvasRef) {
          const drawCanvas = this.drawCanvasRef.nativeElement;
          const drawCtx = drawCanvas.getContext('2d')!;
          drawCtx.clearRect(0, 0, drawCanvas.width, drawCanvas.height);
        }

        // Display only the new segmented mask
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
      // --- UPDATE existing region: replace with new mask (no merge) ---
      this.videoService.updateRegion(this.selectedRegion!.id, {
        frame_time: this.frameTime,
        brush_mask: brushMask,
        segmented_mask: newSegmentedMask,
        label: this.currentRegionLabel,
        color: this.currentRegionColor
      }).subscribe({
        next: () => {
          const idx = this.regions.findIndex(r => r.id === this.selectedRegion!.id);
          if (idx !== -1) {
            this.regions[idx].frame_time = this.frameTime;
            this.regions[idx].brush_mask = brushMask;
            this.regions[idx].segmented_mask = newSegmentedMask;
            this.regions[idx].label = this.currentRegionLabel;
            this.regions[idx].color = this.currentRegionColor;
          }
          this.lastSegmentedMask = newSegmentedMask;
          this.hasDrawing = false;
          this.clearDrawCanvas();
          // Show only the updated region's mask
          this.drawMaskOverlay(newSegmentedMask, this.currentRegionColor);
          this.snackBar.open('Region updated!', '', { duration: 1500, panelClass: 'snack-success' });
        }
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
          this.lastSegmentedMask = newSegmentedMask;
          this.hasDrawing = false;
          this.clearDrawCanvas();
          this.autoSetNextRegionColor();
          // Show only the newly created region's mask
          this.drawMaskOverlay(newSegmentedMask, region.color);
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
    this.lastSegmentedMask = region.segmented_mask || '';

    // Load the frame and show only the selected region's mask
    setTimeout(() => {
      this.loadFrameForSegmentation(() => {
        if (region.segmented_mask) {
          this.drawMaskOverlay(region.segmented_mask, region.color);
        } else {
          // Clear mask canvas if selected region has no mask
          if (this.maskCanvasRef) {
            const maskCanvas = this.maskCanvasRef.nativeElement;
            const ctx = maskCanvas.getContext('2d')!;
            ctx.clearRect(0, 0, maskCanvas.width, maskCanvas.height);
          }
        }
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

    // Update current color if this is the selected region & redraw mask overlay
    if (this.selectedRegion?.id === region.id) {
      this.currentRegionColor = region.color;
      if (region.segmented_mask) {
        this.drawMaskOverlay(region.segmented_mask, region.color);
      }
    }
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
  loadCategories(): void {
    if (!this.video?.project_id) return;
    this.videoService.getProjectCategories(this.video.project_id).subscribe({
      next: (cats) => this.categories = cats,
      error: () => this.categories = []
    });
  }

  onCategoryChange(categoryId: string | null): void {
    if (!this.selectedRegion) return;
    const cat = this.categories.find(c => c.id === categoryId);
    this.selectedRegion.category_id = categoryId || undefined;
    this.selectedRegion.category_name = cat?.name || undefined;
    this.videoService.updateRegion(this.selectedRegion.id, {
      category_id: categoryId || '',
      category_name: cat?.name || ''
    }).subscribe({
      next: () => this.snackBar.open('Category updated', '', { duration: 1200, panelClass: 'snack-success' }),
      error: () => this.snackBar.open('Failed to update category', '', { duration: 2000 })
    });
  }

  addCategory(): void {
    if (!this.video?.project_id || !this.newCategoryName.trim()) return;
    this.videoService.createCategory(this.video.project_id, {
      name: this.newCategoryName.trim(),
      color: this.newCategoryColor,
      description: this.newCategoryDesc.trim() || undefined
    }).subscribe({
      next: (cat) => {
        this.categories.push(cat);
        this.newCategoryName = '';
        this.newCategoryDesc = '';
        this.snackBar.open('Category added', '', { duration: 1200, panelClass: 'snack-success' });
      },
      error: () => this.snackBar.open('Failed to add category', '', { duration: 2000 })
    });
  }

  deleteCategory(cat: Category): void {
    if (!confirm(`Delete category "${cat.name}"? Regions using this category will be unassigned.`)) return;
    this.videoService.deleteCategory(cat.id).subscribe({
      next: () => {
        this.categories = this.categories.filter(c => c.id !== cat.id);
        // Clear category from any loaded regions using it
        this.regions.forEach(r => {
          if (r.category_id === cat.id) {
            r.category_id = undefined;
            r.category_name = undefined;
          }
        });
        this.snackBar.open('Category deleted', '', { duration: 1200, panelClass: 'snack-success' });
      },
      error: () => this.snackBar.open('Failed to delete category', '', { duration: 2000 })
    });
  }

  selectSegmentForCaption(seg: VideoSegment): void {
    this.selectedSegment = seg;
    this.selectedRegion = null;
    this.loadRegions();
    this.loadSegmentCaption(seg);
    this.loadSegmentPreview(seg);
  }

  selectRegionForCaption(region: ObjectRegion): void {
    this.selectedRegion = region;
    this.loadRegionCaption(region);
    this.loadCaptionPreview(region);
  }

  loadSegmentCaption(seg: VideoSegment): void {
    this.videoService.getSegmentCaption(seg.id).subscribe({
      next: (caption) => {
        if (caption) {
          this.segmentCaptionData = caption;
        } else {
          this.segmentCaptionData = {
            visual_caption: '',
            contextual_caption: '',
            knowledge_caption: '',
            combined_caption: '',
            visual_caption_vi: '',
            contextual_caption_vi: '',
            knowledge_caption_vi: '',
            combined_caption_vi: ''
          };
        }
      }
    });
  }

  loadSegmentPreview(seg: VideoSegment): void {
    if (!this.video) return;
    // Use Media Fragments to clip video to segment range
    this.segmentPreviewSrc = `${this.video.url}#t=${seg.start_time.toFixed(3)},${seg.end_time.toFixed(3)}`;
    this.segmentPreviewPlaying = false;
    const dur = seg.end_time - seg.start_time;
    this.segmentPreviewDurationLabel = this.formatSegTime(dur);
    this.segmentPreviewCurrentLabel = this.formatSegTime(0);
    this.segmentPreviewProgress = 0;
  }

  onSegmentVideoLoaded(): void {
    const vid = this.segmentPreviewVideoRef?.nativeElement;
    if (!vid || !this.selectedSegment) return;
    // Auto-play from segment start
    vid.currentTime = this.selectedSegment.start_time;
    vid.play().then(() => {
      this.segmentPreviewPlaying = true;
    }).catch(() => {
      this.segmentPreviewPlaying = false;
    });
  }

  onSegmentPreviewTimeUpdate(): void {
    const vid = this.segmentPreviewVideoRef?.nativeElement;
    if (!vid || !this.selectedSegment) return;
    const seg = this.selectedSegment;
    // Clamp to segment boundaries
    if (vid.currentTime >= seg.end_time) {
      vid.pause();
      vid.currentTime = seg.end_time;
      this.segmentPreviewPlaying = false;
    }
    if (vid.currentTime < seg.start_time) {
      vid.currentTime = seg.start_time;
    }
    const elapsed = vid.currentTime - seg.start_time;
    const dur = seg.end_time - seg.start_time;
    this.segmentPreviewProgress = dur > 0 ? (elapsed / dur) * 100 : 0;
    this.segmentPreviewCurrentLabel = this.formatSegTime(elapsed);
  }

  toggleSegmentPreview(): void {
    const vid = this.segmentPreviewVideoRef?.nativeElement;
    if (!vid || !this.selectedSegment) return;
    if (vid.paused) {
      // If at end, restart from segment start
      if (vid.currentTime >= this.selectedSegment.end_time - 0.1) {
        vid.currentTime = this.selectedSegment.start_time;
      }
      vid.play();
      this.segmentPreviewPlaying = true;
    } else {
      vid.pause();
      this.segmentPreviewPlaying = false;
    }
  }

  seekSegmentPreview(event: MouseEvent): void {
    const vid = this.segmentPreviewVideoRef?.nativeElement;
    if (!vid || !this.selectedSegment) return;
    const target = event.currentTarget as HTMLElement;
    const rect = target.getBoundingClientRect();
    const pct = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
    const seg = this.selectedSegment;
    vid.currentTime = seg.start_time + pct * (seg.end_time - seg.start_time);
  }

  private formatSegTime(seconds: number): string {
    const s = Math.max(0, Math.floor(seconds));
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return `${m}:${sec.toString().padStart(2, '0')}`;
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
              combined_caption: '',
              visual_caption_vi: '',
              contextual_caption_vi: '',
              knowledge_caption_vi: '',
              combined_caption_vi: ''
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

  /** Check if segment has Vietnamese content ready for combining */
  canCombineSegmentCaptions(): boolean {
    const d = this.segmentCaptionData;
    const hasViDescription = !!(d.visual_caption_vi?.trim() || d.contextual_caption_vi?.trim());
    return hasViDescription && this.segmentCaptionKBIds.length > 0;
  }

  /** Get tooltip message for segment combine button */
  getSegmentCombineTooltip(): string {
    const d = this.segmentCaptionData;
    const hasViDescription = !!(d.visual_caption_vi?.trim() || d.contextual_caption_vi?.trim());
    const hasKB = this.segmentCaptionKBIds.length > 0;
    
    if (!hasViDescription && !hasKB) {
      return 'Cần có mô tả tiếng Việt và chọn Knowledge Base';
    }
    if (!hasViDescription) {
      return 'Cần có mô tả tiếng Việt (Visual hoặc Contextual)';
    }
    if (!hasKB) {
      return 'Cần chọn Knowledge Base';
    }
    return '';
  }

  /** Auto combine + translate: Vietnamese first, then translate to English */
  async autoCombineAndTranslate(): Promise<void> {
    const d = this.segmentCaptionData;

    if (!this.geminiService.isConfigured()) {
      this.snackBar.open('Gemini API key not set. Open Settings to configure.', 'Settings', {
        duration: 5000
      }).onAction().subscribe(() => this.openSettings());
      return;
    }

    this.translating = true;
    try {
      // Step 1: Get KB context (Vietnamese)
      let kbContextVi = '';
      if (this.segmentCaptionKBIds.length > 0) {
        const contextData = await this.kbService.getContext(this.segmentCaptionKBIds).toPromise();
        if (contextData) {
          kbContextVi = contextData.context_text_vi;
        }
      }

      // Step 2: Combine Vietnamese captions with KB context
      const partsVi: string[] = [];
      if (d.visual_caption_vi) partsVi.push(d.visual_caption_vi);
      if (d.contextual_caption_vi) partsVi.push(d.contextual_caption_vi);
      
      const combinedVi = await this.geminiService.combineCaptionsWithKnowledge(partsVi, kbContextVi, true);
      d.combined_caption_vi = combinedVi;

      // Step 3: Translate Vietnamese combined to English
      if (combinedVi) {
        const enResult = await this.geminiService.translateToEn(combinedVi);
        d.combined_caption = enResult;
      }

      this.snackBar.open('Combine & Translate thành công!', '', { duration: 2000, panelClass: 'snack-success' });
    } catch (err: any) {
      this.snackBar.open(err.message || 'Combine/Translate failed', '', { duration: 4000, panelClass: 'snack-error' });
    } finally {
      this.translating = false;
    }
  }

  /** Translate a single caption field EN↔VI */
  async translateField(fieldBase: string, direction: 'en_to_vi' | 'vi_to_en', target: 'region' | 'segment' = 'region'): Promise<void> {
    if (!this.geminiService.isConfigured()) {
      this.snackBar.open('Gemini API key not set. Open Settings to configure.', 'Settings', {
        duration: 5000
      }).onAction().subscribe(() => this.openSettings());
      return;
    }

    const data = target === 'segment' ? this.segmentCaptionData : this.captionData;
    const sourceKey = direction === 'en_to_vi' ? fieldBase : fieldBase + '_vi';
    const targetKey = direction === 'en_to_vi' ? fieldBase + '_vi' : fieldBase;
    const sourceText = (data as any)[sourceKey];

    if (!sourceText?.trim()) {
      this.snackBar.open('Source text is empty', '', { duration: 2000 });
      return;
    }

    this.translating = true;
    try {
      const result = await this.geminiService.translate(sourceText, direction);
      (data as any)[targetKey] = result;
      const arrow = direction === 'en_to_vi' ? 'EN → VI' : 'VI → EN';
      this.snackBar.open(`Translated ${arrow}`, '', { duration: 2000, panelClass: 'snack-success' });
    } catch (err: any) {
      this.snackBar.open(err.message || 'Translation failed', '', { duration: 4000, panelClass: 'snack-error' });
    } finally {
      this.translating = false;
    }
  }

  /** Check if region has Vietnamese content ready for combining */
  canCombineRegionCaptions(): boolean {
    const d = this.captionData;
    const hasViDescription = !!(d.visual_caption_vi?.trim() || d.knowledge_caption_vi?.trim());
    return hasViDescription && this.captionKBIds.length > 0;
  }

  /** Get tooltip message for region combine button */
  getRegionCombineTooltip(): string {
    const d = this.captionData;
    const hasViDescription = !!(d.visual_caption_vi?.trim() || d.knowledge_caption_vi?.trim());
    const hasKB = this.captionKBIds.length > 0;
    
    if (!hasViDescription && !hasKB) {
      return 'Cần có mô tả tiếng Việt và chọn Knowledge Base';
    }
    if (!hasViDescription) {
      return 'Cần có mô tả tiếng Việt (Visual hoặc Knowledge)';
    }
    if (!hasKB) {
      return 'Cần chọn Knowledge Base';
    }
    return '';
  }

  /** Auto combine region captions + translate: Vietnamese first, then English */
  async autoCombineRegionAndTranslate(): Promise<void> {
    const d = this.captionData;

    if (!this.geminiService.isConfigured()) {
      this.snackBar.open('Gemini API key not set. Open Settings to configure.', 'Settings', {
        duration: 5000
      }).onAction().subscribe(() => this.openSettings());
      return;
    }

    this.translating = true;
    try {
      // Step 1: Get KB context (Vietnamese)
      let kbContextVi = '';
      if (this.captionKBIds.length > 0) {
        const contextData = await this.kbService.getContext(this.captionKBIds).toPromise();
        if (contextData) {
          kbContextVi = contextData.context_text_vi;
        }
      }

      // Step 2: Combine Vietnamese captions with KB context
      const partsVi: string[] = [];
      if (d.visual_caption_vi) partsVi.push(d.visual_caption_vi);
      if (d.knowledge_caption_vi) partsVi.push(d.knowledge_caption_vi);
      
      const combinedVi = await this.geminiService.combineCaptionsWithKnowledge(partsVi, kbContextVi, true);
      d.combined_caption_vi = combinedVi;

      // Step 3: Translate Vietnamese combined to English
      if (combinedVi) {
        const enResult = await this.geminiService.translateToEn(combinedVi);
        d.combined_caption = enResult;
      }

      this.snackBar.open('Combine & Translate thành công!', '', { duration: 2000, panelClass: 'snack-success' });
    } catch (err: any) {
      this.snackBar.open(err.message || 'Combine/Translate failed', '', { duration: 4000, panelClass: 'snack-error' });
    } finally {
      this.translating = false;
    }
  }

  /** Open settings dialog */
  openSettings(): void {
    this.dialog.open(SettingsDialogComponent, {
      width: '600px',
      panelClass: 'settings-dialog'
    });
  }

  // ---- DAM Auto Caption (Video: 8 frames from segment) ----

  /**
   * Rescale a base64 mask image to the given width × height.
   * Returns a Promise with the resized mask as base64 PNG.
   */
  private rescaleMask(maskB64: string, targetW: number, targetH: number): Promise<string> {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        if (img.width === targetW && img.height === targetH) {
          resolve(maskB64); // already correct size
          return;
        }
        const canvas = document.createElement('canvas');
        canvas.width = targetW;
        canvas.height = targetH;
        const ctx = canvas.getContext('2d')!;
        ctx.imageSmoothingEnabled = false; // nearest-neighbor for binary mask
        ctx.drawImage(img, 0, 0, targetW, targetH);
        resolve(canvas.toDataURL('image/png'));
      };
      img.onerror = () => resolve(maskB64); // fallback: return original
      img.src = maskB64;
    });
  }

  /**
   * Capture 8 evenly-spaced frames from the current segment at native video resolution.
   * Returns { frames: base64[], width, height } so callers can rescale the mask to match.
   */
  private captureSegmentFrames(): Promise<{ frames: string[]; width: number; height: number }> {
    return new Promise((resolve, reject) => {
      const video = this.segVideoPlayerRef?.nativeElement;
      if (!video) {
        reject('Video element not available');
        return;
      }
      if (!this.selectedSegment) {
        reject('No segment selected');
        return;
      }

      const startTime = this.selectedSegment.start_time;
      const endTime = this.selectedSegment.end_time;
      const numFrames = 8;
      const duration = endTime - startTime;

      // Calculate 8 evenly-spaced timestamps within the segment
      const timestamps: number[] = [];
      if (duration <= 0) {
        for (let i = 0; i < numFrames; i++) timestamps.push(startTime);
      } else {
        for (let i = 0; i < numFrames; i++) {
          timestamps.push(startTime + (duration * i) / (numFrames - 1));
        }
      }

      const frames: string[] = [];
      let currentIdx = 0;

      // Capture at native video resolution for best DAM quality
      const captureW = video.videoWidth || 800;
      const captureH = video.videoHeight || 450;

      const captureFrame = () => {
        const tempCanvas = document.createElement('canvas');
        tempCanvas.width = captureW;
        tempCanvas.height = captureH;
        const ctx = tempCanvas.getContext('2d')!;
        ctx.drawImage(video, 0, 0, captureW, captureH);
        frames.push(tempCanvas.toDataURL('image/jpeg', 0.85));
      };

      const seekAndCapture = () => {
        if (currentIdx >= timestamps.length) {
          // All frames captured — restore position without leaving onseeked active
          video.onseeked = null;
          if (this.selectedRegion) {
            video.currentTime = this.selectedRegion.frame_time;
          }
          resolve({ frames, width: captureW, height: captureH });
          return;
        }

        video.onseeked = () => {
          video.onseeked = null; // clear immediately to avoid re-fires
          captureFrame();
          currentIdx++;
          seekAndCapture();
        };

        video.currentTime = timestamps[currentIdx];
      };

      // Wait for video to be ready if it's currently seeking or loading
      const startCapture = () => {
        if (video.readyState >= 2 && !video.seeking) {
          seekAndCapture();
        } else {
          // Wait for the video to become ready
          const onReady = () => {
            video.removeEventListener('seeked', onReady);
            video.removeEventListener('canplay', onReady);
            seekAndCapture();
          };
          video.addEventListener('seeked', onReady, { once: false });
          video.addEventListener('canplay', onReady, { once: false });
          // Timeout safety net: reject after 5s if video never becomes ready
          setTimeout(() => {
            video.removeEventListener('seeked', onReady);
            video.removeEventListener('canplay', onReady);
            if (frames.length === 0) {
              reject('Timeout waiting for video to be ready');
            }
          }, 5000);
        }
      };

      startCapture();
    });
  }

  generateSingleCaption(type: 'visual' | 'contextual'): void {
    if (!this.selectedSegment) return;

    if (type === 'visual') {
      if (!this.selectedRegion) return;
      const maskB64 = this.selectedRegion.segmented_mask || '';
      if (!maskB64) {
        this.snackBar.open('No mask available for this region.', '', { duration: 3000 });
        return;
      }
      this.generatingVisual = true;
      this.snackBar.open('Capturing 8 frames from segment...', '', { duration: 2000 });
      this.captureSegmentFrames().then(async ({ frames, width, height }) => {
        const scaledMask = await this.rescaleMask(maskB64, width, height);
        this.videoService.generateCaption(frames, scaledMask, 'visual').subscribe({
          next: (res) => {
            this.captionData.visual_caption = res.caption;
            this.generatingVisual = false;
            this.snackBar.open('Visual caption generated!', '', { duration: 2000, panelClass: 'snack-success' });
          },
          error: (err) => {
            this.generatingVisual = false;
            this.snackBar.open(err.error?.error || 'Failed to generate visual caption', '', { duration: 4000, panelClass: 'snack-error' });
          }
        });
      }).catch(() => {
        this.generatingVisual = false;
        this.snackBar.open('Cannot capture frames. Please wait for video to load.', '', { duration: 3000 });
      });
    } else {
      // Contextual caption → segment-level, uses full-frame mask (no region mask needed)
      this.generatingContextual = true;
      this.snackBar.open('Capturing 8 frames from segment...', '', { duration: 2000 });
      this.captureSegmentFrames().then(async ({ frames }) => {
        // Pass empty mask — backend uses full-white mask for contextual
        this.videoService.generateCaption(frames, '', 'contextual').subscribe({
          next: (res) => {
            this.segmentCaptionData.contextual_caption = res.caption;
            this.generatingContextual = false;
            this.snackBar.open('Contextual caption generated!', '', { duration: 2000, panelClass: 'snack-success' });
          },
          error: (err) => {
            this.generatingContextual = false;
            this.snackBar.open(err.error?.error || 'Failed to generate contextual caption', '', { duration: 4000, panelClass: 'snack-error' });
          }
        });
      }).catch(() => {
        this.generatingContextual = false;
        this.snackBar.open('Cannot capture frames. Please wait for video to load.', '', { duration: 3000 });
      });
    }
  }

  /** Generate all segment-level captions (contextual via DAM) */
  generateAllSegmentCaptions(): void {
    if (!this.selectedSegment) return;
    this.generatingAll = true;
    this.generatingContextual = true;
    this.snackBar.open('Capturing 8 frames from segment...', '', { duration: 2000 });

    this.captureSegmentFrames().then(async ({ frames }) => {
      this.videoService.generateCaption(frames, '', 'contextual').subscribe({
        next: (res) => {
          this.segmentCaptionData.contextual_caption = res.caption;
          this.generatingAll = false;
          this.generatingContextual = false;
          this.snackBar.open('Contextual caption generated!', '', { duration: 2000, panelClass: 'snack-success' });
        },
        error: (err) => {
          this.generatingAll = false;
          this.generatingContextual = false;
          this.snackBar.open(err.error?.error || 'Failed to generate captions', '', { duration: 4000, panelClass: 'snack-error' });
        }
      });
    }).catch(() => {
      this.generatingAll = false;
      this.generatingContextual = false;
      this.snackBar.open('Cannot capture frames. Please wait for video to load.', '', { duration: 3000 });
    });
  }

  /** Generate visual caption for the selected region */
  generateAllCaptions(): void {
    if (!this.selectedRegion || !this.selectedSegment) return;

    const maskB64 = this.selectedRegion.segmented_mask || '';
    if (!maskB64) {
      this.snackBar.open('No mask available for this region.', '', { duration: 3000 });
      return;
    }

    this.generatingAll = true;
    this.generatingVisual = true;

    this.snackBar.open('Capturing 8 frames from segment...', '', { duration: 2000 });

    this.captureSegmentFrames().then(async ({ frames, width, height }) => {
      const scaledMask = await this.rescaleMask(maskB64, width, height);

      this.videoService.generateCaption(frames, scaledMask, 'visual').subscribe({
        next: (res) => {
          if (res.caption) this.captionData.visual_caption = res.caption;
          this.generatingAll = false;
          this.generatingVisual = false;
          this.snackBar.open('Visual caption generated!', '', { duration: 2000, panelClass: 'snack-success' });
        },
        error: (err) => {
          this.generatingAll = false;
          this.generatingVisual = false;
          this.snackBar.open(err.error?.error || 'Failed to generate captions', '', { duration: 4000, panelClass: 'snack-error' });
        }
      });
    }).catch(() => {
      this.generatingAll = false;
      this.generatingVisual = false;
      this.snackBar.open('Cannot capture frames. Please wait for video to load.', '', { duration: 3000 });
    });
  }

  saveCaption(): void {
    if (!this.selectedSegment || !this.selectedRegion || !this.video) return;

    const data = {
      segment_id: this.selectedSegment.id,
      video_id: this.video.id,
      region_id: this.selectedRegion.id,
      visual_caption: this.captionData.visual_caption,
      visual_caption_vi: this.captionData.visual_caption_vi,
      knowledge_caption: this.captionData.knowledge_caption,
      knowledge_caption_vi: this.captionData.knowledge_caption_vi,
      combined_caption: this.captionData.combined_caption,
      combined_caption_vi: this.captionData.combined_caption_vi
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

  saveSegmentCaption(): void {
    if (!this.selectedSegment || !this.video) return;

    const data = {
      segment_id: this.selectedSegment.id,
      video_id: this.video.id,
      contextual_caption: this.segmentCaptionData.contextual_caption,
      knowledge_caption: this.segmentCaptionData.knowledge_caption,
      combined_caption: this.segmentCaptionData.combined_caption,
      contextual_caption_vi: this.segmentCaptionData.contextual_caption_vi,
      knowledge_caption_vi: this.segmentCaptionData.knowledge_caption_vi,
      combined_caption_vi: this.segmentCaptionData.combined_caption_vi
    };

    if (this.segmentCaptionData.id) {
      this.videoService.updateCaption(this.segmentCaptionData.id, data).subscribe({
        next: (caption) => {
          this.segmentCaptionData = caption;
          this.snackBar.open('Segment caption updated!', '', { duration: 1500, panelClass: 'snack-success' });
        }
      });
    } else {
      this.videoService.saveCaption(data).subscribe({
        next: (caption) => {
          this.segmentCaptionData = caption;
          this.snackBar.open('Segment caption saved!', '', { duration: 1500, panelClass: 'snack-success' });
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
        this.snackBar.open('Video annotations exported!', '', { duration: 2000, panelClass: 'snack-success' });
      },
      error: () => {
        this.snackBar.open('Failed to export video annotations', '', { duration: 3000, panelClass: 'snack-error' });
      }
    });
  }

  exportProject(): void {
    if (!this.video?.project_id) {
      this.snackBar.open('No project associated with this video', '', { duration: 3000, panelClass: 'snack-error' });
      return;
    }
    this.snackBar.open('Exporting project... please wait', '', { duration: 5000 });
    this.videoService.exportProjectAnnotations(this.video.project_id).subscribe({
      next: (data) => {
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        const projectName = data?.project?.name || 'project';
        a.download = `dataset_${projectName}.json`;
        a.click();
        URL.revokeObjectURL(url);
        this.snackBar.open('Project dataset exported!', '', { duration: 2000, panelClass: 'snack-success' });
      },
      error: () => {
        this.snackBar.open('Failed to export project', '', { duration: 3000, panelClass: 'snack-error' });
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
      case 'in_review': return 'In Review';
      case 'approved': return 'Approved';
      case 'rejected': return 'Rejected';
      default: return 'Not Submitted';
    }
  }

  canSubmitForReview(): boolean {
    // Can submit if has reviewers and not pending/in_review/approved
    const hasReviewers = (this.video?.subpart_reviewers?.length ?? 0) > 0 || !!this.video?.reviewer_id;
    if (!hasReviewers) return false;
    const status = this.video?.review_status || 'not_submitted';
    return status === 'not_submitted' || status === 'rejected';
  }

  canReview(): boolean {
    const currentUserId = this.authService.user()?.id;
    if (!currentUserId || !this.video) return false;
    
    // Check if user is a reviewer
    const reviewers = this.video.subpart_reviewers || (this.video.reviewer_id ? [this.video.reviewer_id] : []);
    if (!reviewers.includes(currentUserId)) return false;
    
    // Can review if pending or in_review
    return this.video.review_status === 'pending_review' || this.video.review_status === 'in_review';
  }

  hasUserReviewed(): boolean {
    const currentUserId = this.authService.user()?.id;
    return this.video?.reviews?.some(r => r.reviewer_id === currentUserId) ?? false;
  }

  getUserReview(): { action: 'approve' | 'reject'; comment?: string } | null {
    const currentUserId = this.authService.user()?.id;
    const review = this.video?.reviews?.find(r => r.reviewer_id === currentUserId);
    return review ? { action: review.action, comment: review.comment } : null;
  }

  getReviewerAction(reviewerId: string): string | null {
    const review = this.video?.reviews_with_details?.find(r => r.reviewer.id === reviewerId);
    return review?.action || null;
  }

  canRevokeApproval(): boolean {
    // Admin or any reviewer can revoke when approved
    const currentUserId = this.authService.user()?.id;
    const userRole = this.authService.user()?.role;
    if (this.video?.review_status !== 'approved') return false;
    
    const reviewers = this.video.subpart_reviewers || (this.video.reviewer_id ? [this.video.reviewer_id] : []);
    return userRole === 'admin' || reviewers.includes(currentUserId || '');
  }

  canWithdrawReview(): boolean {
    const currentUserId = this.authService.user()?.id;
    if (!currentUserId || !this.video) return false;
    
    // Can withdraw if has reviewed and status is in_review or pending_review
    const hasReviewed = this.video.reviews?.some(r => r.reviewer_id === currentUserId);
    return hasReviewed && (this.video.review_status === 'in_review' || this.video.review_status === 'pending_review');
  }

  getReviewSummary(): string {
    if (!this.video?.reviews?.length) return 'No reviews yet';
    
    const approvals = this.video.reviews.filter(r => r.action === 'approve').length;
    const rejections = this.video.reviews.filter(r => r.action === 'reject').length;
    const totalReviewers = this.video.subpart_reviewers?.length || (this.video.reviewer_id ? 1 : 0);
    
    return `${approvals}/${totalReviewers} approved, ${rejections} rejected`;
  }

  submitForReview(): void {
    if (!this.video || !confirm('Submit this video for cross-check review?')) return;
    this.videoService.submitForReview(this.video.id).subscribe({
      next: () => {
        this.video!.review_status = 'pending_review';
        this.video!.review_comment = '';
        this.video!.reviews = [];
        this.snackBar.open('Submitted for review!', '', { duration: 2000, panelClass: 'snack-success' });
      }
    });
  }

  approveVideo(): void {
    if (!this.video) return;
    this.videoService.reviewVideo(this.video.id, 'approve').subscribe({
      next: (res) => {
        this.video!.review_status = res.review_status;
        this.video!.reviews = res.reviews || [];
        this.video!.review_comment = '';
        this.snackBar.open('Your approval recorded!', '', { duration: 2000, panelClass: 'snack-success' });
        this.loadVideo(this.video!.id); // Reload to get updated details
      }
    });
  }

  rejectVideo(): void {
    if (!this.video) return;
    this.videoService.reviewVideo(this.video.id, 'reject', this.editorRejectComment).subscribe({
      next: (res) => {
        this.video!.review_status = res.review_status;
        this.video!.reviews = res.reviews || [];
        this.video!.review_comment = res.review_comment || '';
        this.showEditorRejectDialog = false;
        this.snackBar.open('Your rejection recorded', '', { duration: 2000, panelClass: 'snack-success' });
        this.loadVideo(this.video!.id); // Reload to get updated details
      }
    });
  }

  revokeApproval(): void {
    if (!this.video || !confirm('Revoke approval and reset to not submitted?')) return;
    this.videoService.revokeApproval(this.video.id).subscribe({
      next: () => {
        this.video!.review_status = 'not_submitted';
        this.video!.reviews = [];
        this.snackBar.open('Approval revoked', '', { duration: 2000, panelClass: 'snack-success' });
      }
    });
  }

  withdrawReview(): void {
    if (!this.video || !confirm('Withdraw your review?')) return;
    this.videoService.withdrawReview(this.video.id).subscribe({
      next: (res) => {
        this.video!.review_status = res.review_status;
        this.video!.reviews = res.reviews || [];
        this.snackBar.open('Your review withdrawn', '', { duration: 2000, panelClass: 'snack-success' });
      }
    });
  }
}
