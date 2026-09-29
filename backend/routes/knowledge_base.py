from flask import Blueprint, request, jsonify, current_app
from bson import ObjectId
from datetime import datetime, timezone
import json
import os
import re
import unicodedata
import uuid
import requests
from utils.auth_middleware import token_required
from config import Config
from utils.vector_store import upsert_embedding, search_embeddings

knowledge_base_bp = Blueprint('knowledge_base', __name__)


def generate_kb_id(name):
    """Generate a unique kb_id from name"""
    if not name:
        return ''

    # Normalize Vietnamese/Unicode to ASCII-friendly slug.
    name = name.replace('đ', 'd').replace('Đ', 'D')
    normalized = unicodedata.normalize('NFKD', name)
    ascii_name = normalized.encode('ascii', 'ignore').decode('ascii')
    ascii_name = ascii_name.lower().strip()
    ascii_name = re.sub(r'\s+', '_', ascii_name)
    kb_id = re.sub(r'[^a-z0-9_]', '', ascii_name)
    kb_id = re.sub(r'_+', '_', kb_id).strip('_')

    if not kb_id:
        kb_id = f"node_{uuid.uuid4().hex[:8]}"

    return kb_id


def generate_unique_kb_id(base_name: str, exclude_node_id=None):
    """Generate a unique kb_id, optionally excluding one existing node id."""
    base_kb_id = generate_kb_id(base_name)
    kb_id = base_kb_id
    i = 2

    while True:
        existing = current_app.db.knowledge_base.find_one({'kb_id': kb_id})
        if not existing:
            return kb_id
        if exclude_node_id and str(existing.get('_id')) == str(exclude_node_id):
            return kb_id
        kb_id = f"{base_kb_id}_{i}"
        i += 1


def _parse_related_ids(data):
    """Accept both related_kb_ids and related_ids from FE and convert to ObjectId list."""
    raw_ids = data.get('related_kb_ids')
    if raw_ids is None:
        raw_ids = data.get('related_ids', [])

    related_ids = []
    for rid in raw_ids or []:
        try:
            related_ids.append(ObjectId(rid))
        except Exception:
            pass
    return related_ids


def serialize_kb_node(node):
    """Serialize a KB node for JSON response"""
    return {
        'id': str(node['_id']),
        'kb_id': node['kb_id'],
        'name': node['name'],
        'name_vi': node.get('name_vi', ''),
        'type': node.get('type', 'concept'),
        'parent_id': str(node['parent_id']) if node.get('parent_id') else None,
        'children_ids': [str(cid) for cid in node.get('children_ids', [])],
        'description': node.get('description', ''),
        'description_vi': node.get('description_vi', ''),
        'description_graph': node.get('description_graph', ''),
        'description_graph_vi': node.get('description_graph_vi', ''),
        'visual_cues': node.get('visual_cues', ''),
        'visual_cues_vi': node.get('visual_cues_vi', ''),
        'region': node.get('region', ''),
        'confidence_level': node.get('confidence_level', 'optional'),
        'related_kb_ids': [str(rid) for rid in node.get('related_kb_ids', [])],
        'related_ids': [str(rid) for rid in node.get('related_kb_ids', [])],
        'tags': node.get('tags', []),
        'facts': node.get('facts', []),
        'created_at': node['created_at'].isoformat() if node.get('created_at') else None,
        'updated_at': node['updated_at'].isoformat() if node.get('updated_at') else None
    }


def get_ancestors(node_id, db):
    """Get all ancestors of a node from root to parent"""
    ancestors = []
    current_id = node_id
    visited = set()
    
    while current_id and str(current_id) not in visited:
        visited.add(str(current_id))
        node = db.knowledge_base.find_one({'_id': ObjectId(current_id) if isinstance(current_id, str) else current_id})
        if not node:
            break
        if node.get('parent_id'):
            parent = db.knowledge_base.find_one({'_id': node['parent_id']})
            if parent:
                ancestors.insert(0, serialize_kb_node(parent))
            current_id = node.get('parent_id')
        else:
            break
    
    return ancestors


