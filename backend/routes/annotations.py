from flask import Blueprint, request, jsonify, current_app, send_file, after_this_request
from datetime import datetime, timezone
from bson import ObjectId
from config import Config
from utils.auth_middleware import token_required
from routes.settings import get_dam_url
import base64
import io
import os
import json
import re
import subprocess
import tempfile
import zipfile
import shutil
import threading
import uuid
import time
import logging
import requests as http_requests
import traceback

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

annotations_bp = Blueprint('annotations', __name__)


def _serialize_object_id_list(values):
    if not values:
        return []
    result = []
    for value in values:
        try:
            result.append(str(value))
        except Exception:
            continue
    return result


def _parse_object_id_list(values):
    if not isinstance(values, list):
        return []
    parsed = []
    for value in values:
        try:
            parsed.append(ObjectId(str(value)))
        except Exception:
            continue
    return parsed


def _reset_video_approval_if_needed(video_id):
    """Reset video review status if it was approved (content changed)."""
    video = current_app.db.videos.find_one({'_id': video_id})
    if video and video.get('review_status') == 'approved':
        current_app.db.videos.update_one(
            {'_id': video_id},
            {'$set': {
                'review_status': 'not_submitted',
                'reviews': [],
                'review_comment': 'Auto-reset: Content modified after approval',
                'updated_at': datetime.now(timezone.utc)
            }}
        )


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
            'visual_caption_vi': c.get('visual_caption_vi', ''),
            'contextual_caption_vi': c.get('contextual_caption_vi', ''),
            'knowledge_caption_vi': c.get('knowledge_caption_vi', ''),
            'combined_caption_vi': c.get('combined_caption_vi', ''),
            'knowledge_base_ids': _serialize_object_id_list(c.get('knowledge_base_ids', [])),
            'created_by': str(c['created_by']),
            'created_at': c['created_at'].isoformat(),
            'updated_at': c.get('updated_at', c['created_at']).isoformat()
        })

    return jsonify(result)


@annotations_bp.route('/segment-caption/<segment_id>', methods=['GET'])
@token_required
def get_segment_caption(segment_id):
    """Get segment-level caption (region_id is None)"""
    try:
        caption = current_app.db.captions.find_one({
            'segment_id': ObjectId(segment_id),
            'region_id': None
        })
    except Exception:
        return jsonify({'error': 'Invalid segment ID'}), 400

    if not caption:
        return jsonify(None)

    return jsonify({
        'id': str(caption['_id']),
        'segment_id': str(caption['segment_id']),
        'video_id': str(caption['video_id']),
        'region_id': None,
        'contextual_caption': caption.get('contextual_caption', ''),
        'knowledge_caption': caption.get('knowledge_caption', ''),
        'combined_caption': caption.get('combined_caption', ''),
        'contextual_caption_vi': caption.get('contextual_caption_vi', ''),
        'knowledge_caption_vi': caption.get('knowledge_caption_vi', ''),
        'combined_caption_vi': caption.get('combined_caption_vi', ''),
        'knowledge_base_ids': _serialize_object_id_list(caption.get('knowledge_base_ids', [])),
        'created_at': caption['created_at'].isoformat(),
        'updated_at': caption.get('updated_at', caption['created_at']).isoformat()
    })


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
        'visual_caption_vi': caption.get('visual_caption_vi', ''),
        'contextual_caption_vi': caption.get('contextual_caption_vi', ''),
        'knowledge_caption_vi': caption.get('knowledge_caption_vi', ''),
        'combined_caption_vi': caption.get('combined_caption_vi', ''),
        'knowledge_base_ids': _serialize_object_id_list(caption.get('knowledge_base_ids', [])),
        'created_at': caption['created_at'].isoformat(),
        'updated_at': caption.get('updated_at', caption['created_at']).isoformat()
    })

def _fetch_knowledge_for_caption(db, caption):
    kb_ids = caption.get('knowledge_base_ids', []) if caption else []
    en_desc, vi_desc, en_graph, vi_graph = [], [], [], []
    for kb_id in kb_ids:
        node = db.knowledge_base.find_one({'_id': kb_id})
        if node:
            if str(node.get('description', '')).strip(): en_desc.append(node['description'])
            if str(node.get('description_vi', '')).strip(): vi_desc.append(node['description_vi'])
            if str(node.get('description_graph', '')).strip(): en_graph.append(node['description_graph'])
            if str(node.get('description_graph_vi', '')).strip(): vi_graph.append(node['description_graph_vi'])
            
    return {
        'knowledge_en': '\n\n'.join(en_desc),
        'knowledge_vi': '\n\n'.join(vi_desc),
        'knowledge_graph_en': '\n\n'.join(en_graph),
        'knowledge_graph_vi': '\n\n'.join(vi_graph)
    }


def _segment_kb_id(db, caption):
    """Return the id (Mongo _id) of the first knowledge_base node attached to the
    caption, or None when the segment is out of KB (no knowledge_base_ids)."""
    kb_ids = caption.get('knowledge_base_ids') if caption else None
    if not kb_ids:
        return None
    return str(kb_ids[0])


def _build_segment_metadata(db, video, subpart_map):
    """Build the per-video metadata dict shared by the labeled/segmented-kb
    exports and the metadata-only endpoint. `path` is computed identically to
    the ZIP layout (subpart/<sanitized video name>) so it maps to downloaded files."""
    target_subpart_id = str(video.get('subpart_id', 'Unassigned'))
    subpart_name = _sanitize_name(subpart_map.get(target_subpart_id, 'Unassigned'))
    original_name = video.get('original_name') or video.get('filename')
    base, ext = os.path.splitext(original_name)
    safe_name = _sanitize_name(base) + (ext if ext else '')

    segments = list(db.video_segments.find({'video_id': video['_id']}).sort('order', 1))
    segments_info = []
    for seg in segments:
        seg_caption = db.captions.find_one({'segment_id': seg['_id'], 'region_id': None})
        gt = {}
        if seg_caption:
            kdata = _fetch_knowledge_for_caption(db, seg_caption)
            gt = {
                'contextual_en': seg_caption.get('contextual_caption', ''),
                'contextual_vi': seg_caption.get('contextual_caption_vi', ''),
                'combined_en': seg_caption.get('combined_caption', ''),
                'combined_vi': seg_caption.get('combined_caption_vi', ''),
                'knowledge_en': kdata['knowledge_en'],
                'knowledge_vi': kdata['knowledge_vi'],
                'knowledge_graph_en': kdata['knowledge_graph_en'],
                'knowledge_graph_vi': kdata['knowledge_graph_vi'],
            }
        segments_info.append({
            'id': str(seg['_id']),
            'name': seg.get('name', ''),
            'kb_id': _segment_kb_id(db, seg_caption),
            'start_time': seg['start_time'],
            'end_time': seg['end_time'],
            'duration': round(seg['end_time'] - seg['start_time'], 3),
            'ground_truth_captions': {'segment_level': gt}
        })

    return {
        'video_id': str(video['_id']),
        'video_name': video.get('original_name', ''),
        'subpart': subpart_map.get(target_subpart_id, 'Unassigned'),
        'path': f"{subpart_name}/{safe_name}",
        'duration': video.get('duration', 0),
        'width': video.get('width', 0),
        'height': video.get('height', 0),
        'fps': video.get('fps', 0),
        'total_segments': len(segments_info),
        'segments': segments_info
    }


