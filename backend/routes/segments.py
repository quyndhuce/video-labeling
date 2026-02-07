import os
import uuid
import base64
import io
import time
import requests as http_requests
import traceback
from flask import Blueprint, request, jsonify, current_app
from datetime import datetime, timezone
from bson import ObjectId
from config import Config
from utils.auth_middleware import token_required
from routes.settings import get_dam_url

segments_bp = Blueprint('segments', __name__)


# ============ VIDEO SEGMENTS (Step 1: Cut & Split) ============

@segments_bp.route('/video/<video_id>', methods=['GET'])
@token_required
def get_video_segments(video_id):
    try:
        segments = list(current_app.db.video_segments.find(
            {'video_id': ObjectId(video_id)}
        ).sort('order', 1))
    except Exception:
        return jsonify({'error': 'Invalid video ID'}), 400

    result = []
    for seg in segments:
        regions = list(current_app.db.object_regions.find({'segment_id': seg['_id']}))
        regions_data = []
        for r in regions:
            captions = current_app.db.captions.find_one({'region_id': r['_id']})
            regions_data.append({
                'id': str(r['_id']),
                'frame_time': r['frame_time'],
                'label': r.get('label', ''),
                'color': r.get('color', '#FF0000'),
                'has_caption': captions is not None
            })

        result.append({
            'id': str(seg['_id']),
            'video_id': str(seg['video_id']),
            'name': seg.get('name', ''),
            'start_time': seg['start_time'],
            'end_time': seg['end_time'],
            'order': seg.get('order', 0),
            'regions': regions_data,
            'created_at': seg['created_at'].isoformat()
        })

    return jsonify(result)


@segments_bp.route('/video/<video_id>', methods=['POST'])
@token_required
def create_segment(video_id):
    data = request.get_json()

    if data.get('start_time') is None or data.get('end_time') is None:
        return jsonify({'error': 'start_time and end_time are required'}), 400

    try:
        video = current_app.db.videos.find_one({'_id': ObjectId(video_id)})
    except Exception:
        return jsonify({'error': 'Invalid video ID'}), 400

    if not video:
        return jsonify({'error': 'Video not found'}), 404

    # Get next order
    max_order = current_app.db.video_segments.find_one(
        {'video_id': ObjectId(video_id)},
        sort=[('order', -1)]
    )
    next_order = (max_order['order'] + 1) if max_order else 0

    segment = {
        'video_id': ObjectId(video_id),
        'name': data.get('name', f'Segment {next_order + 1}'),
        'start_time': float(data['start_time']),
        'end_time': float(data['end_time']),
        'order': next_order,
        'created_by': request.current_user['_id'],
        'created_at': datetime.now(timezone.utc),
        'updated_at': datetime.now(timezone.utc)
    }

    result = current_app.db.video_segments.insert_one(segment)

    return jsonify({
        'id': str(result.inserted_id),
        'video_id': video_id,
        'name': segment['name'],
        'start_time': segment['start_time'],
        'end_time': segment['end_time'],
        'order': segment['order'],
        'regions': [],
        'created_at': segment['created_at'].isoformat()
    }), 201


@segments_bp.route('/<segment_id>', methods=['PUT'])
@token_required
def update_segment(segment_id):
    data = request.get_json()

    try:
        segment = current_app.db.video_segments.find_one({'_id': ObjectId(segment_id)})
    except Exception:
        return jsonify({'error': 'Invalid segment ID'}), 400

    if not segment:
        return jsonify({'error': 'Segment not found'}), 404

    update_fields = {}
    if 'name' in data:
        update_fields['name'] = data['name']
    if 'start_time' in data:
        update_fields['start_time'] = float(data['start_time'])
    if 'end_time' in data:
        update_fields['end_time'] = float(data['end_time'])
    if 'order' in data:
        update_fields['order'] = int(data['order'])
    update_fields['updated_at'] = datetime.now(timezone.utc)

    current_app.db.video_segments.update_one(
        {'_id': ObjectId(segment_id)},
        {'$set': update_fields}
    )

    updated = current_app.db.video_segments.find_one({'_id': ObjectId(segment_id)})
    return jsonify({
        'id': str(updated['_id']),
        'video_id': str(updated['video_id']),
        'name': updated.get('name', ''),
        'start_time': updated['start_time'],
        'end_time': updated['end_time'],
        'order': updated.get('order', 0),
        'created_at': updated['created_at'].isoformat()
    })


@segments_bp.route('/<segment_id>', methods=['DELETE'])
@token_required
def delete_segment(segment_id):
    try:
        segment = current_app.db.video_segments.find_one({'_id': ObjectId(segment_id)})
    except Exception:
        return jsonify({'error': 'Invalid segment ID'}), 400

    if not segment:
        return jsonify({'error': 'Segment not found'}), 404

    # Delete related data
    current_app.db.captions.delete_many({'segment_id': ObjectId(segment_id)})
    current_app.db.object_regions.delete_many({'segment_id': ObjectId(segment_id)})
    current_app.db.video_segments.delete_one({'_id': ObjectId(segment_id)})

    return jsonify({'message': 'Segment deleted successfully'})


