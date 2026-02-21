import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router, RouterModule } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatOptionModule } from '@angular/material/core';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatMenuModule } from '@angular/material/menu';
import { MatChipsModule } from '@angular/material/chips';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatTabsModule } from '@angular/material/tabs';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { MatTreeModule } from '@angular/material/tree';
import { MatExpansionModule } from '@angular/material/expansion';
import { KnowledgeBaseService, KBNode } from '../../core/services/knowledge-base.service';
import { KBNodeDialogComponent } from './kb-node-dialog.component';
import { AppNavbarComponent } from '../../core/components/app-navbar.component';

@Component({
  selector: 'app-knowledge-base',
  standalone: true,
  imports: [
    CommonModule, FormsModule, RouterModule,
    MatButtonModule, MatIconModule, MatInputModule, MatSelectModule, MatOptionModule,
    MatFormFieldModule, MatSnackBarModule, MatMenuModule, MatChipsModule,
    MatProgressSpinnerModule, MatTooltipModule, MatTabsModule, MatDialogModule,
    MatTreeModule, MatExpansionModule, KBNodeDialogComponent, AppNavbarComponent
  ],
  templateUrl: './knowledge-base.component.html',
  styleUrls: ['./knowledge-base.component.scss']
})
export class KnowledgeBaseComponent implements OnInit {
  allNodes: KBNode[] = [];
  treeNodes: KBNode[] = [];
  loading = false;
  searchQuery = '';
  filterType = '';
  filterRegion = '';
  selectedNode: KBNode | null = null;
  expandedNodes: Set<string> = new Set();

  nodeTypes = ['action', 'object', 'concept', 'ritual', 'festival'];
  regions: string[] = [];

  viewMode: 'tree' | 'list' = 'tree';

  constructor(
    private kbService: KnowledgeBaseService,
    private snackBar: MatSnackBar,
    private dialog: MatDialog,
    private router: Router
  ) {}

  ngOnInit(): void {
    this.loadData();
  }

  loadData(): void {
    this.loading = true;
    this.kbService.getTree().subscribe({
      next: (tree) => {
        this.treeNodes = tree || [];
        this.extractRegions();
        this.loading = false;
        if (tree && tree.length === 0) {
          this.snackBar.open('No KB nodes found. Create one to get started!', 'Close', { duration: 3000 });
        }
      },
      error: (error) => {
        console.error('Error loading KB tree:', error);
        this.snackBar.open('Failed to load KB data: ' + (error?.error?.error || 'Unknown error'), 'Close', { duration: 3000 });
        this.loading = false;
        this.treeNodes = [];
      }
    });
  }

  loadAllNodes(): void {
    this.kbService.getAllNodes().subscribe({
      next: (nodes) => {
        this.allNodes = nodes;
        this.extractRegions();
      }
    });
  }

  extractRegions(): void {
    const regions = new Set<string>();
    this.treeNodes.forEach(node => {
      this.collectRegions(node, regions);
    });
    this.regions = Array.from(regions).filter(r => r.length > 0);
  }

  collectRegions(node: KBNode, regions: Set<string>): void {
    if (node.region) regions.add(node.region);
    if (node.children) {
      node.children.forEach(child => this.collectRegions(child, regions));
    }
  }

  toggleNode(node: KBNode): void {
    if (this.expandedNodes.has(node.id)) {
      this.expandedNodes.delete(node.id);
    } else {
      this.expandedNodes.add(node.id);
    }
  }

  isNodeExpanded(node: KBNode): boolean {
    return this.expandedNodes.has(node.id);
  }

  selectNode(node: KBNode): void {
    this.selectedNode = node;
  }

  createNode(): void {
    this.kbService.getAllNodes().subscribe({
      next: (nodes) => {
        this.allNodes = nodes;
        const dialogRef = this.dialog.open(KBNodeDialogComponent, {
          width: '600px',
          data: {
            isEditMode: false,
            allNodes: this.allNodes,
            node: undefined
          }
        });

        dialogRef.afterClosed().subscribe(result => {
          if (result) {
            this.snackBar.open('Node created!', 'Close', { duration: 2000 });
            this.loadData();
          }
        });
      }
    });
  }

  editNode(node: KBNode): void {
    this.kbService.getAllNodes().subscribe({
      next: (nodes) => {
        this.allNodes = nodes;
        const dialogRef = this.dialog.open(KBNodeDialogComponent, {
          width: '600px',
          data: {
            isEditMode: true,
            allNodes: this.allNodes,
            node: node
          }
        });

        dialogRef.afterClosed().subscribe(result => {
          if (result) {
            this.snackBar.open('Node updated!', 'Close', { duration: 2000 });
            this.loadData();
            this.selectedNode = null;
          }
        });
      }
    });
  }

  deleteNode(node: KBNode): void {
    if (!confirm(`Delete "${node.name}"? Its children will be reassigned to its parent.`)) return;

    this.kbService.deleteNode(node.id).subscribe({
      next: () => {
        this.snackBar.open('Node deleted', 'Close', { duration: 2000 });
        this.loadData();
        if (this.selectedNode?.id === node.id) {
          this.selectedNode = null;
        }
      },
      error: () => {
        this.snackBar.open('Failed to delete node', 'Close', { duration: 3000 });
      }
    });
  }

  searchNodes(): void {
    if (!this.searchQuery.trim()) {
      this.loadData();
      return;
    }

    this.loading = true;
    this.kbService.search(this.searchQuery).subscribe({
      next: (results) => {
        this.allNodes = results;
        this.viewMode = 'list';
        this.loading = false;
      },
      error: () => {
        this.snackBar.open('Search failed', 'Close', { duration: 3000 });
        this.loading = false;
      }
    });
  }

  applyFilters(): void {
    const filters: any = {};
    if (this.filterType) filters.type = this.filterType;
    if (this.filterRegion) filters.region = this.filterRegion;

    this.loading = true;
    this.kbService.getAllNodes(filters).subscribe({
      next: (results) => {
        this.allNodes = results;
        this.viewMode = 'list';
        this.loading = false;
      }
    });
  }

  resetFilters(): void {
    this.searchQuery = '';
    this.filterType = '';
    this.filterRegion = '';
    this.loadData();
  }

  getTypeColor(type: string): string {
    const colors: { [key: string]: string } = {
      'action': '#3b82f6',
      'object': '#ef4444',
      'concept': '#8b5cf6',
      'ritual': '#f59e0b',
      'festival': '#ec4899'
    };
    return colors[type] || '#64748b';
  }

  getConfidenceColor(level: string): string {
    const colors: { [key: string]: string } = {
      'core': '#10b981',
      'optional': '#f59e0b',
      'inferred': '#6366f1'
    };
    return colors[level] || '#64748b';
  }

  renderTreeNode(node: KBNode): void {
    // Used by template for tree rendering
  }
}
