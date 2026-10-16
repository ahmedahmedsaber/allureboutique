"""Local stand-in for a Supabase project — testing only.
/rest/v1 -> real PostgREST (real SQL & row-level security); /auth/v1 -> tiny GoTrue fake (HS256 JWTs);
/storage/v1 -> files on disk.  Run: python3 tests/gateway.py  (needs PostgREST on :54330, Postgres on :54329)"""
import base64, hashlib, hmac, json, os, subprocess, time, uuid, urllib.request, urllib.error
from http.server import ThreadingHTTPServer, BaseHTTPRequestHandler
from urllib.parse import urlparse, parse_qs

SECRET = 'local-test-secret-local-test-secret-123456'
PGRST = 'http://127.0.0.1:54330'
STORE_DIR = os.environ.get('GATEWAY_STORAGE', '/tmp/allure-test-storage'); os.makedirs(STORE_DIR, exist_ok=True)
PSQL = ['psql', '-h', '127.0.0.1', '-p', '54329', '-U', 'postgres', '-d', 'allure', '-At', '-v', 'ON_ERROR_STOP=1', '-c']
PASSWORDS = {}

def b64(b): return base64.urlsafe_b64encode(b).rstrip(b'=').decode()
def jwt(claims):
    h = b64(json.dumps({'alg': 'HS256', 'typ': 'JWT'}).encode()); p = b64(json.dumps(claims).encode())
    return f'{h}.{p}.' + b64(hmac.new(SECRET.encode(), f'{h}.{p}'.encode(), hashlib.sha256).digest())
def unjwt(tok):
    try:
        h, p, s = tok.split('.')
        if b64(hmac.new(SECRET.encode(), f'{h}.{p}'.encode(), hashlib.sha256).digest()) != s: return None
        return json.loads(base64.urlsafe_b64decode(p + '=' * (-len(p) % 4)))
    except Exception: return None
ANON = jwt({'role': 'anon', 'iss': 'supabase', 'iat': 1700000000, 'exp': 2000000000})
def sql(q): return subprocess.run(PSQL + [q], capture_output=True, text=True, check=True).stdout.strip()
def q(s): return "'" + str(s).replace("'", "''") + "'"
def user_row(email=None, uid=None):
    where = f"email = {q(email)}" if email else f"id = {q(uid)}"
    out = sql(f"select row_to_json(u) from (select id, email, raw_user_meta_data from auth.users where {where}) u")
    return json.loads(out) if out else None
def user_obj(u):
    return {'id': u['id'], 'aud': 'authenticated', 'role': 'authenticated', 'email': u['email'], 'email_confirmed_at': '2026-01-01T00:00:00Z',
            'user_metadata': u.get('raw_user_meta_data') or {}, 'app_metadata': {'provider': 'email'}, 'created_at': '2026-01-01T00:00:00Z'}
def session(u):
    now = int(time.time())
    tok = jwt({'sub': u['id'], 'role': 'authenticated', 'aud': 'authenticated', 'email': u['email'], 'iat': now, 'exp': now + 3600})
    return {'access_token': tok, 'token_type': 'bearer', 'expires_in': 3600, 'expires_at': now + 3600, 'refresh_token': 'r-' + u['id'], 'user': user_obj(u)}

