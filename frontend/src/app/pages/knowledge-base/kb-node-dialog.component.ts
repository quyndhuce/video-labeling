import { Component, Inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatDialogModule, MatDialogRef, MAT_DIALOG_DATA } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatChipsModule } from '@angular/material/chips';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatSnackBar } from '@angular/material/snack-bar';
import { KnowledgeBaseService, KBNode, KBNodeFact } from '../../core/services/knowledge-base.service';

@Component({
  selector: 'app-kb-node-dialog',
  standalone: true,
  imports: [
    CommonModule, FormsModule,
    MatDialogModule, MatFormFieldModule, MatInputModule,
    MatSelectModule, MatButtonModule, MatIconModule, MatChipsModule,
    MatCheckboxModule, MatProgressSpinnerModule, MatTooltipModule
  ],
  templateUrl: './kb-node-dialog.component.html',
  styleUrls: ['./kb-node-dialog.component.scss']
})
export class KBNodeDialogComponent {
  node: Partial<KBNode> = {
    name: '',
    name_vi: '',
    type: 'object',
    description: '',
    visual_cues: '',
    tags: [],
    facts: [],
    region: '',
    confidence_level: 'optional',
    related_ids: []
  };

  types = ['action', 'object', 'concept', 'ritual', 'festival'];
  confidenceLevels = ['core', 'optional', 'inferred'];
  regions = ['North', 'Central', 'South', 'Nationwide', 'International'];

  newTag = '';
  availableNodes: KBNode[] = [];

  // Fact Extraction & Selection
  availableFacts: KBNodeFact[] = [];
  extractingFacts = false;
  factSearchQuery = '';

  // Manual Fact Entry
  showAddFactForm = false;
  newFact: KBNodeFact = {
    head: '',
    head_type: 'landmark',
    relation: 'located_in',
    tail: '',
    tail_type: 'location',
    score: 1.0,
    selected: true
  };

  constructor(
    private dialogRef: MatDialogRef<KBNodeDialogComponent>,
    @Inject(MAT_DIALOG_DATA) public data: { node?: KBNode; parentId?: string; allNodes?: KBNode[]; isEditMode?: boolean },
    private kbService: KnowledgeBaseService,
    private snackBar: MatSnackBar
  ) {
    if (data.node) {
      this.node = { ...data.node };
      if (data.node.facts && Array.isArray(data.node.facts)) {
        this.availableFacts = data.node.facts.map(f => ({
          ...f,
          selected: f.selected !== undefined ? f.selected : ((f.score ?? 1) >= 0.10)
        }));
        this.sortAndFilterFacts();
      }
    }
    if (data.parentId) {
      this.node.parent_id = data.parentId;
    }

    if (data.allNodes) {
      this.availableNodes = data.allNodes.filter(n => n.id !== this.node.id);
    } else {
      this.loadAvailableNodes();
    }
  }

  /**
   * Sort facts by score descending and auto-deselect facts with score < 10% (0.10)
   */
  private sortAndFilterFacts(): void {
    // Sort descending by score
    this.availableFacts.sort((a, b) => (b.score ?? 0) - (a.score ?? 0));

    // Auto-deselect facts with score < 10%
    this.availableFacts.forEach(f => {
      if (f.score !== undefined && f.score !== null) {
        const normalizedScore = f.score > 1 ? f.score / 100 : f.score;
        if (normalizedScore < 0.10) {
          f.selected = false;
        }
      }
    });
  }

  loadAvailableNodes(): void {
    this.kbService.getAllNodes().subscribe({
      next: (nodes) => {
        this.availableNodes = nodes.filter(n => n.id !== this.node.id);
      },
      error: (error) => {
        console.error('Error loading nodes:', error);
      }
    });
  }

  addTag(): void {
    if (this.newTag.trim() && !this.node.tags?.includes(this.newTag.trim())) {
      this.node.tags = [...(this.node.tags || []), this.newTag.trim()];
      this.newTag = '';
    }
  }

  removeTag(tag: string): void {
    this.node.tags = this.node.tags?.filter(t => t !== tag) || [];
  }

