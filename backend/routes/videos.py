import os
import uuid
import json
import hashlib
import base64
import tempfile
import re
from io import BytesIO
import cv2
import numpy as np
import requests
from flask import Blueprint, request, jsonify, current_app
from datetime import datetime, timezone
from bson import ObjectId
from werkzeug.utils import secure_filename
from config import Config
from utils.auth_middleware import token_required
from utils.vector_store import upsert_embedding, search_embeddings

videos_bp = Blueprint('videos', __name__)

ALLOWED_EXTENSIONS = {'mp4', 'avi', 'mov', 'mkv', 'webm'}
GEMINI_MAX_OUTPUT_TOKENS = int(os.environ.get('GEMINI_MAX_OUTPUT_TOKENS', '8192'))


def allowed_file(filename):
    return '.' in filename and filename.rsplit('.', 1)[1].lower() in ALLOWED_EXTENSIONS


def _extract_video_frames(video_path: str, num_frames: int = 16):
    cap = cv2.VideoCapture(video_path)
    total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    if total_frames <= 0:
        cap.release()
        return []

    if total_frames <= num_frames:
        frame_indices = list(range(total_frames))
    else:
        frame_indices = np.linspace(0, total_frames - 1, num_frames, dtype=int).tolist()

    frames = []
    for idx in frame_indices:
        cap.set(cv2.CAP_PROP_POS_FRAMES, idx)
        ok, frame_bgr = cap.read()
        if not ok:
            continue
        frame_rgb = cv2.cvtColor(frame_bgr, cv2.COLOR_BGR2RGB)
        frames.append(frame_rgb)

    cap.release()
    return frames


def _to_rgba_base64(frame_rgb: np.ndarray) -> str:
    alpha = np.full((frame_rgb.shape[0], frame_rgb.shape[1], 1), 255, dtype=np.uint8)
    rgba = np.concatenate([frame_rgb, alpha], axis=2)
    ok, encoded = cv2.imencode('.png', cv2.cvtColor(rgba, cv2.COLOR_RGBA2BGRA))
    if not ok:
        raise ValueError('Could not encode frame')
    return f"data:image/png;base64,{base64.b64encode(encoded.tobytes()).decode('utf-8')}"


def _to_jpeg_base64(frame_rgb: np.ndarray) -> str:
    ok, encoded = cv2.imencode('.jpg', cv2.cvtColor(frame_rgb, cv2.COLOR_RGB2BGR))
    if not ok:
        raise ValueError('Could not encode frame')
    return f"data:image/jpeg;base64,{base64.b64encode(encoded.tobytes()).decode('utf-8')}"


def _file_sha256(file_path: str) -> str:
    hasher = hashlib.sha256()
    with open(file_path, 'rb') as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b''):
            hasher.update(chunk)
    return hasher.hexdigest()


def _request_embedding(image_b64: str):
    resp = requests.post(
        f"{Config.DAM_SERVER_URL}/embed",
        json={'image': image_b64},
        timeout=60,
    )
    if resp.status_code != 200:
        raise ValueError(f"Embedding API failed: {resp.text}")
    return resp.json().get('embedding', [])


def _request_dam_video_description(frames_rgb, prompt: str) -> str:
    if not frames_rgb:
        return ''

    sample_count = min(8, len(frames_rgb))
    idx = np.linspace(0, len(frames_rgb) - 1, sample_count, dtype=int).tolist()
    selected = [frames_rgb[i] for i in idx]

    content = [{'type': 'text', 'text': prompt}]
    for fr in selected:
        content.append({'type': 'image_url', 'image_url': {'url': _to_rgba_base64(fr)}})

    payload = {
        'model': 'describe_anything_model',
        'messages': [{'role': 'user', 'content': content}],
        'stream': False,
    }
    resp = requests.post(f"{Config.DAM_SERVER_URL}/chat/completions", json=payload, timeout=300)
    if resp.status_code != 200:
        raise ValueError(f"DAM chat failed: {resp.text}")

    data = resp.json()
    choices = data.get('choices') or []
    if not choices:
        return ''
    msg = choices[0].get('message', {})
    content_val = msg.get('content', '')
    if isinstance(content_val, str):
        return content_val
    if isinstance(content_val, list):
        texts = [x.get('text', '') for x in content_val if isinstance(x, dict)]
        return '\n'.join([t for t in texts if t])
    return ''


def _extract_json_from_text(text: str):
    """Try to parse JSON object from Gemini text response."""
    if not text:
        return None

    raw = text.strip()
    try:
        return json.loads(raw)
    except Exception:
        pass

    # Handle fenced json blocks.
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

    # Best-effort: first JSON object substring.
    start = raw.find('{')
    end = raw.rfind('}')
    if start != -1 and end != -1 and end > start:
        candidate = raw[start:end + 1]
        try:
            return json.loads(candidate)
        except Exception:
            return None
    return None


