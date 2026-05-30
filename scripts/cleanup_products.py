"""
products 컬렉션 중복 제거 스크립트 (v2, 실제 UID 자동 탐지)
"""
import json, sys, ssl, urllib.request

ssl_ctx = ssl.create_default_context()
ssl_ctx.check_hostname = False
ssl_ctx.verify_mode = ssl.CERT_NONE

DRY_RUN = "--dry-run" in sys.argv

with open("/Users/youngmikim/.config/configstore/firebase-tools.json") as f:
    cfg = json.load(f)
TOKEN = cfg["tokens"]["access_token"]

PROJ = "onstep-lifeos-v2"
BASE = f"https://firestore.googleapis.com/v1/projects/{PROJ}/databases/(default)/documents"

def get(url):
    req = urllib.request.Request(url, headers={"Authorization": f"Bearer {TOKEN}"})
    with urllib.request.urlopen(req, context=ssl_ctx) as r:
        return json.loads(r.read())

def post_json(url, body):
    data = json.dumps(body).encode()
    req = urllib.request.Request(url, data=data, headers={
        "Authorization": f"Bearer {TOKEN}", "Content-Type": "application/json"
    }, method="POST")
    with urllib.request.urlopen(req, context=ssl_ctx) as r:
        return json.loads(r.read())

def delete(url):
    req = urllib.request.Request(url, headers={"Authorization": f"Bearer {TOKEN}"}, method="DELETE")
    with urllib.request.urlopen(req, context=ssl_ctx) as r:
        r.read()

def parse(v):
    if not isinstance(v, dict): return v
    for t in ("stringValue","integerValue","doubleValue","booleanValue","timestampValue"):
        if t in v:
            return int(v[t]) if t=="integerValue" else (float(v[t]) if t=="doubleValue" else v[t])
    if "nullValue" in v: return None
    if "arrayValue" in v: return [parse(i) for i in v["arrayValue"].get("values",[])]
    if "mapValue" in v: return {k: parse(vv) for k,vv in v["mapValue"].get("fields",{}).items()}
    return v

def load_all(col_url):
    docs = []
    page_token = None
    while True:
        url = col_url + ("&" if "?" in col_url else "?") + "pageSize=300"
        if page_token: url += f"&pageToken={page_token}"
        r = get(url)
        docs.extend(r.get("documents", []))
        page_token = r.get("nextPageToken")
        if not page_token: break
    return docs

# ── 1단계: UID 탐지 — 알려진 v1 UID로 v2 subcollection 확인 후,
#           없으면 runQuery로 샘플 탐색 ───────────────────────────────────────
KNOWN_UID = "M8lxWV6AH2NW1vHwF5iCaVfvKE02"  # v1 UID

print("🔍 UID 탐지 중...")
# v2에서 알려진 UID의 products 확인
test = get(f"{BASE}/users/{KNOWN_UID}/products?pageSize=3")
if test.get("documents"):
    UID = KNOWN_UID
    print(f"  → v1 UID 그대로 사용: {UID}")
else:
    # runQuery로 1개 샘플 찾기
    sample = post_json(f"{BASE}:runQuery", {
        "structuredQuery": {
            "from": [{"collectionId": "products", "allDescendants": True}],
            "limit": 1
        }
    })
    found = [r for r in sample if "document" in r]
    if not found:
        print("❌ products 문서를 찾을 수 없습니다.")
        sys.exit(1)
    path = found[0]["document"]["name"]
    UID = path.split("/users/")[1].split("/")[0]
    print(f"  → 탐지된 UID: {UID}")

# ── 2단계: products 전체 로드 ────────────────────────────────────────────────
print(f"\n📦 products 로드 중 (users/{UID[:10]}...)...")
prod_docs = load_all(f"{BASE}/users/{UID}/products?pageSize=300")
print(f"  → {len(prod_docs)}개")

