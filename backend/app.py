from flask import Flask
from flask_cors import CORS
from pymongo import MongoClient
from config import Config
import os
from utils.vector_store import init_vector_store


def create_app():
    app = Flask(__name__)
    app.config.from_object(Config)
    app.config['MAX_CONTENT_LENGTH'] = Config.MAX_CONTENT_LENGTH

    cors_origins = Config.CORS_ORIGINS or ['*']
    CORS(
        app,
        resources={r"/api/*": {"origins": cors_origins}},
        supports_credentials=True,
        methods=['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
        allow_headers=['Content-Type', 'Authorization', 'X-Requested-With'],
        expose_headers=['Content-Type', 'Authorization'],
        max_age=86400,
    )

    @app.route('/api/<path:_path>', methods=['OPTIONS'])
    def api_preflight(_path):
        # Explicitly handle preflight for reverse proxies that forward OPTIONS.
        return ('', 204)

    @app.after_request
    def add_cors_headers(response):
        origin = response.headers.get('Access-Control-Allow-Origin')
        req_origin = ''
        try:
            from flask import request
            req_origin = request.headers.get('Origin', '')
        except Exception:
            req_origin = ''

        # Ensure CORS headers exist on all API responses, including errors.
        if not origin and req_origin:
            allowed = Config.CORS_ORIGINS or []
            if '*' in allowed or req_origin in allowed:
                response.headers['Access-Control-Allow-Origin'] = req_origin
                response.headers['Vary'] = 'Origin'

        response.headers.setdefault('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS')
        response.headers.setdefault('Access-Control-Allow-Headers', 'Content-Type,Authorization,X-Requested-With')
        response.headers.setdefault('Access-Control-Max-Age', '86400')
        return response

    # MongoDB connection
    client = MongoClient(Config.MONGO_URI)
    app.db = client[Config.DB_NAME]
    init_vector_store(app.db)

    # Create upload directories
    for folder in ['videos', 'thumbnails', 'frames', 'masks', 'images']:
        os.makedirs(os.path.join(Config.UPLOAD_FOLDER, folder), exist_ok=True)

    # Register blueprints
    from routes.auth import auth_bp
    from routes.projects import projects_bp
    from routes.videos import videos_bp
    from routes.segments import segments_bp
    from routes.annotations import annotations_bp
    from routes.batch_review import batch_review_bp
    from routes.tags import tags_bp
    from routes.settings import settings_bp
    from routes.categories import categories_bp
    from routes.knowledge_base import knowledge_base_bp
    from routes.images import images_bp
    from routes.stats import stats_bp

    app.register_blueprint(auth_bp, url_prefix='/api/auth')
    app.register_blueprint(projects_bp, url_prefix='/api/projects')
    app.register_blueprint(videos_bp, url_prefix='/api/videos')
    app.register_blueprint(segments_bp, url_prefix='/api/segments')
    app.register_blueprint(annotations_bp, url_prefix='/api/annotations')
    app.register_blueprint(batch_review_bp, url_prefix='/api/annotations')
    app.register_blueprint(tags_bp, url_prefix='/api/tags')
    app.register_blueprint(settings_bp, url_prefix='/api/settings')
    app.register_blueprint(categories_bp, url_prefix='/api/categories')
    app.register_blueprint(knowledge_base_bp, url_prefix='/api/knowledge-base')
    app.register_blueprint(images_bp, url_prefix='/api/images')
    app.register_blueprint(stats_bp, url_prefix='/api/stats')

    # Serve uploaded files
    @app.route('/uploads/<path:filename>')
    def serve_upload(filename):
        from flask import send_from_directory
        return send_from_directory(Config.UPLOAD_FOLDER, filename)

    # Create indexes
    app.db.users.create_index('username', unique=True)
    app.db.users.create_index('email', unique=True)
    app.db.projects.create_index('created_by')
    app.db.videos.create_index('project_id')
    app.db.video_segments.create_index('video_id')
    app.db.object_regions.create_index('segment_id')
    app.db.captions.create_index('segment_id')
    app.db.caption_review_tasks.create_index('project_id')
    app.db.tags.create_index([('project_id', 1), ('name', 1)], unique=True)
    # Image indexes
    app.db.images.create_index('project_id')
    app.db.images.create_index('subpart_id')
    app.db.image_regions.create_index('image_id')
    app.db.image_captions.create_index('image_id')
    app.db.image_captions.create_index('region_id')
    app.db.image_qa.create_index('image_id')

    return app


if __name__ == '__main__':
    app = create_app()
    app.run(debug=True, host='0.0.0.0', port=6800)
