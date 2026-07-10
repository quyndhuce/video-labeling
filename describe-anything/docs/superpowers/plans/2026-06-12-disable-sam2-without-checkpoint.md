# Disable SAM2 When No Checkpoint Arg Passed Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tắt SAM2 hoàn toàn khi không truyền `--sam2-checkpoint` trên CLI, thay vì tự dò file trong thư mục `checkpoints/`.

**Architecture:** Bỏ vòng lặp auto-detect trong hàm `lifespan` (dòng 301-309 của `dam_server.py`). Sau khi sửa, SAM2 chỉ load khi người dùng truyền `--sam2-checkpoint` tường minh. Nếu không truyền, server khởi động bình thường và `/segment` dùng fallback PIL.

**Tech Stack:** Python, FastAPI, argparse

---

### Task 1: Bỏ auto-detect SAM2 checkpoint

**Files:**
- Modify: `dam_server.py:298-309`

- [ ] **Step 1: Xác nhận code hiện tại cần xóa**

Mở `dam_server.py` và tìm đoạn sau (khoảng dòng 296-309):

```python
    # Load SAM2 model for segmentation (same approach as demo_video.py)
    sam2_predictor = None
    sam2_checkpoint = getattr(app, '_sam2_checkpoint', None) or os.getenv('SAM2_CHECKPOINT', '')
    sam2_config = getattr(app, '_sam2_config', None) or os.getenv('SAM2_CONFIG', '')

    if not sam2_checkpoint:
        # Try common paths (same as demo_video.py default)
        for p in [
            'checkpoints/sam2.1_hiera_large.pt',
            'checkpoints/sam2.1_hiera_small.pt',
        ]:
            if os.path.exists(p):
                sam2_checkpoint = p
                break
```

- [ ] **Step 2: Xóa vòng lặp auto-detect (6 dòng)**

Thay đoạn trên bằng:

```python
    # Load SAM2 model for segmentation (same approach as demo_video.py)
    sam2_predictor = None
    sam2_checkpoint = getattr(app, '_sam2_checkpoint', None) or os.getenv('SAM2_CHECKPOINT', '')
    sam2_config = getattr(app, '_sam2_config', None) or os.getenv('SAM2_CONFIG', '')
```

Không còn vòng lặp `if not sam2_checkpoint` tự dò nữa. SAM2 sẽ chỉ load nếu `sam2_checkpoint` khác rỗng (tức là đã truyền `--sam2-checkpoint` hoặc set env `SAM2_CHECKPOINT`).

- [ ] **Step 3: Kiểm tra thủ công không có SAM2 arg**

Chạy server **không** truyền `--sam2-checkpoint`, dù file `checkpoints/sam2.1_hiera_large.pt` có tồn tại:

```bash
python dam_server.py --conv-mode v1
```

Kỳ vọng log xuất hiện:
```
[SAM2] No checkpoint found. /segment endpoint will use fallback.
```

SAM2 **không** load (dù file checkpoint có trong `checkpoints/`).

- [ ] **Step 4: Kiểm tra thủ công có SAM2 arg**

Chạy server **có** truyền `--sam2-checkpoint`:

```bash
python dam_server.py --conv-mode v1 --sam2-checkpoint checkpoints/sam2.1_hiera_large.pt
```

Kỳ vọng log:
```
[SAM2] Loading video predictor on cuda
[SAM2] Video predictor loaded successfully!
```

- [ ] **Step 5: Commit**

```bash
git add dam_server.py
git commit -m "fix: disable SAM2 auto-detect when --sam2-checkpoint not provided"
```