def build_tree(nodes, parent_id=None):
    """Build hierarchical tree from flat list of nodes"""
    tree = []
    for node in nodes:
        node_parent = str(node['parent_id']) if node.get('parent_id') else None
        if node_parent == parent_id:
            children = build_tree(nodes, str(node['_id']))
            node_data = serialize_kb_node(node)
            node_data['children'] = children
            tree.append(node_data)
    return tree


# ==================== GET ALL KB NODES ====================
@knowledge_base_bp.route('', methods=['GET'])
@token_required
def get_all_kb_nodes():
    """Get all KB nodes, optionally as tree structure"""
    as_tree = request.args.get('tree', 'false').lower() == 'true'
    search = request.args.get('search', '').strip()
    node_type = request.args.get('type', '').strip()
    
    query = {}
    if search:
        query['$or'] = [
            {'name': {'$regex': search, '$options': 'i'}},
            {'name_vi': {'$regex': search, '$options': 'i'}},
            {'kb_id': {'$regex': search, '$options': 'i'}},
            {'description': {'$regex': search, '$options': 'i'}},
            {'description_vi': {'$regex': search, '$options': 'i'}},
            {'tags': {'$regex': search, '$options': 'i'}}
        ]
    if node_type:
        query['type'] = node_type
    
    nodes = list(current_app.db.knowledge_base.find(query).sort('name', 1))
    
    if as_tree and not search:
        # Return hierarchical structure
        return jsonify(build_tree(nodes, None))
    else:
        # Return flat list
        return jsonify([serialize_kb_node(n) for n in nodes])


# ==================== GET SINGLE KB NODE ====================
@knowledge_base_bp.route('/<node_id>', methods=['GET'])
@token_required
def get_kb_node(node_id):
    """Get a single KB node by ID"""
    try:
        node = current_app.db.knowledge_base.find_one({'_id': ObjectId(node_id)})
    except Exception:
        # Try to find by kb_id
        node = current_app.db.knowledge_base.find_one({'kb_id': node_id})
    
    if not node:
        return jsonify({'error': 'KB node not found'}), 404
    
    return jsonify(serialize_kb_node(node))


# ==================== CREATE KB NODE ====================
@knowledge_base_bp.route('', methods=['POST'])
@token_required
def create_kb_node():
    """Create a new KB node"""
    data = request.get_json()
    
    if not data or not data.get('name'):
        return jsonify({'error': 'Name is required'}), 400
    
    # Generate unique kb_id from name
    kb_id = generate_unique_kb_id(data['name'])
    
    # Handle parent_id
    parent_id = None
    if data.get('parent_id'):
        try:
            parent_id = ObjectId(data['parent_id'])
        except Exception:
            return jsonify({'error': 'Invalid parent_id'}), 400
    
    # Handle related ids (supports both related_kb_ids and related_ids)
    related_kb_ids = _parse_related_ids(data)
    
    node = {
        'kb_id': kb_id,
        'name': data['name'],
        'name_vi': data.get('name_vi', ''),
        'type': data.get('type', 'concept'),
        'parent_id': parent_id,
        'children_ids': [],
        'description': data.get('description', ''),
        'description_vi': data.get('description_vi', ''),
        'description_graph': data.get('description_graph', ''),
        'description_graph_vi': data.get('description_graph_vi', ''),
        'visual_cues': data.get('visual_cues', ''),
        'visual_cues_vi': data.get('visual_cues_vi', ''),
        'region': data.get('region', ''),
        'confidence_level': data.get('confidence_level', 'optional'),
        'related_kb_ids': related_kb_ids,
        'tags': data.get('tags', []),
        'facts': data.get('facts', []),
        'created_at': datetime.now(timezone.utc),
        'updated_at': datetime.now(timezone.utc)
    }
    
    result = current_app.db.knowledge_base.insert_one(node)
    node['_id'] = result.inserted_id
    
    # Update parent's children_ids
    if parent_id:
        current_app.db.knowledge_base.update_one(
            {'_id': parent_id},
            {'$push': {'children_ids': result.inserted_id}}
        )
    
    return jsonify(serialize_kb_node(node)), 201


