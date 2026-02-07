from flask import Blueprint, request, jsonify, current_app
from config import Config
from utils.auth_middleware import token_required
import requests as http_requests

settings_bp = Blueprint('settings', __name__)


def get_dam_url():
    """Get DAM server URL from DB settings, fallback to Config."""
    try:
        doc = current_app.db.settings.find_one({'key': 'dam_server_url'})
        if doc and doc.get('value'):
            return doc['value'].rstrip('/')
    except Exception:
        pass
    return Config.DAM_SERVER_URL.rstrip('/')


@settings_bp.route('/dam-url', methods=['GET'])
@token_required
def get_dam_server_url():
    """Get current DAM server URL"""
    url = get_dam_url()
    return jsonify({'dam_server_url': url})


@settings_bp.route('/dam-url', methods=['PUT'])
@token_required
def set_dam_server_url():
    """Update DAM server URL"""
    data = request.get_json()
    url = data.get('dam_server_url', '').strip().rstrip('/')

    if not url:
        return jsonify({'error': 'URL is required'}), 400

    current_app.db.settings.update_one(
        {'key': 'dam_server_url'},
        {'$set': {'key': 'dam_server_url', 'value': url}},
        upsert=True
    )

    return jsonify({'dam_server_url': url, 'message': 'DAM server URL updated'})


@settings_bp.route('/dam-url/test', methods=['POST'])
@token_required
def test_dam_connection():
    """Test connection to DAM server"""
    data = request.get_json()
    url = (data.get('dam_server_url') or get_dam_url()).strip().rstrip('/')

    try:
        resp = http_requests.get(f"{url}/health", timeout=5)
        if resp.status_code == 200:
            return jsonify({'status': 'ok', 'message': f'Connected to {url}', 'details': resp.json()})
        else:
            return jsonify({'status': 'error', 'message': f'Server responded with status {resp.status_code}'}), 502
    except http_requests.exceptions.ConnectionError:
        return jsonify({'status': 'error', 'message': f'Cannot connect to {url}'}), 502
    except http_requests.exceptions.Timeout:
        return jsonify({'status': 'error', 'message': f'Connection timed out to {url}'}), 504
    except Exception as e:
        return jsonify({'status': 'error', 'message': str(e)}), 500
