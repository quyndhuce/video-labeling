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
        'reviews': _format_reviews(video.get('reviews', [])),
        'reviewers': [str(r) for r in video.get('reviewers', [])],
        'created_at': video['created_at'].isoformat()
    }


def _format_reviews(reviews):
    """Format review entries for API response."""
    formatted = []
    for r in reviews:
        formatted.append({
            'reviewer_id': str(r['reviewer_id']),
            'action': r['action'],
            'comment': r.get('comment', ''),
            'reviewed_at': r['reviewed_at'].isoformat() if r.get('reviewed_at') else None
        })
    return formatted


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

    # Resolve subpart reviewers (multiple)
    subpart_reviewers = []
    reviewer_details_list = []
    if video.get('subpart_id'):
        subpart = current_app.db.subparts.find_one({'_id': video['subpart_id']})
        if subpart:
            # Support both single reviewer and multiple reviewers
            reviewers_list = subpart.get('reviewers', [])
            if not reviewers_list and subpart.get('reviewer'):
                reviewers_list = [subpart['reviewer']]
            
            for rev_id in reviewers_list:
                subpart_reviewers.append(str(rev_id))
                rev_user = current_app.db.users.find_one({'_id': rev_id}, {'password_hash': 0})
                if rev_user:
                    reviewer_details_list.append({
                        'id': str(rev_user['_id']),
                        'username': rev_user['username'],
                        'full_name': rev_user.get('full_name', ''),
                        'avatar_color': rev_user.get('avatar_color', '#4A90D9')
                    })

    # Format individual reviews with user details
    reviews_with_details = []
    for r in video.get('reviews', []):
        rev_user = current_app.db.users.find_one({'_id': r['reviewer_id']}, {'password_hash': 0})
        reviews_with_details.append({
            'reviewer_id': str(r['reviewer_id']),
            'action': r['action'],
            'comment': r.get('comment', ''),
            'reviewed_at': r['reviewed_at'].isoformat() if r.get('reviewed_at') else None,
            'reviewer_details': {
                'id': str(rev_user['_id']),
                'username': rev_user['username'],
                'full_name': rev_user.get('full_name', ''),
                'avatar_color': rev_user.get('avatar_color', '#4A90D9')
            } if rev_user else None
        })

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
        'reviews': reviews_with_details,
        'subpart_reviewers': subpart_reviewers,
        'reviewer_details_list': reviewer_details_list,
        # Legacy single reviewer support
        'reviewer_id': subpart_reviewers[0] if subpart_reviewers else None,
        'reviewer_details': reviewer_details_list[0] if reviewer_details_list else None,
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
    
    # Track if content-related fields are being changed (should reset approval)
    content_changed = False
    content_fields = ['duration', 'status', 'current_step', 'width', 'height']
    
    if 'duration' in data:
        update_fields['duration'] = float(data['duration'])
        content_changed = True
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

    # If video was approved and content changed, reset to not_submitted
    # (except when explicitly setting review_status)
    if video.get('review_status') == 'approved' and content_changed and 'review_status' not in data:
        update_fields['review_status'] = 'not_submitted'
        update_fields['reviews'] = []
        update_fields['review_comment'] = 'Auto-reset: Content modified after approval'

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

    # Clear all previous reviews when re-submitting
    current_app.db.videos.update_one(
        {'_id': ObjectId(video_id)},
        {'$set': {
            'review_status': 'pending_review',
            'review_comment': '',
            'reviews': [],  # Clear individual reviews
            'reviewed_by': None,
            'updated_at': datetime.now(timezone.utc)
        }}
    )

    return jsonify({'message': 'Video submitted for review', 'review_status': 'pending_review'})


@videos_bp.route('/<video_id>/review', methods=['POST'])
@token_required
def review_video(video_id):
    """Reviewer approves or rejects a video (multi-reviewer with consensus)."""
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

    comment = data.get('comment', '')
    reviewer_id = request.current_user['_id']
    now = datetime.now(timezone.utc)

    # Get existing reviews
    reviews = video.get('reviews', [])
    
    # Remove any existing review from this reviewer (allows changing vote)
    reviews = [r for r in reviews if r['reviewer_id'] != reviewer_id]
    
    # Add new review
    reviews.append({
        'reviewer_id': reviewer_id,
        'action': action,
        'comment': comment,
        'reviewed_at': now
    })

    # Get required reviewers from subpart
    required_reviewers = []
    if video.get('subpart_id'):
        subpart = current_app.db.subparts.find_one({'_id': video['subpart_id']})
        if subpart:
            required_reviewers = subpart.get('reviewers', [])
            if not required_reviewers and subpart.get('reviewer'):
                required_reviewers = [subpart['reviewer']]

    # Calculate consensus status
    review_status = _calculate_consensus_status(reviews, required_reviewers)
    
    # Get latest comment from most recent review
    latest_comment = reviews[-1]['comment'] if reviews else ''

    current_app.db.videos.update_one(
        {'_id': ObjectId(video_id)},
        {'$set': {
            'review_status': review_status,
            'review_comment': latest_comment,
            'reviews': reviews,
            'reviewed_by': reviewer_id,
            'reviewed_at': now,
            'updated_at': now
        }}
    )

    return jsonify({
        'message': f'Your review recorded: {action}',
        'review_status': review_status,
        'reviews': _format_reviews(reviews),
        'your_action': action
    })


