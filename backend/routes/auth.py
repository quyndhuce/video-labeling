from flask import Blueprint, request, jsonify, current_app
import bcrypt
import jwt
from datetime import datetime, timedelta, timezone
from bson import ObjectId
from config import Config
from utils.auth_middleware import token_required

auth_bp = Blueprint('auth', __name__)


@auth_bp.route('/register', methods=['POST'])
def register():
    data = request.get_json()

    if not data or not data.get('username') or not data.get('email') or not data.get('password'):
        return jsonify({'error': 'Missing required fields: username, email, password'}), 400

    # Check if user already exists
    existing = current_app.db.users.find_one({
        '$or': [
            {'username': data['username']},
            {'email': data['email']}
        ]
    })
    if existing:
        return jsonify({'error': 'Username or email already exists'}), 409

    password_hash = bcrypt.hashpw(data['password'].encode('utf-8'), bcrypt.gensalt())

    user = {
        'username': data['username'],
        'email': data['email'],
        'password_hash': password_hash,
        'full_name': data.get('full_name', ''),
        'role': data.get('role', 'annotator'),
        'avatar_color': data.get('avatar_color', '#4A90D9'),
        'created_at': datetime.now(timezone.utc),
        'updated_at': datetime.now(timezone.utc)
    }

    result = current_app.db.users.insert_one(user)

    token = jwt.encode({
        'user_id': str(result.inserted_id),
        'exp': datetime.now(timezone.utc) + timedelta(hours=Config.JWT_EXPIRATION_HOURS)
    }, Config.SECRET_KEY, algorithm='HS256')

    return jsonify({
        'token': token,
        'user': {
            'id': str(result.inserted_id),
            'username': user['username'],
            'email': user['email'],
            'full_name': user['full_name'],
            'role': user['role'],
            'avatar_color': user['avatar_color']
        }
    }), 201


@auth_bp.route('/login', methods=['POST'])
def login():
    data = request.get_json()

    if not data or not data.get('username') or not data.get('password'):
        return jsonify({'error': 'Missing credentials'}), 400

    user = current_app.db.users.find_one({'username': data['username']})

    if not user or not bcrypt.checkpw(data['password'].encode('utf-8'), user['password_hash']):
        return jsonify({'error': 'Invalid username or password'}), 401

    token = jwt.encode({
        'user_id': str(user['_id']),
        'exp': datetime.now(timezone.utc) + timedelta(hours=Config.JWT_EXPIRATION_HOURS)
    }, Config.SECRET_KEY, algorithm='HS256')

    return jsonify({
        'token': token,
        'user': {
            'id': str(user['_id']),
            'username': user['username'],
            'email': user['email'],
            'full_name': user.get('full_name', ''),
            'role': user.get('role', 'annotator'),
            'avatar_color': user.get('avatar_color', '#4A90D9')
        }
    })


@auth_bp.route('/profile', methods=['GET'])
@token_required
def get_profile():
    user = request.current_user
    return jsonify({
        'id': str(user['_id']),
        'username': user['username'],
        'email': user['email'],
        'full_name': user.get('full_name', ''),
        'role': user.get('role', 'annotator'),
        'avatar_color': user.get('avatar_color', '#4A90D9')
    })


@auth_bp.route('/profile', methods=['PUT'])
@token_required
def update_profile():
    data = request.get_json()
    user = request.current_user
    update_fields = {}

    if 'full_name' in data:
        update_fields['full_name'] = data['full_name']
    if 'email' in data:
        update_fields['email'] = data['email']
    if 'avatar_color' in data:
        update_fields['avatar_color'] = data['avatar_color']

    update_fields['updated_at'] = datetime.now(timezone.utc)

    current_app.db.users.update_one(
        {'_id': user['_id']},
        {'$set': update_fields}
    )

    updated_user = current_app.db.users.find_one({'_id': user['_id']})
    return jsonify({
        'id': str(updated_user['_id']),
        'username': updated_user['username'],
        'email': updated_user['email'],
        'full_name': updated_user.get('full_name', ''),
        'role': updated_user.get('role', 'annotator'),
        'avatar_color': updated_user.get('avatar_color', '#4A90D9')
    })


@auth_bp.route('/users', methods=['GET'])
@token_required
def get_users():
    users = current_app.db.users.find({}, {'password_hash': 0})
    result = []
    for user in users:
        result.append({
            'id': str(user['_id']),
            'username': user['username'],
            'email': user['email'],
            'full_name': user.get('full_name', ''),
            'role': user.get('role', 'annotator'),
            'avatar_color': user.get('avatar_color', '#4A90D9')
        })
    return jsonify(result)
