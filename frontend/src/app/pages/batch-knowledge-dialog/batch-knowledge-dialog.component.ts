import { Component, Inject, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatTabsModule } from '@angular/material/tabs';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatFormFieldModule } from '@angular/material/form-field';
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
    MatInputModule,
    MatFormFieldModule,
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

  batchSegmentName = '';
  batchObjectLabel = '';

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
    return nodes.map(n => (typeof n === 'string' ? n : n?.id || '')).filter(id => !!id);
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
        if (this.data.regionCaptionCache && this.data.regionCaptionCache[reg.id]) {
          this.data.regionCaptionCache[reg.id].kbIds = [...this.globalKBIds];
          if (this.data.regionCaptionCache[reg.id].data) {
            this.data.regionCaptionCache[reg.id].data.knowledge_base_ids = [...this.globalKBIds];
          }
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

    const actionText = mode === 'clear' ? 'Cleared KB from' : `Updated KB (${mode}) for`;
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
      if (this.data.regionCaptionCache && this.data.regionCaptionCache[reg.id]) {
        this.data.regionCaptionCache[reg.id].kbIds = [...newIds];
        if (this.data.regionCaptionCache[reg.id].data) {
          this.data.regionCaptionCache[reg.id].data.knowledge_base_ids = [...newIds];
        }
      }
    });

    const actionText = mode === 'clear' ? 'Cleared KB from' : `Updated KB (${mode}) for`;
    this.snackBar.open(`${actionText} ${this.data.regions.length} object track(s).`, 'OK', { duration: 3000 });
  }

  renameAllSegments(): void {
    const name = this.batchSegmentName.trim();
    if (!name) return;

    if (!this.data.segments || !this.data.segments.length) {
      this.snackBar.open('No segments available to rename.', 'OK', { duration: 3000 });
      return;
    }

    this.data.segments.forEach(seg => {
      seg.name = name;
    });

    this.snackBar.open(`Renamed ${this.data.segments.length} segment(s) to "${name}".`, 'OK', { duration: 3000 });
  }

  renameAllObjects(withNumbering: boolean = false): void {
    const label = this.batchObjectLabel.trim();
    if (!label) return;

    if (!this.data.regions || !this.data.regions.length) {
      this.snackBar.open('No object tracks available to rename.', 'OK', { duration: 3000 });
      return;
    }

    this.data.regions.forEach((reg, idx) => {
      reg.label = withNumbering ? `${label} ${idx + 1}` : label;
    });

    this.snackBar.open(`Updated labels for ${this.data.regions.length} object track(s).`, 'OK', { duration: 3000 });
  }

  saveAndClose(): void {
    // Auto-apply segment KB selection if user picked items in dropdown
    if (this.segmentKBIds.length > 0 && Array.isArray(this.data.segments)) {
      this.data.segments.forEach(seg => {
        if (!seg.caption) seg.caption = {};
        seg.caption.knowledge_base_ids = Array.from(new Set([
          ...(seg.caption.knowledge_base_ids || []),
          ...this.segmentKBIds
        ]));
      });
    }

    // Auto-apply object track KB selection if user picked items in dropdown
    if (this.objectKBIds.length > 0 && Array.isArray(this.data.regions)) {
      this.data.regions.forEach(reg => {
        if (!reg.caption) reg.caption = {};
        reg.caption.knowledge_base_ids = Array.from(new Set([
          ...(reg.caption.knowledge_base_ids || []),
          ...this.objectKBIds
        ]));
        if (this.data.regionCaptionCache && this.data.regionCaptionCache[reg.id]) {
          this.data.regionCaptionCache[reg.id].kbIds = [...reg.caption.knowledge_base_ids];
        }
      });
    }

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
