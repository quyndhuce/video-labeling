from flask import Blueprint, request, jsonify, current_app
from datetime import datetime, timezone
from bson import ObjectId
import json
import logging
import random
import threading
import time
import uuid

from utils.auth_middleware import token_required
from routes.settings import _get_setting_value

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

batch_review_bp = Blueprint('batch_review', __name__)

MIN_REQUEST_DELAY_S = 0.75
MAX_RETRIES = 5
RETRY_BASE_DELAY = 2.0
RETRY_MAX_DELAY = 60.0


def _extract_json_from_text(text):
    """Try to parse a JSON object out of a Gemini text response.

    Same resilient parsing as backend/routes/videos.py:_extract_json_from_text
    (raw JSON, fenced ```json blocks, or best-effort brace-matched substring).
    """
    if not text:
        return None

    raw = text.strip()
    try:
        return json.loads(raw)
    except Exception:
        pass

    if '```' in raw:
        parts = raw.split('```')
        for part in parts:
            candidate = part.replace('json', '', 1).strip()
            if not candidate:
                continue
            try:
                return json.loads(candidate)
            except Exception:
                continue

    start = raw.find('{')
    end = raw.rfind('}')
    if start != -1 and end != -1 and end > start:
        candidate = raw[start:end + 1]
        try:
            return json.loads(candidate)
        except Exception:
            return None
    return None


def _build_review_prompt(object_label, segment_name, current_visual_caption):
    return f"""Object name (ground truth, may be a proper name): {object_label}
Segment name (context): {segment_name}
Original caption (may misidentify the object): {current_visual_caption}

Task:
1. Identify what general type of object "{object_label}" is (e.g. "Hang Dau Tower" -> "tower",
   "Ben Thanh Market" -> "market", "gate" -> "gate"). Rewrite the caption so it correctly refers
   to the object using that general type (e.g. "this tower", "the market") wherever the original
   wrongly called it something else. Do NOT insert the proper name itself into the caption —
   only the generic type. Preserve all other correctly-described visual details (colors,
   position, materials, actions, etc.). Keep it a natural, fluent English caption of similar
   length.
2. Translate your corrected caption into fluent Vietnamese with proper diacritics, using the
   generic type there too (e.g. "tòa tháp này", "ngôi chợ này") — not the proper name.

Return ONLY valid JSON:
{{"visual_caption": "...", "visual_caption_vi": "..."}}
"""


def _iter_review_candidates(db, project_id, video_id=None, subpart_id=None, video_start=None, video_end=None):
    """Yield ('segment' | 'object', video, segment, region, caption) for every
    segment (its own contextual_caption) and every object region within it
    (its visual_caption), whether or not a caption doc exists yet. `region` is
    None for segment-level rows; `caption` is None when no caption doc exists.
    Filters by subpart_id and video range (video_start/video_end, 1-based
    index) if specified."""
    query = {'project_id': ObjectId(project_id)}
    if video_id:
        query['_id'] = ObjectId(video_id)
    elif subpart_id:
        query['subpart_id'] = ObjectId(subpart_id)

    # Sort videos by created_at (descending) to match the UI listing order
    videos_cursor = db.videos.find(query).sort('created_at', -1)

    if video_start is not None or video_end is not None:
        videos = list(videos_cursor)
        start = int(video_start) if video_start is not None else 1
        end = int(video_end) if video_end is not None else len(videos)

        # Convert 1-based start/end to 0-based slice indexes
        slice_start = max(0, start - 1)
        slice_end = max(0, end)
        videos = videos[slice_start:slice_end]
    else:
        videos = list(videos_cursor)

    for video in videos:
        segments = list(db.video_segments.find({'video_id': video['_id']}).sort('order', 1))
        for segment in segments:
            segment_caption = db.captions.find_one({'segment_id': segment['_id'], 'region_id': None})
            yield 'segment', video, segment, None, segment_caption

            regions = list(db.object_regions.find({'segment_id': segment['_id']}))
            for region in regions:
                caption = db.captions.find_one({'region_id': region['_id']})
                yield 'object', video, segment, region, caption


# Which caption doc field holds the reviewable English text / its Vietnamese
# translation, per level. Object-level reviews visual_caption; segment-level
# reviews contextual_caption (the scene-level description, not the KB-derived
# knowledge_caption or the merged combined_caption).
_CAPTION_FIELDS = {
    'object': ('visual_caption', 'visual_caption_vi'),
    'segment': ('contextual_caption', 'contextual_caption_vi'),
}


