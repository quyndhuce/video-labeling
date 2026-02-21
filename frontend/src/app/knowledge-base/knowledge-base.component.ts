import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { MatToolbarModule } from '@angular/material/toolbar';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatChipsModule } from '@angular/material/chips';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { AuthService } from '../core/services/auth.service';
import { KnowledgeBaseService, KBNode, KBType } from '../core/services/knowledge-base.service';
import { GeminiService } from '../core/services/gemini.service';
import { SettingsDialogComponent } from '../pages/settings-dialog/settings-dialog.component';

@Component({
  selector: 'app-knowledge-base',
  standalone: true,
  imports: [
    CommonModule, FormsModule,
    MatToolbarModule, MatButtonModule, MatIconModule, MatMenuModule,
    MatFormFieldModule, MatInputModule, MatSelectModule,
    MatSnackBarModule, MatProgressSpinnerModule, MatTooltipModule,
    MatChipsModule, MatDialogModule
  ],
  templateUrl: './knowledge-base.component.html',
  styleUrls: ['./knowledge-base.component.scss']
})
export class KnowledgeBaseComponent implements OnInit {
  user = this.authService.user;
  kbNodes: KBNode[] = [];
  kbTree: KBNode[] = [];
  kbTypes: KBType[] = [
    { value: 'action', label: 'Action', icon: 'directions_run', color: '#10b981' },
    { value: 'object', label: 'Object', icon: 'category', color: '#3b82f6' },
    { value: 'concept', label: 'Concept', icon: 'lightbulb', color: '#f59e0b' },
    { value: 'ritual', label: 'Ritual', icon: 'auto_awesome', color: '#8b5cf6' },
    { value: 'festival', label: 'Festival', icon: 'celebration', color: '#ec4899' }
  ];
  loading = false;
  searchQuery = '';
  filterType = '';
  viewMode: 'tree' | 'list' = 'tree';

  // Dialog states
  showNodeDialog = false;
  editingNode: KBNode | null = null;
  nodeForm = {
    name: '',
    name_vi: '',
    type: 'concept' as string,
    parent_id: null as string | null,
    description: '',
    description_vi: '',
    visual_cues: '',
    visual_cues_vi: '',
    tags: [] as string[],
    related_kb_ids: [] as string[]
  };
  newTag = '';
  translating = false;

  // Flattened nodes for hierarchical parent selector
  flattenedNodes: KBNode[] = [];

  // Expanded tree nodes
  expandedNodes: Set<string> = new Set();

  constructor(
    private router: Router,
    private authService: AuthService,
    private kbService: KnowledgeBaseService,
    private geminiService: GeminiService,
    private dialog: MatDialog,
    private snackBar: MatSnackBar
  ) {}

  ngOnInit(): void {
    this.loadKBTree();
    this.loadKBNodes();
  }

  loadKBTree(): void {
    this.loading = true;
    this.kbService.getTree().subscribe({
      next: (tree) => {
        this.kbTree = tree;
        this.flattenedNodes = this.flattenTree(tree);
        this.loading = false;
      },
      error: () => {
        this.loading = false;
        this.snackBar.open('Failed to load Knowledge Base', 'Close', { duration: 3000 });
      }
    });
  }

  // Flatten tree for hierarchical parent selector
  flattenTree(nodes: KBNode[], level: number = 0, path: string = ''): KBNode[] {
    let result: KBNode[] = [];
    for (const node of nodes) {
      const nodePath = path ? `${path} > ${node.name}` : node.name;
      result.push({ ...node, level, path: nodePath });
      if (node.children && node.children.length > 0) {
        result = result.concat(this.flattenTree(node.children, level + 1, nodePath));
      }
    }
    return result;
  }

  loadKBNodes(): void {
    this.kbService.getAllNodes().subscribe({
      next: (nodes) => this.kbNodes = nodes
    });
  }

  searchNodes(): void {
    if (!this.searchQuery && !this.filterType) {
      this.loadKBTree();
      return;
    }
    this.kbService.getAllNodes({ search: this.searchQuery, type: this.filterType }).subscribe({
      next: (nodes) => {
        this.kbTree = nodes;
        this.viewMode = 'list';
      }
    });
  }

  clearSearch(): void {
    this.searchQuery = '';
    this.filterType = '';
    this.viewMode = 'tree';
    this.loadKBTree();
  }

  // Tree operations
  toggleNode(node: KBNode): void {
    if (this.expandedNodes.has(node.id)) {
      this.expandedNodes.delete(node.id);
    } else {
      this.expandedNodes.add(node.id);
    }
  }

  isExpanded(node: KBNode): boolean {
    return this.expandedNodes.has(node.id);
  }

  // Dialog operations
  openCreateDialog(parentId: string | null = null): void {
    this.editingNode = null;
    this.nodeForm = {
      name: '',
      name_vi: '',
      type: 'concept',
      parent_id: parentId,
      description: '',
      description_vi: '',
      visual_cues: '',
      visual_cues_vi: '',
      tags: [],
      related_kb_ids: []
    };
    this.showNodeDialog = true;
  }

