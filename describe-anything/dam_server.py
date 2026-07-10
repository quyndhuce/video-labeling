# Copyright 2025 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.
#
# SPDX-License-Identifier: Apache-2.0

# Adapted from https://github.com/NVlabs/VILA/blob/ec7fb2c264920bf004fd9fa37f1ec36ea0942db5/server.py
# This script offers an OpenAI-compatible server for the Describe Anything Model (DAM).
# Extended with DINOv2 embedding APIs. Indexing/search persistence is handled in backend.

import argparse
import base64
import os
import re
import time
import uuid
from contextlib import asynccontextmanager
from io import BytesIO
from typing import List, Literal, Optional, Union, get_args

import requests
import torch
import torch.nn.functional as F
import uvicorn
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, StreamingResponse
from PIL import Image as PILImage
from PIL.Image import Image
from pydantic import BaseModel
import numpy as np
import traceback
import json
import asyncio
import tempfile
import shutil
import subprocess
import cv2
from typing import AsyncGenerator, Generator
from torchvision import transforms
#thêm mới
import os, csv, io, tempfile
import requests
from scenedetect import open_video, SceneManager
from scenedetect.detectors import ContentDetector, ThresholdDetector, AdaptiveDetector

# --- DAM compatibility shims for newer transformers ---
# 1. transformers >= 4.50 moved no_init_weights out of modeling_utils; the
#    shipped dam package still imports it from the old path.
# 2. transformers >= 5 added all_tied_weights_keys (dict); DAM-bundled
#    submodels (e.g. MultimodalProjector) only define the older
#    _tied_weights_keys list. Default to {} so the iteration is a no-op —
#    tied-weights bookkeeping is diagnostic only, doesn't affect inference.
import transformers.modeling_utils as _mu
if not hasattr(_mu, "no_init_weights"):
    try:
        from transformers.initialization import no_init_weights as _niw
        _mu.no_init_weights = _niw
    except ImportError:
        pass
if not hasattr(_mu.PreTrainedModel, "all_tied_weights_keys"):
    _mu.PreTrainedModel.all_tied_weights_keys = {}

from dam import DescribeAnythingModel, DEFAULT_IMAGE_TOKEN, disable_torch_init

# ============ Global Variables ============
dam = None
sam2_predictor = None
dinov2_model = None
dinov2_transform = None

# ============ Configuration ============
DINOV2_MODEL = os.getenv('DINOV2_MODEL', 'dinov2_vitg14')  # Largest DINOv2 model
EMBEDDING_DIM = 1536  # DINOv2 ViT-G/14 dimension


class TextContent(BaseModel):
    type: Literal["text"]
    text: str


class ImageURL(BaseModel):
    url: str


class ImageContent(BaseModel):
    type: Literal["image_url"]
    image_url: ImageURL


IMAGE_CONTENT_BASE64_REGEX = re.compile(
    r"^data:image/(png|jpe?g);base64,(.*)$")


class ChatMessage(BaseModel):
    role: Literal["user", "assistant"]
    content: Union[str, List[Union[TextContent, ImageContent]]]


class ChatCompletionRequest(BaseModel):
    model: str
    messages: List[ChatMessage]
    max_tokens: Optional[int] = 512
    top_p: Optional[float] = 0.9
    temperature: Optional[float] = 0.2
    stream: Optional[bool] = False
    use_cache: Optional[bool] = True
    num_beams: Optional[int] = 1


class SceneDetectRequest(BaseModel):
    video_url: str
    method: Optional[str] = "content"
    threshold: Optional[float] = 27.0
    min_scene_len: Optional[float] = 1.0


class CutRange(BaseModel):
    start_sec: float
    end_sec: float


class TrimRequest(BaseModel):
    video_url: str
    cut_ranges: List[CutRange]