# ==================== UPDATE KB NODE ====================
@knowledge_base_bp.route('/<node_id>', methods=['PUT'])
@token_required
def update_kb_node(node_id):
    """Update a KB node"""
    try:
        node = current_app.db.knowledge_base.find_one({'_id': ObjectId(node_id)})
    except Exception:
        return jsonify({'error': 'Invalid node ID'}), 400
    
    if not node:
        return jsonify({'error': 'KB node not found'}), 404
    
    data = request.get_json()
    
    update_data = {'updated_at': datetime.now(timezone.utc)}
    
    if 'name' in data and data['name']:
        update_data['name'] = data['name']
        # Update kb_id with uniqueness check (exclude current node)
        update_data['kb_id'] = generate_unique_kb_id(data['name'], exclude_node_id=node_id)

    if 'name_vi' in data:
        update_data['name_vi'] = data['name_vi']
    
    if 'type' in data:
        update_data['type'] = data['type']
    
    if 'description' in data:
        update_data['description'] = data['description']

    if 'description_vi' in data:
        update_data['description_vi'] = data['description_vi']
        
    if 'description_graph' in data:
        update_data['description_graph'] = data['description_graph']

    if 'description_graph_vi' in data:
        update_data['description_graph_vi'] = data['description_graph_vi']
    
    if 'visual_cues' in data:
        update_data['visual_cues'] = data['visual_cues']

    if 'visual_cues_vi' in data:
        update_data['visual_cues_vi'] = data['visual_cues_vi']

    if 'region' in data:
        update_data['region'] = data['region']

    if 'confidence_level' in data:
        update_data['confidence_level'] = data['confidence_level']
    
    if 'tags' in data:
        update_data['tags'] = data['tags']

    if 'facts' in data:
        update_data['facts'] = data['facts']
    
    if 'related_kb_ids' in data or 'related_ids' in data:
        related_ids = _parse_related_ids(data)
        update_data['related_kb_ids'] = related_ids
    
    # Handle parent change
    if 'parent_id' in data:
        old_parent_id = node.get('parent_id')
        new_parent_id = ObjectId(data['parent_id']) if data['parent_id'] else None
        
        if old_parent_id != new_parent_id:
            # Remove from old parent's children
            if old_parent_id:
                current_app.db.knowledge_base.update_one(
                    {'_id': old_parent_id},
                    {'$pull': {'children_ids': node['_id']}}
                )
            
            # Add to new parent's children
            if new_parent_id:
                current_app.db.knowledge_base.update_one(
                    {'_id': new_parent_id},
                    {'$push': {'children_ids': node['_id']}}
                )
            
            update_data['parent_id'] = new_parent_id
    
    try:
        current_app.db.knowledge_base.update_one(
            {'_id': ObjectId(node_id)},
            {'$set': update_data}
        )
    except Exception as e:
        return jsonify({'error': f'Failed to update KB node: {str(e)}'}), 400
    
    updated_node = current_app.db.knowledge_base.find_one({'_id': ObjectId(node_id)})
    return jsonify(serialize_kb_node(updated_node))


# ==================== DELETE KB NODE ====================
@knowledge_base_bp.route('/<node_id>', methods=['DELETE'])
@token_required
def delete_kb_node(node_id):
    """Delete a KB node and optionally its children"""
    try:
        node = current_app.db.knowledge_base.find_one({'_id': ObjectId(node_id)})
    except Exception:
        return jsonify({'error': 'Invalid node ID'}), 400
    
    if not node:
        return jsonify({'error': 'KB node not found'}), 404
    
    recursive = request.args.get('recursive', 'false').lower() == 'true'
    
    def delete_node_and_children(nid):
        """Recursively delete node and its children"""
        n = current_app.db.knowledge_base.find_one({'_id': nid})
        if n:
            for child_id in n.get('children_ids', []):
                delete_node_and_children(child_id)
            current_app.db.knowledge_base.delete_one({'_id': nid})
    
    if recursive:
        delete_node_and_children(ObjectId(node_id))
    else:
        # Move children to parent
        parent_id = node.get('parent_id')
        for child_id in node.get('children_ids', []):
            current_app.db.knowledge_base.update_one(
                {'_id': child_id},
                {'$set': {'parent_id': parent_id}}
            )
            if parent_id:
                current_app.db.knowledge_base.update_one(
                    {'_id': parent_id},
                    {'$push': {'children_ids': child_id}}
                )
        
        current_app.db.knowledge_base.delete_one({'_id': ObjectId(node_id)})
    
    # Remove from parent's children_ids
    if node.get('parent_id'):
        current_app.db.knowledge_base.update_one(
            {'_id': node['parent_id']},
            {'$pull': {'children_ids': ObjectId(node_id)}}
        )
    
    # Remove from any related_kb_ids
    current_app.db.knowledge_base.update_many(
        {'related_kb_ids': ObjectId(node_id)},
        {'$pull': {'related_kb_ids': ObjectId(node_id)}}
    )
    
    return jsonify({'message': 'KB node deleted successfully'})


