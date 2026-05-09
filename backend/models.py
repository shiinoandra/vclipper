from flask_sqlalchemy import SQLAlchemy
from datetime import datetime

db = SQLAlchemy()

class Clip(db.Model):
    __tablename__ = "clips"

    id = db.Column(db.Integer, primary_key=True)
    youtube_url = db.Column(db.String(500), nullable=False)
    title = db.Column(db.String(500), nullable=True)
    start_time = db.Column(db.Float, nullable=False)
    end_time = db.Column(db.Float, nullable=False)
    quality = db.Column(db.String(50), default="best")
    video_codec = db.Column(db.String(50), nullable=True)
    audio_quality = db.Column(db.String(50), nullable=True)
    download_thumbnail = db.Column(db.Boolean, default=False)
    download_cc = db.Column(db.Boolean, default=False)
    output_dir = db.Column(db.String(500), default="./downloads")
    status = db.Column(db.String(50), default="pending")
    output_path = db.Column(db.String(500), nullable=True)
    error_message = db.Column(db.Text, nullable=True)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    def to_dict(self):
        return {
            "id": self.id,
            "youtube_url": self.youtube_url,
            "title": self.title,
            "start_time": self.start_time,
            "end_time": self.end_time,
            "quality": self.quality,
            "video_codec": self.video_codec,
            "audio_quality": self.audio_quality,
            "download_thumbnail": self.download_thumbnail,
            "download_cc": self.download_cc,
            "output_dir": self.output_dir,
            "status": self.status,
            "output_path": self.output_path,
            "error_message": self.error_message,
            "created_at": self.created_at.isoformat() if self.created_at else None,
            "updated_at": self.updated_at.isoformat() if self.updated_at else None,
        }

class Setting(db.Model):
    __tablename__ = "settings"

    id = db.Column(db.Integer, primary_key=True)
    key = db.Column(db.String(100), unique=True, nullable=False)
    value = db.Column(db.Text, nullable=True)

    @staticmethod
    def get(key, default=None):
        s = Setting.query.filter_by(key=key).first()
        return s.value if s else default

    @staticmethod
    def set(key, value):
        s = Setting.query.filter_by(key=key).first()
        if s:
            s.value = value
        else:
            s = Setting(key=key, value=value)
            db.session.add(s)
        db.session.commit()

    @staticmethod
    def get_all():
        return {s.key: s.value for s in Setting.query.all()}

    @staticmethod
    def init_defaults():
        defaults = {
            "default_quality": "default",
            "default_audio_quality": "default",
            "download_thumbnail": "false",
            "default_output_dir": "./downloads",
        }
        for k, v in defaults.items():
            if Setting.get(k) is None:
                Setting.set(k, v)
