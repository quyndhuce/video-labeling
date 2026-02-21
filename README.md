<p align="center">
  <img src="https://img.shields.io/badge/Angular-17-DD0031?logo=angular&logoColor=white" alt="Angular 17" />
  <img src="https://img.shields.io/badge/Flask-3.0-000000?logo=flask&logoColor=white" alt="Flask 3.0" />
  <img src="https://img.shields.io/badge/MongoDB-7.0-47A248?logo=mongodb&logoColor=white" alt="MongoDB 7.0" />
  <img src="https://img.shields.io/badge/Docker-Compose-2496ED?logo=docker&logoColor=white" alt="Docker" />
  <img src="https://img.shields.io/badge/SAM2-Meta-0467DF?logo=meta&logoColor=white" alt="SAM2" />
  <img src="https://img.shields.io/badge/DAM-NVIDIA-76B900?logo=nvidia&logoColor=white" alt="NVIDIA DAM" />
</p>

<p align="center">
  <strong>Developed at</strong><br/>
  <a href="https://www.facebook.com/profile.php?id=61563435713112">
    🏛️ AIRC — AI Research Center
  </a>
</p>

# 🎬 Video Annotator Tool

A full-stack, production-ready video annotation platform for creating high-quality, multi-modal video datasets. Built for research teams and data labeling workflows that require precise temporal segmentation, pixel-level object masking, and structured bilingual captioning (English & Vietnamese).

---

## 📋 Table of Contents

