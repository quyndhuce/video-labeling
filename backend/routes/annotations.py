from flask import Blueprint, request, jsonify, current_app
from datetime import datetime, timezone
from bson import ObjectId
from utils.auth_middleware import token_required

annotations_bp = Blueprint('annotations', __name__)


# ============ CAPTIONS (Step 3) ============

@annotations_bp.route('/segment/<segment_id>', methods=['GET'])
@token_required
def get_segment_captions(segment_id):
    """Get all captions for a segment"""
    try:
        captions = list(current_app.db.captions.find({'segment_id': ObjectId(segment_id)}))
    except Exception:
        return jsonify({'error': 'Invalid segment ID'}), 400

    result = []
    for c in captions:
        region = None
        if c.get('region_id'):
            region = current_app.db.object_regions.find_one({'_id': c['region_id']})

        result.append({
            'id': str(c['_id']),
            'segment_id': str(c['segment_id']),
            'video_id': str(c['video_id']),
            'region_id': str(c['region_id']) if c.get('region_id') else None,
            'region_label': region.get('label', '') if region else None,
            'region_color': region.get('color', '') if region else None,
            'visual_caption': c.get('visual_caption', ''),
            'contextual_caption': c.get('contextual_caption', ''),
            'knowledge_caption': c.get('knowledge_caption', ''),
            'combined_caption': c.get('combined_caption', ''),
            'created_by': str(c['created_by']),
            'created_at': c['created_at'].isoformat(),
            'updated_at': c.get('updated_at', c['created_at']).isoformat()
        })

    return jsonify(result)


@annotations_bp.route('/region/<region_id>', methods=['GET'])
@token_required
def get_region_caption(region_id):
    """Get caption for a specific region"""
    try:
        caption = current_app.db.captions.find_one({'region_id': ObjectId(region_id)})
    except Exception:
        return jsonify({'error': 'Invalid region ID'}), 400

    if not caption:
        return jsonify(None)

    return jsonify({
        'id': str(caption['_id']),
        'segment_id': str(caption['segment_id']),
        'video_id': str(caption['video_id']),
        'region_id': str(caption['region_id']),
        'visual_caption': caption.get('visual_caption', ''),
        'contextual_caption': caption.get('contextual_caption', ''),
        'knowledge_caption': caption.get('knowledge_caption', ''),
        'combined_caption': caption.get('combined_caption', ''),
        'created_at': caption['created_at'].isoformat(),
        'updated_at': caption.get('updated_at', caption['created_at']).isoformat()
    })


@annotations_bp.route('', methods=['POST'])
@token_required
def create_caption():
    data = request.get_json()

    if not data.get('segment_id') or not data.get('video_id'):
        return jsonify({'error': 'segment_id and video_id are required'}), 400

    # Check if caption already exists for this region
    if data.get('region_id'):
        existing = current_app.db.captions.find_one({
            'region_id': ObjectId(data['region_id']),
            'segment_id': ObjectId(data['segment_id'])
        })
        if existing:
            # Update instead
            current_app.db.captions.update_one(
                {'_id': existing['_id']},
                {'$set': {
                    'visual_caption': data.get('visual_caption', existing.get('visual_caption', '')),
                    'contextual_caption': data.get('contextual_caption', existing.get('contextual_caption', '')),
                    'knowledge_caption': data.get('knowledge_caption', existing.get('knowledge_caption', '')),
                    'combined_caption': data.get('combined_caption', existing.get('combined_caption', '')),
                    'updated_at': datetime.now(timezone.utc)
                }}
            )
            updated = current_app.db.captions.find_one({'_id': existing['_id']})
            return jsonify({
                'id': str(updated['_id']),
                'segment_id': str(updated['segment_id']),
                'video_id': str(updated['video_id']),
                'region_id': str(updated['region_id']) if updated.get('region_id') else None,
                'visual_caption': updated.get('visual_caption', ''),
                'contextual_caption': updated.get('contextual_caption', ''),
                'knowledge_caption': updated.get('knowledge_caption', ''),
                'combined_caption': updated.get('combined_caption', ''),
                'created_at': updated['created_at'].isoformat(),
                'updated_at': updated.get('updated_at', updated['created_at']).isoformat()
            })

    caption = {
        'segment_id': ObjectId(data['segment_id']),
        'video_id': ObjectId(data['video_id']),
        'region_id': ObjectId(data['region_id']) if data.get('region_id') else None,
        'visual_caption': data.get('visual_caption', ''),
        'contextual_caption': data.get('contextual_caption', ''),
        'knowledge_caption': data.get('knowledge_caption', ''),
        'combined_caption': data.get('combined_caption', ''),
        'created_by': request.current_user['_id'],
        'created_at': datetime.now(timezone.utc),
        'updated_at': datetime.now(timezone.utc)
    }

    result = current_app.db.captions.insert_one(caption)

    return jsonify({
        'id': str(result.inserted_id),
        'segment_id': data['segment_id'],
        'video_id': data['video_id'],
        'region_id': data.get('region_id'),
        'visual_caption': caption['visual_caption'],
        'contextual_caption': caption['contextual_caption'],
        'knowledge_caption': caption['knowledge_caption'],
        'combined_caption': caption['combined_caption'],
        'created_at': caption['created_at'].isoformat()
    }), 201