def _serialize_preview_item(level, video, segment, region, caption):
    field_en, field_vi = _CAPTION_FIELDS[level]
    current_caption = caption.get(field_en, '') if caption else ''
    current_caption_vi = caption.get(field_vi, '') if caption else ''
    segment_name = segment.get('name', '')
    object_label = region.get('label', '') if region else ''
    # The name Gemini treats as ground truth: the object's own label for an
    # object-level row, or the segment's name for a segment-level row (there's
    # no more specific "object" than the segment itself in that case).
    ground_truth_name = object_label if level == 'object' else segment_name
    eligible = bool(current_caption.strip())
    return {
        'caption_id': str(caption['_id']) if caption else None,
        'level': level,
        'region_id': str(region['_id']) if region else None,
        'segment_id': str(segment['_id']),
        'video_id': str(video['_id']),
        'video_name': video.get('original_name', ''),
        'segment_name': segment_name,
        'object_label': object_label,
        'current_visual_caption': current_caption,
        'current_visual_caption_vi': current_caption_vi,
        'eligible': eligible,
        'skip_reason': None if eligible else 'no_caption',
        'prompt': _build_review_prompt(ground_truth_name, segment_name, current_caption) if eligible else None,
    }


@batch_review_bp.route('/batch-review/preview', methods=['GET'])
@token_required
def batch_review_preview():
    project_id = request.args.get('project_id')
    video_id = request.args.get('video_id')
    subpart_id = request.args.get('subpart_id')
    video_start = request.args.get('video_start')
    video_end = request.args.get('video_end')

    if not project_id:
        return jsonify({'error': 'project_id is required'}), 400

    try:
        # Convert start/end to integers if present
        start_idx = int(video_start) if video_start else None
        end_idx = int(video_end) if video_end else None
    except ValueError:
        return jsonify({'error': 'video_start and video_end must be integers'}), 400

    try:
        db = current_app.db
        project = db.projects.find_one({'_id': ObjectId(project_id)})
        if not project:
            return jsonify({'error': 'Project not found'}), 404

        items = [
            _serialize_preview_item(level, video, segment, region, caption)
            for level, video, segment, region, caption in _iter_review_candidates(
                db, project_id, video_id, subpart_id, start_idx, end_idx
            )
        ]

        # Calculate total videos in the queried subset for frontend information
        count_query = {'project_id': ObjectId(project_id)}
        if video_id:
            count_query['_id'] = ObjectId(video_id)
        elif subpart_id:
            count_query['subpart_id'] = ObjectId(subpart_id)
        total_videos = db.videos.count_documents(count_query)

        return jsonify({
            'generated_at': datetime.now(timezone.utc).isoformat(),
            'project_id': project_id,
            'video_id': video_id,
            'subpart_id': subpart_id,
            'total_items': len(items),
            'eligible_items': sum(1 for i in items if i['eligible']),
            'total_videos': total_videos,
            'items': items,
        }), 200
    except Exception as e:
        logger.error(f"[BatchReviewPreview] {e}")
        return jsonify({'error': str(e)}), 500


def _serialize_task(task):
    return {
        'task_id': task['_id'],
        'project_id': task.get('project_id'),
        'video_id': task.get('video_id'),
        'status': task.get('status'),
        'total': task.get('total', 0),
        'processed': task.get('processed', 0),
        'succeeded': task.get('succeeded', 0),
        'failed': task.get('failed', 0),
        'error': task.get('error'),
        'results': task.get('results', []),
    }


def _call_gemini_with_retry(model, prompt, caption_id):
    """Call Gemini with a minimum request delay + exponential backoff on rate
    limits, mirroring tools/caption_combiner's call_gpt_with_retry.

    Returns (text, is_auth_error). text is None if every retry failed or the
    error was non-retryable; is_auth_error is True for an invalid/rejected key.
    """
    time.sleep(MIN_REQUEST_DELAY_S)

    for attempt in range(MAX_RETRIES):
        try:
            response = model.generate_content(prompt)
            return (getattr(response, 'text', '') or '').strip(), False
        except Exception as e:
            message = str(e)
            upper = message.upper()
            is_auth_error = (
                'API_KEY_INVALID' in upper or 'PERMISSION_DENIED' in upper
                or 'UNAUTHENTICATED' in upper or ' 401' in message or ' 403' in message
            )
            if is_auth_error:
                return None, True

            is_rate_limited = '429' in message or 'RATE_LIMIT' in upper or 'RESOURCE_EXHAUSTED' in upper
            if is_rate_limited:
                delay = min(RETRY_BASE_DELAY * (2 ** attempt) + random.uniform(0, 1), RETRY_MAX_DELAY)
                logger.info(f"[BatchReview] rate limited on {caption_id}, attempt {attempt + 1}/{MAX_RETRIES}, sleeping {delay:.1f}s")
                time.sleep(delay)
                continue

            delay = min(RETRY_BASE_DELAY * (2 ** attempt), RETRY_MAX_DELAY)
            logger.info(f"[BatchReview] error on {caption_id}: {message} — attempt {attempt + 1}/{MAX_RETRIES}, sleeping {delay:.1f}s")
            time.sleep(delay)

    logger.error(f"[BatchReview] exhausted {MAX_RETRIES} retries for {caption_id}")
    return None, False