def _format_kb_for_prompt(items):
    lines = []
    for idx, item in enumerate(items or [], start=1):
        lines.append(
            f"{idx}. name={item.get('name', '')}; name_vi={item.get('name_vi', '')}; "
            f"description={item.get('description', '')}; description_vi={item.get('description_vi', '')}; "
            f"score={item.get('score', 0):.4f}"
        )
    return '\n'.join(lines) if lines else 'None found'


def _build_bilingual_fallback(dam_description: str, aggregated_knowledge):
    english = (dam_description or '').strip()
    vietnamese = (dam_description or '').strip()

    if aggregated_knowledge:
        top_names_en = [k.get('name', '').strip() for k in aggregated_knowledge[:3] if k.get('name')]
        top_names_vi = [
            (k.get('name_vi') or k.get('name') or '').strip()
            for k in aggregated_knowledge[:3]
            if k.get('name_vi') or k.get('name')
        ]

        if top_names_en:
            english = f"{english} This scene appears around {', '.join(top_names_en)}.".strip()
        if top_names_vi:
            vietnamese = f"{vietnamese} Cảnh này xuất hiện xung quanh {', '.join(top_names_vi)}.".strip()

    return english, vietnamese


def _is_vietnamese_text(text: str) -> bool:
    if not text or len(text.strip()) < 20:
        return False
    # Detect common Vietnamese diacritics to avoid returning English in VI field.
    return bool(re.search(r"[a-zA-Z]*[\u00C0-\u1EF9]+", text))


def _collect_kb_from_similar_images(db, similar_images):
    """Collect KB nodes linked to similar images via image_regions.knowledge_base_ids."""
    collected = {}

    for sim in (similar_images or [])[:8]:
        image_id = sim.get('image_id')
        if not image_id:
            continue

        try:
            image_oid = ObjectId(image_id)
        except Exception:
            continue

        kb_ids = set()
        for region in db.image_regions.find({'image_id': image_oid}, {'knowledge_base_ids': 1, 'label': 1}):
            for kb_id in region.get('knowledge_base_ids', []) or []:
                kb_ids.add(str(kb_id))

        image_doc = db.images.find_one({'_id': image_oid}, {'knowledge_base_ids': 1, 'original_name': 1})
        if image_doc:
            for kb_id in image_doc.get('knowledge_base_ids', []) or []:
                kb_ids.add(str(kb_id))

        for kb_id_str in kb_ids:
            try:
                kb_oid = ObjectId(kb_id_str)
            except Exception:
                continue

            node = db.knowledge_base.find_one({'_id': kb_oid})
            if not node:
                continue

            existing = collected.get(kb_id_str)
            score = float(sim.get('score') or 0.0)
            item = {
                'id': kb_id_str,
                'name': node.get('name', ''),
                'name_vi': node.get('name_vi', ''),
                'description': node.get('description', ''),
                'description_vi': node.get('description_vi', ''),
                'score': score,
                'source': 'similar_image_link',
                'source_image': image_doc.get('original_name', '') if image_doc else '',
            }

            if not existing or score > float(existing.get('score') or 0.0):
                collected[kb_id_str] = item

    return list(collected.values())


def _split_sentences(text: str):
    if not text:
        return []
    raw = re.split(r'[\.\n\r]+', text)
    return [s.strip() for s in raw if s and len(s.strip()) > 20]


def _build_story_facts(aggregated_knowledge, max_items: int = 10):
    """Build concise KB facts for storytelling prompt instead of dumping full KB text."""
    facts = []
    for item in (aggregated_knowledge or [])[:max_items]:
        name = (item.get('name') or '').strip()
        name_vi = (item.get('name_vi') or '').strip()
        desc = (item.get('description') or '').strip()
        desc_vi = (item.get('description_vi') or '').strip()

        if name:
            facts.append(f"Anchor: {name}" + (f" ({name_vi})" if name_vi else ''))

        for sent in _split_sentences(desc)[:2]:
            facts.append(f"Fact: {sent}")
        for sent_vi in _split_sentences(desc_vi)[:1]:
            facts.append(f"Fact-VI: {sent_vi}")

        if len(facts) >= 24:
            break

    return facts[:24]


def _count_kb_anchor_mentions(text: str, aggregated_knowledge):
    if not text:
        return 0
    lowered = text.lower()
    count = 0
    for item in (aggregated_knowledge or [])[:8]:
        for key in ('name', 'name_vi'):
            val = (item.get(key) or '').strip().lower()
            if val and len(val) >= 3 and val in lowered:
                count += 1
                break
    return count


def _translate_to_vietnamese(client, model_name, english_text: str) -> str:
    if not english_text:
        return ''

    vi_prompt = f"""Translate the following English travel caption into fluent Vietnamese with proper diacritics.
Requirements:
- Keep all place names and historical facts accurate.
- Keep tone evocative and narrative.
- Do not add or remove factual details.
- Preserve all paragraphs and paragraph breaks from the original.
- Output the full Vietnamese translation, do not shorten it.

English:
{english_text}

Vietnamese:"""
    try:
        print("\n" + "="*60)
        print("TRANSLATION PROMPT:")
        print("="*60)
        print(vi_prompt)
        print("="*60 + "\n")
        vi_resp = client.models.generate_content(
            model=model_name,
            contents=vi_prompt,
            config={
                'max_output_tokens': GEMINI_MAX_OUTPUT_TOKENS,
            }
        )
        return (getattr(vi_resp, 'text', '') or '').strip()
    except Exception:
        return ''


