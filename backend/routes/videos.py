import os
import uuid
from flask import Blueprint, request, jsonify, current_app
from datetime import datetime, timezone
from bson import ObjectId
from werkzeug.utils import secure_filename
from config import Config
from utils.auth_middleware import token_required

videos_bp = Blueprint('videos', __name__)

ALLOWED_EXTENSIONS = {'mp4', 'avi', 'mov', 'mkv', 'webm'}


def allowed_file(filename):
    return '.' in filename and filename.rsplit('.', 1)[1].lower() in ALLOWED_EXTENSIONS


@videos_bp.route('/upload', methods=['POST'])
@token_required
def upload_video():
    if 'video' not in request.files:
        return jsonify({'error': 'No video file provided'}), 400

    file = request.files['video']
    project_id = request.form.get('project_id')
    subpart_id = request.form.get('subpart_id')

    if not project_id:
        return jsonify({'error': 'Project ID is required'}), 400

    if file.filename == '':
        return jsonify({'error': 'No file selected'}), 400

    if not allowed_file(file.filename):
        return jsonify({'error': f'File type not allowed. Allowed: {", ".join(ALLOWED_EXTENSIONS)}'}), 400

    # Verify project exists
    try:
        project = current_app.db.projects.find_one({'_id': ObjectId(project_id)})
    except Exception:
        return jsonify({'error': 'Invalid project ID'}), 400

    if not project:
        return jsonify({'error': 'Project not found'}), 404

    # Generate unique filename
    original_name = secure_filename(file.filename)
    ext = original_name.rsplit('.', 1)[1].lower()
    unique_filename = f"{uuid.uuid4().hex}.{ext}"

    # Save file
    filepath = os.path.join(Config.UPLOAD_FOLDER, 'videos', unique_filename)
    file.save(filepath)

    # Handle thumbnail
    thumbnail_filename = ''
    if 'thumbnail' in request.files:
        thumb_file = request.files['thumbnail']
        thumb_name = f"{uuid.uuid4().hex}.jpg"
        thumb_dir = os.path.join(Config.UPLOAD_FOLDER, 'thumbnails')
        os.makedirs(thumb_dir, exist_ok=True)
        thumb_file.save(os.path.join(thumb_dir, thumb_name))
        thumbnail_filename = thumb_name

    # Get file size
    file_size = os.path.getsize(filepath)

    video_doc = {
        'project_id': ObjectId(project_id),
        'subpart_id': ObjectId(subpart_id) if subpart_id else None,
        'filename': unique_filename,
        'original_name': original_name,
        'file_path': filepath,
        'file_size': file_size,
        'thumbnail': thumbnail_filename,
        'duration': float(request.form.get('duration', 0)),
        'width': int(request.form.get('width', 0)),
        'height': int(request.form.get('height', 0)),
        'status': 'uploaded',
        'current_step': 1,
        'annotators': [],
        'uploaded_by': request.current_user['_id'],
        'created_at': datetime.now(timezone.utc),
        'updated_at': datetime.now(timezone.utc)
    }

    result = current_app.db.videos.insert_one(video_doc)

    return jsonify({
        'id': str(result.inserted_id),
        'filename': unique_filename,
        'original_name': original_name,
        'file_size': file_size,
        'url': f'/uploads/videos/{unique_filename}',
        'thumbnail_url': f'/uploads/thumbnails/{thumbnail_filename}' if thumbnail_filename else '',
        'status': 'uploaded',
        'message': 'Video uploaded successfully'
    }), 201


def _build_video_stats(db, video):
    """Build video dict with annotation statistics."""
    vid = video['_id']
    segments = list(db.video_segments.find({'video_id': vid}))
    segments_count = len(segments)
    segment_ids = [s['_id'] for s in segments]

    objects_count = db.object_regions.count_documents({'segment_id': {'$in': segment_ids}}) if segment_ids else 0
    captions_count = db.captions.count_documents({'segment_id': {'$in': segment_ids}}) if segment_ids else 0

    thumb = video.get('thumbnail', '')
    # Resolve tag names
    video_tags = video.get('tags', [])
    tag_ids = []
    for t in video_tags:
        try:
            tag_ids.append(ObjectId(t) if not isinstance(t, ObjectId) else t)
        except Exception:
            pass
    tags_data = []
    if tag_ids:
        tags = list(db.tags.find({'_id': {'$in': tag_ids}}))
        tags_data = [str(t['_id']) for t in tags]

    return {
        'id': str(vid),
        'filename': video['filename'],
        'original_name': video['original_name'],
        'file_size': video.get('file_size', 0),
        'duration': video.get('duration', 0),
        'width': video.get('width', 0),
        'height': video.get('height', 0),
        'status': video.get('status', 'uploaded'),
        'current_step': video.get('current_step', 1),
        'subpart_id': str(video['subpart_id']) if video.get('subpart_id') else None,
        'url': f'/uploads/videos/{video["filename"]}',
        'thumbnail_url': f'/uploads/thumbnails/{thumb}' if thumb else '',
        'uploaded_by': str(video['uploaded_by']),
        'annotators': [str(a) for a in video.get('annotators', [])],
        'segments_count': segments_count,
        'objects_count': objects_count,
        'captions_count': captions_count,
        'tags': tags_data,
        'review_status': video.get('review_status', 'not_submitted'),
        'review_comment': video.get('review_comment', ''),
        'reviewed_by': str(video['reviewed_by']) if video.get('reviewed_by') else None,
        'created_at': video['created_at'].isoformat()
    }


