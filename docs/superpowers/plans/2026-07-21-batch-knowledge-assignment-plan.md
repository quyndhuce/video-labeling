# Batch Knowledge Base Assignment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement a Batch Knowledge Base Assignment dialog (Option 1 + Option 2) in the video editor with an activation button located near the video pagination control.

**Architecture:** Create a standalone Angular component `BatchKnowledgeDialogComponent` using `@angular/material/dialog`. The dialog manages 3 sections: Global Video KB (Option 2), Segment Batch KB (Option 1), and Object Track Batch KB (Option 1). Integrate this dialog into `VideoEditorComponent` and add the launcher button near the video pagination bar.

**Tech Stack:** Angular 18+, Angular Material (MatDialog, MatTabs, MatButton, MatIcon, MatSnackBar), TypeScript, SCSS.

## Global Constraints

- **Component Standard**: Use Angular Standalone Components with `imports: [CommonModule, FormsModule, MatDialogModule, MatTabsModule, MatButtonModule, MatIconModule, MatSnackBarModule, KnowledgeBaseSelectorComponent]`.
- **UI & Aesthetics**: Dark theme, modern clean layout matching existing video editor styles.
- **State Integrity**: When batch updating, update both in-memory Angular properties (`segmentCaptionKBIds`, `captionKBIds`, `regionCaptionCache`, `video.knowledge_base_ids`) and update `selectedRegion.caption.knowledge_base_ids` / `selectedSegment.caption.knowledge_base_ids` so the editor UI stays in sync immediately.

---

### Task 1: Create `BatchKnowledgeDialogComponent`

**Files:**
- Create: `frontend/src/app/pages/batch-knowledge-dialog/batch-knowledge-dialog.component.ts`
- Create: `frontend/src/app/pages/batch-knowledge-dialog/batch-knowledge-dialog.component.html`
- Create: `frontend/src/app/pages/batch-knowledge-dialog/batch-knowledge-dialog.component.scss`

**Interfaces:**
- Consumes: `KnowledgeBaseSelectorComponent` (`../../core/components/knowledge-base-selector/knowledge-base-selector.component`)
- Consumes `MAT_DIALOG_DATA`:
```typescript
export interface BatchKnowledgeDialogData {
  video: any;
  segments: any[];
  regions: any[];
  regionCaptionCache: { [key: string]: any };
}
```
- Produces: `dialogRef.close({ updated: boolean, videoKBIds?: string[], segments?: any[], regions?: any[] })`

- [ ] **Step 1: Write `batch-knowledge-dialog.component.ts`**