def _run_video_ai_pipeline(
    db,
    video_path: str,
    prompt: str,
    num_frames: int,
    use_gemini: bool,
    video_id: str = None,
    video_name: str = '',
):
    from google import genai

    frames = _extract_video_frames(video_path, num_frames)
    if not frames:
        raise ValueError('Could not extract frames from video')

    frame_knowledge = []
    all_knowledge = {}
    frame_similar_images = []
    all_similar_images = {}
    cached_frame_embeddings = {}
    newly_indexed_frames = 0

    if video_id:
        for emb_doc in db.embeddings.find(
            {'entity_type': 'video_frame', 'metadata.video_id': str(video_id)},
            {'embedding': 1, 'metadata.frame_index': 1},
        ):
            metadata = emb_doc.get('metadata') or {}
            frame_index = metadata.get('frame_index')
            embedding = emb_doc.get('embedding') or []
            if isinstance(frame_index, int) and embedding:
                cached_frame_embeddings[frame_index] = embedding

    print(f"[DEBUG] cached video_frame embeddings={len(cached_frame_embeddings)} for video_id={video_id}")

    for i, frame in enumerate(frames):
        emb = cached_frame_embeddings.get(i)
        if emb:
            emb_source = 'cache'
        else:
            frame_b64 = _to_jpeg_base64(frame)
            emb = _request_embedding(frame_b64)
            emb_source = 'new'
            if video_id and emb:
                upsert_embedding(
                    db,
                    f"{video_id}_frame_{i}",
                    'video_frame',
                    emb,
                    {
                        'video_id': str(video_id),
                        'frame_index': i,
                        'video_name': video_name or '',
                    },
                )
                newly_indexed_frames += 1
        if not emb:
            continue
        if emb_source == 'new':
            cached_frame_embeddings[i] = emb

        kb_hits = search_embeddings(db, emb, top_k=5, entity_types=['kb_node'])

        frame_items = []
        for hit in kb_hits:
            node = db.knowledge_base.find_one({'_id': ObjectId(hit['entity_id'])})
            if not node:
                continue
            item = {
                'name': node.get('name', ''),
                'name_vi': node.get('name_vi', ''),
                'description': node.get('description', ''),
                'description_vi': node.get('description_vi', ''),
                'score': hit['score'],
            }
            frame_items.append(item)
            key = item['name'] or hit['entity_id']
            if key not in all_knowledge or item['score'] > all_knowledge[key]['score']:
                all_knowledge[key] = item

        frame_knowledge.append({'frame_idx': i, 'knowledge': frame_items})

        image_hits = search_embeddings(db, emb, top_k=4, entity_types=['image'])
        frame_images = []
        for hit in image_hits:
            image_id = hit.get('entity_id')
            if not image_id:
                continue
            try:
                img = db.images.find_one({'_id': ObjectId(image_id)})
            except Exception:
                img = None
            if not img:
                continue

            image_item = {
                'image_id': image_id,
                'filename': img.get('filename', ''),
                'original_name': img.get('original_name', ''),
                'url': f"/uploads/images/{img.get('filename', '')}",
                'project_id': str(img.get('project_id')) if img.get('project_id') else None,
                'score': hit.get('score', 0),
            }
            frame_images.append(image_item)

            existing = all_similar_images.get(image_id)
            if not existing or image_item['score'] > existing['score']:
                all_similar_images[image_id] = image_item

        frame_similar_images.append({'frame_idx': i, 'images': frame_images})

    dam_description = _request_dam_video_description(frames, prompt)
    print("\n" + "="*60)
    print("DAM VISUAL CAPTION:")
    print("="*60)
    print(dam_description)
    print("="*60 + "\n")
    aggregated_knowledge = sorted(all_knowledge.values(), key=lambda x: -x['score'])[:10]
    similar_images = sorted(all_similar_images.values(), key=lambda x: -x['score'])[:12]

    # Merge extra KB nodes linked from top similar images.
    linked_kb = _collect_kb_from_similar_images(db, similar_images)
    for item in linked_kb:
        key = item.get('id') or item.get('name') or str(item)
        existing = all_knowledge.get(key)
        if not existing or float(item.get('score') or 0.0) > float(existing.get('score') or 0.0):
            all_knowledge[key] = item

    aggregated_knowledge = sorted(all_knowledge.values(), key=lambda x: -x['score'])[:14]
    story_facts = _build_story_facts(aggregated_knowledge)
    fallback_en, fallback_vi = _build_bilingual_fallback(dam_description, aggregated_knowledge)

    image_embedding_count = db.embeddings.count_documents({'entity_type': 'image'})
    kb_embedding_count = db.embeddings.count_documents({'entity_type': 'kb_node'})

    result = {
        'num_frames': len(frames),
        'dam_description': dam_description,
        'frame_knowledge': frame_knowledge,
        'frame_similar_images': frame_similar_images,
        'aggregated_knowledge': aggregated_knowledge,
        'story_facts': story_facts,
        'linked_kb_from_similar_images': linked_kb,
        'similar_images': similar_images,
        'retrieval_debug': {
            'image_embedding_count': image_embedding_count,
            'kb_embedding_count': kb_embedding_count,
            'similar_images_count': len(similar_images),
            'knowledge_hits_count': len(aggregated_knowledge),
            'cached_video_frame_embeddings': len(cached_frame_embeddings),
            'newly_indexed_video_frames': newly_indexed_frames,
        },
        'similar_images_message': '',
        'english_description': fallback_en,
        'vietnamese_description': fallback_vi,
        'final_description': f"English:\n{fallback_en}\n\nVietnamese:\n{fallback_vi}".strip(),
    }

    if not similar_images:
        if image_embedding_count == 0:
            result['similar_images_message'] = 'No similar images found because image vectors have not been indexed yet.'
        else:
            result['similar_images_message'] = 'No similar images matched the current video frames.'

    print(f"[DEBUG] use_gemini={use_gemini}, dam_description={bool(result.get('dam_description'))}, aggregated_knowledge={bool(result.get('aggregated_knowledge'))}")
    if use_gemini and (result.get('dam_description') or result.get('aggregated_knowledge')):
        try:
            settings = db.settings.find_one({'key': 'gemini_api_key'}) or {}
            gemini_key = settings.get('value', os.environ.get('GEMINI_API_KEY', ''))
            model_doc = db.settings.find_one({'key': 'gemini_model'}) or {}
            gemini_model = model_doc.get('value', 'gemini-2.5-flash')
            print(f"[DEBUG] gemini_key found={bool(gemini_key)}, length={len(gemini_key) if gemini_key else 0}")

            if gemini_key:
                client = genai.Client(api_key=gemini_key)

                gemini_prompt = f"""You are given two inputs for one video:
1) visual caption
2) knowledge description

Visual caption:
{result.get('dam_description', 'Not available')}

Knowledge description:
{_format_kb_for_prompt(result.get('aggregated_knowledge', []))}

Task:
- Write 3 to 5 rich, detailed English paragraphs that naturally combine the visual caption and the knowledge description.
- Include historical facts, cultural context, and vivid scene descriptions from both inputs.
- Then translate those exact paragraphs into fluent Vietnamese with proper diacritics.
- Keep it readable and engaging.
- Do not output bullet points.

Return ONLY valid JSON:
{{
    "english_description": "...",
    "vietnamese_description": "..."
}}
"""

                print("\n" + "="*60)
                print("GEMINI PROMPT:")
                print("="*60)
                print(gemini_prompt)
                print("="*60 + "\n")
                gemini_response = client.models.generate_content(
                    model=gemini_model,
                    contents=gemini_prompt,
                    config={
                        'max_output_tokens': GEMINI_MAX_OUTPUT_TOKENS,
                    }
                )
                result['gemini_description'] = gemini_response.text
                print("\n" + "="*60)
                print("GEMINI RESPONSE:")
                print("="*60)
                print(gemini_response.text)
                print("="*60 + "\n")

                parsed = _extract_json_from_text(gemini_response.text)
                if isinstance(parsed, dict):
                    en = (parsed.get('english_description') or '').strip()
                    vi = (parsed.get('vietnamese_description') or '').strip()
                    result['english_description'] = en or fallback_en
                    # If Gemini did not return Vietnamese, translate the English paragraph
                    if not vi:
                        vi = _translate_to_vietnamese(client, gemini_model, result['english_description'])
                    result['vietnamese_description'] = vi or fallback_vi or 'Chua co noi dung tieng Viet.'
                    result['final_description'] = (
                        f"English:\n{result['english_description']}\n\n"
                        f"Vietnamese:\n{result['vietnamese_description']}"
                    ).strip()
                else:
                    # Fallback if model does not return strict JSON.
                    fallback_text = (gemini_response.text or '').strip()
                    result['english_description'] = fallback_text or fallback_en
                    vi = _translate_to_vietnamese(client, gemini_model, result['english_description'])
                    result['vietnamese_description'] = vi or fallback_vi or 'Chua co noi dung tieng Viet.'
                    result['final_description'] = (
                        f"English:\n{result['english_description']}\n\n"
                        f"Vietnamese:\n{result['vietnamese_description']}"
                    ).strip()
            else:
                result['gemini_description'] = None
                result['gemini_error'] = 'Gemini API key not configured'
                if not result.get('vietnamese_description'):
                    result['vietnamese_description'] = fallback_vi or 'Chua co noi dung tieng Viet.'
                result['final_description'] = (
                    f"English:\n{result['english_description']}\n\n"
                    f"Vietnamese:\n{result['vietnamese_description']}"
                ).strip()
        except Exception as e:
            import traceback
            print("\n[GEMINI ERROR]", str(e))
            traceback.print_exc()
            result['gemini_description'] = None
            result['gemini_error'] = str(e)
            if not result.get('vietnamese_description'):
                result['vietnamese_description'] = fallback_vi or 'Chua co noi dung tieng Viet.'
            result['final_description'] = (
                f"English:\n{result['english_description']}\n\n"
                f"Vietnamese:\n{result['vietnamese_description']}"
            ).strip()

    return result


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


