import json, ssl, urllib.request

ssl_ctx = ssl.create_default_context()
ssl_ctx.check_hostname = False
ssl_ctx.verify_mode = ssl.CERT_NONE

with open("/Users/youngmikim/.config/configstore/firebase-tools.json") as f:
    d = json.load(f)
TOKEN = d["tokens"]["access_token"]

def get(url):
    req = urllib.request.Request(url, headers={"Authorization": f"Bearer {TOKEN}"})
    with urllib.request.urlopen(req, context=ssl_ctx) as r:
        return json.loads(r.read())

def post(url, body={}):
    data = json.dumps(body).encode()
    req = urllib.request.Request(url, data=data, headers={
        "Authorization": f"Bearer {TOKEN}", "Content-Type": "application/json"
    }, method="POST")
    with urllib.request.urlopen(req, context=ssl_ctx) as r:
        return json.loads(r.read())

# CollectionGroup 쿼리 — products 컬렉션 ID로 전체 문서 검색 (모든 사용자)
print("=== CollectionGroup 쿼리: 모든 products 문서 ===")
run_query_url = "https://firestore.googleapis.com/v1/projects/onstep-lifeos-v2/databases/(default)/documents:runQuery"
query_body = {
    "structuredQuery": {
        "from": [{"collectionId": "products", "allDescendants": True}],
        "limit": 10
    }
}
results = post(run_query_url, query_body)
print(f"결과 타입: {type(results)}")
if isinstance(results, list):
    actual = [r for r in results if "document" in r]
    print(f"products 문서 수 (샘플 10): {len(actual)}")
    for r in actual[:5]:
        doc = r["document"]
        name_field = doc.get("fields", {}).get("name", {}).get("stringValue", "?")
        path = doc["name"]
        uid_part = path.split("/users/")[1].split("/")[0] if "/users/" in path else "?"
        print(f"  UID: {uid_part[:12]}... | 제품: {name_field}")
else:
    print(results)

# v1도 확인
print("\n=== CollectionGroup 쿼리: onstep-lifeos (v1) ===")
run_query_url_v1 = "https://firestore.googleapis.com/v1/projects/onstep-lifeos/databases/(default)/documents:runQuery"
results_v1 = post(run_query_url_v1, query_body)
if isinstance(results_v1, list):
    actual_v1 = [r for r in results_v1 if "document" in r]
    print(f"products 문서 수 (샘플 10): {len(actual_v1)}")
    for r in actual_v1[:5]:
        doc = r["document"]
        name_field = doc.get("fields", {}).get("name", {}).get("stringValue", "?")
        path = doc["name"]
        uid_part = path.split("/users/")[1].split("/")[0] if "/users/" in path else "?"
        print(f"  UID: {uid_part[:12]}... | 제품: {name_field}")
else:
    print(results_v1)
