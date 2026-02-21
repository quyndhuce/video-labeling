import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';

export interface KBNode {
  id: string;
  kb_id: string;
  name: string;
  name_vi: string;
  type: 'action' | 'object' | 'concept' | 'ritual' | 'festival';
  parent_id: string | null;
  children_ids: string[];
  description: string;
  description_vi: string;
  visual_cues: string;
  visual_cues_vi: string;
  related_kb_ids: string[];
  tags: string[];
  created_at: string;
  updated_at: string;
  children?: KBNode[];
  related_ids?: KBNode[];
  region: string,
  // For hierarchical 
  confidence_level: string,
  level?: number;
  path?: string;
}

export interface KBType {
  value: string;
  label: string;
  icon: string;
  color: string;
}

@Injectable({
  providedIn: 'root'
})
export class KnowledgeBaseService {
  private apiUrl = '/api/knowledge-base';

  constructor(private http: HttpClient) {}

  // Get all KB nodes with optional filters
  getAllNodes(options?: { tree?: boolean; search?: string; type?: string }): Observable<KBNode[]> {
    const params: any = {};
    if (options?.tree) params.tree = 'true';
    if (options?.search) params.search = options.search;
    if (options?.type) params.type = options.type;
    return this.http.get<KBNode[]>(this.apiUrl, { params });
  }

  // Get a specific KB node with full details
  getNode(nodeId: string): Observable<KBNode> {
    return this.http.get<KBNode>(`${this.apiUrl}/${nodeId}`);
  }

  // Create a new KB node
  createNode(data: Partial<KBNode>): Observable<KBNode> {
    return this.http.post<KBNode>(this.apiUrl, data);
  }

  // Quick create a KB node (minimal data)
  quickCreate(data: { name: string; type?: string; description?: string; visual_cues?: string }): Observable<KBNode> {
    return this.http.post<KBNode>(`${this.apiUrl}/quick`, data);
  }

  // Update a KB node
  updateNode(nodeId: string, data: Partial<KBNode>): Observable<KBNode> {
    return this.http.put<KBNode>(`${this.apiUrl}/${nodeId}`, data);
  }

  // Delete a KB node
  deleteNode(nodeId: string, recursive: boolean = false): Observable<{ message: string }> {
    const params = recursive ? { recursive: 'true' } : {};
    return this.http.delete<{ message: string }>(`${this.apiUrl}/${nodeId}`, { params });
  }

  // Search KB nodes
  search(query: string): Observable<KBNode[]> {
    return this.getAllNodes({ search: query });
  }

  // Get KB as hierarchical tree
  getTree(): Observable<KBNode[]> {
    return this.getAllNodes({ tree: true });
  }

  // Get nodes by type
  getByType(type: string): Observable<KBNode[]> {
    return this.getAllNodes({ type });
  }

  // Get KB types
  getTypes(): Observable<KBType[]> {
    return this.http.get<KBType[]>(`${this.apiUrl}/types`);
  }

  // Get full context for KB nodes (with ancestors)
  getContext(nodeIds: string[]): Observable<{
    nodes: (KBNode & { ancestors: KBNode[]; full_path: string; full_path_vi: string })[];
    context_text: string;
    context_text_vi: string;
  }> {
    return this.http.post<any>(`${this.apiUrl}/context`, { node_ids: nodeIds });
  }
}