@videos_bp.route('/trim', methods=['POST'])
@token_required
def trim_video():
    """Orchestrate a trim job: ask dam_server to encode, save the result,
    create a new VideoItem mirroring /upload. Frontend never sees the bytes."""
    data = request.get_json(silent=True) or {}
    source_video_id = data.get('source_video_id')
    cut_ranges = data.get('cut_ranges')
    target_name = data.get('target_name')
    duration_hint = data.get('duration_hint')
    dam_url = data.get('dam_url')

    if not source_video_id:
        return jsonify({'error': 'source_video_id is required'}), 400
    if not isinstance(cut_ranges, list) or len(cut_ranges) == 0:
        return jsonify({'error': 'cut_ranges must be a non-empty list'}), 400
    if not isinstance(dam_url, str) or not dam_url.strip():
        return jsonify({'error': 'dam_url is required'}), 400
    dam_url = dam_url.strip()
    if not (dam_url.startswith('http://') or dam_url.startswith('https://')):
        return jsonify({'error': 'dam_url must be an http(s) URL'}), 400

    try:
        source = current_app.db.videos.find_one({'_id': ObjectId(source_video_id)})
    except Exception:
        return jsonify({'error': 'Invalid source_video_id'}), 400
    if not source:
        return jsonify({'error': 'Source video not found'}), 404

    # Build the URL dam_server will fetch from. Same URL the browser uses,
    # served by `/uploads/<path:filename>` in app.py.
    video_url = request.url_root.rstrip('/') + f'/uploads/videos/{source["filename"]}'

    dam_endpoint = dam_url.rstrip('/') + '/trim'
    try:
        resp = requests.post(
            dam_endpoint,
            json={'video_url': video_url, 'cut_ranges': cut_ranges},
            stream=True,
            timeout=(30, 600),
        )
    except requests.RequestException as e:
        return jsonify({'error': f'DAM server unreachable: {e}'}), 502

    if resp.status_code != 200:
        try:
            err_body = resp.json()
            err_msg = err_body.get('error') or str(err_body)[:500]
        except ValueError:
            err_msg = (resp.text or '')[:500]
        return jsonify({'error': f'DAM /trim failed (HTTP {resp.status_code}): {err_msg}'}), 502

    unique_filename = f"{uuid.uuid4().hex}.mp4"
    videos_dir = os.path.join(Config.UPLOAD_FOLDER, 'videos')
    os.makedirs(videos_dir, exist_ok=True)
    filepath = os.path.join(videos_dir, unique_filename)
    try:
        with open(filepath, 'wb') as f:
            for chunk in resp.iter_content(chunk_size=64 * 1024):
                if chunk:
                    f.write(chunk)
    except Exception as e:
        if os.path.exists(filepath):
            try:
                os.remove(filepath)
            except OSError:
                pass
        return jsonify({'error': f'Failed to save trimmed video: {e}'}), 500

    file_size = os.path.getsize(filepath)

    if not target_name:
        orig = source.get('original_name') or 'trimmed.mp4'
        dot = orig.rfind('.')
        base = orig[:dot] if dot > 0 else orig
        target_name = f"{base}_trimmed.mp4"

    # Generate thumbnail (match frontend behavior: ~25% in, max 1s seek, 320 wide).
    thumbnail_filename = ''
    try:
        cap = cv2.VideoCapture(filepath)
        fps = cap.get(cv2.CAP_PROP_FPS) or 0.0
        total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT) or 0)
        probe_duration = (total_frames / fps) if fps > 0 else 0.0
        seek_sec = min(1.0, max(0.0, probe_duration * 0.25))
        if fps > 0:
            cap.set(cv2.CAP_PROP_POS_FRAMES, int(seek_sec * fps))
        ret, frame = cap.read()
        cap.release()
        if ret and frame is not None:
            h, w = frame.shape[:2]
            if w > 320:
                new_h = int(h * 320 / w)
                frame = cv2.resize(frame, (320, new_h), interpolation=cv2.INTER_AREA)
            thumb_dir = os.path.join(Config.UPLOAD_FOLDER, 'thumbnails')
            os.makedirs(thumb_dir, exist_ok=True)
            thumb_name = f"{uuid.uuid4().hex}.jpg"
            thumb_path = os.path.join(thumb_dir, thumb_name)
            if cv2.imwrite(thumb_path, frame, [cv2.IMWRITE_JPEG_QUALITY, 80]):
                thumbnail_filename = thumb_name
    except Exception:
        # Thumbnail is best-effort; video upload still succeeds without one.
        thumbnail_filename = ''

    video_doc = {
        'project_id': source['project_id'],
        'subpart_id': source.get('subpart_id'),
        'filename': unique_filename,
        'original_name': target_name,
        'file_path': filepath,
        'file_size': file_size,
        'thumbnail': thumbnail_filename,
        'duration': float(duration_hint) if duration_hint is not None else 0.0,
        'width': int(source.get('width', 0) or 0),
        'height': int(source.get('height', 0) or 0),
        'status': 'uploaded',
        'current_step': 1,
        'annotators': [],
        'uploaded_by': request.current_user['_id'],
        'created_at': datetime.now(timezone.utc),
        'updated_at': datetime.now(timezone.utc),
    }
    result = current_app.db.videos.insert_one(video_doc)

    return jsonify({
        'id': str(result.inserted_id),
        'filename': unique_filename,
        'original_name': target_name,
        'file_size': file_size,
        'url': f'/uploads/videos/{unique_filename}',
        'thumbnail_url': f'/uploads/thumbnails/{thumbnail_filename}' if thumbnail_filename else '',
        'status': 'uploaded',
        'message': 'Trimmed video saved',
    })


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
        entry = {
            'reviewer_id': str(r['reviewer_id']),
            'action': r['action'],
            'comment': r.get('comment', ''),
            'reviewed_at': r['reviewed_at'].isoformat() if r.get('reviewed_at') else None
        }
        if r.get('quality_scores'):
            entry['quality_scores'] = r['quality_scores']
        formatted.append(entry)
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
        review_detail = {
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
        }
        if r.get('quality_scores'):
            review_detail['quality_scores'] = r['quality_scores']
        reviews_with_details.append(review_detail)

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
    if 'original_name' in data:
        name = (data.get('original_name') or '').strip()
        if not name:
            return jsonify({'error': 'original_name must not be empty'}), 400
        update_fields['original_name'] = name
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
    quality_scores = data.get('quality_scores', None)
    reviewer_id = request.current_user['_id']
    now = datetime.now(timezone.utc)

    # Validate quality_scores if provided
    valid_criteria = ['accuracy', 'completeness', 'knowledge_integration', 'fluency_coherence', 'knowledge_relevance']
    if quality_scores:
        validated_scores = {}
        for key in valid_criteria:
            val = quality_scores.get(key, 0)
            validated_scores[key] = max(0, min(5, int(val))) if val else 0
        quality_scores = validated_scores

    # Get existing reviews
    reviews = video.get('reviews', [])
    
    # Remove any existing review from this reviewer (allows changing vote)
    reviews = [r for r in reviews if r['reviewer_id'] != reviewer_id]
    
    # Add new review
    review_entry = {
        'reviewer_id': reviewer_id,
        'action': action,
        'comment': comment,
        'reviewed_at': now
    }
    if quality_scores:
        review_entry['quality_scores'] = quality_scores
    reviews.append(review_entry)

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
    
    # Statuses tracked by the dashboard. Must match keys used downstream.
    status_keys = ['not_submitted', 'pending_review', 'in_review', 'approved', 'rejected']

    # Calculate statistics
    stats = {
        'total_videos': len(videos),
        'by_status': {k: 0 for k in status_keys},
        'by_project': {},
        'by_user': {},  # New: stats by user
        'recent_reviews': [],
        'pending_reviews': []
    }

    for video in videos:
        review_status = video.get('review_status', 'not_submitted')
        # Any unknown legacy value is treated as not_submitted so totals stay consistent.
        if review_status not in stats['by_status']:
            review_status = 'not_submitted'

        # Count by status
        stats['by_status'][review_status] += 1

        # Count by project
        project_id = str(video.get('project_id', ''))
        project_name = projects.get(project_id, {}).get('name', 'Unknown')
        if project_name not in stats['by_project']:
            stats['by_project'][project_name] = {'total': 0, **{k: 0 for k in status_keys}}
        stats['by_project'][project_name]['total'] += 1
        stats['by_project'][project_name][review_status] += 1
        
        # Collect reviews with details and count by user
        for review in video.get('reviews', []):
            reviewer_id = str(review.get('reviewer_id', ''))
            reviewer = users.get(reviewer_id, {})
            reviewer_name = reviewer.get('full_name') or reviewer.get('username', 'Unknown')
            reviewer_color = reviewer.get('avatar_color', '#4A90D9')
            # Note: individual review uses 'action' field (approve/reject), not 'status'
            review_action = review.get('action', 'pending')
            quality_scores = review.get('quality_scores', {})
            
            # Count by user
            if reviewer_id not in stats['by_user']:
                stats['by_user'][reviewer_id] = {
                    'id': str(reviewer_id),
                    'name': reviewer_name,
                    'color': reviewer_color,
                    'total_reviews': 0,
                    'approved': 0,
                    'rejected': 0,
                    'quality_scores_sum': {},
                    'quality_scores_count': 0
                }
            stats['by_user'][reviewer_id]['total_reviews'] += 1
            if review_action == 'approve':
                stats['by_user'][reviewer_id]['approved'] += 1
            elif review_action == 'reject':
                stats['by_user'][reviewer_id]['rejected'] += 1
            
            # Accumulate quality scores for averaging
            if quality_scores:
                stats['by_user'][reviewer_id]['quality_scores_count'] += 1
                for criterion, score in quality_scores.items():
                    if criterion not in stats['by_user'][reviewer_id]['quality_scores_sum']:
                        stats['by_user'][reviewer_id]['quality_scores_sum'][criterion] = 0
                    stats['by_user'][reviewer_id]['quality_scores_sum'][criterion] += score
            
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
        if review_status in ['pending_review', 'in_review']:
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
            if pending_reviewers or (not required_reviewers and review_status in ['pending_review', 'in_review']):
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
    
    # Convert by_user dict to sorted list, compute avg quality scores
    for user_stats in stats['by_user'].values():
        qs_sum = user_stats.pop('quality_scores_sum', {})
        qs_count = user_stats.pop('quality_scores_count', 0)
        if qs_count > 0:
            user_stats['avg_quality_scores'] = {
                k: round(v / qs_count, 2) for k, v in qs_sum.items()
            }
            all_scores = list(user_stats['avg_quality_scores'].values())
            user_stats['avg_quality_score'] = round(sum(all_scores) / len(all_scores), 2) if all_scores else 0
        else:
            user_stats['avg_quality_scores'] = {}
            user_stats['avg_quality_score'] = 0
    
    stats['by_user'] = sorted(
        list(stats['by_user'].values()),
        key=lambda x: x.get('total_reviews', 0),
        reverse=True
    )
    
    return jsonify(stats)


