from flask import Blueprint, request, jsonify, current_app
from datetime import datetime, timezone
from bson import ObjectId
from utils.auth_middleware import token_required

categories_bp = Blueprint('categories', __name__)


def serialize_category(cat):
    return {
        'id': str(cat['_id']),
        'project_id': str(cat['project_id']),
        'name': cat['name'],
        'description': cat.get('description', ''),
        'color': cat.get('color', '#3b82f6'),
        'created_at': cat['created_at'].isoformat()
    }


@categories_bp.route('/project/<project_id>', methods=['GET'])
@token_required
def get_project_categories(project_id):
    """Get all categories for a project."""
    try:
        categories = list(current_app.db.categories.find(
            {'project_id': ObjectId(project_id)}
        ).sort('name', 1))
    except Exception:
        return jsonify({'error': 'Invalid project ID'}), 400

    return jsonify([serialize_category(c) for c in categories])


@categories_bp.route('/project/<project_id>', methods=['POST'])
@token_required
def create_category(project_id):
    """Create a new category for a project."""
    data = request.get_json()
    if not data or not data.get('name'):
        return jsonify({'error': 'Category name is required'}), 400

    try:
        project = current_app.db.projects.find_one({'_id': ObjectId(project_id)})
    except Exception:
        return jsonify({'error': 'Invalid project ID'}), 400

    if not project:
        return jsonify({'error': 'Project not found'}), 404

    # Check for duplicate name within project
    existing = current_app.db.categories.find_one({
        'project_id': ObjectId(project_id),
        'name': data['name']
    })
    if existing:
        return jsonify({'error': 'Category with this name already exists in this project'}), 409

    category = {
        'project_id': ObjectId(project_id),
        'name': data['name'],
        'description': data.get('description', ''),
        'color': data.get('color', '#3b82f6'),
        'created_by': request.current_user['_id'],
        'created_at': datetime.now(timezone.utc)
    }

    result = current_app.db.categories.insert_one(category)
    category['_id'] = result.inserted_id

    return jsonify(serialize_category(category)), 201


@categories_bp.route('/<category_id>', methods=['PUT'])
@token_required
def update_category(category_id):
    """Update a category."""
    data = request.get_json()
    try:
        cat = current_app.db.categories.find_one({'_id': ObjectId(category_id)})
    except Exception:
        return jsonify({'error': 'Invalid category ID'}), 400

    if not cat:
        return jsonify({'error': 'Category not found'}), 404

    update_fields = {}
    if 'name' in data:
        existing = current_app.db.categories.find_one({
            'project_id': cat['project_id'],
            'name': data['name'],
            '_id': {'$ne': ObjectId(category_id)}
        })
        if existing:
            return jsonify({'error': 'Category with this name already exists'}), 409
        update_fields['name'] = data['name']
    if 'description' in data:
        update_fields['description'] = data['description']
    if 'color' in data:
        update_fields['color'] = data['color']

    if update_fields:
        current_app.db.categories.update_one(
            {'_id': ObjectId(category_id)},
            {'$set': update_fields}
        )

    updated = current_app.db.categories.find_one({'_id': ObjectId(category_id)})
    return jsonify(serialize_category(updated))


@categories_bp.route('/<category_id>', methods=['DELETE'])
@token_required
def delete_category(category_id):
    """Delete a category. Regions using it will have their category cleared."""
    try:
        result = current_app.db.categories.delete_one({'_id': ObjectId(category_id)})
    except Exception:
        return jsonify({'error': 'Invalid category ID'}), 400

    if result.deleted_count == 0:
        return jsonify({'error': 'Category not found'}), 404

    # Clear category from regions that reference it
    current_app.db.object_regions.update_many(
        {'category_id': ObjectId(category_id)},
        {'$set': {'category_id': None, 'category_name': ''}}
    )

    return jsonify({'message': 'Category deleted successfully'})
