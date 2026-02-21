from flask import Blueprint, request, jsonify, current_app
from bson import ObjectId
from datetime import datetime, timezone
import re
from utils.auth_middleware import token_required

knowledge_base_bp = Blueprint('knowledge_base', __name__)


def generate_kb_id(name):
    """Generate a unique kb_id from name"""
    # Convert to lowercase, replace spaces with underscores, remove special chars
    kb_id = re.sub(r'[^a-z0-9_]', '', name.lower().replace(' ', '_'))
    return kb_id


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
        'visual_cues': node.get('visual_cues', ''),
        'visual_cues_vi': node.get('visual_cues_vi', ''),
        'related_kb_ids': [str(rid) for rid in node.get('related_kb_ids', [])],
        'tags': node.get('tags', []),
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
            {'kb_id': {'$regex': search, '$options': 'i'}},
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
    
    # Generate kb_id from name
    kb_id = generate_kb_id(data['name'])
    
    # Check if kb_id already exists
    existing = current_app.db.knowledge_base.find_one({'kb_id': kb_id})
    if existing:
        # Append a number to make it unique
        count = current_app.db.knowledge_base.count_documents({'kb_id': {'$regex': f'^{kb_id}'}})
        kb_id = f"{kb_id}_{count + 1}"
    
    # Handle parent_id
    parent_id = None
    if data.get('parent_id'):
        try:
            parent_id = ObjectId(data['parent_id'])
        except Exception:
            return jsonify({'error': 'Invalid parent_id'}), 400
    
    # Handle related_kb_ids
    related_kb_ids = []
    for rid in data.get('related_kb_ids', []):
        try:
            related_kb_ids.append(ObjectId(rid))
        except Exception:
            pass
    
    node = {
        'kb_id': kb_id,
        'name': data['name'],
        'type': data.get('type', 'concept'),
        'parent_id': parent_id,
        'children_ids': [],
        'description': data.get('description', ''),
        'visual_cues': data.get('visual_cues', ''),
        'related_kb_ids': related_kb_ids,
        'tags': data.get('tags', []),
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
    
    if 'name' in data:
        update_data['name'] = data['name']
        # Update kb_id based on new name
        update_data['kb_id'] = generate_kb_id(data['name'])
    
    if 'type' in data:
        update_data['type'] = data['type']
    
    if 'description' in data:
        update_data['description'] = data['description']
    
    if 'visual_cues' in data:
        update_data['visual_cues'] = data['visual_cues']
    
    if 'tags' in data:
        update_data['tags'] = data['tags']
    
    if 'related_kb_ids' in data:
        related_ids = []
        for rid in data['related_kb_ids']:
            try:
                related_ids.append(ObjectId(rid))
            except Exception:
                pass
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
    
    current_app.db.knowledge_base.update_one(
        {'_id': ObjectId(node_id)},
        {'$set': update_data}
    )
    
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
    
    kb_id = generate_kb_id(data['name'])
    
    # Check if kb_id already exists
    existing = current_app.db.knowledge_base.find_one({'kb_id': kb_id})
    if existing:
        count = current_app.db.knowledge_base.count_documents({'kb_id': {'$regex': f'^{kb_id}'}})
        kb_id = f"{kb_id}_{count + 1}"
    
    node = {
        'kb_id': kb_id,
        'name': data['name'],
        'type': data.get('type', 'concept'),
        'parent_id': None,
        'children_ids': [],
        'description': data.get('description', ''),
        'visual_cues': data.get('visual_cues', ''),
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