@videos_bp.route('/project/<project_id>', methods=['GET'])
@token_required
def get_project_videos(project_id):
    try:
        videos = list(current_app.db.videos.find({'project_id': ObjectId(project_id)}))
    except Exception:
        return jsonify({'error': 'Invalid project ID'}), 400

    result = [_build_video_stats(current_app.db, v) for v in videos]
    return jsonify(result)


@videos_bp.route('/subpart/<subpart_id>', methods=['GET'])
@token_required
def get_subpart_videos(subpart_id):
    try:
        videos = list(current_app.db.videos.find({'subpart_id': ObjectId(subpart_id)}).sort('created_at', -1))
    except Exception:
        return jsonify({'error': 'Invalid subpart ID'}), 400

    result = [_build_video_stats(current_app.db, v) for v in videos]
    return jsonify(result)


@videos_bp.route('/<video_id>', methods=['GET'])
@token_required
def get_video(video_id):
    try:
        video = current_app.db.videos.find_one({'_id': ObjectId(video_id)})
    except Exception:
        return jsonify({'error': 'Invalid video ID'}), 400

    if not video:
        return jsonify({'error': 'Video not found'}), 404

    # Get segments
    segments = list(current_app.db.video_segments.find(
        {'video_id': ObjectId(video_id)}
    ).sort('order', 1))

    segments_data = []
    for seg in segments:
        regions_count = current_app.db.object_regions.count_documents({'segment_id': seg['_id']})
        captions_count = current_app.db.captions.count_documents({'segment_id': seg['_id']})
        segments_data.append({
            'id': str(seg['_id']),
            'name': seg.get('name', ''),
            'start_time': seg['start_time'],
            'end_time': seg['end_time'],
            'order': seg.get('order', 0),
            'regions_count': regions_count,
            'captions_count': captions_count,
            'created_at': seg['created_at'].isoformat()
        })

    # Resolve annotator details
    annotator_ids = video.get('annotators', [])
    annotator_details = []
    for uid in annotator_ids:
        try:
            u = current_app.db.users.find_one({'_id': uid if isinstance(uid, ObjectId) else ObjectId(uid)}, {'password_hash': 0})
            if u:
                annotator_details.append({
                    'id': str(u['_id']),
                    'username': u['username'],
                    'full_name': u.get('full_name', ''),
                    'avatar_color': u.get('avatar_color', '#4A90D9')
                })
        except Exception:
            pass

    # Resolve subpart reviewer
    reviewer_id = None
    reviewer_details = None
    if video.get('subpart_id'):
        subpart = current_app.db.subparts.find_one({'_id': video['subpart_id']})
        if subpart and subpart.get('reviewer'):
            reviewer_id = str(subpart['reviewer'])
            rev_user = current_app.db.users.find_one({'_id': subpart['reviewer']}, {'password_hash': 0})
            if rev_user:
                reviewer_details = {
                    'id': str(rev_user['_id']),
                    'username': rev_user['username'],
                    'full_name': rev_user.get('full_name', ''),
                    'avatar_color': rev_user.get('avatar_color', '#4A90D9')
                }

    return jsonify({
        'id': str(video['_id']),
        'project_id': str(video['project_id']),
        'filename': video['filename'],
        'original_name': video['original_name'],
        'file_size': video.get('file_size', 0),
        'duration': video.get('duration', 0),
        'width': video.get('width', 0),
        'height': video.get('height', 0),
        'status': video.get('status', 'uploaded'),
        'current_step': video.get('current_step', 1),
        'subpart_id': str(video['subpart_id']) if video.get('subpart_id') else None,
        'url': f'/uploads/videos/{video["filename"]}',
        'thumbnail_url': f'/uploads/thumbnails/{video["thumbnail"]}' if video.get('thumbnail') else '',
        'uploaded_by': str(video['uploaded_by']),
        'annotators': [str(a) for a in video.get('annotators', [])],
        'annotator_details': annotator_details,
        'tags': [str(t) for t in video.get('tags', [])],
        'review_status': video.get('review_status', 'not_submitted'),
        'review_comment': video.get('review_comment', ''),
        'reviewed_by': str(video['reviewed_by']) if video.get('reviewed_by') else None,
        'reviewer_id': reviewer_id,
        'reviewer_details': reviewer_details,
        'segments': segments_data,
        'created_at': video['created_at'].isoformat()
    })