# ============ BATCH SEGMENTS ============

@segments_bp.route('/video/<video_id>/batch', methods=['POST'])
@token_required
def create_segments_batch(video_id):
    """Create multiple segments at once (auto-split)"""
    data = request.get_json()
    segments_data = data.get('segments', [])

    if not segments_data:
        return jsonify({'error': 'No segments provided'}), 400

    try:
        video = current_app.db.videos.find_one({'_id': ObjectId(video_id)})
    except Exception:
        return jsonify({'error': 'Invalid video ID'}), 400

    if not video:
        return jsonify({'error': 'Video not found'}), 404

    # Delete existing segments for this video
    if data.get('replace', False):
        existing_segments = [s['_id'] for s in current_app.db.video_segments.find({'video_id': ObjectId(video_id)})]
        current_app.db.captions.delete_many({'segment_id': {'$in': existing_segments}})
        current_app.db.object_regions.delete_many({'segment_id': {'$in': existing_segments}})
        current_app.db.video_segments.delete_many({'video_id': ObjectId(video_id)})

    created = []
    for i, seg_data in enumerate(segments_data):
        segment = {
            'video_id': ObjectId(video_id),
            'name': seg_data.get('name', f'Segment {i + 1}'),
            'start_time': float(seg_data['start_time']),
            'end_time': float(seg_data['end_time']),
            'order': i,
            'created_by': request.current_user['_id'],
            'created_at': datetime.now(timezone.utc),
            'updated_at': datetime.now(timezone.utc)
        }
        result = current_app.db.video_segments.insert_one(segment)
        created.append({
            'id': str(result.inserted_id),
            'name': segment['name'],
            'start_time': segment['start_time'],
            'end_time': segment['end_time'],
            'order': segment['order'],
            'regions': [],
            'created_at': segment['created_at'].isoformat()
        })

    return jsonify(created), 201


# ============ OBJECT REGIONS (Step 2: Segmentation) ============

@segments_bp.route('/<segment_id>/regions', methods=['GET'])
@token_required
def get_segment_regions(segment_id):
    try:
        regions = list(current_app.db.object_regions.find({'segment_id': ObjectId(segment_id)}))
    except Exception:
        return jsonify({'error': 'Invalid segment ID'}), 400

    result = []
    for r in regions:
        caption = current_app.db.captions.find_one({'region_id': r['_id']})
        result.append({
            'id': str(r['_id']),
            'segment_id': str(r['segment_id']),
            'video_id': str(r['video_id']),
            'frame_time': r['frame_time'],
            'segmented_mask': r.get('segmented_mask', ''),
            'label': r.get('label', ''),
            'color': r.get('color', '#FF0000'),
            'caption': {
                'id': str(caption['_id']),
                'visual_caption': caption.get('visual_caption', ''),
                'contextual_caption': caption.get('contextual_caption', ''),
                'knowledge_caption': caption.get('knowledge_caption', ''),
                'combined_caption': caption.get('combined_caption', ''),
                'visual_caption_vi': caption.get('visual_caption_vi', ''),
                'contextual_caption_vi': caption.get('contextual_caption_vi', ''),
                'knowledge_caption_vi': caption.get('knowledge_caption_vi', ''),
                'combined_caption_vi': caption.get('combined_caption_vi', '')
            } if caption else None,
            'created_at': r['created_at'].isoformat()
        })

    return jsonify(result)


@segments_bp.route('/<segment_id>/regions', methods=['POST'])
@token_required
def create_region(segment_id):
    data = request.get_json()

    try:
        segment = current_app.db.video_segments.find_one({'_id': ObjectId(segment_id)})
    except Exception:
        return jsonify({'error': 'Invalid segment ID'}), 400

    if not segment:
        return jsonify({'error': 'Segment not found'}), 404

    region = {
        'segment_id': ObjectId(segment_id),
        'video_id': segment['video_id'],
        'frame_time': float(data.get('frame_time', 0)),
        'brush_mask': data.get('brush_mask', ''),
        'segmented_mask': data.get('segmented_mask', ''),
        'label': data.get('label', 'Object'),
        'color': data.get('color', '#FF0000'),
        'created_by': request.current_user['_id'],
        'created_at': datetime.now(timezone.utc),
        'updated_at': datetime.now(timezone.utc)
    }

    result = current_app.db.object_regions.insert_one(region)

    return jsonify({
        'id': str(result.inserted_id),
        'segment_id': segment_id,
        'video_id': str(segment['video_id']),
        'frame_time': region['frame_time'],
        'brush_mask': region['brush_mask'],
        'segmented_mask': region['segmented_mask'],
        'label': region['label'],
        'color': region['color'],
        'created_at': region['created_at'].isoformat()
    }), 201


