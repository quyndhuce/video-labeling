from flask import Blueprint, request, jsonify, current_app
from datetime import datetime, timezone
from bson import ObjectId
from config import Config
from utils.auth_middleware import token_required
from routes.settings import get_dam_url
import base64
import io
import requests as http_requests
import traceback

annotations_bp = Blueprint('annotations', __name__)


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
        'created_at': caption['created_at'].isoformat(),
        'updated_at': caption.get('updated_at', caption['created_at']).isoformat()
    })


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
        # Update instead
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
    if 'visual_caption_vi' in data:
        update_fields['visual_caption_vi'] = data['visual_caption_vi']
    if 'contextual_caption_vi' in data:
        update_fields['contextual_caption_vi'] = data['contextual_caption_vi']
    if 'knowledge_caption_vi' in data:
        update_fields['knowledge_caption_vi'] = data['knowledge_caption_vi']
    if 'combined_caption_vi' in data:
        update_fields['combined_caption_vi'] = data['combined_caption_vi']
    update_fields['updated_at'] = datetime.now(timezone.utc)

    current_app.db.captions.update_one(
        {'_id': ObjectId(caption_id)},
        {'$set': update_fields}
    )
    
    # Reset video approval if was approved
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
                        'knowledge': caption.get('knowledge_caption', '') if caption else '',
                        'combined': caption.get('combined_caption', '') if caption else ''
                    },
                    'vi': {
                        'visual': caption.get('visual_caption_vi', '') if caption else '',
                        'knowledge': caption.get('knowledge_caption_vi', '') if caption else '',
                        'combined': caption.get('combined_caption_vi', '') if caption else ''
                    }
                }
            }
            regions_data.append(region_data)

        # Segment-level captions
        seg_captions = list(current_app.db.captions.find({
            'segment_id': seg['_id'],
            'region_id': None
        }))
        seg_captions_data = [{
            'en': {
                'contextual': c.get('contextual_caption', ''),
                'knowledge': c.get('knowledge_caption', ''),
                'combined': c.get('combined_caption', '')
            },
            'vi': {
                'contextual': c.get('contextual_caption_vi', ''),
                'knowledge': c.get('knowledge_caption_vi', ''),
                'combined': c.get('combined_caption_vi', '')
            }
        } for c in seg_captions]

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