@annotations_bp.route('', methods=['POST'])
@token_required
def create_caption():
    data = request.get_json()

    if not data.get('segment_id') or not data.get('video_id'):
        return jsonify({'error': 'segment_id and video_id are required'}), 400

    # Check if caption already exists
    if data.get('region_id'):
        existing = current_app.db.captions.find_one({
            'region_id': ObjectId(data['region_id']),
            'segment_id': ObjectId(data['segment_id'])
        })
    else:
        # Segment-level caption (region_id is None)
        existing = current_app.db.captions.find_one({
            'segment_id': ObjectId(data['segment_id']),
            'region_id': None
        })

    if existing:
        current_app.db.captions.update_one(
            {'_id': existing['_id']},
            {'$set': {
                'visual_caption': data.get('visual_caption', existing.get('visual_caption', '')),
                'contextual_caption': data.get('contextual_caption', existing.get('contextual_caption', '')),
                'knowledge_caption': data.get('knowledge_caption', existing.get('knowledge_caption', '')),
                'combined_caption': data.get('combined_caption', existing.get('combined_caption', '')),
                'visual_caption_vi': data.get('visual_caption_vi', existing.get('visual_caption_vi', '')),
                'contextual_caption_vi': data.get('contextual_caption_vi', existing.get('contextual_caption_vi', '')),
                'knowledge_caption_vi': data.get('knowledge_caption_vi', existing.get('knowledge_caption_vi', '')),
                'combined_caption_vi': data.get('combined_caption_vi', existing.get('combined_caption_vi', '')),
                'knowledge_base_ids': _parse_object_id_list(data.get('knowledge_base_ids', existing.get('knowledge_base_ids', []))),
                'updated_at': datetime.now(timezone.utc)
            }}

        )
        
        # Reset video approval if was approved
        _reset_video_approval_if_needed(ObjectId(data['video_id']))
        
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
            'visual_caption_vi': updated.get('visual_caption_vi', ''),
            'contextual_caption_vi': updated.get('contextual_caption_vi', ''),
            'knowledge_caption_vi': updated.get('knowledge_caption_vi', ''),
            'combined_caption_vi': updated.get('combined_caption_vi', ''),
            'knowledge_base_ids': _serialize_object_id_list(updated.get('knowledge_base_ids', [])),
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
        'visual_caption_vi': data.get('visual_caption_vi', ''),
        'contextual_caption_vi': data.get('contextual_caption_vi', ''),
        'knowledge_caption_vi': data.get('knowledge_caption_vi', ''),
        'combined_caption_vi': data.get('combined_caption_vi', ''),
        'knowledge_base_ids': _parse_object_id_list(data.get('knowledge_base_ids', [])),

        'created_by': request.current_user['_id'],
        'created_at': datetime.now(timezone.utc),
        'updated_at': datetime.now(timezone.utc)
    }

    result = current_app.db.captions.insert_one(caption)
    
    # Reset video approval if was approved
    _reset_video_approval_if_needed(ObjectId(data['video_id']))

    return jsonify({
        'id': str(result.inserted_id),
        'segment_id': data['segment_id'],
        'video_id': data['video_id'],
        'region_id': data.get('region_id'),
        'visual_caption': caption['visual_caption'],
        'contextual_caption': caption['contextual_caption'],
        'knowledge_caption': caption['knowledge_caption'],
        'combined_caption': caption['combined_caption'],
        'visual_caption_vi': caption['visual_caption_vi'],
        'contextual_caption_vi': caption['contextual_caption_vi'],
        'knowledge_caption_vi': caption['knowledge_caption_vi'],
        'combined_caption_vi': caption['combined_caption_vi'],
        'knowledge_base_ids': _serialize_object_id_list(caption.get('knowledge_base_ids', [])),
        'created_at': caption['created_at'].isoformat()
    }), 201


@annotations_bp.route('/bulk-combined-targets', methods=['GET'])
@token_required
def get_bulk_combined_targets():
    """
    Fetch all captions that have at least one knowledge base ID.
    Returns visual, contextual, knowledge info to be used by external generator tools.
    """
    query = {
        'knowledge_base_ids': {'$exists': True, '$ne': []}
    }
    
    # We only return needed fields to keep the response light
    projection = {
        'segment_id': 1,
        'video_id': 1,
        'region_id': 1,
        'visual_caption': 1,
        'contextual_caption': 1,
        'visual_caption_vi': 1,
        'contextual_caption_vi': 1,
        'knowledge_base_ids': 1
    }
    
    captions_cursor = current_app.db.captions.find(query, projection)
    results = []
    
    for caption in captions_cursor:
        # Resolve knowledge texts
        knowledge_info = _fetch_knowledge_for_caption(current_app.db, caption)
        
        results.append({
            'id': str(caption['_id']),
            'segment_id': str(caption.get('segment_id', '')),
            'video_id': str(caption.get('video_id', '')),
            'region_id': str(caption.get('region_id', '')) if caption.get('region_id') else None,
            'visual_caption': caption.get('visual_caption', ''),
            'contextual_caption': caption.get('contextual_caption', ''),
            'visual_caption_vi': caption.get('visual_caption_vi', ''),
            'contextual_caption_vi': caption.get('contextual_caption_vi', ''),
            'knowledge_en': knowledge_info['knowledge_en'],
            'knowledge_vi': knowledge_info['knowledge_vi'],
            'knowledge_base_ids': _serialize_object_id_list(caption.get('knowledge_base_ids', []))
        })
        
    return jsonify(results), 200


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
    if 'visual_caption_vi' in data:
        update_fields['visual_caption_vi'] = data['visual_caption_vi']
    if 'contextual_caption_vi' in data:
        update_fields['contextual_caption_vi'] = data['contextual_caption_vi']
    if 'knowledge_caption_vi' in data:
        update_fields['knowledge_caption_vi'] = data['knowledge_caption_vi']
    if 'combined_caption_vi' in data:
        update_fields['combined_caption_vi'] = data['combined_caption_vi']
    if 'knowledge_base_ids' in data:
        update_fields['knowledge_base_ids'] = _parse_object_id_list(data.get('knowledge_base_ids', []))
    update_fields['updated_at'] = datetime.now(timezone.utc)

    current_app.db.captions.update_one(
        {'_id': ObjectId(caption_id)},
        {'$set': update_fields}
    )
    
    # Reset video approval if was approved (skip if caller requests it, e.g. bulk scripts)
    if not data.get('skip_approval_reset', False):
        _reset_video_approval_if_needed(caption['video_id'])

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
        'visual_caption_vi': updated.get('visual_caption_vi', ''),
        'contextual_caption_vi': updated.get('contextual_caption_vi', ''),
        'knowledge_caption_vi': updated.get('knowledge_caption_vi', ''),
        'combined_caption_vi': updated.get('combined_caption_vi', ''),
        'knowledge_base_ids': _serialize_object_id_list(updated.get('knowledge_base_ids', [])),
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


# ============ DAM AUTO-CAPTION (Video Mode: 8 frames) ============

def _call_dam_server(rgba_base64_list: list, prompt: str) -> str:
    """
    Call the DAM (Describe Anything Model) server with RGBA images.
    For video mode, pass exactly 8 RGBA images (each frame with mask as alpha).
    For single image mode, pass a list with 1 item.
    """
    dam_url = get_dam_url()

    # Build content: each image as separate image_url entry + text prompt
    content = []
    for rgba_b64 in rgba_base64_list:
        content.append({
            "type": "image_url",
            "image_url": {"url": rgba_b64}
        })
    content.append({
        "type": "text",
        "text": prompt
    })

    payload = {
        "model": "describe_anything_model",
        "messages": [
            {
                "role": "user",
                "content": content
            }
        ],
        "max_tokens": 512,
        "temperature": 0.2,
        "top_p": 0.5,
        "use_cache": True,
        "num_beams": 1,
    }

    response = http_requests.post(
        f"{dam_url}/chat/completions",
        json=payload,
        timeout=180
    )
    if response.status_code != 200:
        raise Exception(f"DAM server error {response.status_code}: {response.text}")

    result = response.json()
    return result['choices'][0]['message']['content']


def _make_rgba_image(frame_b64: str, mask_b64: str) -> str:
    """Combine RGB frame + grayscale mask into RGBA PNG base64."""
    from PIL import Image

    frame_data = base64.b64decode(
        frame_b64.split(',')[-1] if ',' in frame_b64 else frame_b64
    )
    frame_img = Image.open(io.BytesIO(frame_data)).convert('RGB')

    mask_data = base64.b64decode(
        mask_b64.split(',')[-1] if ',' in mask_b64 else mask_b64
    )
    mask_img = Image.open(io.BytesIO(mask_data)).convert('L')

    # Safety: resize mask if still mismatched (frontend should handle this)
    if mask_img.size != frame_img.size:
        print(f"[DAM] Warning: mask {mask_img.size} != frame {frame_img.size}, rescaling")
        mask_img = mask_img.resize(frame_img.size, Image.NEAREST)

    rgba = Image.merge('RGBA', frame_img.split() + (mask_img,))
    buffer = io.BytesIO()
    rgba.save(buffer, format='PNG')
    img_b64 = base64.b64encode(buffer.getvalue()).decode('utf-8')
    return f"data:image/png;base64,{img_b64}"


def _make_full_mask_rgba(frame_b64: str) -> str:
    """Create RGBA image with full white mask (entire frame visible)."""
    from PIL import Image

    frame_data = base64.b64decode(
        frame_b64.split(',')[-1] if ',' in frame_b64 else frame_b64
    )
    frame_img = Image.open(io.BytesIO(frame_data)).convert('RGB')

    full_mask = Image.new('L', frame_img.size, 255)
    rgba = Image.merge('RGBA', frame_img.split() + (full_mask,))
    buffer = io.BytesIO()
    rgba.save(buffer, format='PNG')
    img_b64 = base64.b64encode(buffer.getvalue()).decode('utf-8')
    return f"data:image/png;base64,{img_b64}"


def _pad_or_trim_frames(frames: list, target: int = 8) -> list:
    """
    Ensure exactly `target` frames by duplicating the last frame or trimming.
    This handles segments with < 8 or > 8 provided frames.
    """
    if len(frames) == 0:
        return []
    if len(frames) >= target:
        # Evenly sample target frames
        step = len(frames) / target
        return [frames[int(i * step)] for i in range(target)]
    # Pad by repeating last frame
    while len(frames) < target:
        frames.append(frames[-1])
    return frames