if not prod_docs:
    print("products 없음")
    sys.exit(0)

# ── 3단계: routines 로드 → 참조 productId 수집 ────────────────────────────────
print("🔄 routines 로드 중...")
routine_docs = load_all(f"{BASE}/users/{UID}/routines?pageSize=300")

def collect_routine_ids(obj, found=None):
    if found is None: found = set()
    if isinstance(obj, dict):
        if obj.get("type") == "product" and "id" in obj:
            found.add(str(obj["id"]))
        for v in obj.values():
            collect_routine_ids(v, found)
    elif isinstance(obj, list):
        for item in obj:
            collect_routine_ids(item, found)
    return found

routine_ids = set()
for rdoc in routine_docs:
    parsed = {k: parse(v) for k, v in rdoc.get("fields", {}).items()}
    collect_routine_ids(parsed, routine_ids)
print(f"  → {len(routine_docs)}개 세션, 참조 productId {len(routine_ids)}개\n")

# ── 4단계: 중복 분석 ──────────────────────────────────────────────────────────
products = []
for doc in prod_docs:
    pid = doc["name"].split("/")[-1]
    fields = {k: parse(v) for k, v in doc.get("fields", {}).items()}
    products.append({
        "id":        pid,
        "name":      (fields.get("name") or "").strip(),
        "createdAt": fields.get("createdAt") or "",
        "inRoutine": pid in routine_ids,
        "_path":     doc["name"].split("/documents/")[1],
    })

by_name: dict[str, list] = {}
for p in products:
    by_name.setdefault(p["name"].lower(), []).append(p)

to_delete_paths = []

print("=" * 55)
print(f"📊 분석 결과  (총 {len(products)}개, 유니크 이름 {len(by_name)}개)")
print("=" * 55)

dup_count = 0
for name_key, group in sorted(by_name.items()):
    if len(group) < 2:
        continue
    dup_count += 1

    in_routine  = [p for p in group if p["inRoutine"]]
    if in_routine:
        keeper = sorted(in_routine, key=lambda p: p["createdAt"], reverse=True)[0]
    else:
        keeper = sorted(group, key=lambda p: p["createdAt"], reverse=True)[0]

    rest = [p for p in group if p["id"] != keeper["id"]]
    to_delete_paths.extend(p["_path"] for p in rest)

    if dup_count <= 8:
        tag = "루틴참조" if keeper["inRoutine"] else "최신"
        print(f"  [{len(group)}개] {group[0]['name']}  → 보존: {keeper['id'][:10]}... ({tag}), 삭제: {len(rest)}개")

if dup_count > 8:
    print(f"  ... 외 {dup_count - 8}개 중복 그룹")

print(f"\n{'─'*55}")
print(f"  중복 그룹:  {dup_count}개")
print(f"  삭제 대상: {len(to_delete_paths)}개")
print(f"  정리 후:   {len(products) - len(to_delete_paths)}개 남음")

if DRY_RUN:
    print("\n⚠️  DRY RUN — 실제 삭제 안 함")
    sys.exit(0)

if not to_delete_paths:
    print("\n✓ 삭제할 중복 없음")
    sys.exit(0)

# ── 5단계: 삭제 실행 ──────────────────────────────────────────────────────────
print(f"\n🚀 {len(to_delete_paths)}개 삭제 중...")
errors = []
for i, path in enumerate(to_delete_paths, 1):
    try:
        delete(f"{BASE}/{path}")
        if i % 50 == 0 or i == len(to_delete_paths):
            print(f"  [{i}/{len(to_delete_paths)}] 진행 중...")
    except Exception as e:
        errors.append((path, str(e)))

print(f"\n{'='*55}")
if errors:
    print(f"⚠️  완료 (오류 {len(errors)}건)")
else:
    remaining = len(products) - len(to_delete_paths)
    print(f"✅ 완료 — {len(to_delete_paths)}개 삭제, {remaining}개 남음")
