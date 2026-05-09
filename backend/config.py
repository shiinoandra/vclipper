import os

class Config:
    SECRET_KEY = os.environ.get("SECRET_KEY", "dev-secret-key")
    SQLALCHEMY_DATABASE_URI = os.environ.get("DATABASE_URL", "sqlite:///vclipper.db")
    SQLALCHEMY_TRACK_MODIFICATIONS = False
    DEFAULT_OUTPUT_DIR = os.environ.get("DEFAULT_OUTPUT_DIR", "./downloads")
    UPLOAD_FOLDER = os.environ.get("UPLOAD_FOLDER", "./downloads")
