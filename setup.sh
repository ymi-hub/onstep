#!/bin/bash
# OnStep — Mac 초기 세팅 스크립트
set -e

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

ok()   { echo -e "${GREEN}✅  $1${NC}"; }
warn() { echo -e "${YELLOW}⚠️   $1${NC}"; }
err()  { echo -e "${RED}❌  $1${NC}"; exit 1; }
step() { echo -e "\n${YELLOW}▶  $1${NC}"; }

echo ""
echo "  ██████  ███    ██ ███████ ████████ ███████ ██████  "
echo " ██    ██ ████   ██ ██         ██    ██      ██   ██ "
echo " ██    ██ ██ ██  ██ ███████    ██    █████   ██████  "
echo " ██    ██ ██  ██ ██      ██    ██    ██      ██      "
echo "  ██████  ██   ████ ███████    ██    ███████ ██      "
echo ""
echo "  Zero Setting: Life 관리는 리스트에서 즉시"
echo ""

# ── 1. Homebrew ─────────────────────────────────────
step "Homebrew 확인"
if ! command -v brew &>/dev/null; then
  warn "Homebrew가 없습니다. 설치 중..."
  /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
fi
ok "Homebrew $(brew --version | head -1)"

# ── 2. Python 3.11+ ─────────────────────────────────
step "Python 확인"
if ! command -v python3 &>/dev/null; then
  warn "Python 설치 중..."
  brew install python@3.11
fi
PYTHON_VER=$(python3 --version | awk '{print $2}')
PYTHON_MAJOR=$(echo "$PYTHON_VER" | cut -d. -f1)
PYTHON_MINOR=$(echo "$PYTHON_VER" | cut -d. -f2)
if [ "$PYTHON_MAJOR" -lt 3 ] || ([ "$PYTHON_MAJOR" -eq 3 ] && [ "$PYTHON_MINOR" -lt 11 ]); then
  warn "Python 3.11+ 필요. 현재: $PYTHON_VER. 업그레이드 중..."
  brew install python@3.11
  export PATH="/opt/homebrew/opt/python@3.11/bin:$PATH"
fi
ok "Python $(python3 --version)"

# ── 3. Flutter ──────────────────────────────────────
step "Flutter 확인"
if ! command -v flutter &>/dev/null; then
  warn "Flutter가 없습니다."
  echo ""
  echo "  Flutter 설치 방법 (선택):"
  echo "  A) brew install --cask flutter   ← 권장"
  echo "  B) https://flutter.dev/docs/get-started/install/macos"
  echo ""
  read -p "  brew로 자동 설치할까요? (y/n): " yn
  if [[ "$yn" == "y" || "$yn" == "Y" ]]; then
    brew install --cask flutter
  else
    err "Flutter 설치 후 다시 실행해주세요."
  fi
fi
ok "Flutter $(flutter --version | head -1)"

# ── 4. 백엔드 가상환경 ───────────────────────────────
step "Python 가상환경 설정"
if [ ! -d "backend/.venv" ]; then
  python3 -m venv backend/.venv
  ok "가상환경 생성 완료"
fi
source backend/.venv/bin/activate
pip install --upgrade pip -q
pip install -r backend/requirements.txt -q
ok "백엔드 의존성 설치 완료"

# ── 5. .env 파일 ─────────────────────────────────────
step ".env 설정"
if [ ! -f "backend/.env" ]; then
  cp backend/.env.example backend/.env
  ok ".env 파일 생성됨 (backend/.env 에서 API 키 설정하세요)"
else
  ok ".env 파일 이미 존재"
fi

# ── 6. DB 마이그레이션 ──────────────────────────────
step "데이터베이스 초기화"
cd backend
../.venv/bin/alembic upgrade head 2>/dev/null && ok "DB 마이그레이션 완료" || warn "마이그레이션 실패 — 수동으로 확인해주세요"
cd ..

# ── 7. Flutter 패키지 ───────────────────────────────
step "Flutter 패키지 설치"
cd frontend
flutter pub get -q && ok "Flutter 패키지 설치 완료"
cd ..

# ── 완료 ────────────────────────────────────────────
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
ok "OnStep 세팅 완료!"
echo ""
echo "  실행 방법:"
echo ""
echo "  # 백엔드 (터미널 1)"
echo "  source backend/.venv/bin/activate"
echo "  cd backend && uvicorn app.main:app --reload"
echo ""
echo "  # Flutter (터미널 2)"
echo "  cd frontend && flutter run"
echo ""
echo "  또는: make dev-backend  /  make dev-flutter"
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
