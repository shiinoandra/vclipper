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
    audio_bitrate = db.Column(db.String(10), nullable=True)
    download_thumbnail = db.Column(db.Boolean, default=False)
    download_cc = db.Column(db.Boolean, default=False)
    output_dir = db.Column(db.String(500), default="./downloads")
    status = db.Column(db.String(50), default="pending")
    output_path = db.Column(db.String(500), nullable=True)
    error_message = db.Column(db.Text, nullable=True)
    video_resolution = db.Column(db.String(50))
    audio_codec = db.Column(db.String(50))
    has_cc = db.Column(db.Boolean, default=False)
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
            "audio_bitrate": self.audio_bitrate,
            "download_thumbnail": self.download_thumbnail,
            "download_cc": self.download_cc,
            "output_dir": self.output_dir,
            "status": self.status,
            "output_path": self.output_path,
            "error_message": self.error_message,
            "video_resolution": self.video_resolution,
            "audio_codec": self.audio_codec,
            "has_cc": self.has_cc,
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
            "default_audio_bitrate": "128",
            "download_thumbnail": "false",
            "default_output_dir": "./downloads",
        }
        for k, v in defaults.items():
            if Setting.get(k) is None:
                Setting.set(k, v)


class TrackedChannel(db.Model):
    __tablename__ = "tracked_channels"

    id = db.Column(db.Integer, primary_key=True)
    channel_id = db.Column(db.String(100), unique=True, nullable=False)
    channel_name = db.Column(db.String(200))
    avatar_url = db.Column(db.String(500))
    tags = db.Column(db.Text)  # JSON array of tags
    created_at = db.Column(db.DateTime, default=datetime.utcnow)

    def to_dict(self):
        return {
            "id": self.id,
            "channel_id": self.channel_id,
            "channel_name": self.channel_name,
            "avatar_url": self.avatar_url,
            "tags": self.tags,
            "created_at": self.created_at.isoformat() if self.created_at else None,
        }


class LiveStream(db.Model):
    __tablename__ = "live_streams"

    id = db.Column(db.Integer, primary_key=True)
    video_id = db.Column(db.String(20), unique=True, nullable=False)
    channel_id = db.Column(db.Integer, db.ForeignKey("tracked_channels.id"))
    title = db.Column(db.String(500))
    thumbnail_url = db.Column(db.String(500))
    scheduled_start = db.Column(db.DateTime)
    actual_start = db.Column(db.DateTime)
    actual_end = db.Column(db.DateTime)
    status = db.Column(db.String(20), default="upcoming")
    video_url = db.Column(db.String(500))
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    channel = db.relationship("TrackedChannel", backref="streams")

    def to_dict(self):
        return {
            "id": self.id,
            "video_id": self.video_id,
            "channel_id": self.channel_id,
            "channel_name": self.channel.channel_name if self.channel else None,
            "channel_avatar": self.channel.avatar_url if self.channel else None,
            "title": self.title,
            "thumbnail_url": self.thumbnail_url,
            "scheduled_start": self.scheduled_start.isoformat() if self.scheduled_start else None,
            "actual_start": self.actual_start.isoformat() if self.actual_start else None,
            "actual_end": self.actual_end.isoformat() if self.actual_end else None,
            "status": self.status,
            "video_url": self.video_url,
            "created_at": self.created_at.isoformat() if self.created_at else None,
            "updated_at": self.updated_at.isoformat() if self.updated_at else None,
        }