```typescript
import { Component, Inject, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatTabsModule } from '@angular/material/tabs';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { KnowledgeBaseSelectorComponent } from '../../core/components/knowledge-base-selector/knowledge-base-selector.component';

export interface BatchKnowledgeDialogData {
  video: any;
  segments: any[];
  regions: any[];
  regionCaptionCache: { [key: string]: any };
}

@Component({
  selector: 'app-batch-knowledge-dialog',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    MatDialogModule,
    MatTabsModule,
    MatButtonModule,
    MatIconModule,
    MatSnackBarModule,
    KnowledgeBaseSelectorComponent
  ],
  templateUrl: './batch-knowledge-dialog.component.html',
  styleUrls: ['./batch-knowledge-dialog.component.scss']
})
export class BatchKnowledgeDialogComponent implements OnInit {
  globalKBIds: string[] = [];
  segmentKBIds: string[] = [];
  objectKBIds: string[] = [];

  constructor(
    public dialogRef: MatDialogRef<BatchKnowledgeDialogComponent>,
    @Inject(MAT_DIALOG_DATA) public data: BatchKnowledgeDialogData,
    private snackBar: MatSnackBar
  ) {}

  ngOnInit(): void {
    if (this.data.video && Array.isArray(this.data.video.knowledge_base_ids)) {
      this.globalKBIds = [...this.data.video.knowledge_base_ids];
    }
  }

  normalizeIds(nodes: any[]): string[] {
    if (!Array.isArray(nodes)) return [];
    return nodes.map(n => typeof n === 'string' ? n : n?.id || '').filter(id => !!id);
  }

  onGlobalSelectionChange(nodes: any[]): void {
    this.globalKBIds = this.normalizeIds(nodes);
  }

  onSegmentSelectionChange(nodes: any[]): void {
    this.segmentKBIds = this.normalizeIds(nodes);
  }

  onObjectSelectionChange(nodes: any[]): void {
    this.objectKBIds = this.normalizeIds(nodes);
  }

  applyGlobalToAll(): void {
    if (!this.globalKBIds.length) {
      this.snackBar.open('Please select at least one Global Knowledge item first.', 'OK', { duration: 3000 });
      return;
    }

    // Apply to segments
    if (Array.isArray(this.data.segments)) {
      this.data.segments.forEach(seg => {
        if (!seg.caption) seg.caption = {};
        seg.caption.knowledge_base_ids = [...this.globalKBIds];
      });
    }

    // Apply to objects/regions
    if (Array.isArray(this.data.regions)) {
      this.data.regions.forEach(reg => {
        if (!reg.caption) reg.caption = {};
        reg.caption.knowledge_base_ids = [...this.globalKBIds];
        if (this.data.regionCaptionCache[reg.id]) {
          this.data.regionCaptionCache[reg.id].kbIds = [...this.globalKBIds];
          this.data.regionCaptionCache[reg.id].data.knowledge_base_ids = [...this.globalKBIds];
        }
      });
    }

    this.snackBar.open(`Applied ${this.globalKBIds.length} global KB item(s) to all segments and objects!`, 'OK', { duration: 3000 });
  }

  applyToSegments(mode: 'overwrite' | 'append' | 'clear'): void {
    if (!this.data.segments || !this.data.segments.length) {
      this.snackBar.open('No segments available in this video.', 'OK', { duration: 3000 });
      return;
    }

    this.data.segments.forEach(seg => {
      if (!seg.caption) seg.caption = {};
      const existing = seg.caption.knowledge_base_ids || [];

      if (mode === 'overwrite') {
        seg.caption.knowledge_base_ids = [...this.segmentKBIds];
      } else if (mode === 'append') {
        const merged = Array.from(new Set([...existing, ...this.segmentKBIds]));
        seg.caption.knowledge_base_ids = merged;
      } else if (mode === 'clear') {
        seg.caption.knowledge_base_ids = [];
      }
    });

    const actionText = mode === 'clear' ? 'Cleared KB from' : `Updated KB for (${mode}) list of`;
    this.snackBar.open(`${actionText} ${this.data.segments.length} segment(s).`, 'OK', { duration: 3000 });
  }

  applyToObjects(mode: 'overwrite' | 'append' | 'clear'): void {
    if (!this.data.regions || !this.data.regions.length) {
      this.snackBar.open('No object tracks available in this video.', 'OK', { duration: 3000 });
      return;
    }

    this.data.regions.forEach(reg => {
      if (!reg.caption) reg.caption = {};
      const existing = reg.caption.knowledge_base_ids || [];
      let newIds: string[] = [];

      if (mode === 'overwrite') {
        newIds = [...this.objectKBIds];
      } else if (mode === 'append') {
        newIds = Array.from(new Set([...existing, ...this.objectKBIds]));
      } else if (mode === 'clear') {
        newIds = [];
      }

      reg.caption.knowledge_base_ids = newIds;
      if (this.data.regionCaptionCache[reg.id]) {
        this.data.regionCaptionCache[reg.id].kbIds = [...newIds];
        this.data.regionCaptionCache[reg.id].data.knowledge_base_ids = [...newIds];
      }
    });

    const actionText = mode === 'clear' ? 'Cleared KB from' : `Updated KB for (${mode}) list of`;
    this.snackBar.open(`${actionText} ${this.data.regions.length} object track(s).`, 'OK', { duration: 3000 });
  }

  saveAndClose(): void {
    this.dialogRef.close({
      updated: true,
      globalKBIds: this.globalKBIds,
      segments: this.data.segments,
      regions: this.data.regions
    });
  }

  close(): void {
    this.dialogRef.close({ updated: false });
  }
}
```

- [ ] **Step 2: Write `batch-knowledge-dialog.component.html`**

