from flask import Blueprint, request, jsonify, current_app
from datetime import datetime, timezone
from bson import ObjectId
from utils.auth_middleware import token_required

projects_bp = Blueprint('projects', __name__)


def serialize_project(project):
    return {
        'id': str(project['_id']),
        'name': project['name'],
        'description': project.get('description', ''),
        'status': project.get('status', 'active'),
        'created_by': str(project['created_by']),
        'created_at': project['created_at'].isoformat(),
        'updated_at': project.get('updated_at', project['created_at']).isoformat()
    }


def serialize_subpart(subpart):
    return {
        'id': str(subpart['_id']),
        'project_id': str(subpart['project_id']),
        'name': subpart['name'],
        'description': subpart.get('description', ''),
        'assigned_users': [str(uid) for uid in subpart.get('assigned_users', [])],
        'reviewer': str(subpart['reviewer']) if subpart.get('reviewer') else None,
        'order': subpart.get('order', 0),
        'status': subpart.get('status', 'pending'),
        'created_at': subpart['created_at'].isoformat()
    }


# ============ PROJECT ROUTES ============

@projects_bp.route('', methods=['POST'])
@token_required
def create_project():
    data = request.get_json()
    if not data or not data.get('name'):
        return jsonify({'error': 'Project name is required'}), 400

    project = {
        'name': data['name'],
        'description': data.get('description', ''),
        'status': 'active',
        'created_by': request.current_user['_id'],
        'created_at': datetime.now(timezone.utc),
        'updated_at': datetime.now(timezone.utc)
    }

    result = current_app.db.projects.insert_one(project)
    project['_id'] = result.inserted_id

    return jsonify(serialize_project(project)), 201


@projects_bp.route('', methods=['GET'])
@token_required
def get_projects():
    user_id = request.current_user['_id']
    role = request.current_user.get('role', 'annotator')

    if role == 'admin':
        projects = list(current_app.db.projects.find())
    else:
        # Get projects where user is creator, assigned to a subpart, or reviewer
        assigned_subparts = current_app.db.subparts.find({
            '$or': [
                {'assigned_users': user_id},
                {'reviewer': user_id}
            ]
        })
        assigned_project_ids = list(set(s['project_id'] for s in assigned_subparts))

        projects = list(current_app.db.projects.find({
            '$or': [
                {'created_by': user_id},
                {'_id': {'$in': assigned_project_ids}}
            ]
        }))

    result = []
    for p in projects:
        proj_data = serialize_project(p)
        # Count subparts and videos
        proj_data['subpart_count'] = current_app.db.subparts.count_documents({'project_id': p['_id']})
        proj_data['video_count'] = current_app.db.videos.count_documents({'project_id': p['_id']})
        # Get creator info
        creator = current_app.db.users.find_one({'_id': p['created_by']}, {'password_hash': 0})
        if creator:
            proj_data['creator_name'] = creator.get('full_name') or creator['username']
        result.append(proj_data)

    return jsonify(result)


@projects_bp.route('/<project_id>', methods=['GET'])
@token_required
def get_project(project_id):
    try:
        project = current_app.db.projects.find_one({'_id': ObjectId(project_id)})
    except Exception:
        return jsonify({'error': 'Invalid project ID'}), 400

    if not project:
        return jsonify({'error': 'Project not found'}), 404

    proj_data = serialize_project(project)

    # Get subparts with user details (sorted by created_at descending - newest first)
    subparts = list(current_app.db.subparts.find({'project_id': ObjectId(project_id)}).sort('created_at', -1))
    proj_data['subparts'] = []
    for sp in subparts:
        sp_data = serialize_subpart(sp)
        # Get assigned user details
        sp_data['assigned_user_details'] = []
        for uid in sp.get('assigned_users', []):
            user = current_app.db.users.find_one({'_id': uid}, {'password_hash': 0})
            if user:
                sp_data['assigned_user_details'].append({
                    'id': str(user['_id']),
                    'username': user['username'],
                    'full_name': user.get('full_name', ''),
                    'avatar_color': user.get('avatar_color', '#4A90D9')
                })
        sp_data['video_count'] = current_app.db.videos.count_documents({'subpart_id': ObjectId(sp['_id'])})
        # Get reviewer details
        if sp.get('reviewer'):
            reviewer = current_app.db.users.find_one({'_id': sp['reviewer']}, {'password_hash': 0})
            if reviewer:
                sp_data['reviewer_details'] = {
                    'id': str(reviewer['_id']),
                    'username': reviewer['username'],
                    'full_name': reviewer.get('full_name', ''),
                    'avatar_color': reviewer.get('avatar_color', '#4A90D9')
                }
        proj_data['subparts'].append(sp_data)

    # Get videos
    videos = list(current_app.db.videos.find({'project_id': ObjectId(project_id)}))
    proj_data['videos'] = []
    for v in videos:
        proj_data['videos'].append({
            'id': str(v['_id']),
            'filename': v['filename'],
            'original_name': v['original_name'],
            'duration': v.get('duration', 0),
            'status': v.get('status', 'uploaded'),
            'subpart_id': str(v.get('subpart_id', '')),
            'uploaded_by': str(v['uploaded_by']),
            'created_at': v['created_at'].isoformat()
        })

    return jsonify(proj_data)