# ==================== GET KB TYPES ====================
@knowledge_base_bp.route('/types', methods=['GET'])
@token_required
def get_kb_types():
    """Get available KB node types"""
    return jsonify([
        {'value': 'action', 'label': 'Action', 'icon': 'directions_run', 'color': '#10b981'},
        {'value': 'object', 'label': 'Object', 'icon': 'category', 'color': '#3b82f6'},
        {'value': 'concept', 'label': 'Concept', 'icon': 'lightbulb', 'color': '#f59e0b'},
        {'value': 'ritual', 'label': 'Ritual', 'icon': 'auto_awesome', 'color': '#8b5cf6'},
        {'value': 'festival', 'label': 'Festival', 'icon': 'celebration', 'color': '#ec4899'}
    ])


# ==================== QUICK CREATE KB NODE ====================
@knowledge_base_bp.route('/quick', methods=['POST'])
@token_required
def quick_create_kb_node():
    """Quick create a KB node with minimal data"""
    data = request.get_json()
    
    if not data or not data.get('name'):
        return jsonify({'error': 'Name is required'}), 400
    
    kb_id = generate_unique_kb_id(data['name'])
    
    node = {
        'kb_id': kb_id,
        'name': data['name'],
        'name_vi': data.get('name_vi', ''),
        'type': data.get('type', 'concept'),
        'parent_id': None,
        'children_ids': [],
        'description': data.get('description', ''),
        'description_vi': data.get('description_vi', ''),
        'description_graph': data.get('description_graph', ''),
        'description_graph_vi': data.get('description_graph_vi', ''),
        'visual_cues': data.get('visual_cues', ''),
        'visual_cues_vi': data.get('visual_cues_vi', ''),
        'region': data.get('region', ''),
        'confidence_level': data.get('confidence_level', 'optional'),
        'related_kb_ids': [],
        'tags': data.get('tags', []),
        'created_at': datetime.now(timezone.utc),
        'updated_at': datetime.now(timezone.utc)
    }
    
    result = current_app.db.knowledge_base.insert_one(node)
    node['_id'] = result.inserted_id
    
    return jsonify(serialize_kb_node(node)), 201