@annotations_bp.route('/<caption_id>', methods=['PUT'])
@token_required
def update_caption(caption_id):
    data = request.get_json()

    try:
        caption = current_app.db.captions.find_one({'_id': ObjectId(caption_id)})
    except Exception:
        return jsonify({'error': 'Invalid caption ID'}), 400

    if not caption:
        return jsonify({'error': 'Caption not found'}), 404

    update_fields = {}
    if 'visual_caption' in data:
        update_fields['visual_caption'] = data['visual_caption']
    if 'contextual_caption' in data:
        update_fields['contextual_caption'] = data['contextual_caption']
    if 'knowledge_caption' in data:
        update_fields['knowledge_caption'] = data['knowledge_caption']
    if 'combined_caption' in data:
        update_fields['combined_caption'] = data['combined_caption']
    update_fields['updated_at'] = datetime.now(timezone.utc)

    current_app.db.captions.update_one(
        {'_id': ObjectId(caption_id)},
        {'$set': update_fields}
    )

    updated = current_app.db.captions.find_one({'_id': ObjectId(caption_id)})
    return jsonify({
        'id': str(updated['_id']),
        'segment_id': str(updated['segment_id']),
        'video_id': str(updated['video_id']),
        'region_id': str(updated['region_id']) if updated.get('region_id') else None,
        'visual_caption': updated.get('visual_caption', ''),
        'contextual_caption': updated.get('contextual_caption', ''),
        'knowledge_caption': updated.get('knowledge_caption', ''),
        'combined_caption': updated.get('combined_caption', ''),
        'created_at': updated['created_at'].isoformat(),
        'updated_at': updated['updated_at'].isoformat()
    })


@annotations_bp.route('/<caption_id>', methods=['DELETE'])
@token_required
def delete_caption(caption_id):
    try:
        result = current_app.db.captions.delete_one({'_id': ObjectId(caption_id)})
    except Exception:
        return jsonify({'error': 'Invalid caption ID'}), 400

    if result.deleted_count == 0:
        return jsonify({'error': 'Caption not found'}), 404

    return jsonify({'message': 'Caption deleted successfully'})


# ============ EXPORT ============

@annotations_bp.route('/export/video/<video_id>', methods=['GET'])
@token_required
def export_video_annotations(video_id):
    """Export all annotations for a video as JSON"""
    try:
        video = current_app.db.videos.find_one({'_id': ObjectId(video_id)})
    except Exception:
        return jsonify({'error': 'Invalid video ID'}), 400

    if not video:
        return jsonify({'error': 'Video not found'}), 404

    segments = list(current_app.db.video_segments.find(
        {'video_id': ObjectId(video_id)}
    ).sort('order', 1))

    export_data = {
        'video': {
            'id': str(video['_id']),
            'original_name': video['original_name'],
            'duration': video.get('duration', 0),
            'width': video.get('width', 0),
            'height': video.get('height', 0)
        },
        'segments': []
    }

    for seg in segments:
        seg_data = {
            'name': seg.get('name', ''),
            'start_time': seg['start_time'],
            'end_time': seg['end_time'],
            'regions': []
        }

        regions = list(current_app.db.object_regions.find({'segment_id': seg['_id']}))
        for r in regions:
            caption = current_app.db.captions.find_one({'region_id': r['_id']})
            region_data = {
                'label': r.get('label', ''),
                'color': r.get('color', ''),
                'frame_time': r['frame_time'],
                'caption': {
                    'visual': caption.get('visual_caption', '') if caption else '',
                    'contextual': caption.get('contextual_caption', '') if caption else '',
                    'knowledge': caption.get('knowledge_caption', '') if caption else '',
                    'combined': caption.get('combined_caption', '') if caption else ''
                }
            }
            seg_data['regions'].append(region_data)

        # Also get segment-level captions (without region)
        seg_captions = list(current_app.db.captions.find({
            'segment_id': seg['_id'],
            'region_id': None
        }))
        seg_data['segment_captions'] = [{
            'visual': c.get('visual_caption', ''),
            'contextual': c.get('contextual_caption', ''),
            'knowledge': c.get('knowledge_caption', ''),
            'combined': c.get('combined_caption', '')
        } for c in seg_captions]

        export_data['segments'].append(seg_data)

    return jsonify(export_data)