@projects_bp.route('/<project_id>', methods=['PUT'])
@token_required
def update_project(project_id):
    data = request.get_json()
    try:
        project = current_app.db.projects.find_one({'_id': ObjectId(project_id)})
    except Exception:
        return jsonify({'error': 'Invalid project ID'}), 400

    if not project:
        return jsonify({'error': 'Project not found'}), 404

    update_fields = {}
    if 'name' in data:
        update_fields['name'] = data['name']
    if 'description' in data:
        update_fields['description'] = data['description']
    if 'status' in data:
        update_fields['status'] = data['status']
    update_fields['updated_at'] = datetime.now(timezone.utc)

    current_app.db.projects.update_one(
        {'_id': ObjectId(project_id)},
        {'$set': update_fields}
    )

    updated = current_app.db.projects.find_one({'_id': ObjectId(project_id)})
    return jsonify(serialize_project(updated))


@projects_bp.route('/<project_id>', methods=['DELETE'])
@token_required
def delete_project(project_id):
    try:
        project = current_app.db.projects.find_one({'_id': ObjectId(project_id)})
    except Exception:
        return jsonify({'error': 'Invalid project ID'}), 400

    if not project:
        return jsonify({'error': 'Project not found'}), 404

    # Delete all related data
    video_ids = [v['_id'] for v in current_app.db.videos.find({'project_id': ObjectId(project_id)})]
    segment_ids = [s['_id'] for s in current_app.db.video_segments.find({'video_id': {'$in': video_ids}})]

    current_app.db.captions.delete_many({'segment_id': {'$in': segment_ids}})
    current_app.db.object_regions.delete_many({'segment_id': {'$in': segment_ids}})
    current_app.db.video_segments.delete_many({'video_id': {'$in': video_ids}})
    current_app.db.videos.delete_many({'project_id': ObjectId(project_id)})
    current_app.db.subparts.delete_many({'project_id': ObjectId(project_id)})
    current_app.db.projects.delete_one({'_id': ObjectId(project_id)})

    return jsonify({'message': 'Project deleted successfully'})


# ============ SUBPART ROUTES ============

@projects_bp.route('/<project_id>/subparts', methods=['POST'])
@token_required
def create_subpart(project_id):
    data = request.get_json()
    if not data or not data.get('name'):
        return jsonify({'error': 'Subpart name is required'}), 400

    try:
        project = current_app.db.projects.find_one({'_id': ObjectId(project_id)})
    except Exception:
        return jsonify({'error': 'Invalid project ID'}), 400

    if not project:
        return jsonify({'error': 'Project not found'}), 404

    # Get next order
    max_order = current_app.db.subparts.find_one(
        {'project_id': ObjectId(project_id)},
        sort=[('order', -1)]
    )
    next_order = (max_order['order'] + 1) if max_order else 0

    assigned_users = []
    for uid in data.get('assigned_users', []):
        try:
            assigned_users.append(ObjectId(uid))
        except Exception:
            pass

    subpart = {
        'project_id': ObjectId(project_id),
        'name': data['name'],
        'description': data.get('description', ''),
        'assigned_users': assigned_users,
        'reviewer': ObjectId(data['reviewer']) if data.get('reviewer') else None,
        'order': next_order,
        'status': 'pending',
        'created_at': datetime.now(timezone.utc),
        'updated_at': datetime.now(timezone.utc)
    }

    result = current_app.db.subparts.insert_one(subpart)
    subpart['_id'] = result.inserted_id

    return jsonify(serialize_subpart(subpart)), 201


@projects_bp.route('/<project_id>/subparts/<subpart_id>', methods=['PUT'])
@token_required
def update_subpart(project_id, subpart_id):
    data = request.get_json()

    try:
        subpart = current_app.db.subparts.find_one({
            '_id': ObjectId(subpart_id),
            'project_id': ObjectId(project_id)
        })
    except Exception:
        return jsonify({'error': 'Invalid ID'}), 400

    if not subpart:
        return jsonify({'error': 'Subpart not found'}), 404

    update_fields = {}
    if 'name' in data:
        update_fields['name'] = data['name']
    if 'description' in data:
        update_fields['description'] = data['description']
    if 'status' in data:
        update_fields['status'] = data['status']
    if 'assigned_users' in data:
        update_fields['assigned_users'] = [ObjectId(uid) for uid in data['assigned_users']]
    if 'reviewer' in data:
        update_fields['reviewer'] = ObjectId(data['reviewer']) if data['reviewer'] else None
    if 'order' in data:
        update_fields['order'] = data['order']
    update_fields['updated_at'] = datetime.now(timezone.utc)

    current_app.db.subparts.update_one(
        {'_id': ObjectId(subpart_id)},
        {'$set': update_fields}
    )

    updated = current_app.db.subparts.find_one({'_id': ObjectId(subpart_id)})
    return jsonify(serialize_subpart(updated))


@projects_bp.route('/<project_id>/subparts/<subpart_id>', methods=['DELETE'])
@token_required
def delete_subpart(project_id, subpart_id):
    try:
        result = current_app.db.subparts.delete_one({
            '_id': ObjectId(subpart_id),
            'project_id': ObjectId(project_id)
        })
    except Exception:
        return jsonify({'error': 'Invalid ID'}), 400

    if result.deleted_count == 0:
        return jsonify({'error': 'Subpart not found'}), 404

    # Update videos that belonged to this subpart
    current_app.db.videos.update_many(
        {'subpart_id': ObjectId(subpart_id)},
        {'$unset': {'subpart_id': ''}}
    )

    return jsonify({'message': 'Subpart deleted successfully'})