```html
<div class="batch-kb-dialog">
  <div class="dialog-header">
    <div class="dialog-title-row">
      <mat-icon class="header-icon">auto_awesome</mat-icon>
      <h2>Batch Knowledge Base Assignment</h2>
    </div>
    <button mat-icon-button (click)="close()"><mat-icon>close</mat-icon></button>
  </div>

  <mat-dialog-content class="dialog-content">
    <mat-tab-group animationDuration="150ms">

      <!-- Tab 1: Option 2 - Global Video KB -->
      <mat-tab label="Global Video KB">
        <div class="tab-body">
          <p class="tab-desc">
            Define default Knowledge Base items for this entire video. You can assign them globally to all segments and object tracks with one click.
          </p>

          <app-knowledge-base-selector
            label="Global Video Knowledge"
            placeholder="Search knowledge base for whole video..."
            [(ngModel)]="globalKBIds"
            [multiple]="true"
            [showQuickAdd]="true"
            (selectionChange)="onGlobalSelectionChange($event)">
          </app-knowledge-base-selector>

          <div class="action-bar">
            <button mat-raised-button color="primary" (click)="applyGlobalToAll()">
              <mat-icon>done_all</mat-icon> Apply Global KB to ALL Segments & Objects
            </button>
          </div>
        </div>
      </mat-tab>

      <!-- Tab 2: Option 1 - Batch Segments -->
      <mat-tab label="Batch Segments ({{ data.segments?.length || 0 }})">
        <div class="tab-body">
          <p class="tab-desc">
            Select Knowledge Base items and apply them to all <strong>{{ data.segments?.length || 0 }}</strong> video segments at once.
          </p>

          <app-knowledge-base-selector
            label="Segment Knowledge Base"
            placeholder="Search KB for segments..."
            [(ngModel)]="segmentKBIds"
            [multiple]="true"
            [showQuickAdd]="true"
            (selectionChange)="onSegmentSelectionChange($event)">
          </app-knowledge-base-selector>

          <div class="action-buttons-group">
            <button mat-raised-button color="primary" (click)="applyToSegments('overwrite')" [disabled]="!segmentKBIds.length">
              <mat-icon>swap_horiz</mat-icon> Overwrite All Segments
            </button>
            <button mat-stroked-button (click)="applyToSegments('append')" [disabled]="!segmentKBIds.length">
              <mat-icon>add</mat-icon> Append to All Segments
            </button>
            <button mat-stroked-button color="warn" (click)="applyToSegments('clear')">
              <mat-icon>delete_outline</mat-icon> Clear All Segments
            </button>
          </div>
        </div>
      </mat-tab>

      <!-- Tab 3: Option 1 - Batch Object Tracks -->
      <mat-tab label="Batch Object Tracks ({{ data.regions?.length || 0 }})">
        <div class="tab-body">
          <p class="tab-desc">
            Select Knowledge Base items and apply them to all <strong>{{ data.regions?.length || 0 }}</strong> object tracks at once.
          </p>

          <app-knowledge-base-selector
            label="Object Track Knowledge Base"
            placeholder="Search KB for object tracks..."
            [(ngModel)]="objectKBIds"
            [multiple]="true"
            [showQuickAdd]="true"
            (selectionChange)="onObjectSelectionChange($event)">
          </app-knowledge-base-selector>

          <div class="action-buttons-group">
            <button mat-raised-button color="primary" (click)="applyToObjects('overwrite')" [disabled]="!objectKBIds.length">
              <mat-icon>swap_horiz</mat-icon> Overwrite All Objects
            </button>
            <button mat-stroked-button (click)="applyToObjects('append')" [disabled]="!objectKBIds.length">
              <mat-icon>add</mat-icon> Append to All Objects
            </button>
            <button mat-stroked-button color="warn" (click)="applyToObjects('clear')">
              <mat-icon>delete_outline</mat-icon> Clear All Objects
            </button>
          </div>
        </div>
      </mat-tab>

    </mat-tab-group>
  </mat-dialog-content>

  <mat-dialog-actions align="end" class="dialog-actions">
    <button mat-button (click)="close()">Cancel</button>
    <button mat-raised-button color="accent" (click)="saveAndClose()">
      <mat-icon>save</mat-icon> Done & Save Changes
    </button>
  </mat-dialog-actions>
</div>
```

- [ ] **Step 3: Write `batch-knowledge-dialog.component.scss`**

```scss
.batch-kb-dialog {
  padding: 8px 12px;
  max-width: 650px;
  width: 100%;
  color: #e0e0e0;

  .dialog-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    border-bottom: 1px solid rgba(255, 255, 255, 0.1);
    padding-bottom: 12px;
    margin-bottom: 16px;

    .dialog-title-row {
      display: flex;
      align-items: center;
      gap: 10px;

      .header-icon {
        color: #7952b3;
      }

      h2 {
        margin: 0;
        font-size: 1.25rem;
        font-weight: 600;
      }
    }
  }

  .dialog-content {
    min-height: 280px;
    padding: 0;

    .tab-body {
      padding: 16px 0;
      display: flex;
      flex-direction: column;
      gap: 16px;

      .tab-desc {
        font-size: 0.9rem;
        color: #aaa;
        margin: 0;
      }

      .action-bar {
        display: flex;
        justify-content: flex-end;
        margin-top: 12px;
      }

      .action-buttons-group {
        display: flex;
        flex-wrap: wrap;
        gap: 12px;
        margin-top: 12px;
      }
    }
  }

  .dialog-actions {
    margin-top: 16px;
    padding-top: 12px;
    border-top: 1px solid rgba(255, 255, 255, 0.1);
    display: flex;
    gap: 8px;
  }
}
```