# ============ Video Processing with AI ============

@videos_bp.route('/<video_id>/process', methods=['POST'])
@token_required
def process_video_ai(video_id):
    """
    Process video using DAM server:
    - Extract 16 frames
    - Search KB for each frame using DINOv2 embeddings
    - Get visual description from DAM
    - Combine with Gemini for final description
    """
    try:
        video = current_app.db.videos.find_one({'_id': ObjectId(video_id)})
    except Exception:
        return jsonify({'error': 'Invalid video ID'}), 400

    if not video:
        return jsonify({'error': 'Video not found'}), 404

    data = request.get_json() or {}
    num_frames = data.get('num_frames', 16)
    prompt = data.get('prompt', 'Describe this video in detail, including all visible objects, actions, and scenes.')
    use_gemini = data.get('use_gemini', True)

    try:
        video_path = os.path.join(Config.UPLOAD_FOLDER, 'videos', video['filename'])
        if not os.path.exists(video_path):
            return jsonify({'error': 'Video file not found'}), 404
        result = _run_video_ai_pipeline(
            current_app.db,
            video_path,
            prompt,
            num_frames,
            use_gemini,
            video_id=str(video['_id']),
            video_name=video.get('original_name', ''),
        )

        newly_indexed = int((result.get('retrieval_debug') or {}).get('newly_indexed_video_frames') or 0)
        if newly_indexed > 0:
            current_app.db.videos.update_one(
                {'_id': ObjectId(video_id)},
                {
                    '$set': {
                        'indexed': True,
                        'indexed_at': datetime.now(timezone.utc),
                        'updated_at': datetime.now(timezone.utc),
                    },
                    '$inc': {'indexed_frames': newly_indexed},
                },
            )
        
        # Save processing result to video document
        current_app.db.videos.update_one(
            {'_id': ObjectId(video_id)},
            {
                '$set': {
                    'ai_processing': {
                        'dam_description': result.get('dam_description'),
                        'frame_knowledge': result.get('frame_knowledge'),
                        'frame_similar_images': result.get('frame_similar_images'),
                        'aggregated_knowledge': result.get('aggregated_knowledge'),
                        'similar_images': result.get('similar_images'),
                        'gemini_description': result.get('gemini_description'),
                        'english_description': result.get('english_description', ''),
                        'vietnamese_description': result.get('vietnamese_description', ''),
                        'final_description': result.get('final_description', ''),
                        'processed_at': datetime.now(timezone.utc)
                    },
                    'updated_at': datetime.now(timezone.utc)
                }
            }
        )
        
        return jsonify(result)
        
    except requests.exceptions.RequestException as e:
        return jsonify({'error': f'Failed to connect to DAM server: {str(e)}'}), 503
    except Exception as e:
        import traceback
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500