def _calculate_consensus_status(reviews, required_reviewers):
    """
    Calculate the overall review status based on consensus rules:
    - If any reviewer rejects: 'rejected'
    - If all required reviewers approve: 'approved'
    - Otherwise: 'in_review' (partial approvals)
    """
    if not reviews:
        return 'pending_review'
    
    # Check for any rejections
    rejections = [r for r in reviews if r['action'] == 'reject']
    if rejections:
        return 'rejected'
    
    # Check for approvals
    approvals = [r for r in reviews if r['action'] == 'approve']
    
    # If we have required reviewers, check if all have approved
    if required_reviewers:
        required_set = set(required_reviewers) if isinstance(required_reviewers[0], ObjectId) else set(ObjectId(r) for r in required_reviewers)
        approved_set = set(r['reviewer_id'] for r in approvals)
        
        if required_set.issubset(approved_set):
            return 'approved'
        elif approvals:
            return 'in_review'  # Some approved but not all required
        else:
            return 'pending_review'
    else:
        # No specific required reviewers, any approval counts
        return 'approved' if approvals else 'pending_review'


@videos_bp.route('/<video_id>/revoke-approval', methods=['POST'])
@token_required
def revoke_approval(video_id):
    """Revoke approval status (admin/reviewer can cancel approval)."""
    try:
        video = current_app.db.videos.find_one({'_id': ObjectId(video_id)})
    except Exception:
        return jsonify({'error': 'Invalid video ID'}), 400

    if not video:
        return jsonify({'error': 'Video not found'}), 404

    data = request.get_json() or {}
    reason = data.get('reason', 'Approval revoked')

    # Clear reviews and reset status
    current_app.db.videos.update_one(
        {'_id': ObjectId(video_id)},
        {'$set': {
            'review_status': 'not_submitted',
            'review_comment': reason,
            'reviews': [],
            'reviewed_by': None,
            'updated_at': datetime.now(timezone.utc)
        }}
    )

    return jsonify({
        'message': 'Approval revoked',
        'review_status': 'not_submitted'
    })


@videos_bp.route('/<video_id>/withdraw-review', methods=['POST'])
@token_required
def withdraw_review(video_id):
    """Reviewer withdraws their own review."""
    try:
        video = current_app.db.videos.find_one({'_id': ObjectId(video_id)})
    except Exception:
        return jsonify({'error': 'Invalid video ID'}), 400

    if not video:
        return jsonify({'error': 'Video not found'}), 404

    reviewer_id = request.current_user['_id']
    reviews = video.get('reviews', [])
    
    # Remove this reviewer's review
    reviews = [r for r in reviews if r['reviewer_id'] != reviewer_id]

    # Get required reviewers and recalculate status
    required_reviewers = []
    if video.get('subpart_id'):
        subpart = current_app.db.subparts.find_one({'_id': video['subpart_id']})
        if subpart:
            required_reviewers = subpart.get('reviewers', [])
            if not required_reviewers and subpart.get('reviewer'):
                required_reviewers = [subpart['reviewer']]

    review_status = _calculate_consensus_status(reviews, required_reviewers)

    current_app.db.videos.update_one(
        {'_id': ObjectId(video_id)},
        {'$set': {
            'review_status': review_status,
            'reviews': reviews,
            'updated_at': datetime.now(timezone.utc)
        }}
    )

    return jsonify({
        'message': 'Your review has been withdrawn',
        'review_status': review_status,
        'reviews': _format_reviews(reviews)
    })