- [ ] **Step 4: Commit Task 1**

```bash
git add frontend/src/app/pages/batch-knowledge-dialog/
git commit -m "feat: create BatchKnowledgeDialogComponent"
```

---

### Task 2: Integrate Dialog Launcher into `VideoEditorComponent`

**Files:**
- Modify: `frontend/src/app/pages/video-editor/video-editor.component.html:91-101`
- Modify: `frontend/src/app/pages/video-editor/video-editor.component.ts`

- [ ] **Step 1: Update `video-editor.component.html` near video pagination**

Add the `Batch KB` button directly next to the `video-navigation` div:

```html
    <!-- Video Navigation (next/previous within subpart) -->
    <div class="video-navigation" *ngIf="subpartVideoList.length > 1">
      <button mat-icon-button (click)="goToPreviousVideo()" [disabled]="!hasPreviousVideo" matTooltip="Previous Video">
        <mat-icon>chevron_left</mat-icon>
      </button>
      <span class="video-counter">{{ currentVideoIndex + 1 }} / {{ subpartVideoList.length }}</span>
      <button mat-icon-button (click)="goToNextVideo()" [disabled]="!hasNextVideo" matTooltip="Next Video">
        <mat-icon>chevron_right</mat-icon>
      </button>
    </div>

    <!-- Batch Knowledge Base Assignment Launcher -->
    <button mat-stroked-button class="batch-kb-btn" (click)="openBatchKnowledgeDialog()" matTooltip="Batch Knowledge Base Assignment">
      <mat-icon class="batch-icon">auto_awesome</mat-icon> Batch KB
    </button>
```

- [ ] **Step 2: Update `video-editor.component.ts`**

Import `BatchKnowledgeDialogComponent` and implement `openBatchKnowledgeDialog()`:

```typescript
import { BatchKnowledgeDialogComponent } from '../batch-knowledge-dialog/batch-knowledge-dialog.component';
```
Add to `@Component.imports`:
```typescript
BatchKnowledgeDialogComponent,
```

Method implementation in `VideoEditorComponent`:

```typescript
  openBatchKnowledgeDialog(): void {
    if (!this.video) return;

    const dialogRef = this.dialog.open(BatchKnowledgeDialogComponent, {
      width: '640px',
      data: {
        video: this.video,
        segments: this.segments || [],
        regions: this.regions || [],
        regionCaptionCache: this.regionCaptionCache || {}
      }
    });

    dialogRef.afterClosed().subscribe(result => {
      if (result && result.updated) {
        if (result.globalKBIds) {
          this.video.knowledge_base_ids = result.globalKBIds;
        }

        // Sync selected segment if active
        if (this.selectedSegment && this.selectedSegment.caption) {
          this.segmentCaptionKBIds = this.normalizeKbIds(this.selectedSegment.caption.knowledge_base_ids || []);
        }

        // Sync selected region if active
        if (this.selectedRegion && this.selectedRegion.caption) {
          this.captionKBIds = this.normalizeKbIds(this.selectedRegion.caption.knowledge_base_ids || []);
        }

        // Save annotations
        this.saveAnnotations();
        this.snackBar.open('Batch Knowledge Base updates saved!', 'OK', { duration: 3000, panelClass: 'snack-success' });
      }
    });
  }
```

- [ ] **Step 3: Add SCSS styling for `batch-kb-btn` in `video-editor.component.scss`**

```scss
.batch-kb-btn {
  margin-left: 8px;
  border-color: rgba(121, 82, 179, 0.5) !important;
  color: #b197fc !important;

  &:hover {
    background: rgba(121, 82, 179, 0.15) !important;
  }

  .batch-icon {
    margin-right: 4px;
    color: #cc5de8;
  }
}
```

- [ ] **Step 4: Commit Task 2**

```bash
git add frontend/src/app/pages/video-editor/
git commit -m "feat: integrate Batch KB button and dialog into video editor"
```

---

## Plan Self-Review
1. **Spec Coverage**: All features from Option 1 (Batch Segments, Batch Object Tracks) and Option 2 (Global Video KB) are fully covered in the modal architecture and integrated next to video pagination.
2. **Type Consistency**: `normalizeIds`, `knowledge_base_ids`, `segments`, `regions`, `regionCaptionCache` signatures align across `video-editor.component.ts` and `batch-knowledge-dialog.component.ts`.
3. **No Placeholders**: All TypeScript, HTML, and SCSS code snippets are fully detailed and complete.
