// backup.js — Firestore 전체 데이터 로컬 JSON 백업
// 실행: node backup.js

const admin = require('./node_modules/firebase-admin');
const fs    = require('fs');
const path  = require('path');

const KEY_PATH = path.join(__dirname, 'serviceAccountKey.json');
if (!fs.existsSync(KEY_PATH)) {
  console.error('❌ serviceAccountKey.json 없음');
  process.exit(1);
}

admin.initializeApp({
  credential: admin.credential.cert(KEY_PATH),
  projectId: 'onstep-lifeos-v2',
});
const db = admin.firestore();

const SUB_COLS = [
  'products', 'routines', 'habits', 'habitLogs',
  'usageLogs', 'ootdLogs', 'careItems', 'makeupItems',
  'lookItems', 'settings',
];

async function exportAll() {
  const timestamp = new Date().toISOString().slice(0, 10);
  const outDir  = path.join(__dirname, 'backups');
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir);
  const outPath = path.join(outDir, `firestore_${timestamp}.json`);

  // UID 목록을 collectionGroup으로 수집
  const uidSet = new Set();
  for (const col of SUB_COLS) {
    const snap = await db.collectionGroup(col).get().catch(() => ({ empty: true, docs: [] }));
    if (!snap.empty) snap.docs.forEach(d => uidSet.add(d.ref.parent.parent.id));
  }
  console.log(`👤 발견된 UID: ${uidSet.size}명`);

  const result = {};

  for (const uid of uidSet) {
    result[uid] = {};
    for (const colName of SUB_COLS) {
      const snap = await db.collection('users').doc(uid).collection(colName).get()
        .catch(() => ({ empty: true, docs: [] }));
      if (snap.empty) continue;
      result[uid][colName] = {};
      snap.docs.forEach(d => { result[uid][colName][d.id] = d.data(); });
      console.log(`  📦 ${colName}: ${snap.docs.length}개`);
    }
  }

  fs.writeFileSync(outPath, JSON.stringify(result, null, 2), 'utf-8');
  const kb = (fs.statSync(outPath).size / 1024).toFixed(1);
  console.log(`\n✅ 백업 완료: ${outPath}  (${kb} KB)`);
}

exportAll().catch(err => {
  console.error('❌ 백업 실패:', err.message);
  process.exit(1);
});