@annotations_bp.route('/generate-caption', methods=['POST'])
@token_required
def generate_caption():
    """
    Auto-generate caption using DAM server (video mode: 8 frames).
    Only 1 of the 8 frames carries the mask; the other 7 have zero-alpha.
    Accepts:
      - frames: list of 8 base64 frame images (evenly sampled from segment)
      - mask_image: base64 of the object mask (for visual caption)
      - mask_frame_index: which frame (0-7) gets the mask (default 0)
      - caption_type: 'visual' | 'contextual'
    Returns:
      - caption: generated text
    """
    data = request.get_json()
    caption_type = data.get('caption_type', 'visual')
    frames = data.get('frames', [])
    mask_image = data.get('mask_image', '')

    if not frames or len(frames) == 0:
        return jsonify({'error': 'frames (list of base64 images) is required'}), 400

    # Ensure exactly 8 frames
    frames = _pad_or_trim_frames(frames, 8)

    try:
        if caption_type == 'visual':
            # Visual Caption: all 8 frames get the object mask as alpha channel
            if not mask_image:
                return jsonify({'error': 'mask_image is required for visual caption'}), 400

            img_list = [_make_rgba_image(f, mask_image) for f in frames]
            prompt = "\nDescribe the masked region in detail. Focus on the visual appearance, shape, color, texture, and any distinguishing features of the object across the video frames."
            caption = _call_dam_server(img_list, prompt)

        elif caption_type == 'contextual':
            # Contextual Caption: all 8 frames get full-white mask (entire frame is the region)
            img_list = [_make_full_mask_rgba(f) for f in frames]
            prompt = "\nDescribe the overall scene in this video segment. Focus on the context, environment, spatial relationships between objects, and what is happening across the frames."
            caption = _call_dam_server(img_list, prompt)

        else:
            return jsonify({'error': f'Unknown caption_type: {caption_type}'}), 400

        return jsonify({
            'caption': caption,
            'caption_type': caption_type
        })

    except http_requests.exceptions.ConnectionError:
        return jsonify({
            'error': f'Cannot connect to DAM server at {get_dam_url()}. Make sure the server is running.'
        }), 503
    except http_requests.exceptions.Timeout:
        return jsonify({
            'error': 'DAM server request timed out. The model may be loading or processing.'
        }), 504
    except Exception as e:
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500


@annotations_bp.route('/generate-caption-batch', methods=['POST'])
@token_required
def generate_caption_batch():
    """
    Auto-generate both visual and contextual captions for a region (video mode: 8 frames).
    Only 1 of the 8 frames carries the mask; the other 7 have zero-alpha.
    Accepts:
      - frames: list of 8 base64 frame images (evenly sampled from segment)
      - mask_image: base64 of the object's segmented mask
      - mask_frame_index: which frame (0-7) gets the mask (default 0)
    Returns:
      - visual_caption, contextual_caption
    """
    data = request.get_json()
    frames = data.get('frames', [])
    mask_image = data.get('mask_image', '')

    if not frames or not mask_image:
        return jsonify({'error': 'frames and mask_image are required'}), 400

    frames = _pad_or_trim_frames(frames, 8)
    results = {}
    errors = []

    try:
        # 1. Visual caption: all 8 frames get the object mask as alpha
        img_visual_list = [_make_rgba_image(f, mask_image) for f in frames]
        visual_prompt = "\nDescribe the masked region in detail. Focus on the visual appearance, shape, color, texture, and any distinguishing features of the object across the video frames."
        results['visual_caption'] = _call_dam_server(img_visual_list, visual_prompt)
    except Exception as e:
        errors.append(f"Visual caption error: {str(e)}")
        results['visual_caption'] = ''

    try:
        # 2. Contextual caption: all 8 frames get full-white mask (entire frame)
        img_context_list = [_make_full_mask_rgba(f) for f in frames]
        context_prompt = "\nDescribe the overall scene in this video segment. Focus on the context, environment, spatial relationships between objects, and what is happening across the frames."
        results['contextual_caption'] = _call_dam_server(img_context_list, context_prompt)
    except Exception as e:
        errors.append(f"Contextual caption error: {str(e)}")
        results['contextual_caption'] = ''

    if errors:
        results['warnings'] = errors

    return jsonify(results)


# ============ EXPORT ============

@annotations_bp.route('/export/video/<video_id>', methods=['GET'])
@token_required
def export_video_annotations(video_id):
    """Export all annotations for a single video in standard dataset format"""
    try:
        video = current_app.db.videos.find_one({'_id': ObjectId(video_id)})
    except Exception:
        return jsonify({'error': 'Invalid video ID'}), 400

    if not video:
        return jsonify({'error': 'Video not found'}), 404

    video_data = _build_video_export(video)
    
    # Get project info
    project = None
    if video.get('project_id'):
        project = current_app.db.projects.find_one({'_id': ObjectId(video['project_id'])})

    export_data = {
        'dataset_info': {
            'name': project.get('name', 'Video Annotation Dataset') if project else 'Video Annotation Dataset',
            'description': project.get('description', '') if project else '',
            'version': '1.0',
            'format': 'video_annotation_v1',
            'export_date': datetime.utcnow().isoformat() + 'Z',
            'total_videos': 1,
            'total_segments': len(video_data['segments']),
            'total_regions': sum(len(s['regions']) for s in video_data['segments']),
            'languages': ['en', 'vi']
        },
        'videos': [video_data]
    }

    return jsonify(export_data)


@annotations_bp.route('/export/project/<project_id>', methods=['GET'])
@token_required
def export_project_annotations(project_id):
    """Export all annotations for an entire project in standard dataset format"""
    try:
        project = current_app.db.projects.find_one({'_id': ObjectId(project_id)})
    except Exception:
        return jsonify({'error': 'Invalid project ID'}), 400

    if not project:
        return jsonify({'error': 'Project not found'}), 404

    videos = list(current_app.db.videos.find({'project_id': ObjectId(project_id)}))

    videos_data = []
    total_segments = 0
    total_regions = 0
    total_captions = 0

    for video in videos:
        v = _build_video_export(video)
        videos_data.append(v)
        total_segments += len(v['segments'])
        for seg in v['segments']:
            total_regions += len(seg['regions'])
            total_captions += sum(1 for r in seg['regions'] if r.get('captions', {}).get('en', {}).get('visual'))
            if seg.get('segment_captions'):
                total_captions += len(seg['segment_captions'])

    # Subparts
    subparts = list(current_app.db.subparts.find({'project_id': ObjectId(project_id)}).sort('order', 1))
    subparts_data = []
    for sp in subparts:
        sp_videos = [str(v['_id']) for v in videos if str(v.get('subpart_id', '')) == str(sp['_id'])]
        subparts_data.append({
            'id': str(sp['_id']),
            'name': sp.get('name', ''),
            'description': sp.get('description', ''),
            'order': sp.get('order', 0),
            'video_ids': sp_videos
        })

    export_data = {
        'dataset_info': {
            'name': project.get('name', ''),
            'description': project.get('description', ''),
            'version': '1.0',
            'format': 'video_annotation_v1',
            'export_date': datetime.utcnow().isoformat() + 'Z',
            'total_videos': len(videos_data),
            'total_segments': total_segments,
            'total_regions': total_regions,
            'total_captions': total_captions,
            'languages': ['en', 'vi']
        },
        'project': {
            'id': str(project['_id']),
            'name': project.get('name', ''),
            'description': project.get('description', ''),
            'status': project.get('status', ''),
            'subparts': subparts_data
        },
        'videos': videos_data
    }

    return jsonify(export_data)


def _get_kb_items_for_caption(caption):
    if not caption or not caption.get('knowledge_base_ids'):
        return [], []
    
    kb_ids = _serialize_object_id_list(caption['knowledge_base_ids'])
    kb_items = []
    
    try:
        nodes = list(current_app.db.knowledge_base.find({'_id': {'$in': caption['knowledge_base_ids']}}))
        for node in nodes:
            kb_items.append({
                'id': str(node['_id']),
                'kb_id': node.get('kb_id', ''),
                'name': node.get('name', ''),
                'name_vi': node.get('name_vi', ''),
                'type': node.get('type', 'concept'),
                'description': node.get('description', ''),
                'description_vi': node.get('description_vi', ''),
                'visual_cues': node.get('visual_cues', ''),
                'visual_cues_vi': node.get('visual_cues_vi', '')
            })
    except Exception as e:
        print(f"Error fetching KB items: {e}")
        
    return kb_ids, kb_items


