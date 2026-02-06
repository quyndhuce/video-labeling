from flask import Flask
from flask_cors import CORS
from pymongo import MongoClient
from config import Config
import os


def create_app():
    app = Flask(__name__)
    app.config.from_object(Config)
    app.config['MAX_CONTENT_LENGTH'] = Config.MAX_CONTENT_LENGTH

    CORS(app, resources={r"/api/*": {"origins": "*"}})

    # MongoDB connection
    client = MongoClient(Config.MONGO_URI)
    app.db = client[Config.DB_NAME]

    # Create upload directories
    for folder in ['videos', 'thumbnails', 'frames', 'masks']:
        os.makedirs(os.path.join(Config.UPLOAD_FOLDER, folder), exist_ok=True)

    # Register blueprints
    from routes.auth import auth_bp
    from routes.projects import projects_bp
    from routes.videos import videos_bp
    from routes.segments import segments_bp
    from routes.annotations import annotations_bp
    from routes.tags import tags_bp

    app.register_blueprint(auth_bp, url_prefix='/api/auth')
    app.register_blueprint(projects_bp, url_prefix='/api/projects')
    app.register_blueprint(videos_bp, url_prefix='/api/videos')
    app.register_blueprint(segments_bp, url_prefix='/api/segments')
    app.register_blueprint(annotations_bp, url_prefix='/api/annotations')
    app.register_blueprint(tags_bp, url_prefix='/api/tags')

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
    app.db.tags.create_index([('project_id', 1), ('name', 1)], unique=True)

    return app


if __name__ == '__main__':
    app = create_app()
    app.run(debug=True, host='0.0.0.0', port=6800)