@videos_bp.route('/demo/process', methods=['POST'])
@token_required
def process_video_demo():
    """Process an uploaded demo video and return only AI description payload."""
    if 'video' not in request.files:
        return jsonify({'error': 'No video file provided'}), 400

    file = request.files['video']
    if not file or file.filename == '':
        return jsonify({'error': 'No file selected'}), 400

    if not allowed_file(file.filename):
        return jsonify({'error': f'File type not allowed. Allowed: {", ".join(ALLOWED_EXTENSIONS)}'}), 400

    prompt = (request.form.get('prompt') or 'Describe this video in detail, including all visible objects, actions, and scenes.').strip()
    num_frames = int(request.form.get('num_frames', 16))
    use_gemini = str(request.form.get('use_gemini', 'true')).lower() == 'true'

    temp_path = ''
    try:
        suffix = os.path.splitext(secure_filename(file.filename))[1] or '.mp4'
        with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tf:
            temp_path = tf.name
        file.save(temp_path)

        video_hash = _file_sha256(temp_path)
        demo_video_cache_id = f"demo_{video_hash}"
        result = _run_video_ai_pipeline(
            current_app.db,
            temp_path,
            prompt,
            num_frames,
            use_gemini,
            video_id=demo_video_cache_id,
            video_name=file.filename,
        )
        return jsonify(result)
    except requests.exceptions.RequestException as e:
        return jsonify({'error': f'Failed to connect to DAM server: {str(e)}'}), 503
    except Exception as e:
        import traceback
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500
    finally:
        if temp_path and os.path.exists(temp_path):
            os.remove(temp_path)