def _build_video_export(video):
    """Build export data for a single video with all segments, regions, masks, captions."""
    video_id = video['_id']

    segments = list(current_app.db.video_segments.find(
        {'video_id': video_id}
    ).sort('order', 1))

    segments_data = []
    for seg in segments:
        regions = list(current_app.db.object_regions.find({'segment_id': seg['_id']}))
        regions_data = []

        for r in regions:
            caption = current_app.db.captions.find_one({'region_id': r['_id']})
            kb_ids, kb_items = _get_kb_items_for_caption(caption)

            kdata = _fetch_knowledge_for_caption(current_app.db, caption) if caption else {'knowledge_en': '', 'knowledge_vi': '', 'knowledge_graph_en': '', 'knowledge_graph_vi': ''}

            region_data = {
                'id': str(r['_id']),
                'label': r.get('label', ''),
                'color': r.get('color', ''),
                'category': r.get('category_name', ''),
                'frame_time': r['frame_time'],
                'segmented_mask': r.get('segmented_mask', ''),
                'captions': {
                    'en': {
                        'visual': caption.get('visual_caption', '') if caption else '',
                        'knowledge': kdata['knowledge_en'],
                        'knowledge_graph': kdata['knowledge_graph_en'],
                        'combined': caption.get('combined_caption', '') if caption else ''
                    },
                    'vi': {
                        'visual': caption.get('visual_caption_vi', '') if caption else '',
                        'knowledge': kdata['knowledge_vi'],
                        'knowledge_graph': kdata['knowledge_graph_vi'],
                        'combined': caption.get('combined_caption_vi', '') if caption else ''
                    },
                    'knowledge_base_ids': kb_ids,
                    'knowledge_base_items': kb_items
                }
            }
            regions_data.append(region_data)

        # Segment-level captions
        seg_captions = list(current_app.db.captions.find({
            'segment_id': seg['_id'],
            'region_id': None
        }))
        seg_captions_data = []
        for c in seg_captions:
            kb_ids, kb_items = _get_kb_items_for_caption(c)
            kdata = _fetch_knowledge_for_caption(current_app.db, c)
            seg_captions_data.append({
                'en': {
                    'contextual': c.get('contextual_caption', ''),
                    'knowledge': kdata['knowledge_en'],
                    'knowledge_graph': kdata['knowledge_graph_en'],
                    'combined': c.get('combined_caption', '')
                },
                'vi': {
                    'contextual': c.get('contextual_caption_vi', ''),
                    'knowledge': kdata['knowledge_vi'],
                    'knowledge_graph': kdata['knowledge_graph_vi'],
                    'combined': c.get('combined_caption_vi', '')
                },
                'knowledge_base_ids': kb_ids,
                'knowledge_base_items': kb_items
            })

        seg_data = {
            'id': str(seg['_id']),
            'name': seg.get('name', ''),
            'start_time': seg['start_time'],
            'end_time': seg['end_time'],
            'duration': round(seg['end_time'] - seg['start_time'], 3),
            'regions': regions_data,
            'segment_captions': seg_captions_data
        }
        segments_data.append(seg_data)

    return {
        'id': str(video['_id']),
        'filename': video.get('original_name', ''),
        'duration': video.get('duration', 0),
        'width': video.get('width', 0),
        'height': video.get('height', 0),
        'fps': video.get('fps', 0),
        'segments': segments_data
    }


# ============ SEGMENTED VIDEO EXPORT (ZIP with ffmpeg split) ============

def _decode_base64_image(b64_str):
    """Decode a base64 image string (with optional data URI prefix) to bytes."""
    if not b64_str:
        return None
    if ',' in b64_str:
        b64_str = b64_str.split(',', 1)[1]
    try:
        return base64.b64decode(b64_str)
    except Exception:
        return None


def _sanitize_name(name):
    """Sanitize a name for use as folder/file name."""
    if not name:
        return 'unnamed'
    return re.sub(r'[^\w\-]', '_', name).strip('_')[:80] or 'unnamed'


@annotations_bp.route('/export/video/<video_id>/segmented', methods=['GET'])
@token_required
def export_segmented_video(video_id):
    """Export video split into segments as a ZIP file with metadata and masks.
    
    Each segment is cut using ffmpeg (stream copy, preserves audio).
    Includes brush_mask and segmented_mask PNGs for each region,
    plus a metadata.json with ground truth captions for metric evaluation.
    """
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

    if not segments:
        return jsonify({'error': 'No segments found for this video'}), 400

    # Find video file on disk
    video_path = os.path.join(Config.UPLOAD_FOLDER, 'videos', video['filename'])
    if not os.path.exists(video_path):
        return jsonify({'error': 'Video file not found on server'}), 404

    # Create temp directory for building the ZIP contents
    tmp_dir = tempfile.mkdtemp(prefix='seg_export_')
    video_name_stem = os.path.splitext(video.get('original_name', 'video'))[0]
    root_folder = _sanitize_name(video_name_stem) + '_segments'
    root_path = os.path.join(tmp_dir, root_folder)
    os.makedirs(root_path, exist_ok=True)

    try:
        segments_info = []

        for idx, seg in enumerate(segments):
            seg_folder_name = f"segment_{idx + 1:03d}_{_sanitize_name(seg.get('name', ''))}"
            seg_dir = os.path.join(root_path, seg_folder_name)
            os.makedirs(seg_dir, exist_ok=True)

            # Split video using ffmpeg (stream copy = fast, preserves audio)
            segment_video_path = os.path.join(seg_dir, 'video.mp4')
            try:
                result = subprocess.run([
                    'ffmpeg', '-y',
                    '-ss', str(seg['start_time']),
                    '-to', str(seg['end_time']),
                    '-i', video_path,
                    '-c', 'copy',
                    '-avoid_negative_ts', 'make_zero',
                    segment_video_path
                ], capture_output=True, timeout=120)
                if result.returncode != 0:
                    logger.warning(f"[SegExport] ffmpeg warning for {seg_folder_name}: {result.stderr.decode('utf-8', errors='replace')[-500:]}")
                else:
                    logger.info(f"[SegExport] Successfully cut segment {seg_folder_name}")
            except subprocess.TimeoutExpired:
                logger.error(f"[SegExport] ffmpeg timeout for {seg_folder_name}")
            except FileNotFoundError:
                shutil.rmtree(tmp_dir, ignore_errors=True)
                return jsonify({'error': 'ffmpeg not found. Install ffmpeg on the server.'}), 500

            # Get regions for this segment
            regions = list(current_app.db.object_regions.find({'segment_id': seg['_id']}))
            regions_info = []

            if regions:
                regions_dir = os.path.join(seg_dir, 'regions')
                os.makedirs(regions_dir, exist_ok=True)

                for r_idx, region in enumerate(regions):
                    region_folder_name = f"region_{r_idx + 1:03d}_{_sanitize_name(region.get('label', ''))}"
                    region_dir = os.path.join(regions_dir, region_folder_name)
                    os.makedirs(region_dir, exist_ok=True)

                    has_brush = False
                    has_segmented = False

                    # Save brush mask
                    brush_bytes = _decode_base64_image(region.get('brush_mask', ''))
                    if brush_bytes:
                        with open(os.path.join(region_dir, 'brush_mask.png'), 'wb') as f:
                            f.write(brush_bytes)
                        has_brush = True

                    # Save segmented mask
                    seg_mask_bytes = _decode_base64_image(region.get('segmented_mask', ''))
                    if seg_mask_bytes:
                        with open(os.path.join(region_dir, 'segmented_mask.png'), 'wb') as f:
                            f.write(seg_mask_bytes)
                        has_segmented = True

                    # Get region caption
                    caption = current_app.db.captions.find_one({'region_id': region['_id']})
                    gt_captions = {}
                    if caption:
                        kdata = _fetch_knowledge_for_caption(current_app.db, caption)
                        gt_captions = {
                            'visual_en': caption.get('visual_caption', ''),
                            'visual_vi': caption.get('visual_caption_vi', ''),
                            'combined_en': caption.get('combined_caption', ''),
                            'combined_vi': caption.get('combined_caption_vi', ''),
                            'knowledge_en': kdata['knowledge_en'],
                            'knowledge_vi': kdata['knowledge_vi'],
                            'knowledge_graph_en': kdata['knowledge_graph_en'],
                            'knowledge_graph_vi': kdata['knowledge_graph_vi'],
                        }

                    regions_info.append({
                        'id': str(region['_id']),
                        'label': region.get('label', ''),
                        'folder': region_folder_name,
                        'color': region.get('color', ''),
                        'category': region.get('category_name', ''),
                        'frame_time': region.get('frame_time', 0),
                        'has_brush_mask': has_brush,
                        'has_segmented_mask': has_segmented,
                        'ground_truth_captions': gt_captions
                    })

            # Get segment-level caption
            seg_caption = current_app.db.captions.find_one({
                'segment_id': seg['_id'],
                'region_id': None
            })
            seg_gt_captions = {}
            if seg_caption:
                kdata = _fetch_knowledge_for_caption(current_app.db, seg_caption)
                seg_gt_captions = {
                    'contextual_en': seg_caption.get('contextual_caption', ''),
                    'contextual_vi': seg_caption.get('contextual_caption_vi', ''),
                    'combined_en': seg_caption.get('combined_caption', ''),
                    'combined_vi': seg_caption.get('combined_caption_vi', ''),
                    'knowledge_en': kdata['knowledge_en'],
                    'knowledge_vi': kdata['knowledge_vi'],
                    'knowledge_graph_en': kdata['knowledge_graph_en'],
                    'knowledge_graph_vi': kdata['knowledge_graph_vi'],
                }

            segments_info.append({
                'id': str(seg['_id']),
                'name': seg.get('name', ''),
                'folder': seg_folder_name,
                'start_time': seg['start_time'],
                'end_time': seg['end_time'],
                'duration': round(seg['end_time'] - seg['start_time'], 3),
                'ground_truth_captions': {
                    'segment_level': seg_gt_captions
                },
                'regions': regions_info
            })

        # Write metadata.json
        metadata = {
            'video_name': video.get('original_name', ''),
            'video_id': str(video['_id']),
            'duration': video.get('duration', 0),
            'width': video.get('width', 0),
            'height': video.get('height', 0),
            'fps': video.get('fps', 0),
            'export_date': datetime.now(timezone.utc).isoformat() + 'Z',
            'total_segments': len(segments_info),
            'total_regions': sum(len(s['regions']) for s in segments_info),
            'segments': segments_info
        }

        metadata_path = os.path.join(root_path, 'metadata.json')
        with open(metadata_path, 'w', encoding='utf-8') as f:
            json.dump(metadata, f, indent=2, ensure_ascii=False)

        # Create ZIP file
        zip_path = os.path.join(tmp_dir, f'{_sanitize_name(video_name_stem)}_segments.zip')
        with zipfile.ZipFile(zip_path, 'w') as zf:
            for dirpath, dirnames, filenames in os.walk(root_path):
                for filename in filenames:
                    file_path = os.path.join(dirpath, filename)
                    arcname = os.path.relpath(file_path, tmp_dir)
                    # Use ZIP_STORED for video files (already compressed), ZIP_DEFLATED for text
                    compress = zipfile.ZIP_STORED if filename.endswith(('.mp4', '.png')) else zipfile.ZIP_DEFLATED
                    zf.write(file_path, arcname, compress_type=compress)

        # Schedule cleanup after response is sent
        @after_this_request
        def cleanup(response):
            try:
                shutil.rmtree(tmp_dir, ignore_errors=True)
            except Exception:
                pass
            return response

        download_name = f'{_sanitize_name(video_name_stem)}_segments.zip'
        return send_file(
            zip_path,
            mimetype='application/zip',
            as_attachment=True,
            download_name=download_name
        )

    except Exception as e:
        shutil.rmtree(tmp_dir, ignore_errors=True)
        logger.error(f"Failed to export segmented video: {str(e)}")
        traceback.print_exc()
        return jsonify({'error': f'Failed to export segmented video: {str(e)}'}), 500