- [Overview](#overview)
- [Key Features](#key-features)
- [Architecture](#architecture)
- [Tech Stack](#tech-stack)
- [Getting Started](#getting-started)
  - [Prerequisites](#prerequisites)
  - [Docker Deployment (Recommended)](#docker-deployment-recommended)
  - [Local Development](#local-development)
- [Usage Guide](#usage-guide)
  - [Three-Step Annotation Workflow](#three-step-annotation-workflow)
  - [Project Organization](#project-organization)
  - [AI-Assisted Features](#ai-assisted-features)
- [Export Format](#export-format)
- [API Reference](#api-reference)
- [Configuration](#configuration)
- [Project Structure](#project-structure)
- [License](#license)

---

## Overview

Video Annotator Tool provides an end-to-end pipeline for annotating video content through a guided three-step workflow:

1. **Temporal Segmentation** — Split videos into meaningful time-based segments
2. **Object Region Masking** — Paint and refine pixel-level object masks with AI-powered segmentation (SAM2 / NVIDIA DAM)
3. **Structured Captioning** — Write multi-level bilingual captions (visual, contextual, knowledge-based) with optional AI translation via Google Gemini

The platform exports annotations in a standardized JSON dataset format suitable for training vision-language models, video understanding systems, and multimodal AI research.

---

## Key Features

### Annotation Workflow
- 🎞️ **Video Segmentation** — Interactive timeline with drag-to-select segment creation, reordering, and editing
- 🖌️ **Brush & Eraser Tools** — Freehand painting with adjustable brush size for creating object region masks
- 🤖 **AI Segmentation** — One-click SAM2 / NVIDIA DAM-powered mask refinement from rough brush strokes
- 🎨 **Multi-Region Support** — Multiple labeled, color-coded object regions per segment with individual mask overlays
- ✍️ **4-Level Captions** — Visual, Contextual, Knowledge-based, and Combined captions per region and per segment
- 🌐 **Bilingual (EN/VI)** — Full English and Vietnamese caption support with side-by-side editing
- 🔄 **AI Translation** — One-click Gemini-powered translation between English ↔ Vietnamese with configurable prompts

### Platform
- 👥 **Multi-User** — JWT-based authentication with role-based access (admin / annotator)
- 📁 **Project Organization** — Projects with sub-parts, user assignment, and reviewer workflows
- 🏷️ **Tagging System** — Custom color-coded tags for organizing and filtering videos
- 📊 **Review System** — Per-video review status tracking (pending, approved, rejected)
- 📦 **Dataset Export** — Standardized JSON export at video or project level
- 🐳 **Docker Ready** — Single-command deployment with Docker Compose
- 🌙 **Dark Theme** — Modern, eye-friendly dark UI built with Angular Material

---

## Architecture

```
┌──────────────────┐     ┌──────────────────┐     ┌──────────────────┐
│   Angular 17     │────▶│   Flask API      │────▶│   MongoDB 7.0    │
│   (Frontend)     │     │   (Backend)      │     │   (Database)     │
│   Port: 4200     │     │   Port: 6800     │     │   Port: 27017    │
└──────────────────┘     └────────┬─────────┘     └──────────────────┘
                                  │
                         ┌────────▼─────────┐
                         │  DAM Server      │
                         │  (NVIDIA DAM +   │
                         │   SAM2)          │
                         │  Port: 8688      │
                         └──────────────────┘
```

- **Frontend** — Angular 17 SPA with standalone components, served via Nginx in production
- **Backend** — Flask REST API handling authentication, CRUD, file management, and AI proxy
- **Database** — MongoDB document store for projects, videos, segments, regions, captions, and users
- **DAM Server** — Optional external service providing NVIDIA DAM captioning and Meta SAM2 segmentation

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| **Frontend** | Angular 17, Angular Material, TypeScript, SCSS |
| **Backend** | Python 3.11, Flask 3.0, PyJWT, bcrypt, Pillow |
| **Database** | MongoDB 7.0, PyMongo |
| **AI / ML** | Meta SAM2 (Segment Anything Model 2), NVIDIA DAM (Describe Anything Model), Google Gemini API |
| **Infrastructure** | Docker, Docker Compose, Nginx |

---

## Getting Started

### Prerequisites

- **Docker & Docker Compose** (for containerized deployment)
- **Node.js 20+** and **Python 3.11+** (for local development)
- **MongoDB 7.0+** (if running locally without Docker)
- **(Optional)** NVIDIA GPU server with DAM + SAM2 for AI-assisted segmentation

### Docker Deployment (Recommended)

```bash
# Clone the repository
git clone <repository-url>
cd AnnotatorTool

# Start all services
docker compose up -d
```

The application will be available at:

| Service | URL |
|---------|-----|
| **Frontend** | http://localhost:4200 |
| **Backend API** | http://localhost:6800 |
| **MongoDB** | localhost:27017 |

### Local Development

**Backend:**

```bash
cd backend

# Create virtual environment
python -m venv venv
source venv/bin/activate  # macOS/Linux

# Install dependencies
pip install -r requirements.txt

# Run development server
python app.py
```

**Frontend:**

```bash
cd frontend

# Install dependencies
npm install

# Start dev server with API proxy
npm start
```

The Angular dev server runs at `http://localhost:4200` and proxies API requests to the Flask backend at `http://localhost:6800`.

---

## Usage Guide

### Three-Step Annotation Workflow

The video editor follows a guided three-step process, tracked per video:

#### Step 1 — Video Segmentation

Split the video into temporal segments using the interactive timeline. Each segment represents a meaningful scene or action.

- Click and drag on the timeline to create segments
- Adjust segment boundaries by dragging handles
- Rename and reorder segments
- Navigate between segments using the segment list

#### Step 2 — Object Region Masking

For each segment, define object regions by painting masks on a reference frame.

- **Brush Tool** — Paint regions of interest with adjustable brush size
- **Eraser Tool** — Remove brush strokes and mask areas
- **Segment Button** — Send brush strokes to SAM2/DAM for AI-refined mask generation
- **Multi-Region** — Create multiple labeled, color-coded regions per segment
- **Color Picker** — Change region colors with live mask overlay update

#### Step 3 — Structured Captioning

Write detailed, multi-level bilingual captions for each region and each segment.

| Caption Level | Description |
|---------------|-------------|
| **Visual** | What is directly observable in the region/segment |
| **Contextual** | Scene context, spatial relationships, environment |
| **Knowledge** | Background knowledge, cultural context, inferences |
| **Combined** | Unified comprehensive description |

Each level supports both **English** and **Vietnamese** with one-click AI translation.

### Project Organization

- **Projects** — Top-level containers for related videos
- **Sub-Parts** — Divide projects into sections with assigned annotators and reviewers
- **Tags** — Custom color-coded labels for filtering and categorizing videos
- **Review Workflow** — Videos can be marked for review with status tracking

### AI-Assisted Features

| Feature | Service | Description |
|---------|---------|-------------|
| **Object Segmentation** | SAM2 / NVIDIA DAM | Refines rough brush strokes into precise pixel masks |
| **Auto Captioning** | NVIDIA DAM | Generates visual and contextual captions from video frames |
| **Translation** | Google Gemini | Translates captions between English ↔ Vietnamese |

> **Note:** AI features require external service configuration. The tool works fully without them — segmentation and captioning can be done manually.

Configure AI settings via the **Settings** dialog (⚙️ gear icon), accessible from any page.

---

## Export Format

The platform exports annotations in a standardized JSON format (`video_annotation_v1`) at both video and project levels.

### Schema Overview

```jsonc
{
  "dataset_info": {
    "name": "Project Name",
    "description": "Project description",
    "version": "1.0",
    "format": "video_annotation_v1",
    "export_date": "2026-02-07T12:00:00Z",
    "total_videos": 10,
    "total_segments": 45,
    "total_regions": 120,
    "total_captions": 98,
    "languages": ["en", "vi"]
  },
  "project": {
    "id": "...",
    "name": "...",
    "subparts": [
      { "id": "...", "name": "Part 1", "video_ids": ["..."] }
    ]
  },
  "videos": [
    {
      "id": "...",
      "filename": "video_001.mp4",
      "duration": 120.5,
      "width": 1920,
      "height": 1080,
      "segments": [
        {
          "id": "...",
          "name": "Scene 1",
          "start_time": 0.0,
          "end_time": 15.5,
          "duration": 15.5,
          "regions": [
            {
              "id": "...",
              "label": "Person",
              "color": "#FF0000",
              "frame_time": 5.2,
              "segmented_mask": "<base64-encoded PNG>",
              "captions": {
                "en": {
                  "visual": "A person walking across the bridge",
                  "contextual": "The person is on a historic red wooden bridge",
                  "knowledge": "This is the Huc Bridge in Hanoi, Vietnam",
                  "combined": "A person walks across the iconic red Huc Bridge..."
                },
                "vi": {
                  "visual": "Một người đi bộ qua cầu",
                  "contextual": "Người đó đang ở trên cầu gỗ đỏ cổ kính",
                  "knowledge": "Đây là Cầu Thê Húc ở Hà Nội, Việt Nam",
                  "combined": "Một người đi bộ qua Cầu Thê Húc mang tính biểu tượng..."
                }
              }
            }
          ],
          "segment_captions": [
            {
              "en": { "visual": "...", "contextual": "...", "knowledge": "...", "combined": "..." },
              "vi": { "visual": "...", "contextual": "...", "knowledge": "...", "combined": "..." }
            }
          ]
        }
      ]
    }
  ]
}
```

### Export Options

| Scope | Endpoint | Description |
|-------|----------|-------------|
| **Single Video** | `GET /api/annotations/export/video/:id` | Export one video with all segments, regions, masks, and captions |
| **Entire Project** | `GET /api/annotations/export/project/:id` | Export all videos in a project with project metadata and sub-parts |

Export is available from:
- **Video Editor** — Export dropdown in the toolbar (single video or entire project)
- **Dashboard** — Project card menu → "Export Dataset"

---

## API Reference

### Authentication
| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/auth/register` | Register a new user |
| `POST` | `/api/auth/login` | Login and receive JWT token |
| `GET` | `/api/auth/me` | Get current user profile |
| `GET` | `/api/auth/users` | List all users (admin) |

### Projects
| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/projects` | List all accessible projects |
| `POST` | `/api/projects` | Create a new project |
| `GET` | `/api/projects/:id` | Get project details with sub-parts |
| `PUT` | `/api/projects/:id` | Update project |
| `DELETE` | `/api/projects/:id` | Delete project and all related data |
| `POST` | `/api/projects/:id/subparts` | Create a sub-part |
| `PUT` | `/api/projects/:id/subparts/:subId` | Update sub-part |
| `DELETE` | `/api/projects/:id/subparts/:subId` | Delete sub-part |

### Videos
| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/videos/upload` | Upload a video file (max 500 MB) |
| `GET` | `/api/videos/:id` | Get video details |
| `PUT` | `/api/videos/:id` | Update video metadata |
| `DELETE` | `/api/videos/:id` | Delete video and related data |

### Segments & Regions
| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/segments/video/:videoId` | List segments for a video |
| `POST` | `/api/segments` | Create a segment |
| `POST` | `/api/segments/video/:videoId/batch` | Batch create segments |
| `PUT` | `/api/segments/:id` | Update segment |
| `DELETE` | `/api/segments/:id` | Delete segment |
| `POST` | `/api/segments/:segId/regions` | Create object region |
| `PUT` | `/api/segments/regions/:id` | Update object region |
| `DELETE` | `/api/segments/regions/:id` | Delete object region |
| `POST` | `/api/segments/segment-object` | AI object segmentation (SAM2/DAM) |

### Annotations & Captions
| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/annotations/segment/:segmentId` | Get captions for a segment |
| `POST` | `/api/annotations` | Create or update a caption |
| `DELETE` | `/api/annotations/:id` | Delete a caption |
| `POST` | `/api/annotations/auto-caption` | AI auto-captioning via DAM |
| `GET` | `/api/annotations/export/video/:id` | Export video annotations |
| `GET` | `/api/annotations/export/project/:id` | Export project dataset |

### Tags
| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/tags/project/:projectId` | List tags for a project |
| `POST` | `/api/tags` | Create a tag |
| `DELETE` | `/api/tags/:id` | Delete a tag |

### Settings
| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/settings/dam-url` | Get current DAM server URL |
| `PUT` | `/api/settings/dam-url` | Update DAM server URL |
| `POST` | `/api/settings/dam-url/test` | Test connection to DAM server |

> **Authentication:** All endpoints (except register and login) require a valid JWT token via the `Authorization: Bearer <token>` header. Unauthorized (401) responses automatically redirect to the login page.

---

## Configuration

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `MONGO_URI` | `mongodb://localhost:27017/` | MongoDB connection string |
| `DB_NAME` | `annotator_tool` | MongoDB database name |
| `SECRET_KEY` | `annotator-tool-secret-key-2024` | JWT signing secret (change in production) |

### In-App Settings (Settings Dialog ⚙️)

Accessible from any page via the gear icon. Settings are organized into three tabs:

**Server**
| Setting | Description |
|---------|-------------|
| **DAM Server URL** | URL of the NVIDIA DAM + SAM2 server (e.g., `http://192.168.88.31:8688`). Stored in MongoDB. Includes a **Test Connection** button. |

**Gemini API**
| Setting | Description |
|---------|-------------|
| **Gemini API Key** | Google Gemini API key for AI translation |
| **Gemini Model** | Model name (default: `gemini-2.0-flash`) |

**Translation Prompts**
| Setting | Description |
|---------|-------------|
| **EN → VI Prompt** | Customizable English-to-Vietnamese translation prompt |
| **VI → EN Prompt** | Customizable Vietnamese-to-English translation prompt |

---

## Project Structure

```
AnnotatorTool/
├── docker-compose.yml              # Multi-service orchestration
├── README.md
│
├── backend/                         # Flask REST API
│   ├── app.py                       # Application factory & startup
│   ├── config.py                    # Configuration management
│   ├── Dockerfile                   # Lightweight backend container (Python 3.11)
│   ├── requirements.txt             # Python dependencies
│   ├── routes/
│   │   ├── auth.py                  # Authentication (register, login, JWT)
│   │   ├── projects.py              # Projects & sub-parts CRUD
│   │   ├── videos.py                # Video upload, metadata, thumbnails
│   │   ├── segments.py              # Temporal segments & AI segmentation proxy
│   │   ├── annotations.py           # Captions, auto-caption, dataset export
│   │   ├── tags.py                  # Tag management
│   │   └── settings.py              # DAM server URL config (stored in DB)
│   ├── utils/
│   │   └── auth_middleware.py       # JWT token verification decorator
│   └── uploads/                     # File storage
│       ├── videos/                  # Uploaded video files
│       ├── thumbnails/              # Auto-generated thumbnails
│       ├── frames/                  # Extracted video frames
│       └── masks/                   # Segmentation masks
│
└── frontend/                        # Angular 17 SPA
    ├── angular.json                 # Angular CLI configuration
    ├── Dockerfile                   # Multi-stage build (Node 20 → Nginx)
    ├── nginx.conf                   # Nginx with API reverse proxy
    ├── package.json                 # Node.js dependencies
    ├── proxy.conf.json              # Dev server API proxy
    └── src/
        ├── index.html
        ├── main.ts                  # Application bootstrap
        ├── styles.scss              # Global dark theme styles
        └── app/
            ├── app.component.ts     # Root component
            ├── app.config.ts        # App configuration & providers
            ├── app.routes.ts        # Route definitions
            ├── core/
            │   ├── guards/
            │   │   └── auth.guard.ts          # Route protection
            │   ├── interceptors/
            │   │   └── auth.interceptor.ts    # JWT header injection & 401 redirect
            │   ├── models/
            │   │   └── index.ts               # TypeScript interfaces
            │   └── services/
            │       ├── auth.service.ts        # Authentication & user state
            │       ├── gemini.service.ts      # Google Gemini API client
            │       ├── project.service.ts     # Project CRUD operations
            │       ├── settings.service.ts    # App settings (local + backend sync)
            │       └── video.service.ts       # Video, segment, annotation APIs
            └── pages/
                ├── dashboard/                 # Project listing & management
                ├── login/                     # User login
                ├── register/                  # User registration
                ├── project-detail/            # Videos, sub-parts, assignments
                ├── settings-dialog/           # Server, Gemini & translation config
                └── video-editor/              # Three-step annotation editor
```

---

## Supported Formats

### Video
| Format | Extension |
|--------|-----------|
| MPEG-4 | `.mp4` |
| AVI | `.avi` |
| QuickTime | `.mov` |
| Matroska | `.mkv` |
| WebM | `.webm` |

**Maximum file size:** 500 MB

### Export
| Format | Extension | Description |
|--------|-----------|-------------|
| JSON | `.json` | Standardized `video_annotation_v1` dataset format |

---

## License

This project is developed for internal research and annotation purposes at **AIRC** (AI Research Center).

---

<p align="center">
  Built with ❤️ at <a href="https://www.facebook.com/profile.php?id=61563435713112"><strong>AIRC</strong></a> — for video AI research
</p>


Đây là schema đánh nhãn đầy đủ cho dataset video captioning du lịch Hà Nội của bạn:

## 📋 Schema đánh nhãn tổng thể

### **Metadata cơ bản (Video-level)**

```json
{
  "video_id": "HN_0001",
  "filename": "van_mieu_morning_001.mp4",
  "duration": 45.5,  // seconds
  "fps": 30,
  "resolution": "1920x1080",
  "recording_date": "2024-03-15",
  "recording_time": "08:30:00",
  "weather": "sunny/cloudy/rainy",
  "location": {
    "heritage_site": "Văn Miếu - Quốc Tử Giám",
    "address": "58 Quốc Tử Giám, Đống Đa, Hà Nội",
    "gps": {
      "latitude": 21.0285,
      "longitude": 105.8355
    },
    "heritage_type": "temple/pagoda/museum/historical_site/landscape"
  }
}
```

---

## 1️⃣ **Video Caption** (quan trọng nhất)

### **Full Video Caption**
```json
{
  "captions": {
    "vietnamese": {
      "short": "Du khách tham quan Văn Miếu vào buổi sáng",  // 10-15 từ
      "medium": "Một nhóm du khách đang dạo quanh khuôn viên Văn Miếu - Quốc Tử Giám, ngắm nhìn các bia tiến sĩ và kiến trúc cổ kính từ thời Lý",  // 20-30 từ
      "long": "Video ghi lại cảnh tượng buổi sáng thanh bình tại Văn Miếu - Quốc Tử Giám, di tích lịch sử nổi tiếng của Hà Nội. Du khách từ nhiều nơi đến tham quan, chụp ảnh bên các bia đá ghi tên các tiến sĩ thời xưa. Kiến trúc mang đậm phong cách thời Lý-Trần với mái ngói cong, cột trụ gỗ chạm khắc tinh xảo. Không gian yên tĩnh, cây cối xanh mát tạo bầu không khí trang nghiêm."  // 50+ từ
    },
    "english": {
      "short": "Tourists visiting Temple of Literature in the morning",
      "medium": "A group of tourists exploring the Temple of Literature complex, admiring the doctoral stele and ancient architecture from the Ly Dynasty",
      "long": "The video captures a peaceful morning scene at the Temple of Literature (Van Mieu - Quoc Tu Giam), a renowned historical site in Hanoi. Visitors from various places come to explore and photograph the stone steles inscribed with names of doctoral graduates from ancient times. The architecture showcases the distinctive Ly-Tran Dynasty style with curved tile roofs and intricately carved wooden pillars. The serene atmosphere with lush greenery creates a solemn ambiance."
    }
  },
  "caption_type": "descriptive/narrative/instructional",
  "cultural_significance": "Văn Miếu là nơi thờ Khổng Tử và là trường đại học đầu tiên của Việt Nam, tượng trưng cho truyền thống trọng học của dân tộc"
}
```

---

## 2️⃣ **Temporal Segmentation** (phân đoạn video)

```json
{
  "segments": [
    {
      "segment_id": "seg_001",
      "start_time": 0.0,
      "end_time": 8.5,
      "keyframes": [0.0, 4.2, 8.5],  // timestamp của các frame đại diện
      "scene_type": "establishing_shot/close_up/panorama/action",
      "caption_vi": "Camera pan qua cổng chính Văn Miếu với hai con rồng đá hai bên",
      "caption_en": "Camera pans across the main gate of Temple of Literature with two stone dragons on either side",
      "primary_activity": "camera_movement",
      "objects_present": ["gate", "dragon_statue", "walls"]
    },
    {
      "segment_id": "seg_002", 
      "start_time": 8.5,
      "end_time": 18.3,
      "keyframes": [8.5, 13.0, 18.3],
      "scene_type": "action",
      "caption_vi": "Du khách chụp ảnh bên các bia tiến sĩ",
      "caption_en": "Tourists taking photos next to doctoral steles",
      "primary_activity": "photography",
      "objects_present": ["tourists", "stone_steles", "turtles"]
    }
  ]
}
```

---

## 3️⃣ **Object Detection & Segmentation**

### **Frame-level annotations** (mỗi 1-2 giây hoặc keyframes)

```json
{
  "frame_annotations": [
    {
      "frame_id": "frame_0042",
      "timestamp": 4.2,
      "objects": [
        {
          "object_id": "obj_001",
          "category": "architecture",
          "class": "gate",
          "specific_name": "Văn Miếu Môn",
          "bounding_box": {
            "x": 320,
            "y": 180,
            "width": 640,
            "height": 480,
            "format": "xywh"  // hoặc xyxy, polygon cho segmentation
          },
          "segmentation_mask": "masks/frame_0042_obj_001.png",  // binary mask
          "confidence": 0.95,
          
          // Mô tả đối tượng
          "description_vi": "Cổng chính Văn Miếu Môn với kiến trúc 3 tầng mái cong, ngói âm dương xen kẽ, hai bên có tường thành cao",
          "description_en": "Main gate of Van Mieu with three-tiered curved roofs, alternating yin-yang tiles, flanked by high walls",
          
          // Thuộc tính
          "attributes": {
            "color": "red_brown",
            "material": "wood_brick",
            "condition": "well_preserved",
            "era": "Lý Dynasty (reconstructed)",
            "architectural_style": "Confucian temple architecture"
          },
          
          // Tri thức văn hóa
          "cultural_knowledge": {
            "historical_significance": "Cổng được xây dựng năm 1070, là lối vào chính của ngôi đền thờ Khổng Tử đầu tiên tại Việt Nam",
            "symbolism": "Ba tầng mái tượng trưng cho Tam tài: Thiên, Địa, Nhân",
            "cultural_context": "Theo phong tục, học sinh thường đến lễ trước khi thi cử",
            "related_entities": ["Confucius", "Lý Thánh Tông", "Quốc Tử Giám"]
          }
        },
        
        {
          "object_id": "obj_002",
          "category": "artifact",
          "class": "stone_stele",
          "specific_name": "Bia tiến sĩ",
          "bounding_box": {...},
          "segmentation_mask": "masks/frame_0042_obj_002.png",
          
          "description_vi": "Bia đá đặt trên lưng rùa, khắc tên các tiến sĩ khoa thi năm 1442",
          "description_en": "Stone stele mounted on turtle pedestal, inscribed with names of doctoral graduates from 1442 examination",
          
          "attributes": {
            "material": "bluestone",
            "height_cm": 180,
            "inscription_year": 1442,
            "dynasty": "Lê Dynasty"
          },
          
          "cultural_knowledge": {
            "historical_significance": "Một trong 82 bia tiến sĩ được UNESCO công nhận là Di sản Tư liệu Thế giới",
            "symbolism": "Rùa tượng trưng cho sự trường tồn của tri thức",
            "related_entities": ["Lê Dynasty", "Imperial Examination System"]
          }
        },
        
        {
          "object_id": "obj_003",
          "category": "people",
          "class": "tourist",
          "count": 3,
          "bounding_box": {...},
          "activity": "taking_photo",
          "pose": "standing",
          "attributes": {
            "age_group": "adult",
            "group_type": "family"
          }
        },
        
        {
          "object_id": "obj_004",
          "category": "nature",
          "class": "tree",
          "specific_name": "Cây đa cổ thụ",
          "bounding_box": {...},
          "attributes": {
            "estimated_age_years": 200,
            "height_meters": 15
          },
          "cultural_knowledge": {
            "significance": "Cây đa thường được trồng ở đình, chùa, mang ý nghĩa tâm linh"
          }
        }
      ]
    }
  ]
}
```

---

## 4️⃣ **Contextual Knowledge** (Video-level)

```json
{
  "heritage_knowledge": {
    "site_name": "Văn Miếu - Quốc Tử Giám",
    "unesco_status": "World Heritage Tentative List",
    
    "historical_context": {
      "built_year": 1070,
      "built_by": "Emperor Lý Thánh Tông",
      "original_purpose": "Temple dedicated to Confucius",
      "evolution": [
        {
          "year": 1070,
          "event": "Văn Miếu được xây dựng"
        },
        {
          "year": 1076,
          "event": "Quốc Tử Giám được thành lập - trường đại học đầu tiên"
        },
        {
          "year": 1484,
          "event": "Bắt đầu dựng bia tiến sĩ"
        }
      ]
    },
    
    "architectural_features": {
      "layout": "5 courtyards following Confucian principles",
      "style": "Traditional Vietnamese temple architecture with Chinese influence",
      "notable_structures": [
        "Văn Miếu Môn (Main Gate)",
        "Đại Trung Môn (Great Middle Gate)",
        "Khuê Văn Các (Constellation of Literature Pavilion)",
        "Thiên Quang Tỉnh (Well of Heavenly Clarity)",
        "82 Doctoral Steles",
        "Đại Thành sanctuary"
      ]
    },
    
    "cultural_significance": {
      "role": "Symbol of Vietnamese education and Confucian values",
      "traditions": [
        "Students visit before important exams",
        "Graduation photo location",
        "Calligraphy events during Tet"
      ],
      "cultural_values": "Respect for knowledge, teachers, and scholarly achievement"
    },
    
    "related_entities": {
      "people": ["Confucius", "Lý Thánh Tông", "Chu Văn An"],
      "concepts": ["Imperial Examination", "Confucianism", "Scholarly tradition"],
      "other_sites": ["Quốc Tử Giám Huế", "Văn Miếu Bắc Ninh"]
    }
  },
  
  "tourist_information": {
    "visiting_hours": "08:00 - 17:00 daily",
    "entrance_fee": "30,000 VND",
    "best_time_to_visit": "Early morning or late afternoon",
    "photography_allowed": true,
    "dress_code": "Respectful attire recommended"
  }
}
```

---

## 5️⃣ **Activity & Event Annotations**

```json
{
  "activities": [
    {
      "activity_id": "act_001",
      "start_time": 8.5,
      "end_time": 15.2,
      "activity_type": "photography",
      "description_vi": "Du khách chụp ảnh kỷ niệm",
      "description_en": "Tourists taking souvenir photos",
      "participants": ["tourists"],
      "objects_involved": ["camera", "smartphone", "stele"]
    },
    {
      "activity_id": "act_002",
      "start_time": 20.0,
      "end_time": 28.5,
      "activity_type": "worship",
      "description_vi": "Người dân thắp hương cầu may trong kỳ thi",
      "description_en": "Locals burning incense for good luck in exams",
      "cultural_context": "Traditional practice before examinations",
      "participants": ["worshippers"],
      "objects_involved": ["incense", "altar"]
    }
  ],
  
  "events": {
    "special_event": null,  // hoặc "Tet Calligraphy Festival" nếu có
    "seasonal_context": "Spring - cherry blossoms blooming"
  }
}
```

---

## 6️⃣ **Audio/Ambient Information** (nếu có)

```json
{
  "audio": {
    "ambient_sounds": ["temple_bell", "tourist_chatter", "birds", "footsteps"],
    "narration": false,
    "background_music": false,
    "notable_sounds": [
      {
        "timestamp": 12.5,
        "sound": "temple_bell",
        "description": "Tiếng chuông chùa vang lên"
      }
    ]
  }
}
```

---

## 7️⃣ **Quality Metrics**

```json
{
  "quality_assessment": {
    "video_quality": "high/medium/low",
    "lighting": "good/acceptable/poor",
    "stability": "stable/shaky",
    "occlusion_level": "none/partial/heavy",
    "crowd_density": "empty/sparse/moderate/crowded",
    "annotation_confidence": 0.9,
    "annotator_id": "annotator_005",
    "annotation_time_minutes": 45,
    "review_status": "approved/pending/rejected",
    "reviewer_id": "reviewer_002"
  }
}
```

---

## 8️⃣ **Multi-lingual Support**

```json
{
  "languages": {
    "primary": "vietnamese",
    "available": ["vietnamese", "english"],
    "cultural_terms": [
      {
        "vietnamese": "tiến sĩ",
        "english": "doctoral graduate",
        "explanation": "Scholars who passed the highest level of imperial examinations",
        "transliteration": "tien si"
      },
      {
        "vietnamese": "Khổng Tử",
        "english": "Confucius",
        "explanation": "Chinese philosopher, founder of Confucianism",
        "transliteration": "Khong Tu"
      }
    ]
  }
}
```

---

## 📊 Annotation Tools đề xuất

### **Video Annotation:**
- **CVAT** (Computer Vision Annotation Tool) - free, open-source
- **Labelbox** - có free tier
- **Label Studio** - open-source, customizable

### **Object Detection/Segmentation:**
- **CVAT** - hỗ trợ bounding box, polygon, segmentation
- **Roboflow** - dễ dùng, có labeling assistance

### **Caption Annotation:**
- Custom web interface (đơn giản hơn)
- Google Sheets/Airtable (cho giai đoạn đầu)
- Label Studio (có thể custom cho caption)

---

## 👥 Workflow đánh nhãn

### **Phase 1: Video-level (nhanh)**
1. Metadata cơ bản
2. Full video caption (3 versions)
3. Contextual knowledge
4. Quality check

### **Phase 2: Temporal segmentation**
1. Chia scenes
2. Keyframe selection
3. Segment captions

### **Phase 3: Object annotation** (tốn thời gian nhất)
1. Bounding boxes
2. Segmentation masks
3. Object descriptions
4. Cultural knowledge

### **Phase 4: Review & QC**
1. Cross-check consistency
2. Cultural accuracy review
3. Language quality check

---

## 💡 Tips để tăng efficiency

### **1. Prioritization:**
- Annotate đầy đủ nhất ~500 videos "core" (heritage sites chính)
- 1000 videos: annotations cơ bản (caption + objects)
- 500 videos: minimal annotations (caption only)

### **2. Semi-automation:**
- Dùng pre-trained models để pre-label objects (YOLO, SAM)
- Human review và correct
- Tiết kiệm 40-60% thời gian

### **3. Crowdsourcing strategy:**
- Video caption: có thể crowdsource (nhưng cần QC kỹ)
- Object detection: semi-auto + expert review
- Cultural knowledge: PHẢI có experts

### **4. Quality control:**
- Inter-annotator agreement: ~10% videos được label bởi 2+ người
- Expert review: 100% cultural knowledge
- Automatic checks: caption length, object count consistency

---

## 📁 File Structure đề xuất

```
dataset/
├── videos/
│   ├── raw/
│   │   └── HN_0001.mp4
│   └── processed/
│       └── HN_0001_720p.mp4
├── annotations/
│   ├── video_level/
│   │   └── HN_0001.json
│   ├── segments/
│   │   └── HN_0001_segments.json
│   ├── objects/
│   │   └── HN_0001_objects.json
│   └── knowledge/
│       └── heritage_knowledge_base.json
├── masks/
│   └── HN_0001/
│       ├── frame_0042_obj_001.png
│       └── ...
├── keyframes/
│   └── HN_0001/
│       ├── frame_0000.jpg
│       └── ...
└── metadata/
    ├── dataset_statistics.json
    ├── split_info.json (train/val/test)
    └── annotation_guidelines.pdf
``` 