@videos_bp.route('/<video_id>', methods=['PUT'])
@token_required
def update_video(video_id):
    data = request.get_json()

    try:
        video = current_app.db.videos.find_one({'_id': ObjectId(video_id)})
    except Exception:
        return jsonify({'error': 'Invalid video ID'}), 400

    if not video:
        return jsonify({'error': 'Video not found'}), 404

    update_fields = {}
    if 'duration' in data:
        update_fields['duration'] = float(data['duration'])
    if 'status' in data:
        update_fields['status'] = data['status']
    if 'current_step' in data:
        update_fields['current_step'] = int(data['current_step'])
    if 'subpart_id' in data:
        update_fields['subpart_id'] = ObjectId(data['subpart_id']) if data['subpart_id'] else None
    if 'width' in data:
        update_fields['width'] = int(data['width'])
    if 'height' in data:
        update_fields['height'] = int(data['height'])
    if 'tags' in data:
        update_fields['tags'] = [ObjectId(t) for t in data['tags'] if t]
    if 'review_status' in data:
        update_fields['review_status'] = data['review_status']
    if 'review_comment' in data:
        update_fields['review_comment'] = data['review_comment']
    if 'annotators' in data:
        update_fields['annotators'] = [ObjectId(a) for a in data['annotators'] if a]

    update_fields['updated_at'] = datetime.now(timezone.utc)

    current_app.db.videos.update_one(
        {'_id': ObjectId(video_id)},
        {'$set': update_fields}
    )

    return jsonify({'message': 'Video updated successfully'})


@videos_bp.route('/<video_id>', methods=['DELETE'])
@token_required
def delete_video(video_id):
    try:
        video = current_app.db.videos.find_one({'_id': ObjectId(video_id)})
    except Exception:
        return jsonify({'error': 'Invalid video ID'}), 400

    if not video:
        return jsonify({'error': 'Video not found'}), 404

    # Delete file
    try:
        filepath = os.path.join(Config.UPLOAD_FOLDER, 'videos', video['filename'])
        if os.path.exists(filepath):
            os.remove(filepath)
    except Exception:
        pass

    # Delete related data
    segment_ids = [s['_id'] for s in current_app.db.video_segments.find({'video_id': ObjectId(video_id)})]
    current_app.db.captions.delete_many({'segment_id': {'$in': segment_ids}})
    current_app.db.object_regions.delete_many({'segment_id': {'$in': segment_ids}})
    current_app.db.video_segments.delete_many({'video_id': ObjectId(video_id)})
    current_app.db.videos.delete_one({'_id': ObjectId(video_id)})

    return jsonify({'message': 'Video deleted successfully'})


# ============ REVIEW ENDPOINTS ============

@videos_bp.route('/<video_id>/submit-review', methods=['POST'])
@token_required
def submit_for_review(video_id):
    """Annotator submits a video for cross-check review."""
    try:
        video = current_app.db.videos.find_one({'_id': ObjectId(video_id)})
    except Exception:
        return jsonify({'error': 'Invalid video ID'}), 400

    if not video:
        return jsonify({'error': 'Video not found'}), 404

    current_app.db.videos.update_one(
        {'_id': ObjectId(video_id)},
        {'$set': {
            'review_status': 'pending_review',
            'review_comment': '',
            'updated_at': datetime.now(timezone.utc)
        }}
    )

    return jsonify({'message': 'Video submitted for review', 'review_status': 'pending_review'})


@videos_bp.route('/<video_id>/review', methods=['POST'])
@token_required
def review_video(video_id):
    """Reviewer approves or rejects a video."""
    data = request.get_json()
    if not data or 'action' not in data:
        return jsonify({'error': 'Action is required (approve/reject)'}), 400

    action = data['action']
    if action not in ('approve', 'reject'):
        return jsonify({'error': 'Invalid action. Must be approve or reject'}), 400

    try:
        video = current_app.db.videos.find_one({'_id': ObjectId(video_id)})
    except Exception:
        return jsonify({'error': 'Invalid video ID'}), 400

    if not video:
        return jsonify({'error': 'Video not found'}), 404

    review_status = 'approved' if action == 'approve' else 'rejected'
    comment = data.get('comment', '')

    current_app.db.videos.update_one(
        {'_id': ObjectId(video_id)},
        {'$set': {
            'review_status': review_status,
            'review_comment': comment,
            'reviewed_by': request.current_user['_id'],
            'reviewed_at': datetime.now(timezone.utc),
            'updated_at': datetime.now(timezone.utc)
        }}
    )

    return jsonify({
        'message': f'Video {review_status}',
        'review_status': review_status,
        'review_comment': comment
    })