# ============ BATCH SEGMENTED VIDEO EXPORT ============

def process_batch_segmented_export(app, task_id, project_id, subpart_id=None):
    with app.app_context():
        try:
            db = current_app.db
            task = db.export_tasks.find_one({'_id': task_id})
            if not task:
                return

            export_dir = os.path.join(current_app.root_path, 'uploads', 'exports')
            os.makedirs(export_dir, exist_ok=True)
            _cleanup_exports(export_dir, db=db)
            
            project = db.projects.find_one({'_id': ObjectId(project_id)})
            if not project:
                db.export_tasks.update_one({'_id': task_id}, {'$set': {'status': 'failed', 'error': 'Project not found'}})
                return

            zip_filename = f"segments_export_{project_id}_{int(time.time())}.zip"
            zip_filepath = os.path.join(export_dir, zip_filename)

            query = {'project_id': ObjectId(project_id)}
            if subpart_id:
                query['subpart_id'] = ObjectId(subpart_id)
                
            videos = list(db.videos.find(query))
            
            # Filter videos: must be pending_review or approved, and have all 6 caption fields filled for all segments
            valid_videos = []
            for video in videos:
                if video.get('review_status') not in ['pending_review', 'approved']:
                    continue
                
                segments = list(db.video_segments.find({'video_id': video['_id']}))
                if not segments:
                    continue

                is_valid = True
                for seg in segments:
                    seg_caption = db.captions.find_one({'segment_id': seg['_id'], 'region_id': None})
                    if not seg_caption:
                        is_valid = False
                        break

                    # Knowledge captions are sourced dynamically from the KB
                    # (knowledge_base_ids), not the stale stored field. Mirror the
                    # logic in /eligible-videos so export and eligibility agree.
                    kdata = _fetch_knowledge_for_caption(db, seg_caption)
                    if not all([
                        seg_caption.get('contextual_caption'),
                        seg_caption.get('contextual_caption_vi'),
                        kdata['knowledge_en'],
                        kdata['knowledge_vi'],
                        seg_caption.get('combined_caption'),
                        seg_caption.get('combined_caption_vi')
                    ]):
                        is_valid = False
                        break

                if is_valid:
                    valid_videos.append(video)
            total_videos = len(valid_videos)
            if total_videos == 0:
                with zipfile.ZipFile(zip_filepath, 'w', zipfile.ZIP_STORED) as zipf:
                    zipf.writestr("metadata.json", json.dumps({"project_id": str(project_id), "videos": []}))
                db.export_tasks.update_one({'_id': task_id}, {'$set': {'status': 'completed', 'progress': 100, 'file_path': zip_filepath}})
                return

            subparts = list(db.subparts.find({'project_id': ObjectId(project_id)}))
            subpart_map = {str(sp['_id']): sp.get('name', f"Subpart_{sp['_id']}") for sp in subparts}

            processed_count = 0
            
            tmp_dir = tempfile.mkdtemp(prefix='batch_seg_export_')
            root_folder = _sanitize_name(project.get('name', 'Project')) + '_segments'
            root_path = os.path.join(tmp_dir, root_folder)
            os.makedirs(root_path, exist_ok=True)
            
            project_metadata = {
                'project_name': project.get('name', ''),
                'project_id': str(project['_id']),
                'export_date': datetime.now(timezone.utc).isoformat() + 'Z',
                'videos': []
            }

            for video in valid_videos:
                try:
                    target_subpart_id = str(video.get('subpart_id', 'Unassigned'))
                    folder_name = _sanitize_name(subpart_map.get(target_subpart_id, "Unassigned"))
                    
                    subpart_dir = os.path.join(root_path, folder_name)
                    os.makedirs(subpart_dir, exist_ok=True)
                    
                    video_name_stem = os.path.splitext(video.get('original_name', 'video'))[0]
                    video_dir = os.path.join(subpart_dir, _sanitize_name(video_name_stem) + '_segments')
                    os.makedirs(video_dir, exist_ok=True)
                    
                    video_path = os.path.join(Config.UPLOAD_FOLDER, 'videos', video['filename'])
                    if not os.path.exists(video_path):
                        continue

                    segments = list(db.video_segments.find({'video_id': video['_id']}).sort('order', 1))
                    segments_info = []

                    for idx, seg in enumerate(segments):
                        seg_folder_name = f"segment_{idx + 1:03d}_{_sanitize_name(seg.get('name', ''))}"
                        seg_dir = os.path.join(video_dir, seg_folder_name)
                        os.makedirs(seg_dir, exist_ok=True)

                        segment_video_path = os.path.join(seg_dir, 'video.mp4')
                        try:
                            result = subprocess.run([
                                'ffmpeg', '-y',
                                '-ss', str(seg['start_time']),
                                '-to', str(seg['end_time']),
                                '-i', video_path,
                                '-c', 'copy',
                                '-avoid_negative_ts', 'make_zero',
                                segment_video_path
                            ], capture_output=True, timeout=120)
                            if result.returncode != 0:
                                logger.warning(f"[BatchSegExport] ffmpeg warning for {seg_folder_name}: {result.stderr.decode('utf-8', errors='replace')[-500:]}")
                        except Exception as e:
                            logger.error(f"[BatchSegExport] Error cutting {seg_folder_name}: {str(e)}")
                            continue

                        regions = list(db.object_regions.find({'segment_id': seg['_id']}))
                        regions_info = []

                        if regions:
                            regions_dir = os.path.join(seg_dir, 'regions')
                            os.makedirs(regions_dir, exist_ok=True)

                            for r_idx, region in enumerate(regions):
                                region_folder_name = f"region_{r_idx + 1:03d}_{_sanitize_name(region.get('label', ''))}"
                                region_dir = os.path.join(regions_dir, region_folder_name)
                                os.makedirs(region_dir, exist_ok=True)

                                brush_bytes = _decode_base64_image(region.get('brush_mask', ''))
                                if brush_bytes:
                                    with open(os.path.join(region_dir, 'brush_mask.png'), 'wb') as f:
                                        f.write(brush_bytes)

                                seg_mask_bytes = _decode_base64_image(region.get('segmented_mask', ''))
                                if seg_mask_bytes:
                                    with open(os.path.join(region_dir, 'segmented_mask.png'), 'wb') as f:
                                        f.write(seg_mask_bytes)

                                caption = db.captions.find_one({'region_id': region['_id']})
                                gt_captions = {}
                                if caption:
                                    kdata = _fetch_knowledge_for_caption(db, caption)
                                    gt_captions = {
                                        'visual_en': caption.get('visual_caption', ''),
                                        'visual_vi': caption.get('visual_caption_vi', ''),
                                        'combined_en': caption.get('combined_caption', ''),
                                        'combined_vi': caption.get('combined_caption_vi', ''),
                                        'knowledge_en': kdata['knowledge_en'],
                                        'knowledge_vi': kdata['knowledge_vi'],
                                        'knowledge_graph_en': kdata['knowledge_graph_en'],
                                        'knowledge_graph_vi': kdata['knowledge_graph_vi'],
                                    }

                                regions_info.append({
                                    'id': str(region['_id']),
                                    'label': region.get('label', ''),
                                    'folder': region_folder_name,
                                    'ground_truth_captions': gt_captions
                                })

                        seg_caption = db.captions.find_one({'segment_id': seg['_id'], 'region_id': None})
                        seg_gt_captions = {}
                        if seg_caption:
                            kdata = _fetch_knowledge_for_caption(db, seg_caption)
                            seg_gt_captions = {
                                'contextual_en': seg_caption.get('contextual_caption', ''),
                                'contextual_vi': seg_caption.get('contextual_caption_vi', ''),
                                'combined_en': seg_caption.get('combined_caption', ''),
                                'combined_vi': seg_caption.get('combined_caption_vi', ''),
                                'knowledge_en': kdata['knowledge_en'],
                                'knowledge_vi': kdata['knowledge_vi'],
                                'knowledge_graph_en': kdata['knowledge_graph_en'],
                                'knowledge_graph_vi': kdata['knowledge_graph_vi'],
                            }

                        segments_info.append({
                            'id': str(seg['_id']),
                            'name': seg.get('name', ''),
                            'kb_id': _segment_kb_id(db, seg_caption),
                            'folder': seg_folder_name,
                            'start_time': seg['start_time'],
                            'end_time': seg['end_time'],
                            'ground_truth_captions': {'segment_level': seg_gt_captions},
                            'regions': regions_info
                        })

                    video_metadata = {
                        'video_name': video.get('original_name', ''),
                        'video_id': str(video['_id']),
                        'folder': _sanitize_name(video_name_stem) + '_segments',
                        'subpart': target_subpart_id,
                        'total_segments': len(segments_info),
                        'segments': segments_info
                    }
                    project_metadata['videos'].append(video_metadata)

                    processed_count += 1
                    progress = int((processed_count / total_videos) * 80)
                    db.export_tasks.update_one({'_id': task_id}, {'$set': {'progress': progress}})
                    logger.info(f"Processed {processed_count}/{total_videos} videos for task {task_id}")

                except Exception as e:
                    logger.error(f"Error processing video {video['_id']}: {str(e)}")

            # Write project metadata
            db.export_tasks.update_one({'_id': task_id}, {'$set': {'progress': 85}})
            metadata_path = os.path.join(root_path, 'metadata.json')
            with open(metadata_path, 'w', encoding='utf-8') as f:
                json.dump(project_metadata, f, indent=2, ensure_ascii=False)

            # Zip everything
            db.export_tasks.update_one({'_id': task_id}, {'$set': {'progress': 90}})
            with zipfile.ZipFile(zip_filepath, 'w') as zf:
                for dirpath, dirnames, filenames in os.walk(root_path):
                    for filename in filenames:
                        file_path = os.path.join(dirpath, filename)
                        arcname = os.path.relpath(file_path, tmp_dir)
                        compress = zipfile.ZIP_STORED if filename.endswith(('.mp4', '.png')) else zipfile.ZIP_DEFLATED
                        zf.write(file_path, arcname, compress_type=compress)

            # Cleanup tmp_dir
            shutil.rmtree(tmp_dir, ignore_errors=True)

            db.export_tasks.update_one({
                '_id': task_id
            }, {
                '$set': {
                    'status': 'completed',
                    'progress': 100,
                    'file_path': zip_filepath
                }
            })
            logger.info(f"Batch segmented export completed for task {task_id}")

        except Exception as e:
            logger.error(f"Export task failed: {str(e)}")
            try:
                shutil.rmtree(tmp_dir, ignore_errors=True)
            except:
                pass
            db.export_tasks.update_one({'_id': task_id}, {'$set': {'status': 'failed', 'error': str(e)}})


