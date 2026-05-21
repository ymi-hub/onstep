#!/bin/bash
# OnStep — 로컬 개발 서버 실행
set -e

GREEN='\033[0;32m'
CYAN='\033[0;36m'
NC='\033[0m'

echo -e "\n${CYAN}OnStep 로컬 서버 시작...${NC}"
echo -e "${GREEN}→ http://localhost:5000/today.html${NC}\n"

firebase serve --only hosting
