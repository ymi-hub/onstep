#!/bin/bash
# OnStep — Mac 시작 스크립트
set -e

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
CYAN='\033[0;36m'
NC='\033[0m'

ok()   { echo -e "${GREEN}✅  $1${NC}"; }
warn() { echo -e "${YELLOW}⚠️   $1${NC}"; }
err()  { echo -e "${RED}❌  $1${NC}"; exit 1; }
step() { echo -e "\n${CYAN}▶  $1${NC}"; }

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
  warn "Homebrew 설치 중..."
  /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
  # Apple Silicon 경로 추가
  eval "$(/opt/homebrew/bin/brew shellenv)" 2>/dev/null || true
fi
ok "Homebrew $(brew --version | head -1)"

# ── 2. Node.js ──────────────────────────────────────
step "Node.js 확인"
if ! command -v node &>/dev/null; then
  warn "Node.js 설치 중..."
  brew install node
fi
ok "Node.js $(node --version)  /  npm $(npm --version)"

# ── 3. Firebase CLI ─────────────────────────────────
step "Firebase CLI 확인"
if ! command -v firebase &>/dev/null; then
  warn "Firebase CLI 설치 중..."
  npm install -g firebase-tools
fi
ok "Firebase CLI $(firebase --version)"

# ── 4. Firebase 로그인 ──────────────────────────────
step "Firebase 로그인 상태 확인"
if ! firebase projects:list &>/dev/null 2>&1; then
  warn "로그인이 필요합니다."
  firebase login
else
  ok "Firebase 로그인됨"
fi

# ── 완료 ────────────────────────────────────────────
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
ok "세팅 완료!"
echo ""
echo -e "  ${CYAN}로컬 미리보기${NC}"
echo "  firebase serve --only hosting"
echo "  → http://localhost:5000/today.html"
echo ""
echo -e "  ${CYAN}배포${NC}"
echo "  firebase deploy --only hosting"
echo "  → https://onstep-lifeos-v2-adee2.web.app"
echo ""
echo -e "  ${CYAN}또는 dev.sh 실행${NC}  →  ./dev.sh"
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