@annotations_bp.route('/export/project/<project_id>/eligible-videos', methods=['GET'])
@token_required
def get_eligible_videos_for_export(project_id):
    """
    Endpoint nhẹ: trả về danh sách video đủ điều kiện export (không cần build ZIP).
    Điều kiện: review_status in [pending_review, approved] + đủ 6 trường caption cho mọi segment.
    Query param: ?subpart_id=<id> để lọc theo subpart.
    """
    try:
        db = current_app.db
        project = db.projects.find_one({'_id': ObjectId(project_id)})
        if not project:
            return jsonify({'error': 'Project not found'}), 404

        subpart_id = request.args.get('subpart_id')
        query = {'project_id': ObjectId(project_id)}
        if subpart_id:
            query['subpart_id'] = ObjectId(subpart_id)

        videos = list(db.videos.find(query, {
            '_id': 1, 'original_name': 1, 'review_status': 1,
            'subpart_id': 1, 'duration': 1
        }))

        REQUIRED_CAPTION_FIELDS = [
            'contextual_caption', 'contextual_caption_vi',
            'knowledge_caption', 'knowledge_caption_vi',
            'combined_caption', 'combined_caption_vi',
        ]

        eligible = []
        ineligible_review = 0
        ineligible_no_segments = 0
        ineligible_incomplete = 0

        for video in videos:
            # 1. Lọc theo review_status
            if video.get('review_status') not in ['pending_review', 'approved']:
                ineligible_review += 1
                continue

            # 2. Phải có segment
            segments = list(db.video_segments.find({'video_id': video['_id']}, {'_id': 1}))
            if not segments:
                ineligible_no_segments += 1
                continue

            # 3. Kiểm tra đủ 6 trường caption cho mọi segment
            all_captions_ok = True
            missing_info = []
            for seg in segments:
                cap = db.captions.find_one({'segment_id': seg['_id'], 'region_id': None})
                if not cap:
                    all_captions_ok = False
                    missing_info.append({'segment_id': str(seg['_id']), 'missing': 'no caption record'})
                    break
                kdata = _fetch_knowledge_for_caption(db, cap)
                cap_check = {
                    'contextual_caption': cap.get('contextual_caption'),
                    'contextual_caption_vi': cap.get('contextual_caption_vi'),
                    'combined_caption': cap.get('combined_caption'),
                    'combined_caption_vi': cap.get('combined_caption_vi'),
                    'knowledge_caption': kdata['knowledge_en'],
                    'knowledge_caption_vi': kdata['knowledge_vi'],
                }
                missing_fields = [f for f in REQUIRED_CAPTION_FIELDS if not (cap_check.get(f) or '').strip()]
                if missing_fields:
                    all_captions_ok = False
                    missing_info.append({'segment_id': str(seg['_id']), 'missing': missing_fields})
                    break

            if not all_captions_ok:
                ineligible_incomplete += 1
                continue

            eligible.append({
                'id': str(video['_id']),
                'name': video.get('original_name', ''),
                'review_status': video.get('review_status', ''),
                'segment_count': len(segments),
                'duration': video.get('duration', 0),
            })

        return jsonify({
            'project_id': project_id,
            'subpart_id': subpart_id,
            'eligible_count': len(eligible),
            'ineligible_review_status': ineligible_review,
            'ineligible_no_segments': ineligible_no_segments,
            'ineligible_incomplete_captions': ineligible_incomplete,
            'total_checked': len(videos),
            'eligible_videos': eligible
        }), 200

    except Exception as e:
        logger.error(f"[EligibleVideos] Error: {str(e)}")
        return jsonify({'error': str(e)}), 500


@annotations_bp.route('/export/project/<project_id>/segmented/start', methods=['POST'])
@token_required
def start_batch_segmented_export(project_id):
    try:
        project = current_app.db.projects.find_one({'_id': ObjectId(project_id)})
        if not project:
            return jsonify({'error': 'Project not found'}), 404
            
        subpart_id = request.args.get('subpart_id')

        task_id = str(uuid.uuid4())
        current_app.db.export_tasks.insert_one({
            '_id': task_id,
            'project_id': project_id,
            'user_id': str(request.current_user['_id']),
            'status': 'processing',
            'progress': 0,
            'file_path': None,
            'created_at': datetime.now(timezone.utc),
            'type': 'segmented'
        })

        app = current_app._get_current_object()
        thread = threading.Thread(target=process_batch_segmented_export, args=(app, task_id, project_id, subpart_id))
        thread.daemon = True
        thread.start()

        return jsonify({'task_id': task_id}), 200

    except Exception as e:
        logger.error(f"Failed to start task: {str(e)}")
        return jsonify({'error': str(e)}), 500