def fmt_time(seconds: float) -> str:
    h = int(seconds // 3600)
    m = int((seconds % 3600) // 60)
    s = seconds % 60
    return f"{h:02d}:{m:02d}:{s:06.3f}"


def load_image(image_url: str) -> Image:
    if image_url.startswith("http") or image_url.startswith("https"):
        response = requests.get(image_url)
        image = PILImage.open(BytesIO(response.content))
    else:
        match_results = IMAGE_CONTENT_BASE64_REGEX.match(image_url)
        if match_results is None:
            raise ValueError(f"Invalid image url: {image_url}")
        image_base64 = match_results.groups()[1]
        image = PILImage.open(BytesIO(base64.b64decode(image_base64)))
    if image.mode not in ("RGB", "RGBA"):
        image = image.convert("RGB")
    return image


def process_image(image_pil):
    # RGBA → use alpha channel as the object mask (Object Mode).
    # RGB  → synthesize a full-white mask covering the whole frame (Video Mode).
    if image_pil.mode == "RGBA":
        arr = np.asarray(image_pil)
        img = PILImage.fromarray(arr[..., :3])
        mask = PILImage.fromarray((arr[..., 3] > 0).astype(np.uint8) * 255)
    else:
        img = image_pil
        mask = PILImage.new("L", img.size, color=255)
    return img, mask


# ============ DINOv2 Helper Functions ============
def load_dinov2_model(model_name: str = 'dinov2_vitg14'):
    """Load DINOv2 model from torch hub."""
    print(f"[DINOv2] Loading {model_name}...")
    model = torch.hub.load('facebookresearch/dinov2', model_name)
    device = 'cuda' if torch.cuda.is_available() else 'cpu'
    model = model.to(device)
    model.eval()
    
    # DINOv2 expects images normalized with ImageNet stats
    transform = transforms.Compose([
        transforms.Resize(518, interpolation=transforms.InterpolationMode.BICUBIC),
        transforms.CenterCrop(518),
        transforms.ToTensor(),
        transforms.Normalize(mean=[0.485, 0.456, 0.406], std=[0.229, 0.224, 0.225])
    ])
    
    print(f"[DINOv2] Model loaded on {device}")
    return model, transform


def get_dinov2_embedding(image: PILImage.Image, mask: PILImage.Image = None) -> np.ndarray:
    """Get DINOv2 embedding for an image, optionally masked to a region."""
    global dinov2_model, dinov2_transform
    
    if dinov2_model is None:
        raise RuntimeError("DINOv2 model not loaded")
    
    # Convert to RGB if needed
    if image.mode != 'RGB':
        image = image.convert('RGB')
    
    # If mask provided, crop to bounding box of mask
    if mask is not None:
        mask_np = np.array(mask.convert('L'))
        if mask_np.max() > 0:
            rows = np.any(mask_np > 128, axis=1)
            cols = np.any(mask_np > 128, axis=0)
            rmin, rmax = np.where(rows)[0][[0, -1]]
            cmin, cmax = np.where(cols)[0][[0, -1]]
            # Add padding
            pad = 10
            rmin = max(0, rmin - pad)
            rmax = min(mask_np.shape[0], rmax + pad)
            cmin = max(0, cmin - pad)
            cmax = min(mask_np.shape[1], cmax + pad)
            image = image.crop((cmin, rmin, cmax, rmax))
    
    # Transform and get embedding
    device = next(dinov2_model.parameters()).device
    img_tensor = dinov2_transform(image).unsqueeze(0).to(device)
    
    with torch.no_grad():
        embedding = dinov2_model(img_tensor)
        embedding = F.normalize(embedding, p=2, dim=1)
    
    return embedding.cpu().numpy().flatten()


def _try_compile(module, label: str, mode: str = "reduce-overhead", fullgraph: bool = False):
    """Wrap a nn.Module with torch.compile (Triton backend via TorchInductor).
    Returns the compiled module on success, the original module on failure.
    First call after compile takes 30-120s for kernel warmup."""
    if module is None:
        return module
    try:
        compiled = torch.compile(module, mode=mode, fullgraph=fullgraph, dynamic=True)
        print(f"[compile] {label}: torch.compile enabled (mode={mode}, fullgraph={fullgraph})")
        return compiled
    except Exception as e:
        print(f"[compile] {label}: failed, falling back to eager. Error: {e}")
        return module


@asynccontextmanager
async def lifespan(app: FastAPI):
    global dam, sam2_predictor, dinov2_model, dinov2_transform

    do_compile = getattr(app.args, 'compile', False)
    compile_mode = getattr(app.args, 'compile_mode', 'reduce-overhead')
    if do_compile:
        print(f"[compile] torch.compile ENABLED (mode={compile_mode}). "
              f"First inference will be slow (30-120s warmup per model).")

    if app.args.model_path:
        disable_torch_init()
        prompt_modes = {
            "focal_prompt": "full+focal_crop",
        }
        dam = DescribeAnythingModel(
            model_path=app.args.model_path,
            conv_mode=app.args.conv_mode,
            prompt_mode=prompt_modes[app.args.prompt_mode],
        )
        print(f"Model {dam.model_name} loaded successfully.")

        if do_compile:
            # DAM wraps an HF transformers model; the LLM is typically at dam.model
            # or dam.model.language_model. fullgraph=False because generation loops graph-break.
            target = getattr(dam, 'model', None)
            if target is not None:
                lm = getattr(target, 'language_model', None) or target
                wrapped = _try_compile(lm, label="DAM language model", mode=compile_mode, fullgraph=False)
                if getattr(target, 'language_model', None) is not None:
                    target.language_model = wrapped
                else:
                    dam.model = wrapped
            else:
                print("[compile] DAM: no .model attribute found, skipping")
    else:
        print("[DAM] --model-path not provided, skipping DAM model load.")

    # Load DINOv2 model
    if getattr(app.args, 'skip_dinov2', False):
        print("[DINOv2] --skip-dinov2 set, skipping model load. /embed and visual-similarity search will be unavailable.")
    else:
        try:
            dinov2_model_name = getattr(app.args, 'dinov2_model', DINOV2_MODEL)
            dinov2_model, dinov2_transform = load_dinov2_model(dinov2_model_name)
            if do_compile:
                # DINOv2 is a clean forward pass with fixed 518x518 input — safest target
                dinov2_model = _try_compile(dinov2_model, label="DINOv2", mode=compile_mode, fullgraph=False)
        except Exception as e:
            print(f"[DINOv2] Failed to load model: {e}")
            traceback.print_exc()

    # Load SAM2 model for segmentation (same approach as demo_video.py)
    sam2_predictor = None
    sam2_checkpoint = getattr(app, '_sam2_checkpoint', None) or os.getenv('SAM2_CHECKPOINT', '')
    sam2_config = getattr(app, '_sam2_config', None) or os.getenv('SAM2_CONFIG', '')

    # Auto-detect config YAML based on checkpoint name (like demo_video.py)
    if sam2_checkpoint and not sam2_config:
        ckpt_name = os.path.basename(sam2_checkpoint).lower()
        if 'large' in ckpt_name or 'hiera_l' in ckpt_name:
            sam2_config = 'configs/sam2.1/sam2.1_hiera_l.yaml'
        elif 'small' in ckpt_name or 'hiera_s' in ckpt_name:
            sam2_config = 'configs/sam2.1/sam2.1_hiera_s.yaml'
        elif 'base' in ckpt_name or 'hiera_b' in ckpt_name:
            sam2_config = 'configs/sam2.1/sam2.1_hiera_b+.yaml'
        elif 'tiny' in ckpt_name or 'hiera_t' in ckpt_name:
            sam2_config = 'configs/sam2.1/sam2.1_hiera_t.yaml'
        else:
            sam2_config = 'configs/sam2.1/sam2.1_hiera_l.yaml'

    if sam2_checkpoint and os.path.exists(sam2_checkpoint):
        try:
            from sam2.build_sam import build_sam2_video_predictor
            device = 'cuda' if torch.cuda.is_available() else 'cpu'
            print(f"[SAM2] Loading video predictor on {device}")
            print(f"[SAM2]   checkpoint: {sam2_checkpoint}")
            print(f"[SAM2]   config: {sam2_config}")
            sam2_predictor = build_sam2_video_predictor(sam2_config, sam2_checkpoint, device=device)
            print("[SAM2] Video predictor loaded successfully!")
            if do_compile:
                # Only compile the image encoder. The rest of the predictor has
                # dynamic control flow (memory bank, mask decoder) that fights the
                # compiler and would cause heavy graph breaks.
                encoder = getattr(sam2_predictor, 'image_encoder', None)
                if encoder is not None:
                    sam2_predictor.image_encoder = _try_compile(
                        encoder, label="SAM2 image_encoder", mode=compile_mode, fullgraph=False
                    )
                else:
                    print("[compile] SAM2: no .image_encoder attribute found, skipping")
        except Exception as e:
            print(f"[SAM2] Failed to load model: {e}")
            traceback.print_exc()
    else:
        print(f"[SAM2] No checkpoint found. /segment endpoint will use fallback.")
        print(f"[SAM2] Set SAM2_CHECKPOINT env or place checkpoint in checkpoints/")

    yield


app = FastAPI(debug=True, lifespan=lifespan)

# Add CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["https://annotator.stecom.vn", "http://localhost:4200", "https://video-labeling.vercel.app"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


def _fmt_size(n: Optional[int]) -> str:
    if n is None:
        return "?"
    if n < 1024:
        return f"{n} B"
    if n < 1024 * 1024:
        return f"{n / 1024:.1f} KB"
    return f"{n / (1024 * 1024):.2f} MB"


@app.middleware("http")
async def log_request_size(request: Request, call_next):
    raw_len = request.headers.get("content-length")
    cl = int(raw_len) if raw_len and raw_len.isdigit() else None
    t0 = time.time()
    response = await call_next(request)
    elapsed = time.time() - t0
    print(f"[req] {request.method} {request.url.path} "
          f"content-length={_fmt_size(cl)} status={response.status_code} "
          f"elapsed={elapsed:.2f}s")
    return response


async def convert_generator_to_async(gen: Generator) -> AsyncGenerator:
    for item in gen:
        yield item
        await asyncio.sleep(0)

# Load model upon startup


@app.post("/chat/completions")
async def chat_completions(request: ChatCompletionRequest):
    try:
        global dam

        # Validate the model name (use "describe_anything_model" to skip the model name check)
        if request.model != "describe_anything_model" and request.model != dam.model_name:
            raise ValueError(
                f"The endpoint is configured to use the model {dam.model_name}, "
                f"but the request model is {request.model}"
            )

        messages = request.messages

        images = []
        image_wire_sizes: List[int] = []  # bytes of each image_url string (wire payload per frame)
        query = ""

        for message in messages:
            if message.role == "user":
                if isinstance(message.content, str):
                    query += message.content
                elif isinstance(message.content, list):
                    for content in message.content:
                        if content.type == "text":
                            query += content.text
                        elif content.type == "image_url":
                            image_wire_sizes.append(len(content.image_url.url))
                            image = load_image(content.image_url.url)
                            images.append(image)
                        else:
                            raise ValueError("Unsupported content type")
            elif message.role == "assistant":
                pass  # We can ignore assistant messages in the input

        if len(images) == 0:
            raise ValueError("No image with mask found in input messages.")

        if image_wire_sizes:
            total = sum(image_wire_sizes)
            per_image = ", ".join(_fmt_size(n) for n in image_wire_sizes)
            print(f"[chat] {len(image_wire_sizes)} images: [{per_image}] total={_fmt_size(total)} "
                  f"first_image_size={images[0].size}")

        # Remove the prefix of the query if it exists. We detect the prefix and add it back on our own.
        query = query.strip()
        query = query.removeprefix("Image:")
        query = query.removeprefix("Video:")
        query = query.strip()
        while query.startswith(DEFAULT_IMAGE_TOKEN):
            query = query.removeprefix(DEFAULT_IMAGE_TOKEN)
        assert DEFAULT_IMAGE_TOKEN not in query, f"{DEFAULT_IMAGE_TOKEN} should not be in other positions than the beginning of the query"
        query = query.strip()

        if app.args.image_video_joint_checkpoint:
            if len(images) == 1:
                query = f"Image: {DEFAULT_IMAGE_TOKEN}\n{query}"
            elif len(images) == 8:
                query = f"Video: {DEFAULT_IMAGE_TOKEN * 8}\n{query}"
            else:
                raise ValueError(
                    f"Only 1 image and video (with 8 frames) are supported, but {len(images)} images are provided")
        else:
            if len(images) == 8:
                # Handle video even if image_video_joint_checkpoint is not set (e.g., using DAM-3B-Video but forgot flag)
                query = f"Video: {DEFAULT_IMAGE_TOKEN * 8}\n{query}"
            else:
                assert len(images) == 1, f"Expected 1 image or 8 frames, but got {len(images)}."
                query = f"{DEFAULT_IMAGE_TOKEN}\n{query}"

        # Print the query for debugging
        # print(f"Query: {query}")

        pils = [process_image(image) for image in images]

        image_pils, mask_pils = zip(*pils)

        if request.stream:
            async def generate_stream():
                try:
                    description_generator = dam.get_description(
                        image_pils,
                        mask_pils,
                        query,
                        streaming=True,
                        temperature=app.args.temperature,
                        top_p=app.args.top_p,
                        num_beams=app.args.num_beams,
                        max_new_tokens=app.args.max_new_tokens,
                    )
                    async for text in convert_generator_to_async(description_generator):
                        chunk = {
                            "id": uuid.uuid4().hex,
                            "object": "chat.completion.chunk",
                            "created": int(time.time()),
                            "model": request.model,
                            "choices": [{
                                "delta": {
                                    "content": [{
                                        "type": "text",
                                        "text": text
                                    }]
                                },
                                "finish_reason": None
                            }]
                        }
                        yield f"data: {json.dumps(chunk)}\n\n"

                    # Send the final chunk
                    yield f"data: {json.dumps({'choices': [{'finish_reason': 'stop'}]})}\n\n"
                    yield "data: [DONE]\n\n"
                except Exception as e:
                    print(f"Error in stream: {str(e)}")
                    yield f"data: {json.dumps({'error': str(e)})}\n\n"

            return StreamingResponse(generate_stream(), media_type="text/event-stream")
        else:
            outputs = dam.get_description(
                image_pils,
                mask_pils,
                query,
                streaming=False,
                temperature=app.args.temperature,
                top_p=app.args.top_p,
                num_beams=app.args.num_beams,
                max_new_tokens=app.args.max_new_tokens,
            )

            return {
                "id": uuid.uuid4().hex,
                "object": "chat.completion",
                "created": time.time(),
                "model": request.model,
                "choices": [
                    {"message": ChatMessage(
                        role="assistant", content=outputs)}
                ],
            }

    except Exception as e:
        traceback.print_exc()
        return JSONResponse(
            status_code=500,
            content={"error": str(e)},
        )


# ============ SAM2 Segmentation Endpoint ============

class SegmentRequest(BaseModel):
    brush_mask: str  # base64 PNG of user brush strokes
    frame_image: Optional[str] = None  # base64 PNG/JPEG of the video frame


def _fallback_segmentation(brush_mask_b64: str) -> dict:
    """Fallback segmentation using PIL when SAM2 is not available."""
    from PIL import ImageFilter

    raw = brush_mask_b64.split(',')[-1] if ',' in brush_mask_b64 else brush_mask_b64
    mask_image = PILImage.open(BytesIO(base64.b64decode(raw))).convert('L')

    smoothed = mask_image.filter(ImageFilter.GaussianBlur(radius=3))
    mask_array = np.array(smoothed)
    binary_mask = (mask_array > 128).astype(np.uint8) * 255
    result_image = PILImage.fromarray(binary_mask, mode='L')
    result_image = result_image.filter(ImageFilter.MaxFilter(5))
    result_image = result_image.filter(ImageFilter.MinFilter(3))
    result_image = result_image.filter(ImageFilter.GaussianBlur(radius=2))
    final_mask = (np.array(result_image) > 100).astype(np.uint8) * 255
    result_image = PILImage.fromarray(final_mask, mode='L')

    buffer = BytesIO()
    result_image.save(buffer, format='PNG')
    segmented_b64 = base64.b64encode(buffer.getvalue()).decode('utf-8')
    return {
        'segmented_mask': f'data:image/png;base64,{segmented_b64}',
        'confidence': 0.85,
        'message': 'Segmentation completed (fallback – SAM2 not loaded)'
    }


@app.post("/segment")
async def segment_object(req: SegmentRequest):
    """
    Object segmentation using SAM2 video predictor (same approach as demo_video.py).
    Accepts brush_mask (user-drawn region) + frame_image (video frame).
    Extracts points from brush mask, uses SAM2 add_new_points_or_box to segment.
    Falls back to PIL-based processing if SAM2 is not available.
    """
    global sam2_predictor
    try:
        brush_mask_b64 = req.brush_mask
        frame_image_b64 = req.frame_image or ''

        if not brush_mask_b64:
            return JSONResponse(status_code=400, content={'error': 'brush_mask is required'})

        # If SAM2 not loaded or no frame image -> fallback
        if sam2_predictor is None or not frame_image_b64:
            return _fallback_segmentation(brush_mask_b64)

        # Decode frame image
        frame_raw = frame_image_b64.split(',')[-1] if ',' in frame_image_b64 else frame_image_b64
        frame_img = PILImage.open(BytesIO(base64.b64decode(frame_raw))).convert('RGB')
        frame_np = np.array(frame_img)

        # Decode brush mask
        mask_raw = brush_mask_b64.split(',')[-1] if ',' in brush_mask_b64 else brush_mask_b64
        brush_img = PILImage.open(BytesIO(base64.b64decode(mask_raw))).convert('RGBA')
        if brush_img.size != frame_img.size:
            brush_img = brush_img.resize(frame_img.size, PILImage.NEAREST)
        brush_np = np.array(brush_img)

        # Extract painted region (alpha > 0) - same as demo_video.py extract_points_from_mask
        if brush_np.shape[2] == 4:
            prompt_mask = brush_np[:, :, 3] > 0
        else:
            prompt_mask = np.any(brush_np[:, :, :3] > 0, axis=2)

        # Extract points from mask (like demo_video.py)
        ys, xs = np.where(prompt_mask)
        if len(xs) == 0 or len(ys) == 0:
            return _fallback_segmentation(brush_mask_b64)

        # Stack as (x, y) coords, randomly sample up to 8 points (like demo_video.py)
        coords = np.stack((xs, ys), axis=1)
        np.random.seed(0)
        n_sample = min(coords.shape[0], 8)
        selected_indices = np.random.choice(coords.shape[0], size=n_sample, replace=False)
        points = coords[selected_indices].astype(np.float32)

        # Save frame to temp dir as JPEG (SAM2 video predictor needs a frame directory)
        temp_dir = tempfile.mkdtemp()
        frame_path = os.path.join(temp_dir, '0000.jpg')
        frame_bgr = cv2.cvtColor(frame_np, cv2.COLOR_RGB2BGR)
        cv2.imwrite(frame_path, frame_bgr)

        # Run SAM2 video predictor (same flow as demo_video.py apply_sam2)
        with torch.autocast('cuda', dtype=torch.bfloat16):
            inference_state = sam2_predictor.init_state(video_path=temp_dir)
            sam2_predictor.reset_state(inference_state)

            labels = np.ones(len(points), dtype=np.int32)
            _, _, out_mask_logits = sam2_predictor.add_new_points_or_box(
                inference_state=inference_state,
                frame_idx=0,
                obj_id=1,
                points=points,
                labels=labels
            )

        # Extract mask from logits (like demo_video.py)
        mask = (out_mask_logits[0] > 0.0).cpu().numpy().squeeze()
        confidence = float(torch.sigmoid(out_mask_logits[0]).max().cpu())

        # Convert mask to PNG
        mask_uint8 = mask.astype(np.uint8) * 255
        result_image = PILImage.fromarray(mask_uint8, mode='L')

        buffer = BytesIO()
        result_image.save(buffer, format='PNG')
        segmented_b64 = base64.b64encode(buffer.getvalue()).decode('utf-8')

        # Cleanup temp dir
        shutil.rmtree(temp_dir, ignore_errors=True)

        return {
            'segmented_mask': f'data:image/png;base64,{segmented_b64}',
            'confidence': confidence,
            'message': f'SAM2 segmentation completed (confidence: {confidence:.3f})'
        }

    except Exception as e:
        traceback.print_exc()
        try:
            return _fallback_segmentation(req.brush_mask)
        except Exception:
            return JSONResponse(status_code=500, content={'error': str(e)})


# ============ DINOv2 Embedding Endpoints ============

class EmbedRequest(BaseModel):
    image: str  # base64 encoded image
    mask: Optional[str] = None  # optional base64 mask for region embedding
    entity_id: Optional[str] = None  # ID to associate with embedding
    entity_type: Optional[str] = 'image'  # 'image' or 'object'


@app.post("/embed")
async def get_embedding(request: EmbedRequest):
    """Get DINOv2 embedding for an image or masked region."""
    try:
        if dinov2_model is None:
            return JSONResponse(status_code=503, content={'error': 'DINOv2 model not loaded'})
        
        # Decode image
        img_raw = request.image.split(',')[-1] if ',' in request.image else request.image
        image = PILImage.open(BytesIO(base64.b64decode(img_raw))).convert('RGB')
        
        # Decode mask if provided
        mask = None
        if request.mask:
            mask_raw = request.mask.split(',')[-1] if ',' in request.mask else request.mask
            mask = PILImage.open(BytesIO(base64.b64decode(mask_raw))).convert('L')
        
        # Get embedding
        embedding = get_dinov2_embedding(image, mask)
        
        return {
            'embedding': embedding.tolist(),
            'dimension': len(embedding),
            'entity_id': request.entity_id,
            'entity_type': request.entity_type
        }
    
    except Exception as e:
        traceback.print_exc()
        return JSONResponse(status_code=500, content={'error': str(e)})


@app.post("/scene-detect")
def detect_scenes_endpoint(req: SceneDetectRequest):
    temp_video_path = None
    try:
        # Download
        print(f"Downloading video from {req.video_url}...")
        response = requests.get(req.video_url, stream=True, timeout=(5, 60))
        response.raise_for_status()

        with tempfile.NamedTemporaryFile(delete=False, suffix=".mp4") as tmp:
            for chunk in response.iter_content(chunk_size=8192):
                tmp.write(chunk)
            temp_video_path = tmp.name

        # Setup detector
        video = open_video(temp_video_path)
        fps = video.frame_rate
        min_len_frames = int(req.min_scene_len * fps)

        if req.method == "content":
            detector = ContentDetector(
                threshold=req.threshold or 27.0,
                min_scene_len=min_len_frames
            )
        elif req.method == "threshold":
            detector = ThresholdDetector(
                threshold=req.threshold or 12.0,
                min_scene_len=min_len_frames
            )
        elif req.method == "adaptive":
            detector = AdaptiveDetector(
                adaptive_threshold=req.threshold or 3.0,
                min_scene_len=min_len_frames
            )
        else:
            return JSONResponse(status_code=400,
                                content={"error": f"Invalid method: {req.method}"})

        # Detect
        scene_manager = SceneManager()
        scene_manager.add_detector(detector)
        scene_manager.detect_scenes(video=video, show_progress=False)

        # Build results
        fields = ["scene", "start_time", "end_time", "duration_s",
                  "start_frame", "end_frame", "start_sec", "end_sec"]
        results = []
        for i, (start, end) in enumerate(scene_manager.get_scene_list(), start=1):
            start_sec = start.seconds
            end_sec   = end.seconds
            results.append({
                "scene":       i,
                "start_time":  fmt_time(start_sec),
                "end_time":    fmt_time(end_sec),
                "duration_s":  round(end_sec - start_sec, 3),
                "start_frame": start.frame_num,
                "end_frame":   end.frame_num,
                "start_sec":   round(start_sec, 3),
                "end_sec":     round(end_sec, 3),
            })

        return JSONResponse(content={"scenes": results})

    except Exception as e:
        import traceback; traceback.print_exc()
        return JSONResponse(status_code=500, content={"error": str(e)})

    finally:
        try:
            if 'video' in locals() and video is not None:
                video.close()
        except Exception:
            pass
        if temp_video_path and os.path.exists(temp_video_path):
            try:
                os.remove(temp_video_path)   # luôn chạy dù crash ở đâu
            except Exception as e:
                print(f"Warning: Failed to delete temp file {temp_video_path}: {e}")

def _normalize_cuts(cut_ranges: List[CutRange], duration: float) -> List[tuple[float, float]]:
    """Clamp to [0, duration], drop zero-length / inverted, sort, merge overlaps."""
    cleaned: List[tuple[float, float]] = []
    for r in cut_ranges:
        s = max(0.0, min(r.start_sec, r.end_sec))
        e = min(duration, max(r.start_sec, r.end_sec))
        if e - s > 0.001:
            cleaned.append((s, e))
    cleaned.sort(key=lambda t: t[0])
    merged: List[tuple[float, float]] = []
    for s, e in cleaned:
        if merged and s <= merged[-1][1]:
            merged[-1] = (merged[-1][0], max(merged[-1][1], e))
        else:
            merged.append((s, e))
    return merged


def _keep_ranges(cuts: List[tuple[float, float]], duration: float) -> List[tuple[float, float]]:
    """Complement of cuts within [0, duration]."""
    keep: List[tuple[float, float]] = []
    cursor = 0.0
    for s, e in cuts:
        if s > cursor:
            keep.append((cursor, s))
        cursor = e
    if cursor < duration:
        keep.append((cursor, duration))
    return [(s, e) for s, e in keep if e - s > 0.001]


def _probe_duration(path: str) -> float:
    out = subprocess.run(
        ["ffprobe", "-v", "quiet", "-show_entries", "format=duration",
         "-of", "csv=p=0", path],
        capture_output=True, text=True, check=True
    )
    return float(out.stdout.strip())


def _has_audio(path: str) -> bool:
    out = subprocess.run(
        ["ffprobe", "-v", "quiet", "-select_streams", "a",
         "-show_entries", "stream=codec_type", "-of", "csv=p=0", path],
        capture_output=True, text=True, check=True
    )
    return bool(out.stdout.strip())


@app.post("/trim")
def trim_video(req: TrimRequest):
    # Sync handler on purpose: ffmpeg subprocess.run blocks for tens of seconds;
    # FastAPI runs `def` handlers in a worker thread so the event loop (and every
    # other endpoint) stays responsive while this trim runs.
    if not req.cut_ranges:
        return JSONResponse(status_code=400, content={"error": "cut_ranges is required"})

    src_path = None
    out_path = None
    seg_paths: List[str] = []
    list_path = None
    try:
        # 1. Download source
        try:
            print(f"[trim] Downloading {req.video_url}")
            r = requests.get(req.video_url, stream=True, timeout=(5, 60))
            r.raise_for_status()
            with tempfile.NamedTemporaryFile(delete=False, suffix=".mp4") as tmp:
                for chunk in r.iter_content(chunk_size=8192):
                    tmp.write(chunk)
                src_path = tmp.name
        except Exception as e:
            return JSONResponse(status_code=502, content={"error": f"failed to fetch source video: {e}"})

        # 2. Probe duration + audio presence
        try:
            duration = _probe_duration(src_path)
            with_audio = _has_audio(src_path)
        except subprocess.CalledProcessError as e:
            return JSONResponse(status_code=500, content={"error": f"ffprobe failed: {e.stderr or e}"})

        # 3. Compute keep ranges
        cuts = _normalize_cuts(req.cut_ranges, duration)
        keeps = _keep_ranges(cuts, duration)
        if not keeps:
            return JSONResponse(status_code=400, content={"error": "nothing left after cuts"})

        # 4. Encode each keep range as a segment via NVDEC + NVENC.
        #    `-ss` AFTER `-i` keeps frame-accurate trimming; CUDA decode is cheap.
        for i, (s, e) in enumerate(keeps):
            seg_fd, seg_path = tempfile.mkstemp(suffix=".mp4", prefix=f"trim_seg_{i}_")
            os.close(seg_fd)
            seg_paths.append(seg_path)
            cmd = [
                "ffmpeg", "-y",
                "-hwaccel", "cuda",
                "-hwaccel_output_format", "cuda",
                "-i", src_path,
                "-ss", f"{s}", "-to", f"{e}",
                "-c:v", "h264_nvenc", "-preset", "p4", "-cq", "20",
            ]
            if with_audio:
                cmd += ["-c:a", "aac"]
            cmd.append(seg_path)
            print(f"[trim] Segment {i+1}/{len(keeps)} [{s:.3f}-{e:.3f}] -> {seg_path}")
            proc = subprocess.run(cmd, capture_output=True, text=True)
            if proc.returncode != 0:
                tail = (proc.stderr or "")[-500:]
                return JSONResponse(status_code=500, content={"error": f"ffmpeg segment {i} failed: {tail}"})

        # 5. Concat segments via the concat demuxer with stream-copy.
        list_fd, list_path = tempfile.mkstemp(suffix=".txt", prefix="trim_list_")
        with os.fdopen(list_fd, "w") as f:
            for p in seg_paths:
                f.write(f"file '{p}'\n")

        out_fd, out_path = tempfile.mkstemp(suffix=".mp4", prefix="trim_out_")
        os.close(out_fd)
        concat_cmd = [
            "ffmpeg", "-y", "-f", "concat", "-safe", "0",
            "-i", list_path, "-c", "copy", out_path,
        ]
        print(f"[trim] Concat {len(seg_paths)} segments -> {out_path}")
        proc = subprocess.run(concat_cmd, capture_output=True, text=True)
        if proc.returncode != 0:
            tail = (proc.stderr or "")[-500:]
            return JSONResponse(status_code=500, content={"error": f"ffmpeg concat failed: {tail}"})

        # 6. Stream back; transfer ownership of out + seg + list files to the iterator.
        def file_iter(path: str, to_delete: List[str]):
            try:
                with open(path, "rb") as f:
                    while True:
                        chunk = f.read(64 * 1024)
                        if not chunk:
                            break
                        yield chunk
            finally:
                for p in [path, *to_delete]:
                    try:
                        if os.path.exists(p):
                            os.remove(p)
                    except Exception as e:
                        print(f"[trim] warning: failed to delete {p}: {e}")

        out_to_stream = out_path
        tail_files = [*seg_paths, list_path]
        out_path = None
        seg_paths = []
        list_path = None
        return StreamingResponse(
            file_iter(out_to_stream, tail_files),
            media_type="video/mp4",
            headers={"Content-Disposition": 'attachment; filename="trimmed.mp4"'}
        )

    except Exception as e:
        traceback.print_exc()
        return JSONResponse(status_code=500, content={"error": str(e)})

    finally:
        if src_path and os.path.exists(src_path):
            try:
                os.remove(src_path)
            except Exception as e:
                print(f"[trim] warning: failed to delete {src_path}: {e}")
        for p in seg_paths:
            try:
                if os.path.exists(p):
                    os.remove(p)
            except Exception as e:
                print(f"[trim] warning: failed to delete {p}: {e}")
        if list_path and os.path.exists(list_path):
            try:
                os.remove(list_path)
            except Exception as e:
                print(f"[trim] warning: failed to delete {list_path}: {e}")
        if out_path and os.path.exists(out_path):
            try:
                os.remove(out_path)
            except Exception as e:
                print(f"[trim] warning: failed to delete {out_path}: {e}")


@app.get("/health")
async def health_check():
    """Health check endpoint."""
    return {
        "status": "ok",
        "dam_loaded": dam is not None,
        "sam2_loaded": sam2_predictor is not None,
        "dinov2_loaded": dinov2_model is not None
    }


if __name__ == "__main__":
    # Example: python dam_server.py --model-path nvidia/DAM-3B --conv-mode v1 --prompt-mode focal_prompt --temperature 0.2 --top_p 0.9 --num_beams 1 --max_new_tokens 512 --workers 1
    # Example: python dam_server.py --model-path nvidia/DAM-3B-Video --conv-mode v1 --prompt-mode focal_prompt --temperature 0.2 --top_p 0.9 --num_beams 1 --max_new_tokens 512 --workers 1 --image_video_joint_checkpoint
    host = os.getenv("DAM_HOST", "0.0.0.0")
    port = int(os.getenv("DAM_PORT", "8000"))
    model_path = os.getenv("DAM_MODEL_PATH", "")
    conv_mode = os.getenv("DAM_CONV_MODE", "v1")
    workers = int(os.getenv("DAM_WORKERS", "1"))
    skip_dinov2 = os.getenv("DAM_SKIP_DINOV2", "").strip().lower() in ("1", "true", "yes")

    parser = argparse.ArgumentParser()
    parser.add_argument("--host", type=str, default=host)
    parser.add_argument("--port", type=int, default=port)
    parser.add_argument("--model-path", type=str, default=model_path)
    parser.add_argument("--conv-mode", type=str, default=conv_mode)
    parser.add_argument("--prompt-mode", type=str, default="focal_prompt")
    parser.add_argument("--temperature", type=float, default=0.2)
    parser.add_argument("--top_p", type=float, default=0.9)
    parser.add_argument("--num_beams", type=int, default=1)
    parser.add_argument("--max_new_tokens", type=int, default=512)
    parser.add_argument("--workers", type=int, default=workers)
    parser.add_argument("--image_video_joint_checkpoint", action="store_true",
                        help="The loaded checkpoint is an image-video joint checkpoint")
    parser.add_argument("--debug", action="store_true",
                        help="Enable debug mode")
    parser.add_argument("--sam2-checkpoint", type=str, default="",
                        help="Path to SAM2 checkpoint (e.g., checkpoints/sam2.1_hiera_large.pt)")
    parser.add_argument("--sam2-config", type=str, default="",
                        help="Path to SAM2 config YAML (e.g., configs/sam2.1/sam2.1_hiera_l.yaml). Auto-detected if empty.")
    parser.add_argument("--dinov2-model", type=str, default=DINOV2_MODEL,
                        help="DINOv2 model name (dinov2_vits14, dinov2_vitb14, dinov2_vitl14, dinov2_vitg14)")
    parser.add_argument("--skip-dinov2", action="store_true", default=skip_dinov2,
                        help="Skip loading the DINOv2 embedding model. Disables /embed and visual-similarity "
                             "search (KB matching, image search); DAM captioning and SAM2 segmentation are unaffected. "
                             "Can also be set via DAM_SKIP_DINOV2=1.")
    parser.add_argument("--compile", action="store_true",
                        help="Enable torch.compile (Triton/Inductor) on DAM LLM, DINOv2, and SAM2 image encoder. "
                             "First inference takes 30-120s for kernel warmup; subsequent calls are faster.")
    parser.add_argument("--compile-mode", type=str, default="reduce-overhead",
                        choices=["default", "reduce-overhead", "max-autotune"],
                        help="torch.compile mode. 'reduce-overhead' is best for inference servers; "
                             "'max-autotune' is slower to compile, marginal gains for variable shapes.")
    app.args = parser.parse_args()

    # Pass args to app for lifespan access
    app._sam2_checkpoint = app.args.sam2_checkpoint
    app._sam2_config = app.args.sam2_config

    if app.args.model_path and "joint" in app.args.model_path and not app.args.image_video_joint_checkpoint:
        print("Warning: The loaded checkpoint looks like an image-video joint checkpoint, but the --image_video_joint_checkpoint flag is not set. This might lead to incorrect behavior, as joint checkpoints use a different prompt format even for single image inputs.")

    uvicorn.run(app, host=app.args.host, port=app.args.port,
                workers=app.args.workers)
