"""
Tiny SQLite helper. No ORM on purpose — at this project's scale, raw SQL is
more useful to learn than an abstraction over it.
"""

import sqlite3
from pathlib import Path

DB_PATH = Path(__file__).parent / "mockproctor.db"


def get_connection():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row  # lets us return dict-like rows from queries
    return conn


def init_db():
    conn = get_connection()
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS sessions (
            id TEXT PRIMARY KEY,
            started_at TEXT NOT NULL,
            ended_at TEXT
        )
        """
    )
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS events (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            session_id TEXT NOT NULL,
            event_type TEXT NOT NULL,
            timestamp TEXT NOT NULL,
            meta TEXT,
            FOREIGN KEY (session_id) REFERENCES sessions (id)
        )
        """
    )
    conn.commit()
    conn.close()