@annotations_bp.route('/export/segmented/status/<task_id>', methods=['GET'])
@token_required
def check_batch_segmented_export(task_id):
    try:
        task = current_app.db.export_tasks.find_one({'_id': task_id})
        if not task:
            return jsonify({'error': 'Task not found'}), 404
            
        if task.get('user_id') != str(request.current_user['_id']):
            return jsonify({'error': 'Unauthorized'}), 403

        return jsonify({
            'task_id': task['_id'],
            'status': task.get('status'),
            'progress': task.get('progress', 0),
            'error': task.get('error')
        }), 200
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@annotations_bp.route('/export/segmented/download/<task_id>', methods=['GET'])
def download_batch_segmented_export(task_id):
    try:
        task = current_app.db.export_tasks.find_one({'_id': task_id})
        if not task:
            return jsonify({'error': 'Task not found'}), 404

        if task.get('status') != 'completed':
            return jsonify({'error': 'Task not completed yet'}), 400

        file_path = task.get('file_path')
        if not file_path or not os.path.exists(file_path):
            return jsonify({'error': 'File not found on server'}), 404

        filename = os.path.basename(file_path)
        return send_file(file_path, as_attachment=True, download_name=filename)
    except Exception as e:
        return jsonify({'error': str(e)}), 500


# ============ LABELED VIDEOS + ANNOTATIONS EXPORT ============
# Exports full original videos (no ffmpeg split) for videos that have >=1 segment,
# grouped by subpart, with a single metadata.json at the root.

def _cleanup_exports(export_dir, db=None, max_age_hours=24):
    """Dọn dẹp toàn diện sau mỗi lần export:
    1. Xóa file ZIP cũ hơn max_age_hours trong thư mục exports/
    2. Xóa các thư mục tmp_* bị sót lại do crash trước đó
    3. Xóa các bản ghi export_tasks cũ trong MongoDB (nếu có db)
    """
    now = time.time()
    max_age_sec = max_age_hours * 3600

    # 1. Xóa ZIP cũ
    if os.path.exists(export_dir):
        for filename in os.listdir(export_dir):
            if not filename.endswith('.zip'):
                continue
            filepath = os.path.join(export_dir, filename)
            try:
                if os.path.isfile(filepath) and (now - os.path.getmtime(filepath)) > max_age_sec:
                    os.remove(filepath)
                    logger.info(f"[Cleanup] Deleted old export ZIP: {filename}")
            except Exception as e:
                logger.warning(f"[Cleanup] Failed to delete ZIP {filepath}: {e}")

    # 2. Xóa tmp dir bị sót (tên bắt đầu bằng batch_seg_export_ hoặc batch_labeled_videos_)
    tmp_root = tempfile.gettempdir()
    stale_prefixes = ('batch_seg_export_', 'batch_labeled_videos_')
    try:
        for entry in os.listdir(tmp_root):
            if not any(entry.startswith(p) for p in stale_prefixes):
                continue
            tmp_path = os.path.join(tmp_root, entry)
            try:
                age = now - os.path.getmtime(tmp_path)
                if age > max_age_sec:
                    shutil.rmtree(tmp_path, ignore_errors=True)
                    logger.info(f"[Cleanup] Deleted stale tmp dir: {entry}")
            except Exception as e:
                logger.warning(f"[Cleanup] Failed to delete tmp dir {tmp_path}: {e}")
    except Exception as e:
        logger.warning(f"[Cleanup] Failed to scan tmp dir: {e}")

    # 3. Xóa export_tasks cũ hơn max_age_hours khỏi MongoDB
    if db is not None:
        try:
            from datetime import timezone as _tz
            cutoff = datetime.now(_tz.utc) - timedelta(hours=max_age_hours)
            result = db.export_tasks.delete_many({'created_at': {'$lt': cutoff}})
            if result.deleted_count:
                logger.info(f"[Cleanup] Deleted {result.deleted_count} old export_tasks from DB")
        except Exception as e:
            logger.warning(f"[Cleanup] Failed to purge old export_tasks: {e}")


def _video_valid_full_captions(db, video):
    """Valid when review_status is ok, the video has >=1 segment, and every
    segment caption has all 6 caption fields (knowledge sourced from the KB)."""
    if video.get('review_status') not in ['pending_review', 'approved']:
        return False
    segments = list(db.video_segments.find({'video_id': video['_id']}))
    if not segments:
        return False
    for seg in segments:
        seg_caption = db.captions.find_one({'segment_id': seg['_id'], 'region_id': None})
        if not seg_caption:
            return False
        kdata = _fetch_knowledge_for_caption(db, seg_caption)
        if not all([
            seg_caption.get('contextual_caption'),
            seg_caption.get('contextual_caption_vi'),
            kdata['knowledge_en'],
            kdata['knowledge_vi'],
            seg_caption.get('combined_caption'),
            seg_caption.get('combined_caption_vi')
        ]):
            return False
    return True


def _video_has_segments(db, video):
    """Valid as long as the video has at least one segment."""
    return db.video_segments.count_documents({'video_id': video['_id']}) > 0


def process_batch_labeled_videos_export(app, task_id, project_id, subpart_id=None):
    """Background thread: ZIP of original videos with all 6 caption fields filled."""
    _run_labeled_videos_export(app, task_id, project_id, subpart_id,
                               _video_valid_full_captions, 'labeled_videos')


def process_batch_segmented_kb_export(app, task_id, project_id, subpart_id=None):
    """Background thread: ZIP of original (uncut) videos that have at least one
    segment, plus metadata.json with segment timestamps."""
    _run_labeled_videos_export(app, task_id, project_id, subpart_id,
                               _video_has_segments, 'segmented_kb_videos')


def _run_labeled_videos_export(app, task_id, project_id, subpart_id, is_video_valid, label):
    """Background thread: build ZIP of original videos passing is_video_valid + metadata.json.

    is_video_valid(db, video) -> bool selects which videos are exported.
    label is used for the zip filename and root folder name.
    """
    tmp_dir = None
    with app.app_context():
        try:
            db = current_app.db
            task = db.export_tasks.find_one({'_id': task_id})
            if not task:
                return

            export_dir = os.path.join(current_app.root_path, 'uploads', 'exports')
            os.makedirs(export_dir, exist_ok=True)
            _cleanup_exports(export_dir, db=db)

            project = db.projects.find_one({'_id': ObjectId(project_id)})
            if not project:
                db.export_tasks.update_one(
                    {'_id': task_id},
                    {'$set': {'status': 'failed', 'error': 'Project not found'}}
                )
                return

            zip_filename = f"{label}_{project_id}_{int(time.time())}.zip"
            zip_filepath = os.path.join(export_dir, zip_filename)

            query = {'project_id': ObjectId(project_id)}
            if subpart_id:
                query['subpart_id'] = ObjectId(subpart_id)
            videos = list(db.videos.find(query))

            valid_videos = [v for v in videos if is_video_valid(db, v)]
            total_videos = len(valid_videos)

            # Empty case: still produce a valid zip with empty metadata
            if total_videos == 0:
                with zipfile.ZipFile(zip_filepath, 'w', zipfile.ZIP_STORED) as zipf:
                    zipf.writestr(
                        'metadata.json',
                        json.dumps({
                            'project_id': str(project_id),
                            'project_name': project.get('name', ''),
                            'export_date': datetime.now(timezone.utc).isoformat() + 'Z',
                            'total_videos': 0,
                            'videos': []
                        }, indent=2, ensure_ascii=False)
                    )
                db.export_tasks.update_one(
                    {'_id': task_id},
                    {'$set': {'status': 'completed', 'progress': 100, 'file_path': zip_filepath}}
                )
                return

            subparts = list(db.subparts.find({'project_id': ObjectId(project_id)}))
            subpart_map = {str(sp['_id']): sp.get('name', f"Subpart_{sp['_id']}") for sp in subparts}

            tmp_dir = tempfile.mkdtemp(prefix='batch_labeled_videos_')
            root_folder = _sanitize_name(project.get('name', 'Project')) + '_' + label
            root_path = os.path.join(tmp_dir, root_folder)
            os.makedirs(root_path, exist_ok=True)

            project_metadata = {
                'project_name': project.get('name', ''),
                'project_id': str(project['_id']),
                'export_date': datetime.now(timezone.utc).isoformat() + 'Z',
                'total_videos': total_videos,
                'videos': []
            }

            processed_count = 0
            for video in valid_videos:
                try:
                    target_subpart_id = str(video.get('subpart_id', 'Unassigned'))
                    subpart_name = _sanitize_name(subpart_map.get(target_subpart_id, 'Unassigned'))
                    subpart_dir = os.path.join(root_path, subpart_name)
                    os.makedirs(subpart_dir, exist_ok=True)

                    video_path = os.path.join(Config.UPLOAD_FOLDER, 'videos', video['filename'])
                    if not os.path.exists(video_path):
                        logger.warning(f"[LabeledExport] Skipping missing video file: {video_path}")
                        processed_count += 1
                        continue

                    # Copy original video preserving its original name (sanitized)
                    original_name = video.get('original_name') or video.get('filename')
                    base, ext = os.path.splitext(original_name)
                    safe_name = _sanitize_name(base) + (ext if ext else '')
                    dest_path = os.path.join(subpart_dir, safe_name)
                    shutil.copy(video_path, dest_path)

                    project_metadata['videos'].append(_build_segment_metadata(db, video, subpart_map))

                    processed_count += 1
                    progress = int((processed_count / total_videos) * 90)
                    db.export_tasks.update_one(
                        {'_id': task_id},
                        {'$set': {'progress': progress}}
                    )
                    logger.info(
                        f"[LabeledExport] Processed {processed_count}/{total_videos} for task {task_id}"
                    )
                except Exception as e:
                    logger.error(f"[LabeledExport] Error processing video {video.get('_id')}: {e}")

            # Write metadata.json
            db.export_tasks.update_one({'_id': task_id}, {'$set': {'progress': 92}})
            with open(os.path.join(root_path, 'metadata.json'), 'w', encoding='utf-8') as f:
                json.dump(project_metadata, f, indent=2, ensure_ascii=False)

            # Zip everything (ZIP_STORED for .mp4, ZIP_DEFLATED for .json)
            db.export_tasks.update_one({'_id': task_id}, {'$set': {'progress': 95}})
            with zipfile.ZipFile(zip_filepath, 'w') as zf:
                for dirpath, _, filenames in os.walk(root_path):
                    for filename in filenames:
                        file_path = os.path.join(dirpath, filename)
                        arcname = os.path.relpath(file_path, tmp_dir)
                        compress = (
                            zipfile.ZIP_STORED
                            if filename.lower().endswith('.mp4')
                            else zipfile.ZIP_DEFLATED
                        )
                        zf.write(file_path, arcname, compress_type=compress)

            shutil.rmtree(tmp_dir, ignore_errors=True)
            tmp_dir = None

            db.export_tasks.update_one(
                {'_id': task_id},
                {'$set': {
                    'status': 'completed',
                    'progress': 100,
                    'file_path': zip_filepath
                }}
            )
            logger.info(f"[LabeledExport] Completed for task {task_id}")

        except Exception as e:
            logger.error(f"[LabeledExport] Task {task_id} failed: {e}")
            traceback.print_exc()
            try:
                if tmp_dir:
                    shutil.rmtree(tmp_dir, ignore_errors=True)
            except Exception:
                pass
            try:
                current_app.db.export_tasks.update_one(
                    {'_id': task_id},
                    {'$set': {'status': 'failed', 'error': str(e)}}
                )
            except Exception:
                pass