@videos_bp.route('/qc-stats', methods=['GET'])
@token_required
def get_qc_stats():
    """Get quality control statistics across all videos"""
    db = current_app.db
    
    # Get all videos with their status
    videos = list(db.videos.find({}, {
        'project_id': 1, 'subpart_id': 1, 'original_name': 1,
        'review_status': 1, 'reviews': 1, 'status': 1, 'created_at': 1
    }))
    
    # Get all projects for names
    projects = {str(p['_id']): p for p in db.projects.find({}, {'name': 1})}
    
    # Get all subparts for names
    subparts = {str(s['_id']): s for s in db.subparts.find({}, {'name': 1, 'reviewers': 1})}
    
    # Get all users for names
    users = {str(u['_id']): u for u in db.users.find({}, {'username': 1, 'full_name': 1, 'avatar_color': 1})}
    
    # Calculate statistics
    stats = {
        'total_videos': len(videos),
        'by_status': {
            'pending': 0,
            'approved': 0,
            'rejected': 0,
            'in_review': 0
        },
        'by_project': {},
        'by_user': {},  # New: stats by user
        'recent_reviews': [],
        'pending_reviews': []
    }
    
    for video in videos:
        review_status = video.get('review_status', 'pending')
        
        # Count by status
        if review_status in stats['by_status']:
            stats['by_status'][review_status] += 1
        else:
            stats['by_status']['pending'] += 1
        
        # Count by project
        project_id = str(video.get('project_id', ''))
        project_name = projects.get(project_id, {}).get('name', 'Unknown')
        if project_name not in stats['by_project']:
            stats['by_project'][project_name] = {'total': 0, 'approved': 0, 'rejected': 0, 'pending': 0, 'in_review': 0}
        stats['by_project'][project_name]['total'] += 1
        if review_status in stats['by_project'][project_name]:
            stats['by_project'][project_name][review_status] += 1
        
        # Collect reviews with details and count by user
        for review in video.get('reviews', []):
            reviewer_id = str(review.get('reviewer_id', ''))
            reviewer = users.get(reviewer_id, {})
            reviewer_name = reviewer.get('full_name') or reviewer.get('username', 'Unknown')
            reviewer_color = reviewer.get('avatar_color', '#4A90D9')
            # Note: individual review uses 'action' field (approve/reject), not 'status'
            review_action = review.get('action', 'pending')
            
            # Count by user
            if reviewer_id not in stats['by_user']:
                stats['by_user'][reviewer_id] = {
                    'id': str(reviewer_id),
                    'name': reviewer_name,
                    'color': reviewer_color,
                    'total_reviews': 0,
                    'approved': 0,
                    'rejected': 0
                }
            stats['by_user'][reviewer_id]['total_reviews'] += 1
            if review_action == 'approve':
                stats['by_user'][reviewer_id]['approved'] += 1
            elif review_action == 'reject':
                stats['by_user'][reviewer_id]['rejected'] += 1
            
            stats['recent_reviews'].append({
                'video_id': str(video['_id']),
                'video_name': video.get('original_name', 'Unknown'),
                'project_name': project_name,
                'reviewer_name': reviewer_name,
                'reviewer_color': reviewer_color,
                'status': review_action,  # Use action value (approve/reject)
                'reviewed_at': review.get('reviewed_at').isoformat() if review.get('reviewed_at') else None
            })
        
        # Collect videos pending review
        if review_status in ['pending', 'in_review']:
            subpart_id = str(video.get('subpart_id', ''))
            subpart = subparts.get(subpart_id, {})
            required_reviewers = [str(r) for r in subpart.get('reviewers', [])]
            reviewed_by = [str(r.get('reviewer_id', '')) for r in video.get('reviews', [])]
            pending_reviewers = [uid for uid in required_reviewers if uid not in reviewed_by]
            
            # Build pending reviewers list
            reviewer_names = []
            for uid in pending_reviewers:
                user = users.get(str(uid), {})
                reviewer_names.append({
                    'id': str(uid),
                    'name': user.get('full_name') or user.get('username', 'Unknown'),
                    'color': user.get('avatar_color', '#4A90D9')
                })
            
            # Add to pending reviews if:
            # - There are specific pending reviewers, OR
            # - The video is pending/in_review and has no required reviewers (needs any reviewer)
            if pending_reviewers or (not required_reviewers and review_status in ['pending', 'in_review']):
                stats['pending_reviews'].append({
                    'video_id': str(video['_id']),
                    'video_name': video.get('original_name', 'Unknown'),
                    'project_name': project_name,
                    'subpart_name': subpart.get('name', 'Unknown'),
                    'pending_reviewers': reviewer_names if reviewer_names else [{'id': '', 'name': 'Any reviewer', 'color': '#64748b'}],
                    'created_at': video.get('created_at').isoformat() if video.get('created_at') else None
                })
    
    # Sort recent reviews by date (newest first)
    stats['recent_reviews'] = sorted(
        stats['recent_reviews'],
        key=lambda x: x.get('reviewed_at') or '',
        reverse=True
    )[:50]  # Limit to 50 most recent
    
    # Sort pending reviews by date (oldest first - needs attention)
    stats['pending_reviews'] = sorted(
        stats['pending_reviews'],
        key=lambda x: x.get('created_at') or '',
        reverse=False
    )[:50]  # Limit to 50
    
    # Convert by_user dict to sorted list
    stats['by_user'] = sorted(
        list(stats['by_user'].values()),
        key=lambda x: x.get('total_reviews', 0),
        reverse=True
    )
    
    return jsonify(stats)