# ==================== GET FULL CONTEXT FOR KB NODES ====================
@knowledge_base_bp.route('/context', methods=['POST'])
@token_required
def get_kb_context():
    """
    Get full context for a list of KB node IDs.
    Returns each node with its full ancestor chain for complete information.
    Used for generating combined captions with full knowledge context.
    """
    data = request.get_json()
    node_ids = data.get('node_ids', [])
    language = data.get('language', 'en')  # 'en' or 'vi'
    
    if not node_ids:
        return jsonify({'nodes': [], 'context_text': '', 'context_text_vi': ''})
    
    results = []
    context_parts_en = []
    context_parts_vi = []
    
    for node_id in node_ids:
        try:
            node = current_app.db.knowledge_base.find_one({'_id': ObjectId(node_id)})
        except Exception:
            continue
            
        if not node:
            continue
        
        node_data = serialize_kb_node(node)
        
        # Get ancestors (from root to parent)
        ancestors = get_ancestors(node_id, current_app.db)
        node_data['ancestors'] = ancestors
        
        # Build full path name
        path_names_en = [a['name'] for a in ancestors] + [node['name']]
        path_names_vi = [a.get('name_vi') or a['name'] for a in ancestors] + [node.get('name_vi') or node['name']]
        node_data['full_path'] = ' > '.join(path_names_en)
        node_data['full_path_vi'] = ' > '.join(path_names_vi)
        
        results.append(node_data)
        
        # Build context text for caption generation
        # Collect descriptions from ancestors down to current node
        context_en = []
        context_vi = []
        
        for ancestor in ancestors:
            if ancestor.get('description'):
                context_en.append(f"{ancestor['name']}: {ancestor['description']}")
            if ancestor.get('description_vi') or ancestor.get('description'):
                vi_desc = ancestor.get('description_vi') or ancestor.get('description', '')
                vi_name = ancestor.get('name_vi') or ancestor['name']
                context_vi.append(f"{vi_name}: {vi_desc}")
        
        # Add current node's full info
        node_context_en = node['name']
        if node.get('description'):
            node_context_en += f": {node['description']}"
        if node.get('visual_cues'):
            node_context_en += f" (Visual cues: {node['visual_cues']})"
        context_en.append(node_context_en)
        
        node_context_vi = node.get('name_vi') or node['name']
        if node.get('description_vi') or node.get('description'):
            node_context_vi += f": {node.get('description_vi') or node.get('description', '')}"
        if node.get('visual_cues_vi') or node.get('visual_cues'):
            node_context_vi += f" (Đặc điểm nhận dạng: {node.get('visual_cues_vi') or node.get('visual_cues', '')})"
        context_vi.append(node_context_vi)
        
        context_parts_en.append(' → '.join(context_en))
        context_parts_vi.append(' → '.join(context_vi))
    
    return jsonify({
        'nodes': results,
        'context_text': '\n'.join(context_parts_en),
        'context_text_vi': '\n'.join(context_parts_vi)
    })


# ==================== KB NODE INDEXING ====================

@knowledge_base_bp.route('/<node_id>/index', methods=['POST'])
@token_required
def index_kb_node(node_id):
    """
    Index a KB node with its representative image using DINOv2 embeddings.
    """
    try:
        node = current_app.db.knowledge_base.find_one({'_id': ObjectId(node_id)})
    except Exception:
        return jsonify({'error': 'Invalid node ID'}), 400

    if not node:
        return jsonify({'error': 'KB node not found'}), 404

    data = request.get_json() or {}
    image_base64 = data.get('image')  # Representative image for this KB node
    
    if not image_base64:
        return jsonify({'error': 'image required - provide a representative image for this KB node'}), 400

    try:
        response = requests.post(
            f"{Config.DAM_SERVER_URL}/embed",
            json={'image': image_base64, 'entity_id': str(node_id), 'entity_type': 'kb_node'},
            timeout=60,
        )
        if response.status_code != 200:
            return jsonify({'error': f'Embedding failed: {response.text}'}), 500

        emb = response.json().get('embedding')
        if not emb:
            return jsonify({'error': 'Embedding payload missing'}), 500
        faiss_idx = upsert_embedding(
            current_app.db,
            str(node_id),
            'kb_node',
            emb,
            {
                'name': node.get('name', ''),
                'description': node.get('description', ''),
                'visual_cues': node.get('visual_cues', ''),
                'type': node.get('type', 'concept'),
            },
        )
        
        # Update node with indexing info
        current_app.db.knowledge_base.update_one(
            {'_id': ObjectId(node_id)},
            {
                '$set': {
                    'indexed': True,
                    'indexed_at': datetime.now(timezone.utc),
                    'updated_at': datetime.now(timezone.utc)
                }
            }
        )
        
        return jsonify({
            'success': True,
            'node_id': node_id,
            'faiss_idx': faiss_idx
        })
        
    except Exception as e:
        import traceback
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500