@annotations_bp.route('/export/project/<project_id>/labeled-videos/start', methods=['POST'])
@token_required
def start_labeled_videos_export(project_id):
    """Start a background task to export labeled (segmented) videos + metadata."""
    try:
        project = current_app.db.projects.find_one({'_id': ObjectId(project_id)})
        if not project:
            return jsonify({'error': 'Project not found'}), 404

        subpart_id = request.args.get('subpart_id')

        task_id = str(uuid.uuid4())
        current_app.db.export_tasks.insert_one({
            '_id': task_id,
            'project_id': project_id,
            'user_id': str(request.current_user['_id']),
            'status': 'processing',
            'progress': 0,
            'file_path': None,
            'created_at': datetime.now(timezone.utc),
            'type': 'labeled_videos'
        })

        app = current_app._get_current_object()
        thread = threading.Thread(
            target=process_batch_labeled_videos_export,
            args=(app, task_id, project_id, subpart_id)
        )
        thread.daemon = True
        thread.start()

        return jsonify({'task_id': task_id}), 200

    except Exception as e:
        logger.error(f"[LabeledExport] Failed to start task: {e}")
        return jsonify({'error': str(e)}), 500


@annotations_bp.route('/export/labeled-videos/status/<task_id>', methods=['GET'])
@token_required
def check_labeled_videos_export(task_id):
    try:
        task = current_app.db.export_tasks.find_one({'_id': task_id})
        if not task:
            return jsonify({'error': 'Task not found'}), 404

        if task.get('user_id') != str(request.current_user['_id']):
            return jsonify({'error': 'Unauthorized'}), 403

        return jsonify({
            'task_id': task['_id'],
            'status': task.get('status'),
            'progress': task.get('progress', 0),
            'error': task.get('error')
        }), 200
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@annotations_bp.route('/export/labeled-videos/download/<task_id>', methods=['GET'])
def download_labeled_videos_export(task_id):
    try:
        task = current_app.db.export_tasks.find_one({'_id': task_id})
        if not task:
            return jsonify({'error': 'Task not found'}), 404

        if task.get('status') != 'completed':
            return jsonify({'error': 'Task not completed yet'}), 400

        file_path = task.get('file_path')
        if not file_path or not os.path.exists(file_path):
            return jsonify({'error': 'File not found on server'}), 404

        filename = os.path.basename(file_path)
        return send_file(file_path, as_attachment=True, download_name=filename)
    except Exception as e:
        return jsonify({'error': str(e)}), 500


# ============ SEGMENTED (UNCUT) VIDEOS WITH KNOWLEDGE BASE EXPORT ============
# Same output as labeled-videos (full original videos + metadata.json, no ffmpeg
# split), but only exports videos whose segments ALL have knowledge_base_ids.

@annotations_bp.route('/export/project/<project_id>/segmented-kb/start', methods=['POST'])
@token_required
def start_segmented_kb_export(project_id):
    """Start a background task to export uncut videos whose segments all have KB ids."""
    try:
        project = current_app.db.projects.find_one({'_id': ObjectId(project_id)})
        if not project:
            return jsonify({'error': 'Project not found'}), 404

        subpart_id = request.args.get('subpart_id')

        task_id = str(uuid.uuid4())
        current_app.db.export_tasks.insert_one({
            '_id': task_id,
            'project_id': project_id,
            'user_id': str(request.current_user['_id']),
            'status': 'processing',
            'progress': 0,
            'file_path': None,
            'created_at': datetime.now(timezone.utc),
            'type': 'segmented_kb'
        })

        app = current_app._get_current_object()
        thread = threading.Thread(
            target=process_batch_segmented_kb_export,
            args=(app, task_id, project_id, subpart_id)
        )
        thread.daemon = True
        thread.start()

        return jsonify({'task_id': task_id}), 200

    except Exception as e:
        logger.error(f"[SegmentedKbExport] Failed to start task: {e}")
        return jsonify({'error': str(e)}), 500


@annotations_bp.route('/export/segmented-kb/status/<task_id>', methods=['GET'])
@token_required
def check_segmented_kb_export(task_id):
    try:
        task = current_app.db.export_tasks.find_one({'_id': task_id})
        if not task:
            return jsonify({'error': 'Task not found'}), 404

        if task.get('user_id') != str(request.current_user['_id']):
            return jsonify({'error': 'Unauthorized'}), 403

        return jsonify({
            'task_id': task['_id'],
            'status': task.get('status'),
            'progress': task.get('progress', 0),
            'error': task.get('error')
        }), 200
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@annotations_bp.route('/export/segmented-kb/download/<task_id>', methods=['GET'])
def download_segmented_kb_export(task_id):
    try:
        task = current_app.db.export_tasks.find_one({'_id': task_id})
        if not task:
            return jsonify({'error': 'Task not found'}), 404

        if task.get('status') != 'completed':
            return jsonify({'error': 'Task not completed yet'}), 400

        file_path = task.get('file_path')
        if not file_path or not os.path.exists(file_path):
            return jsonify({'error': 'File not found on server'}), 404

        filename = os.path.basename(file_path)
        return send_file(file_path, as_attachment=True, download_name=filename)
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@annotations_bp.route('/export/project/<project_id>/segmented-kb/metadata', methods=['GET'])
@token_required
def export_segmented_kb_metadata(project_id):
    """Return ONLY the metadata.json (no video files) for the segmented-kb export.

    Synchronous (no task/poll). Includes every video with >=1 segment, each with
    per-segment kb_id slug, start/end_time, duration and ground-truth captions.
    The schema (and each video's `path`) matches the metadata.json bundled inside
    the segmented-kb ZIP, so it lines up with videos already downloaded.
    """
    try:
        db = current_app.db
        project = db.projects.find_one({'_id': ObjectId(project_id)})
        if not project:
            return jsonify({'error': 'Project not found'}), 404

        subpart_id = request.args.get('subpart_id')
        query = {'project_id': ObjectId(project_id)}
        if subpart_id:
            query['subpart_id'] = ObjectId(subpart_id)
        videos = list(db.videos.find(query))

        valid_videos = [v for v in videos if _video_has_segments(db, v)]

        subparts = list(db.subparts.find({'project_id': ObjectId(project_id)}))
        subpart_map = {str(sp['_id']): sp.get('name', f"Subpart_{sp['_id']}") for sp in subparts}

        metadata = {
            'project_name': project.get('name', ''),
            'project_id': str(project['_id']),
            'export_date': datetime.now(timezone.utc).isoformat() + 'Z',
            'total_videos': len(valid_videos),
            'videos': [_build_segment_metadata(db, v, subpart_map) for v in valid_videos]
        }
        return jsonify(metadata), 200

    except Exception as e:
        logger.error(f"[SegmentedKbMetadata] {e}")
        return jsonify({'error': str(e)}), 500
