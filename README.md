<p align="center">
  <img src="https://img.shields.io/badge/Angular-17-DD0031?logo=angular&logoColor=white" alt="Angular 17" />
  <img src="https://img.shields.io/badge/Flask-3.0-000000?logo=flask&logoColor=white" alt="Flask 3.0" />
  <img src="https://img.shields.io/badge/MongoDB-7.0-47A248?logo=mongodb&logoColor=white" alt="MongoDB 7.0" />
  <img src="https://img.shields.io/badge/Docker-Compose-2496ED?logo=docker&logoColor=white" alt="Docker" />
  <img src="https://img.shields.io/badge/SAM2-Meta-0467DF?logo=meta&logoColor=white" alt="SAM2" />
  <img src="https://img.shields.io/badge/DAM-NVIDIA-76B900?logo=nvidia&logoColor=white" alt="NVIDIA DAM" />
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

# (Optional) Set custom DAM server URL
DAM_SERVER_URL=http://your-gpu-server:8688 docker compose up -d
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

> **Authentication:** All endpoints (except register and login) require a valid JWT token via the `Authorization: Bearer <token>` header.

---

## Configuration

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `MONGO_URI` | `mongodb://localhost:27017/` | MongoDB connection string |
| `DB_NAME` | `annotator_tool` | MongoDB database name |
| `SECRET_KEY` | `annotator-tool-secret-key-2024` | JWT signing secret (change in production) |
| `DAM_SERVER_URL` | `http://192.168.88.31:8688` | NVIDIA DAM / SAM2 server URL |

### Frontend Settings (In-App)

Accessible via the **Settings** dialog (⚙️):

| Setting | Description |
|---------|-------------|
| **Gemini API Key** | Google Gemini API key for AI translation |
| **Gemini Model** | Model name (default: `gemini-2.0-flash`) |
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
│   ├── Dockerfile                   # Backend container (Python 3.11 + SAM2)
│   ├── requirements.txt             # Python dependencies
│   ├── routes/
│   │   ├── auth.py                  # Authentication (register, login, JWT)
│   │   ├── projects.py              # Projects & sub-parts CRUD
│   │   ├── videos.py                # Video upload, metadata, thumbnails
│   │   ├── segments.py              # Temporal segments & AI segmentation proxy
│   │   ├── annotations.py           # Captions, auto-caption, dataset export
│   │   └── tags.py                  # Tag management
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
            │   │   └── auth.interceptor.ts    # JWT header injection
            │   ├── models/
            │   │   └── index.ts               # TypeScript interfaces
            │   └── services/
            │       ├── auth.service.ts        # Authentication & user state
            │       ├── gemini.service.ts      # Google Gemini API client
            │       ├── project.service.ts     # Project CRUD operations
            │       ├── settings.service.ts    # App settings (localStorage)
            │       └── video.service.ts       # Video, segment, annotation APIs
            └── pages/
                ├── dashboard/                 # Project listing & management
                ├── login/                     # User login
                ├── register/                  # User registration
                ├── project-detail/            # Videos, sub-parts, assignments
                ├── settings-dialog/           # Gemini & translation config
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

This project is developed for internal research and annotation purposes.

---

<p align="center">
  Built with ❤️ for video AI research
</p>