def _run_batch_review(app, task_id, item_ids, gemini_api_key, gemini_model):
    import google.generativeai as genai

    with app.app_context():
        db = current_app.db
        db.caption_review_tasks.update_one(
            {'_id': task_id},
            {'$set': {'status': 'running', 'updated_at': datetime.now(timezone.utc)}}
        )

        try:
            genai.configure(api_key=gemini_api_key)
            model = genai.GenerativeModel(gemini_model)

            for index, caption_id in enumerate(item_ids):
                try:
                    caption = db.captions.find_one({'_id': ObjectId(caption_id)})
                except Exception:
                    caption = None

                result = {
                    'caption_id': caption_id,
                    'level': None,
                    'region_id': None,
                    'segment_name': '',
                    'object_label': '',
                    'video_name': '',
                    'old': {'visual_caption': '', 'visual_caption_vi': ''},
                    'new': None,
                    'status': 'error',
                    'error': 'Caption not found',
                    'caption_field': 'visual_caption',
                    'applied': False,
                }

                if caption:
                    level = 'object' if caption.get('region_id') else 'segment'
                    field_en, field_vi = _CAPTION_FIELDS[level]

                    region = db.object_regions.find_one({'_id': caption.get('region_id')}) if caption.get('region_id') else None
                    segment = db.video_segments.find_one({'_id': caption.get('segment_id')}) if caption.get('segment_id') else None
                    video = db.videos.find_one({'_id': caption.get('video_id')}) if caption.get('video_id') else None

                    object_label = region.get('label', '') if region else ''
                    segment_name = segment.get('name', '') if segment else ''
                    ground_truth_name = object_label if level == 'object' else segment_name
                    current_caption = caption.get(field_en, '')

                    result.update({
                        'level': level,
                        'region_id': str(region['_id']) if region else None,
                        'segment_name': segment_name,
                        'object_label': object_label,
                        'video_name': video.get('original_name', '') if video else '',
                        'old': {
                            'visual_caption': current_caption,
                            'visual_caption_vi': caption.get(field_vi, ''),
                        },
                        'caption_field': field_en,
                    })

                    prompt = _build_review_prompt(ground_truth_name, segment_name, current_caption)
                    text, is_auth_error = _call_gemini_with_retry(model, prompt, caption_id)

                    if is_auth_error and index == 0:
                        db.caption_review_tasks.update_one(
                            {'_id': task_id},
                            {'$set': {
                                'status': 'failed',
                                'error': 'Invalid Gemini API key',
                                'updated_at': datetime.now(timezone.utc),
                            }}
                        )
                        return

                    if is_auth_error:
                        result['status'] = 'error'
                        result['error'] = 'Invalid Gemini API key'
                    else:
                        parsed = _extract_json_from_text(text) if text else None
                        new_visual = ((parsed or {}).get('visual_caption') or '').strip()
                        new_visual_vi = ((parsed or {}).get('visual_caption_vi') or '').strip()

                        if new_visual and new_visual_vi:
                            # Gemini's fix is only *proposed* here — nothing is written to
                            # db.captions until the reviewer confirms it via
                            # /batch-review/confirm (batch_review_confirm below).
                            result['status'] = 'ok'
                            result['error'] = None
                            result['new'] = {'visual_caption': new_visual, 'visual_caption_vi': new_visual_vi}
                        else:
                            result['status'] = 'error'
                            result['error'] = 'Gemini did not return valid JSON with both fields'

                succeeded_inc = 1 if result['status'] == 'ok' else 0
                failed_inc = 0 if result['status'] == 'ok' else 1
                db.caption_review_tasks.update_one(
                    {'_id': task_id},
                    {
                        '$push': {'results': result},
                        '$inc': {'processed': 1, 'succeeded': succeeded_inc, 'failed': failed_inc},
                        '$set': {'updated_at': datetime.now(timezone.utc)},
                    }
                )

            db.caption_review_tasks.update_one(
                {'_id': task_id, 'status': {'$ne': 'failed'}},
                {'$set': {'status': 'completed', 'updated_at': datetime.now(timezone.utc)}}
            )
        except Exception as e:
            logger.error(f"[BatchReview] task {task_id} failed: {e}")
            try:
                db.caption_review_tasks.update_one(
                    {'_id': task_id},
                    {'$set': {'status': 'failed', 'error': str(e), 'updated_at': datetime.now(timezone.utc)}}
                )
            except Exception:
                pass