  openEditDialog(node: KBNode): void {
    this.editingNode = node;
    this.nodeForm = {
      name: node.name,
      name_vi: node.name_vi || '',
      type: node.type,
      parent_id: node.parent_id,
      description: node.description,
      description_vi: node.description_vi || '',
      visual_cues: node.visual_cues,
      visual_cues_vi: node.visual_cues_vi || '',
      tags: [...node.tags],
      related_kb_ids: [...node.related_kb_ids]
    };
    this.showNodeDialog = true;
  }

  closeDialog(): void {
    this.showNodeDialog = false;
    this.editingNode = null;
  }

  saveNode(): void {
    if (!this.nodeForm.name.trim()) {
      this.snackBar.open('Name is required', 'Close', { duration: 2000 });
      return;
    }

    const data: any = {
      name: this.nodeForm.name.trim(),
      name_vi: this.nodeForm.name_vi.trim(),
      type: this.nodeForm.type,
      parent_id: this.nodeForm.parent_id,
      description: this.nodeForm.description,
      description_vi: this.nodeForm.description_vi,
      visual_cues: this.nodeForm.visual_cues,
      visual_cues_vi: this.nodeForm.visual_cues_vi,
      tags: this.nodeForm.tags,
      related_kb_ids: this.nodeForm.related_kb_ids
    };

    if (this.editingNode) {
      this.kbService.updateNode(this.editingNode.id, data).subscribe({
        next: () => {
          this.snackBar.open('KB node updated!', 'Close', { duration: 2000 });
          this.closeDialog();
          this.loadKBTree();
          this.loadKBNodes();
        },
        error: () => {
          this.snackBar.open('Failed to update node', 'Close', { duration: 3000 });
        }
      });
    } else {
      this.kbService.createNode(data).subscribe({
        next: (newNode) => {
          this.snackBar.open('KB node created!', 'Close', { duration: 2000 });
          this.closeDialog();
          this.loadKBTree();
          this.loadKBNodes();
          // Expand parent to show new node
          if (newNode.parent_id) {
            this.expandedNodes.add(newNode.parent_id);
          }
        },
        error: () => {
          this.snackBar.open('Failed to create node', 'Close', { duration: 3000 });
        }
      });
    }
  }

  deleteNode(node: KBNode): void {
    const hasChildren = node.children_ids?.length > 0;
    const message = hasChildren
      ? `Delete "${node.name}" and all its children?`
      : `Delete "${node.name}"?`;
    
    if (!confirm(message)) return;

    this.kbService.deleteNode(node.id, hasChildren).subscribe({
      next: () => {
        this.snackBar.open('KB node deleted!', 'Close', { duration: 2000 });
        this.loadKBTree();
        this.loadKBNodes();
      },
      error: () => {
        this.snackBar.open('Failed to delete node', 'Close', { duration: 3000 });
      }
    });
  }

  // Tag operations
  addTag(): void {
    const tag = this.newTag.trim();
    if (tag && !this.nodeForm.tags.includes(tag)) {
      this.nodeForm.tags.push(tag);
    }
    this.newTag = '';
  }

  removeTag(tag: string): void {
    this.nodeForm.tags = this.nodeForm.tags.filter(t => t !== tag);
  }

  // Helper methods
  getTypeColor(type: string): string {
    return this.kbTypes.find(t => t.value === type)?.color || '#64748b';
  }

  getTypeIcon(type: string): string {
    return this.kbTypes.find(t => t.value === type)?.icon || 'help';
  }

  getTypeLabel(type: string): string {
    return this.kbTypes.find(t => t.value === type)?.label || type;
  }

  getParentName(parentId: string | null): string {
    if (!parentId) return 'None (Root)';
    const parent = this.kbNodes.find(n => n.id === parentId);
    return parent?.name || 'Unknown';
  }

  // Get indent string for hierarchical display
  getIndent(level: number): string {
    return '—'.repeat(level);
  }

  // Translation methods
  async translateField(field: 'name' | 'description' | 'visual_cues', direction: 'en_to_vi' | 'vi_to_en'): Promise<void> {
    const sourceField = direction === 'en_to_vi' ? field : `${field}_vi` as keyof typeof this.nodeForm;
    const targetField = direction === 'en_to_vi' ? `${field}_vi` as keyof typeof this.nodeForm : field;
    
    const sourceText = this.nodeForm[sourceField] as string;
    if (!sourceText?.trim()) {
      this.snackBar.open('No text to translate', 'Close', { duration: 2000 });
      return;
    }

    this.translating = true;
    try {
      const translated = await this.geminiService.translate(sourceText, direction);
      (this.nodeForm as any)[targetField] = translated;
      this.snackBar.open('Translation completed!', 'Close', { duration: 2000 });
    } catch (error: any) {
      this.snackBar.open(error.message || 'Translation failed', 'Close', { duration: 3000 });
    } finally {
      this.translating = false;
    }
  }

  // Navigation
  goBack(): void {
    this.router.navigate(['/dashboard']);
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