@knowledge_base_bp.route('/index/batch', methods=['POST'])
@token_required
def batch_index_kb_nodes():
    """
    Batch index multiple KB nodes with their images.
    Request body: {nodes: [{id: string, image: base64_string}]}
    """
    data = request.get_json()
    nodes = data.get('nodes', [])
    
    if not nodes:
        return jsonify({'error': 'nodes array required'}), 400
    
    results = []
    
    for node_data in nodes:
        node_id = node_data.get('id')
        image_base64 = node_data.get('image')
        
        if not node_id or not image_base64:
            results.append({
                'node_id': node_id,
                'success': False,
                'error': 'id and image required'
            })
            continue
        
        try:
            node = current_app.db.knowledge_base.find_one({'_id': ObjectId(node_id)})
            if not node:
                results.append({
                    'node_id': node_id,
                    'success': False,
                    'error': 'Node not found'
                })
                continue
            
            response = requests.post(
                f"{Config.DAM_SERVER_URL}/embed",
                json={'image': image_base64, 'entity_id': str(node_id), 'entity_type': 'kb_node'},
                timeout=60,
            )

            if response.status_code == 200:
                emb = response.json().get('embedding')
                if not emb:
                    results.append({'node_id': node_id, 'success': False, 'error': 'Embedding payload missing'})
                    continue
                upsert_embedding(
                    current_app.db,
                    str(node_id),
                    'kb_node',
                    emb,
                    {
                        'name': node.get('name', ''),
                        'description': node.get('description', ''),
                        'visual_cues': node.get('visual_cues', ''),
                        'type': node.get('type', 'concept'),
                    },
                )
                current_app.db.knowledge_base.update_one(
                    {'_id': ObjectId(node_id)},
                    {
                        '$set': {
                            'indexed': True,
                            'indexed_at': datetime.now(timezone.utc)
                        }
                    }
                )
                results.append({
                    'node_id': node_id,
                    'success': True
                })
            else:
                results.append({
                    'node_id': node_id,
                    'success': False,
                    'error': response.text
                })
                
        except Exception as e:
            results.append({
                'node_id': node_id,
                'success': False,
                'error': str(e)
            })
    
    return jsonify({
        'results': results,
        'total': len(results),
        'success_count': sum(1 for r in results if r.get('success'))
    })


@knowledge_base_bp.route('/search/visual', methods=['POST'])
@token_required
def search_kb_visual():
    """
    Search KB nodes using visual similarity (DINOv2 embeddings).
    """
    data = request.get_json()
    if not data or not data.get('query_image'):
        return jsonify({'error': 'query_image required'}), 400
    
    try:
        response = requests.post(
            f"{Config.DAM_SERVER_URL}/embed",
            json={
                'image': data['query_image'],
                'mask': data.get('query_mask'),
            },
            timeout=60
        )
        if response.status_code != 200:
            return jsonify({'error': f'Embedding failed: {response.text}'}), 500

        emb = response.json().get('embedding')
        search_results = {
            'results': search_embeddings(
                current_app.db,
                emb,
                top_k=data.get('top_k', 10),
                entity_types=['kb_node'],
            )
        }
        
        # Enrich results with KB node details
        enriched_results = []
        for result in search_results.get('results', []):
            try:
                node = current_app.db.knowledge_base.find_one({'_id': ObjectId(result['entity_id'])})
                if node:
                    enriched_results.append({
                        'node': serialize_kb_node(node),
                        'score': result['score'],
                        'ancestors': get_ancestors(node['_id'], current_app.db)
                    })
            except Exception:
                pass
        
        return jsonify({
            'results': enriched_results,
            'total': len(enriched_results)
        })
        
    except Exception as e:
        import traceback
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500


# ==================== EXTRACT FACTS ====================
import subprocess
import sys


@knowledge_base_bp.route('/extract-facts', methods=['POST'])
@token_required
def extract_facts():
    """Extract facts from node description text using FKGFactExtractor in an isolated subprocess."""
    data = request.get_json() or {}
    text = data.get('text', '').strip()
    subject_hint = data.get('subject_hint', '').strip() or None

    if not text:
        return jsonify({'facts': []})

    try:
        cli_path = os.path.join(Config.BASE_DIR, 'utils', 'extract_facts_cli.py')
        payload = json.dumps({'text': text, 'subject_hint': subject_hint})

        proc = subprocess.run(
            [sys.executable, cli_path],
            input=payload,
            text=True,
            capture_output=True,
            timeout=60
        )

        if proc.returncode != 0:
            print("[extract_facts] Subprocess stderr:", proc.stderr)
            return jsonify({'error': 'Fact extraction process failed', 'details': proc.stderr}), 500

        result = json.loads(proc.stdout)
        if 'error' in result:
            return jsonify({'error': result['error']}), 500

        return jsonify({'facts': result.get('facts', [])})
    except Exception as e:
        import traceback
        traceback.print_exc()
        return jsonify({'error': f'Fact extraction failed: {str(e)}'}), 500