@batch_review_bp.route('/batch-review/apply', methods=['POST'])
@token_required
def batch_review_apply():
    data = request.get_json() or {}
    project_id = data.get('project_id')
    video_id = data.get('video_id')
    item_ids = data.get('item_ids') or []
    gemini_api_key = (data.get('gemini_api_key') or '').strip()
    gemini_model = (data.get('gemini_model') or '').strip() or _get_setting_value('gemini_model', 'gemini-2.5-flash')

    if not project_id:
        return jsonify({'error': 'project_id is required'}), 400
    if not item_ids:
        return jsonify({'error': 'item_ids must be a non-empty list'}), 400
    if not gemini_api_key:
        return jsonify({'error': 'gemini_api_key is required'}), 400

    db = current_app.db

    existing = db.caption_review_tasks.find_one({
        'project_id': project_id,
        'status': {'$in': ['pending', 'running']},
    })
    if existing:
        return jsonify({
            'error': 'A batch review job is already running for this project',
            'task_id': existing['_id'],
        }), 409

    task_id = str(uuid.uuid4())
    db.caption_review_tasks.insert_one({
        '_id': task_id,
        'project_id': project_id,
        'video_id': video_id,
        'status': 'pending',
        'total': len(item_ids),
        'processed': 0,
        'succeeded': 0,
        'failed': 0,
        'error': None,
        'results': [],
        'created_by': str(request.current_user['_id']),
        'created_at': datetime.now(timezone.utc),
        'updated_at': datetime.now(timezone.utc),
    })

    app = current_app._get_current_object()
    thread = threading.Thread(
        target=_run_batch_review,
        args=(app, task_id, item_ids, gemini_api_key, gemini_model)
    )
    thread.daemon = True
    thread.start()

    return jsonify({'task_id': task_id}), 202


@batch_review_bp.route('/batch-review/status/<task_id>', methods=['GET'])
@token_required
def batch_review_status(task_id):
    task = current_app.db.caption_review_tasks.find_one({'_id': task_id})
    if not task:
        return jsonify({'error': 'Task not found'}), 404
    return jsonify(_serialize_task(task)), 200


@batch_review_bp.route('/batch-review/confirm', methods=['POST'])
@token_required
def batch_review_confirm():
    """Write reviewer-approved Gemini proposals to db.captions.

    Only proposals already sitting in the task's `results` list (status 'ok',
    not yet applied) are written; anything else in `caption_ids` is ignored.
    """
    data = request.get_json() or {}
    task_id = data.get('task_id')
    caption_ids = data.get('caption_ids') or []

    if not task_id:
        return jsonify({'error': 'task_id is required'}), 400
    if not caption_ids:
        return jsonify({'error': 'caption_ids must be a non-empty list'}), 400

    db = current_app.db
    task = db.caption_review_tasks.find_one({'_id': task_id})
    if not task:
        return jsonify({'error': 'Task not found'}), 404
    if task.get('status') not in ('completed', 'failed'):
        return jsonify({'error': 'Task is still running'}), 409

    results_by_id = {r['caption_id']: r for r in task.get('results', [])}
    requested = set(caption_ids)

    applied_ids = []
    now = datetime.now(timezone.utc)
    for caption_id in caption_ids:
        result = results_by_id.get(caption_id)
        if not result or result.get('status') != 'ok' or result.get('applied'):
            continue
        new_vals = result.get('new') or {}
        new_visual = (new_vals.get('visual_caption') or '').strip()
        new_visual_vi = (new_vals.get('visual_caption_vi') or '').strip()
        if not new_visual or not new_visual_vi:
            continue

        field_en = result.get('caption_field', 'visual_caption')
        field_vi = f'{field_en}_vi'
        try:
            db.captions.update_one(
                {'_id': ObjectId(caption_id)},
                {'$set': {
                    field_en: new_visual,
                    field_vi: new_visual_vi,
                    'updated_at': now,
                }}
            )
        except Exception:
            continue
        # Intentionally does not call _reset_video_approval_if_needed
        # (annotations.py:53-65) — bulk auto-fixes behave like the existing
        # skip_approval_reset convention used by tools/caption_combiner, so a
        # batch run doesn't flip already-approved videos back to review.
        applied_ids.append(caption_id)

    if applied_ids:
        db.caption_review_tasks.update_one(
            {'_id': task_id},
            {'$set': {'results.$[elem].applied': True, 'updated_at': now}},
            array_filters=[{'elem.caption_id': {'$in': applied_ids}}]
        )

    skipped = len(requested) - len(applied_ids)
    return jsonify({'applied': len(applied_ids), 'skipped': skipped}), 200
