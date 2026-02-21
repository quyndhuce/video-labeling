import { Component, EventEmitter, Input, OnInit, Output, forwardRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule, NG_VALUE_ACCESSOR, ControlValueAccessor } from '@angular/forms';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatChipsModule } from '@angular/material/chips';
import { MatAutocompleteModule } from '@angular/material/autocomplete';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { KnowledgeBaseService, KBNode, KBType } from '../../services/knowledge-base.service';

@Component({
  selector: 'app-knowledge-base-selector',
  standalone: true,
  imports: [
    CommonModule, FormsModule,
    MatFormFieldModule, MatInputModule, MatButtonModule, MatIconModule,
    MatChipsModule, MatAutocompleteModule, MatTooltipModule, MatSnackBarModule
  ],
  templateUrl: './knowledge-base-selector.component.html',
  styleUrls: ['./knowledge-base-selector.component.scss'],
  providers: [
    {
      provide: NG_VALUE_ACCESSOR,
      useExisting: forwardRef(() => KnowledgeBaseSelectorComponent),
      multi: true
    }
  ]
})
export class KnowledgeBaseSelectorComponent implements OnInit, ControlValueAccessor {
  @Input() label = 'Knowledge Base';
  @Input() placeholder = 'Search and select knowledge...';
  @Input() multiple = true;
  @Input() showQuickAdd = true;
  
  @Output() selectionChange = new EventEmitter<KBNode[]>();

  allNodes: KBNode[] = [];
  filteredNodes: KBNode[] = [];
  selectedNodes: KBNode[] = [];
  searchQuery = '';
  showDropdown = false;
  loading = false;

  // Quick add form
  showQuickAddForm = false;
  quickAddName = '';
  quickAddType = 'concept';

  kbTypes: KBType[] = [
    { value: 'action', label: 'Action', icon: 'directions_run', color: '#10b981' },
    { value: 'object', label: 'Object', icon: 'category', color: '#3b82f6' },
    { value: 'concept', label: 'Concept', icon: 'lightbulb', color: '#f59e0b' },
    { value: 'ritual', label: 'Ritual', icon: 'auto_awesome', color: '#8b5cf6' },
    { value: 'festival', label: 'Festival', icon: 'celebration', color: '#ec4899' }
  ];

  private onChange = (value: string[]) => {};
  private onTouched = () => {};

  constructor(
    private kbService: KnowledgeBaseService,
    private snackBar: MatSnackBar
  ) {}

  ngOnInit(): void {
    this.loadNodes();
  }

  loadNodes(): void {
    this.loading = true;
    this.kbService.getAllNodes().subscribe({
      next: (nodes) => {
        this.allNodes = nodes;
        this.filteredNodes = nodes;
        this.loading = false;
        // Restore selected nodes from IDs
        this.updateSelectedNodesFromValue();
      },
      error: () => {
        this.loading = false;
      }
    });
  }

  filterNodes(): void {
    const query = this.searchQuery.toLowerCase().trim();
    if (!query) {
      this.filteredNodes = this.allNodes;
      return;
    }
    this.filteredNodes = this.allNodes.filter(node =>
      node.name.toLowerCase().includes(query) ||
      node.description.toLowerCase().includes(query) ||
      node.tags.some(tag => tag.toLowerCase().includes(query))
    );
  }

  selectNode(node: KBNode): void {
    if (this.multiple) {
      if (this.isSelected(node)) {
        // Toggle off - remove if already selected
        this.selectedNodes = this.selectedNodes.filter(n => n.id !== node.id);
      } else {
        // Toggle on - add if not selected
        this.selectedNodes.push(node);
      }
      this.emitChange();
    } else {
      this.selectedNodes = [node];
      this.emitChange();
      this.showDropdown = false;
    }
    this.searchQuery = '';
    this.filterNodes();
  }

  removeNode(node: KBNode): void {
    this.selectedNodes = this.selectedNodes.filter(n => n.id !== node.id);
    this.emitChange();
  }

  isSelected(node: KBNode): boolean {
    return this.selectedNodes.some(n => n.id === node.id);
  }

  emitChange(): void {
    const ids = this.selectedNodes.map(n => n.id);
    this.onChange(ids);
    this.selectionChange.emit(this.selectedNodes);
  }

  // Quick Add
  toggleQuickAdd(): void {
    this.showQuickAddForm = !this.showQuickAddForm;
    if (this.showQuickAddForm) {
      this.quickAddName = this.searchQuery;
      this.quickAddType = 'concept';
    }
  }

  quickAdd(): void {
    if (!this.quickAddName.trim()) return;

    this.kbService.quickCreate({ name: this.quickAddName.trim(), type: this.quickAddType }).subscribe({
      next: (newNode) => {
        this.allNodes.unshift(newNode);
        this.selectNode(newNode);
        this.showQuickAddForm = false;
        this.quickAddName = '';
        this.snackBar.open(`"${newNode.name}" added to Knowledge Base`, 'Close', { duration: 2000 });
      },
      error: () => {
        this.snackBar.open('Failed to create KB node', 'Close', { duration: 3000 });
      }
    });
  }

  // Dropdown control
  openDropdown(): void {
    this.showDropdown = true;
    this.filterNodes();
  }

  closeDropdown(): void {
    setTimeout(() => {
      this.showDropdown = false;
      this.showQuickAddForm = false;
    }, 200);
  }

  // Helpers
  getTypeColor(type: string): string {
    return this.kbTypes.find(t => t.value === type)?.color || '#64748b';
  }

  getTypeIcon(type: string): string {
    return this.kbTypes.find(t => t.value === type)?.icon || 'help';
  }

  // ControlValueAccessor implementation
  writeValue(value: string[]): void {
    if (value && Array.isArray(value)) {
      // Store IDs and update selected nodes when nodes are loaded
      this.updateSelectedNodesFromIds(value);
    } else {
      this.selectedNodes = [];
    }
  }

  registerOnChange(fn: (value: string[]) => void): void {
    this.onChange = fn;
  }

  registerOnTouched(fn: () => void): void {
    this.onTouched = fn;
  }

  private updateSelectedNodesFromIds(ids: string[]): void {
    if (this.allNodes.length > 0) {
      this.selectedNodes = this.allNodes.filter(node => ids.includes(node.id));
    }
  }

  private updateSelectedNodesFromValue(): void {
    if (this.selectedNodes.length === 0) return;
    const ids = this.selectedNodes.map(n => n.id);
    this.selectedNodes = this.allNodes.filter(node => ids.includes(node.id));
  }
}
