# MockProctor — Manual Security & Deployment Setup Guide

This document outlines environment, infrastructure, and architectural security configurations that **cannot be resolved solely in code** and require manual administrative or operational setup prior to production deployment.

---

## 🔒 1. HTTPS / TLS & Secure Context Enforcment

### Context
Modern web browsers enforce strict security restrictions on media devices. `navigator.mediaDevices.getUserMedia` **requires a Secure Context (`https://` or `http://localhost`)**. If deployed over plain HTTP on an IP address or custom domain, camera initialization will fail automatically.

### Remediation Steps
1. **Obtain SSL/TLS Certificates**:
   Use Certbot with Let's Encrypt to generate free, auto-renewing SSL certificates:
   ```bash
   sudo apt-get install certbot python3-certbot-nginx
   sudo certbot --nginx -d proctor.yourdomain.com
   ```
2. **Configure Reverse Proxy (Nginx)**:
   Redirect all HTTP traffic to HTTPS and proxy API requests:
   ```nginx
   server {
       listen 80;
       server_name proctor.yourdomain.com;
       return 301 https://$host$request_uri;
   }

   server {
       listen 443 ssl http2;
       server_name proctor.yourdomain.com;

       ssl_certificate /etc/letsencrypt/live/proctor.yourdomain.com/fullchain.pem;
       ssl_certificate_key /etc/letsencrypt/live/proctor.yourdomain.com/privkey.pem;

       location / {
           root /var/www/mockproctor/frontend/dist;
           try_files $uri /index.html;
       }

       location /api/ {
           proxy_pass http://127.0.0.1:8000/;
           proxy_set_header Host $host;
           proxy_set_header X-Real-IP $remote_addr;
           proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
           proxy_set_header X-Forwarded-Proto $scheme;
       }
   }
   ```

---

## 🔑 2. Authentication & Role-Based Access Control (RBAC)

### Context
The API endpoints currently operate in unauthenticated development mode. In production, exam candidates should only log events to their active session, while proctors/instructors require authenticated access to view summary dashboards and list sessions.

### Remediation Steps
1. **Implement JWT (JSON Web Tokens)**:
   Add `python-jose` and `passlib` to the backend dependencies:
   ```bash
   pip install "python-jose[cryptography]" "passlib[bcrypt]"
   ```
2. **Add Header Verification in FastAPI**:
   Create a authentication dependency:
   ```python
   from fastapi import Depends, HTTPException, status
   from fastapi.security import OAuth2PasswordBearer

   oauth2_scheme = OAuth2PasswordBearer(tokenUrl="token")

   def get_current_user(token: str = Depends(oauth2_scheme)):
       # Validate JWT token and extract user credentials
       ...
   ```
3. **Protect Admin Routes**:
   Attach authorization verification to `/sessions` and `/session/{session_id}/summary` routes so candidates cannot view other candidates' proctoring reports.

---

## 🛡️ 3. Production CORS Origin Lockdown

### Context
The backend API dynamically reads CORS origins from the environment. In production environments, leaving CORS open or pointing to local origins allows unauthorized websites to interact with your backend API.

### Remediation Steps
1. Set the `CORS_ORIGINS` environment variable in your production system or systemd service file:
   ```bash
   export CORS_ORIGINS="https://proctor.yourdomain.com"
   ```
2. Restart your backend server (`uvicorn` or `gunicorn`).

---

## 🚦 4. API Rate Limiting & DoS Mitigation

### Context
Telemetry endpoints like `POST /log-event` could be flooded by malicious scripts or bugged clients, resulting in high CPU usage or rapid database expansion.

### Remediation Steps
1. **Install Rate-Limiting Package**:
   ```bash
   pip install slowapi
   ```
2. **Apply Rate Limits in FastAPI**:
   ```python
   from slowapi import Limiter, _rate_limit_exceeded_handler
   from slowapi.util import get_remote_address
   from slowapi.errors import RateLimitExceeded

   limiter = Limiter(key_func=get_remote_address)
   app.state.limiter = limiter
   app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

   @app.post("/log-event")
   @limiter.limit("30/minute")
   def log_event(request: Request, event: EventIn):
       ...
   ```
3. Alternatively, enforce rate limiting at the Nginx layer:
   ```nginx
   limit_req_zone $binary_remote_addr zone=api_limit:10m rate=10r/s;
   location /api/ {
       limit_req zone=api_limit burst=20 nodelay;
   }
   ```

---

## 💾 5. Database Replication & WAL Backup Strategy

### Context
MockProctor uses SQLite with Write-Ahead Logging (`journal_mode=WAL`), which guarantees high performance and concurrent reads/writes. However, a single database file requires automated backups for disaster recovery.

### Remediation Steps
1. **Online Backup via SQLite CLI**:
   Run safe non-blocking backups without stopping the API server:
   ```bash
   sqlite3 /path/to/mockproctor.db ".backup '/var/backups/mockproctor_$(date +%Y%m%d_%H%M%S).db'"
   ```
2. **Automated Continuous Backup (Litestream)**:
   Install Litestream to continuously stream WAL frames to AWS S3 or Cloudflare R2:
   ```yaml
   # /etc/litestream.yml
   dbs:
     - path: /path/to/mockproctor.db
       replicas:
         - type: s3
           bucket: my-proctor-backups
           path: db
   ```

---

## ⚖️ 6. Data Privacy, Compliance & Retention Policies (GDPR / FERPA)

### Context
Automated exam telemetry tracks user presence and behavior. Educational and institutional guidelines mandate clear data handling and retention policies.

### Remediation Steps
1. **User Consent Notice**:
   Ensure a visible candidate consent notice is displayed prior to requesting camera permissions.
2. **Automated Data Purge Cron Job**:
   Schedule a periodic script to purge event logs older than your institutional retention period (e.g., 30 days):
   ```sql
   DELETE FROM events WHERE timestamp < datetime('now', '-30 days');
   DELETE FROM sessions WHERE ended_at IS NOT NULL AND ended_at < datetime('now', '-30 days');
   VACUUM;
   ```