@videos_bp.route('/<video_id>/index', methods=['POST'])
@token_required
def index_video_frames(video_id):
    """
    Index video frames using DINOv2 embeddings for future search.
    """
    try:
        video = current_app.db.videos.find_one({'_id': ObjectId(video_id)})
    except Exception:
        return jsonify({'error': 'Invalid video ID'}), 400

    if not video:
        return jsonify({'error': 'Video not found'}), 404

    try:
        video_path = os.path.join(Config.UPLOAD_FOLDER, 'videos', video['filename'])

        frames = _extract_video_frames(video_path, 16)
        indexed_count = 0
        for i, frame in enumerate(frames):
            frame_b64 = _to_jpeg_base64(frame)
            emb = _request_embedding(frame_b64)
            if not emb:
                continue
            upsert_embedding(
                current_app.db,
                f"{video_id}_frame_{i}",
                'video_frame',
                emb,
                {
                    'video_id': video_id,
                    'frame_index': i,
                    'video_name': video['original_name'],
                },
            )
            if emb:
                indexed_count += 1
        
        # Update video with indexing info
        current_app.db.videos.update_one(
            {'_id': ObjectId(video_id)},
            {
                '$set': {
                    'indexed': True,
                    'indexed_frames': indexed_count,
                    'indexed_at': datetime.now(timezone.utc),
                    'updated_at': datetime.now(timezone.utc)
                }
            }
        )
        
        return jsonify({
            'success': True,
            'indexed_frames': indexed_count,
            'video_id': video_id
        })
        
    except Exception as e:
        import traceback
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500


