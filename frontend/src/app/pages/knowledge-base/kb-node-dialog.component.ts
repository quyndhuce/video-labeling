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
import { MatSnackBar } from '@angular/material/snack-bar';
import { KnowledgeBaseService, KBNode } from '../../core/services/knowledge-base.service';

@Component({
  selector: 'app-kb-node-dialog',
  standalone: true,
  imports: [
    CommonModule, FormsModule,
    MatDialogModule, MatFormFieldModule, MatInputModule,
    MatSelectModule, MatButtonModule, MatIconModule, MatChipsModule
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
    description_vi: '',
    visual_cues: '',
    visual_cues_vi: '',
    tags: [],
    region: '',
    confidence_level: 'optional',
    related_ids: []
  };

  types = ['action', 'object', 'concept', 'ritual', 'festival'];
  confidenceLevels = ['core', 'optional', 'inferred'];

  newTag = '';
  availableNodes: KBNode[] = [];

  constructor(
    private dialogRef: MatDialogRef<KBNodeDialogComponent>,
    @Inject(MAT_DIALOG_DATA) public data: { node?: KBNode; parentId?: string },
    private kbService: KnowledgeBaseService,
    private snackBar: MatSnackBar
  ) {
    if (data.node) {
      this.node = { ...data.node };
    }
    if (data.parentId) {
      this.node.parent_id = data.parentId;
    }

    // Load available nodes for relationships
    this.loadAvailableNodes();
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

  onSave(): void {
    if (!this.node.name || !this.node.type) {
      this.snackBar.open('Name and type are required', 'Close', { duration: 3000 });
      return;
    }

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
        this.snackBar.open('Error saving knowledge node', 'Close', { duration: 3000 });
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
