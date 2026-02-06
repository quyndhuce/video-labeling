from flask import Blueprint, request, jsonify, current_app
from datetime import datetime, timezone
from bson import ObjectId
from utils.auth_middleware import token_required

tags_bp = Blueprint('tags', __name__)


def serialize_tag(tag):
    return {
        'id': str(tag['_id']),
        'project_id': str(tag['project_id']),
        'name': tag['name'],
        'color': tag.get('color', '#3b82f6'),
        'created_at': tag['created_at'].isoformat()
    }


@tags_bp.route('/project/<project_id>', methods=['GET'])
@token_required
def get_project_tags(project_id):
    """Get all tags for a project."""
    try:
        tags = list(current_app.db.tags.find({'project_id': ObjectId(project_id)}).sort('name', 1))
    except Exception:
        return jsonify({'error': 'Invalid project ID'}), 400

    return jsonify([serialize_tag(t) for t in tags])


@tags_bp.route('/project/<project_id>', methods=['POST'])
@token_required
def create_tag(project_id):
    """Create a new tag for a project."""
    data = request.get_json()
    if not data or not data.get('name'):
        return jsonify({'error': 'Tag name is required'}), 400

    try:
        project = current_app.db.projects.find_one({'_id': ObjectId(project_id)})
    except Exception:
        return jsonify({'error': 'Invalid project ID'}), 400

    if not project:
        return jsonify({'error': 'Project not found'}), 404

    # Check for duplicate name within project
    existing = current_app.db.tags.find_one({
        'project_id': ObjectId(project_id),
        'name': data['name']
    })
    if existing:
        return jsonify({'error': 'Tag with this name already exists in this project'}), 409

    tag = {
        'project_id': ObjectId(project_id),
        'name': data['name'],
        'color': data.get('color', '#3b82f6'),
        'created_at': datetime.now(timezone.utc)
    }

    result = current_app.db.tags.insert_one(tag)
    tag['_id'] = result.inserted_id

    return jsonify(serialize_tag(tag)), 201


@tags_bp.route('/<tag_id>', methods=['PUT'])
@token_required
def update_tag(tag_id):
    """Update a tag."""
    data = request.get_json()
    try:
        tag = current_app.db.tags.find_one({'_id': ObjectId(tag_id)})
    except Exception:
        return jsonify({'error': 'Invalid tag ID'}), 400

    if not tag:
        return jsonify({'error': 'Tag not found'}), 404

    update_fields = {}
    if 'name' in data:
        # Check for duplicate name within same project
        existing = current_app.db.tags.find_one({
            'project_id': tag['project_id'],
            'name': data['name'],
            '_id': {'$ne': ObjectId(tag_id)}
        })
        if existing:
            return jsonify({'error': 'Tag with this name already exists'}), 409
        update_fields['name'] = data['name']
    if 'color' in data:
        update_fields['color'] = data['color']

    if update_fields:
        current_app.db.tags.update_one({'_id': ObjectId(tag_id)}, {'$set': update_fields})

    updated = current_app.db.tags.find_one({'_id': ObjectId(tag_id)})
    return jsonify(serialize_tag(updated))


@tags_bp.route('/<tag_id>', methods=['DELETE'])
@token_required
def delete_tag(tag_id):
    """Delete a tag and remove it from all videos."""
    try:
        result = current_app.db.tags.delete_one({'_id': ObjectId(tag_id)})
    except Exception:
        return jsonify({'error': 'Invalid tag ID'}), 400

    if result.deleted_count == 0:
        return jsonify({'error': 'Tag not found'}), 404

    # Remove this tag from all videos that reference it
    current_app.db.videos.update_many(
        {'tags': ObjectId(tag_id)},
        {'$pull': {'tags': ObjectId(tag_id)}}
    )

    return jsonify({'message': 'Tag deleted successfully'})