class H(BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def cors(self):
        self.send_header('Access-Control-Allow-Origin', self.headers.get('Origin') or '*')
        self.send_header('Access-Control-Allow-Credentials', 'true')
        self.send_header('Access-Control-Allow-Headers', self.headers.get('Access-Control-Request-Headers') or '*')
        self.send_header('Access-Control-Allow-Methods', 'GET,POST,PATCH,PUT,DELETE,OPTIONS')
        self.send_header('Access-Control-Expose-Headers', 'Content-Range, Content-Profile, Preference-Applied')
    def send(self, code, body=None, ctype='application/json', extra=None):
        data = body if isinstance(body, (bytes, bytearray)) else (json.dumps(body).encode() if body is not None else b'')
        self.send_response(code); self.cors()
        if data: self.send_header('Content-Type', ctype)
        for k, v in (extra or {}).items(): self.send_header(k, v)
        self.send_header('Content-Length', str(len(data))); self.end_headers(); self.wfile.write(data)
    def body(self):
        n = int(self.headers.get('Content-Length') or 0); return self.rfile.read(n) if n else b''
    def do_OPTIONS(self): self.send(204)
    def do_GET(self): self.route('GET')
    def do_POST(self): self.route('POST')
    def do_PATCH(self): self.route('PATCH')
    def do_PUT(self): self.route('PUT')
    def do_DELETE(self): self.route('DELETE')
    def route(self, m):
        u = urlparse(self.path)
        try:
            if u.path.startswith('/rest/v1/'): return self.rest(m, u)
            if u.path.startswith('/auth/v1/'): return self.auth(m, u)
            if u.path.startswith('/storage/v1/'): return self.storage(m, u)
            return self.send(404, {'message': 'not found'})
        except subprocess.CalledProcessError as e:
            return self.send(400, {'error': 'db', 'msg': e.stderr})
    def rest(self, m, u):
        req = urllib.request.Request(PGRST + u.path[len('/rest/v1'):] + ('?' + u.query if u.query else ''), data=self.body() if m != 'GET' else None, method=m)
        for k in ('Authorization', 'Content-Type', 'Prefer', 'Accept', 'Range', 'Content-Profile', 'Accept-Profile'):
            if self.headers.get(k): req.add_header(k, self.headers[k])
        try:
            with urllib.request.urlopen(req) as r:
                extra = {k: r.headers[k] for k in ('Content-Range', 'Preference-Applied') if r.headers.get(k)}
                return self.send(r.status, r.read(), r.headers.get('Content-Type') or 'application/json', extra)
        except urllib.error.HTTPError as e:
            return self.send(e.code, e.read(), e.headers.get('Content-Type') or 'application/json')
    def claims(self):
        a = self.headers.get('Authorization', ''); return unjwt(a[7:]) if a.startswith('Bearer ') else None
    def auth(self, m, u):
        p, qs = u.path[len('/auth/v1'):], parse_qs(u.query)
        b = json.loads(self.body() or b'{}') if m in ('POST', 'PUT') else {}
        if p == '/signup' and m == 'POST':
            email = b['email'].lower()
            if user_row(email): return self.send(422, {'code': 422, 'error_code': 'user_already_exists', 'msg': 'User already registered'})
            if len(b.get('password', '')) < 6: return self.send(422, {'code': 422, 'error_code': 'weak_password', 'msg': 'Password should be at least 6 characters.'})
            uid = str(uuid.uuid4())
            try: sql(f"insert into auth.users (id, email, raw_user_meta_data) values ({q(uid)}, {q(email)}, {q(json.dumps(b.get('data') or {}))}::jsonb)")
            except subprocess.CalledProcessError: return self.send(500, {'code': 500, 'error_code': 'unexpected_failure', 'msg': 'Database error saving new user'})   # what Supabase says when a trigger refuses
            PASSWORDS[email] = b['password']; return self.send(200, session(user_row(email)))
        if p == '/token':
            gt = qs.get('grant_type', [''])[0]
            if gt == 'password':
                email = b.get('email', '').lower(); ur = user_row(email)
                if not ur or PASSWORDS.get(email) != b.get('password'):
                    return self.send(400, {'error': 'invalid_grant', 'error_description': 'Invalid login credentials', 'error_code': 'invalid_credentials', 'msg': 'Invalid login credentials'})
                return self.send(200, session(ur))
            if gt == 'refresh_token':
                ur = user_row(uid=b.get('refresh_token', '')[2:])
                return self.send(200, session(ur)) if ur else self.send(400, {'error': 'invalid_grant', 'error_description': 'Invalid Refresh Token'})
        if p == '/user':
            c = self.claims()
            if not c or 'sub' not in c: return self.send(401, {'msg': 'invalid token'})
            ur = user_row(uid=c['sub'])
            if m == 'PUT' and b.get('password'): PASSWORDS[ur['email']] = b['password']
            return self.send(200, user_obj(ur))
        if p == '/logout': return self.send(204)
        if p == '/recover': return self.send(200, {})
        return self.send(404, {'msg': 'auth route not faked: ' + p})
    def storage(self, m, u):
        p = u.path[len('/storage/v1'):]
        if p.startswith('/object/public/'):
            f = os.path.join(STORE_DIR, p[len('/object/public/'):])
            return self.send(200, open(f, 'rb').read(), 'image/jpeg') if os.path.exists(f) else self.send(404, {'message': 'not found'})
        if p.startswith('/object/') and m == 'POST':
            c = self.claims()
            if not (c and c.get('sub') and sql(f"select role from public.profiles where id = {q(c['sub'])}") in ('owner', 'admin')):
                return self.send(403, {'statusCode': '403', 'error': 'Unauthorized', 'message': 'new row violates row-level security policy'})
            rel = p[len('/object/'):]; f = os.path.join(STORE_DIR, rel); os.makedirs(os.path.dirname(f), exist_ok=True)
            data, ct = self.body(), self.headers.get('Content-Type', '')
            if ct.startswith('multipart/form-data'):
                boundary = ct.split('boundary=')[1].encode()
                for part in data.split(b'--' + boundary):
                    if b'\r\n\r\n' in part and b'filename=' in part.split(b'\r\n\r\n', 1)[0]:
                        data = part.split(b'\r\n\r\n', 1)[1].rsplit(b'\r\n', 1)[0]; break
            open(f, 'wb').write(data); return self.send(200, {'Key': rel, 'Id': str(uuid.uuid4())})
        if p.startswith('/object/') and m == 'DELETE': return self.send(200, [])
        return self.send(404, {'message': 'storage route not faked'})

if __name__ == '__main__':
    print('ANON_KEY=' + ANON, flush=True)
    ThreadingHTTPServer(('127.0.0.1', 54321), H).serve_forever()