@segments_bp.route('/regions/<region_id>', methods=['PUT'])
@token_required
def update_region(region_id):
    data = request.get_json()

    try:
        region = current_app.db.object_regions.find_one({'_id': ObjectId(region_id)})
    except Exception:
        return jsonify({'error': 'Invalid region ID'}), 400

    if not region:
        return jsonify({'error': 'Region not found'}), 404

    update_fields = {}
    if 'label' in data:
        update_fields['label'] = data['label']
    if 'color' in data:
        update_fields['color'] = data['color']
    if 'brush_mask' in data:
        update_fields['brush_mask'] = data['brush_mask']
    if 'segmented_mask' in data:
        update_fields['segmented_mask'] = data['segmented_mask']
    if 'frame_time' in data:
        update_fields['frame_time'] = float(data['frame_time'])
    update_fields['updated_at'] = datetime.now(timezone.utc)

    current_app.db.object_regions.update_one(
        {'_id': ObjectId(region_id)},
        {'$set': update_fields}
    )

    return jsonify({'message': 'Region updated successfully'})


@segments_bp.route('/regions/<region_id>', methods=['DELETE'])
@token_required
def delete_region(region_id):
    try:
        region = current_app.db.object_regions.find_one({'_id': ObjectId(region_id)})
    except Exception:
        return jsonify({'error': 'Invalid region ID'}), 400

    if not region:
        return jsonify({'error': 'Region not found'}), 404

    current_app.db.captions.delete_many({'region_id': ObjectId(region_id)})
    current_app.db.object_regions.delete_one({'_id': ObjectId(region_id)})

    return jsonify({'message': 'Region deleted successfully'})


# ============ SAM2 SEGMENTATION API (proxied to DAM server) ============

def _fallback_segmentation(brush_mask_b64):
    """Fallback segmentation using PIL when DAM/SAM2 server is not available."""
    from PIL import Image, ImageFilter
    import numpy as np

    mask_data = base64.b64decode(brush_mask_b64.split(',')[-1] if ',' in brush_mask_b64 else brush_mask_b64)
    mask_image = Image.open(io.BytesIO(mask_data)).convert('L')

    # Smooth + threshold + morphological closing
    smoothed = mask_image.filter(ImageFilter.GaussianBlur(radius=3))
    mask_array = np.array(smoothed)
    binary_mask = (mask_array > 128).astype(np.uint8) * 255
    result_image = Image.fromarray(binary_mask, mode='L')
    result_image = result_image.filter(ImageFilter.MaxFilter(5))
    result_image = result_image.filter(ImageFilter.MinFilter(3))
    result_image = result_image.filter(ImageFilter.GaussianBlur(radius=2))

    result_array = np.array(result_image)
    final_mask = (result_array > 100).astype(np.uint8) * 255
    result_image = Image.fromarray(final_mask, mode='L')

    buffer = io.BytesIO()
    result_image.save(buffer, format='PNG')
    segmented_mask_b64 = base64.b64encode(buffer.getvalue()).decode('utf-8')

    return {
        'segmented_mask': f'data:image/png;base64,{segmented_mask_b64}',
        'confidence': 0.85,
        'message': 'Segmentation completed (fallback - DAM/SAM2 server not available)'
    }


@segments_bp.route('/segment-object', methods=['POST'])
@token_required
def segment_object():
    """
    Object segmentation API - proxies to DAM server's /segment endpoint.
    Receives brush_mask (user-drawn region) + frame_image (video frame).
    DAM server uses SAM2 to produce a precise segmentation mask.
    Falls back to PIL-based processing if DAM server is not available.
    """
    data = request.get_json()
    brush_mask_b64 = data.get('brush_mask', '')
    frame_image_b64 = data.get('frame_image', '')

    if not brush_mask_b64:
        return jsonify({'error': 'brush_mask is required'}), 400

    try:
        dam_url = get_dam_url()
        response = http_requests.post(
            f"{dam_url}/segment",
            json={
                'brush_mask': brush_mask_b64,
                'frame_image': frame_image_b64
            },
            timeout=120
        )

        if response.status_code == 200:
            return jsonify(response.json())
        else:
            print(f"[SAM2] DAM server /segment error {response.status_code}: {response.text}")
            # Fallback to local processing
            result = _fallback_segmentation(brush_mask_b64)
            return jsonify(result)

    except http_requests.exceptions.ConnectionError:
        print(f"[SAM2] Cannot connect to DAM server at {get_dam_url()}/segment, using fallback")
        result = _fallback_segmentation(brush_mask_b64)
        return jsonify(result)
    except http_requests.exceptions.Timeout:
        print("[SAM2] DAM server /segment timed out, using fallback")
        result = _fallback_segmentation(brush_mask_b64)
        return jsonify(result)
    except Exception as e:
        traceback.print_exc()
        try:
            result = _fallback_segmentation(brush_mask_b64)
            return jsonify(result)
        except Exception:
            return jsonify({
                'segmented_mask': brush_mask_b64 if brush_mask_b64.startswith('data:') else f'data:image/png;base64,{brush_mask_b64}',
                'confidence': 0.5,
                'message': f'Segmentation fallback: {str(e)}'
            })