@videos_bp.route('/search', methods=['POST'])
@token_required
def search_videos_by_image():
    """
    Search for similar videos using an image query.
    """
    data = request.get_json()
    if not data or not data.get('query_image'):
        return jsonify({'error': 'query_image required'}), 400
    
    try:
        response = requests.post(
            f"{Config.DAM_SERVER_URL}/embed",
            json={
                'image': data['query_image'],
            },
            timeout=60
        )
        if response.status_code != 200:
            return jsonify({'error': f'Embedding failed: {response.text}'}), 500

        emb = response.json().get('embedding')
        if not emb:
            return jsonify({'results': [], 'total': 0})
        search_results = {
            'results': search_embeddings(
                current_app.db,
                emb,
                top_k=data.get('top_k', 20),
                entity_types=['video_frame'],
            )
        }
        
        # Group results by video
        video_scores = {}
        for result in search_results.get('results', []):
            video_id = result.get('metadata', {}).get('video_id')
            if video_id:
                if video_id not in video_scores:
                    video_scores[video_id] = {
                        'max_score': result['score'],
                        'frame_matches': []
                    }
                video_scores[video_id]['frame_matches'].append({
                    'frame_index': result.get('metadata', {}).get('frame_index'),
                    'score': result['score']
                })
                if result['score'] > video_scores[video_id]['max_score']:
                    video_scores[video_id]['max_score'] = result['score']
        
        # Get video details
        videos = []
        for video_id, scores in sorted(video_scores.items(), key=lambda x: -x[1]['max_score']):
            try:
                video = current_app.db.videos.find_one({'_id': ObjectId(video_id)})
                if video:
                    videos.append({
                        'video': _build_video_stats(current_app.db, video),
                        'score': scores['max_score'],
                        'frame_matches': scores['frame_matches']
                    })
            except Exception:
                pass
        
        return jsonify({
            'results': videos,
            'total': len(videos)
        })
        
    except Exception as e:
        import traceback
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500
