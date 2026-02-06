# 🎬 Video Annotator Tool

Professional video annotation tool for labeling and segmenting video content. Built with **Angular 17** (frontend) and **Python Flask** (backend) with **MongoDB** storage.

## 🏗️ Architecture

```
AnnotatorTool/
├── backend/                  # Python Flask API
│   ├── app.py               # Application entry point
│   ├── config.py             # Configuration
│   ├── routes/               # API routes
│   │   ├── auth.py           # Authentication
│   │   ├── projects.py       # Projects & sub-parts
│   │   ├── videos.py         # Video management
│   │   ├── segments.py       # Video segments & object regions
│   │   └── annotations.py    # Captions & export
│   ├── utils/
│   │   └── auth_middleware.py # JWT authentication
│   └── requirements.txt
├── frontend/                 # Angular 17 SPA
│   ├── src/app/
│   │   ├── core/             # Services, guards, models
│   │   └── pages/            # Login, Dashboard, Project, Editor
│   └── package.json
├── docker-compose.yml        # Docker setup (MongoDB)
└── README.md
```

## ✨ Features

### Project Management
- Create and manage annotation projects
- Sub-parts with user assignment
- Role-based access (admin/annotator)

### Step 1: Video Segmentation
- Professional video player with timeline
- Mark start/end points to create segments
- Auto-split video into equal segments
- Visual timeline with segment markers
- Drag to seek, keyboard shortcuts

### Step 2: Object Region Segmentation
- Frame-by-frame navigation
- Brush tool to paint object regions
- Eraser tool for corrections
- Adjustable brush size
- AI-powered segmentation (fake API ready for real model)
- Multiple object regions per segment
- Color-coded labels

### Step 3: Multi-level Captioning
- **Level 1 - Visual**: Describe what the object looks like
- **Level 2 - Contextual**: Describe the object's context/situation
- **Level 3 - Knowledge**: Domain knowledge about the object
- **Combined**: Auto-combine all levels into final caption
- Export annotations as JSON

## 🚀 Quick Start

### Prerequisites
- **Node.js** 18+ and npm
- **Python** 3.9+
- **MongoDB** 7.0+ (or use Docker)

### 1. Start MongoDB

Using Docker:
```bash
docker compose up -d mongodb
```

Or install MongoDB locally and start it.

### 2. Setup Backend

```bash
cd backend
python -m venv venv
source venv/bin/activate  # On Windows: venv\Scripts\activate
pip install -r requirements.txt
python app.py
```

Backend runs at `http://localhost:5000`

### 3. Setup Frontend

```bash
cd frontend
npm install
npm start
```

Frontend runs at `http://localhost:4200` (proxies API requests to backend)

### 4. Open the App

Navigate to `http://localhost:4200` and:
1. Register a new account
2. Create a project
3. Upload a video
4. Start annotating!

## 🐳 Docker (Full Stack)

```bash
docker compose up -d
```

This starts MongoDB and the backend. For frontend, run `npm start` in the frontend directory.

## 📡 API Endpoints

### Authentication
- `POST /api/auth/register` - Register new user
- `POST /api/auth/login` - Login
- `GET /api/auth/profile` - Get current user
- `GET /api/auth/users` - List all users

### Projects
- `GET /api/projects` - List projects
- `POST /api/projects` - Create project
- `GET /api/projects/:id` - Get project details
- `PUT /api/projects/:id` - Update project
- `DELETE /api/projects/:id` - Delete project
- `POST /api/projects/:id/subparts` - Create sub-part
- `PUT /api/projects/:id/subparts/:subId` - Update sub-part
- `DELETE /api/projects/:id/subparts/:subId` - Delete sub-part

### Videos
- `POST /api/videos/upload` - Upload video
- `GET /api/videos/project/:projectId` - List project videos
- `GET /api/videos/:id` - Get video details
- `PUT /api/videos/:id` - Update video
- `DELETE /api/videos/:id` - Delete video

### Segments & Regions
- `GET /api/segments/video/:videoId` - List segments
- `POST /api/segments/video/:videoId` - Create segment
- `POST /api/segments/video/:videoId/batch` - Batch create segments
- `PUT /api/segments/:id` - Update segment
- `DELETE /api/segments/:id` - Delete segment
- `GET /api/segments/:segId/regions` - List regions
- `POST /api/segments/:segId/regions` - Create region
- `PUT /api/segments/regions/:id` - Update region
- `DELETE /api/segments/regions/:id` - Delete region
- `POST /api/segments/segment-object` - Fake segmentation API

### Annotations
- `GET /api/annotations/segment/:segId` - Get captions
- `POST /api/annotations` - Create/update caption
- `PUT /api/annotations/:id` - Update caption
- `DELETE /api/annotations/:id` - Delete caption
- `GET /api/annotations/export/video/:videoId` - Export all annotations

## 🔧 Configuration

Backend environment variables (`.env`):
```
SECRET_KEY=your-secret-key
MONGO_URI=mongodb://localhost:27017/
DB_NAME=annotator_tool
```

## 📋 Tech Stack

| Component | Technology |
|-----------|-----------|
| Frontend | Angular 17 (standalone components) |
| UI Library | Angular Material |
| Backend | Python Flask |
| Database | MongoDB |
| Auth | JWT (PyJWT + bcrypt) |
| File Upload | Werkzeug |
| Image Processing | Pillow + NumPy |
