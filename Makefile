PYTHON  = python3
VENV    = backend/.venv
PIP     = $(VENV)/bin/pip
UVICORN = $(VENV)/bin/uvicorn
ALEMBIC = $(VENV)/bin/alembic

.PHONY: setup setup-backend setup-flutter dev dev-backend dev-flutter migrate reset-db

# ── 전체 초기 세팅 ───────────────────────
setup: setup-backend setup-flutter
	@echo "\n✅  세팅 완료. 'make dev'로 실행하세요."

setup-backend:
	@echo "🐍  Python 가상환경 생성 중..."
	$(PYTHON) -m venv $(VENV)
	$(PIP) install --upgrade pip -q
	$(PIP) install -r backend/requirements.txt -q
	@cp -n backend/.env.example backend/.env 2>/dev/null || true
	@echo "✅  백엔드 의존성 설치 완료"

setup-flutter:
	@echo "🦋  Flutter 패키지 설치 중..."
	cd frontend && flutter pub get
	@echo "✅  Flutter 의존성 설치 완료"

# ── DB 마이그레이션 ──────────────────────
migrate:
	@echo "🗄️  DB 마이그레이션 실행 중..."
	cd backend && ../$(ALEMBIC) upgrade head
	@echo "✅  마이그레이션 완료"

reset-db:
	@echo "⚠️  DB 초기화 중..."
	rm -f backend/onstep.db
	cd backend && ../$(ALEMBIC) upgrade head
	@echo "✅  DB 초기화 완료"

# ── 개발 서버 ───────────────────────────
dev-backend:
	cd backend && ../$(VENV)/bin/uvicorn app.main:app --reload --port 8000

dev-flutter:
	cd frontend && flutter run

dev:
	@echo "백엔드와 Flutter를 각각 실행해주세요:"
	@echo "  터미널 1: make dev-backend"
	@echo "  터미널 2: make dev-flutter"