  // --- Fact Extraction ---
  onExtractFacts(): void {
    if (!this.node.description || !this.node.description.trim()) {
      this.snackBar.open('Vui lòng nhập Description trước khi trích xuất facts.', 'Đóng', { duration: 3000 });
      return;
    }

    this.extractingFacts = true;
    const subjectHint = this.node.name || undefined;

    this.kbService.extractFacts(this.node.description, subjectHint).subscribe({
      next: (res) => {
        this.extractingFacts = false;
        const extracted = res.facts || [];
        if (extracted.length === 0) {
          this.snackBar.open('Không tìm thấy fact nào trong Description.', 'Đóng', { duration: 3000 });
          return;
        }

        let addedCount = 0;
        extracted.forEach(nf => {
          const exists = this.availableFacts.some(
            ef => ef.head.toLowerCase() === nf.head.toLowerCase() &&
                  ef.relation.toLowerCase() === nf.relation.toLowerCase() &&
                  ef.tail.toLowerCase() === nf.tail.toLowerCase()
          );
          if (!exists) {
            const score = nf.score ?? 1.0;
            const normalizedScore = score > 1 ? score / 100 : score;
            const autoSelected = normalizedScore >= 0.10;
            this.availableFacts.push({ ...nf, selected: autoSelected });
            addedCount++;
          }
        });

        this.sortAndFilterFacts();

        this.snackBar.open(`Đã trích xuất ${addedCount} fact mới từ Description (đã tự động sắp xếp & lọc độ tin cậy).`, 'Đóng', { duration: 3500 });
      },
      error: (err) => {
        this.extractingFacts = false;
        console.error('Fact extraction error:', err);
        const msg = err?.error?.error || 'Lỗi trích xuất fact từ mô hình.';
        this.snackBar.open(msg, 'Đóng', { duration: 4000 });
      }
    });
  }

  toggleFact(fact: KBNodeFact): void {
    fact.selected = !fact.selected;
  }

  selectAllFacts(select: boolean): void {
    this.availableFacts.forEach(f => f.selected = select);
  }

  removeFact(index: number): void {
    this.availableFacts.splice(index, 1);
  }

  getSelectedFactsCount(): number {
    return this.availableFacts.filter(f => f.selected !== false).length;
  }

  getFilteredFacts(): KBNodeFact[] {
    if (!this.factSearchQuery.trim()) {
      return this.availableFacts;
    }
    const q = this.factSearchQuery.toLowerCase().trim();
    return this.availableFacts.filter(f =>
      f.head.toLowerCase().includes(q) ||
      f.relation.toLowerCase().includes(q) ||
      f.tail.toLowerCase().includes(q)
    );
  }

  addManualFact(): void {
    if (!this.newFact.head.trim() || !this.newFact.relation.trim() || !this.newFact.tail.trim()) {
      this.snackBar.open('Vui lòng nhập đầy đủ Head, Relation, và Tail.', 'Đóng', { duration: 3000 });
      return;
    }

    this.availableFacts.push({
      head: this.newFact.head.trim(),
      head_type: this.newFact.head_type?.trim() || 'concept',
      relation: this.newFact.relation.trim(),
      tail: this.newFact.tail.trim(),
      tail_type: this.newFact.tail_type?.trim() || 'concept',
      score: 1.0,
      selected: true
    });

    this.sortAndFilterFacts();

    this.newFact.relation = 'located_in';
    this.newFact.tail = '';
    this.showAddFactForm = false;
    this.snackBar.open('Đã thêm fact mới!', 'Đóng', { duration: 2000 });
  }

  onSave(): void {
    if (!this.node.name || !this.node.type) {
      this.snackBar.open('Name and type are required', 'Close', { duration: 3000 });
      return;
    }

    // Save only selected facts
    this.node.facts = this.availableFacts.filter(f => f.selected !== false);

    const operation = this.data.node
      ? this.kbService.updateNode(this.data.node.id, this.node)
      : this.kbService.createNode(this.node);

    operation.subscribe({
      next: (result) => {
        this.snackBar.open(
          `Knowledge node ${this.data.node ? 'updated' : 'created'} successfully`,
          'Close',
          { duration: 3000 }
        );
        this.dialogRef.close(result);
      },
      error: (error) => {
        console.error('Error saving node:', error);
        const msg = error?.error?.error || 'Error saving knowledge node';
        this.snackBar.open(msg, 'Close', { duration: 4000 });
      }
    });
  }

  onCancel(): void {
    this.dialogRef.close();
  }

  getNodeDisplayName(node: KBNode): string {
    return `${node.name} (${node.type})`;
  }
}
