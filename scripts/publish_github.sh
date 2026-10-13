#!/usr/bin/env bash
# v0.1을 GitHub 공개 저장소에 올립니다.
# 필요: GitHub 로그인 (gh auth login 또는 HTTPS 자격 증명)
set -euo pipefail
cd "$(dirname "$0")/.."

REPO_SSH="git@github.com:insonmia0126-lovable/WIT-posture-Coach.git"
REPO_HTTPS="https://github.com/insonmia0126-lovable/WIT-posture-Coach.git"

if git remote get-url github >/dev/null 2>&1; then
  git remote set-url github "$REPO_HTTPS"
else
  git remote add github "$REPO_HTTPS"
fi

if command -v gh >/dev/null 2>&1 && gh auth status >/dev/null 2>&1; then
  if ! gh repo view insonmia0126-lovable/WIT-posture-Coach >/dev/null 2>&1; then
    gh repo create insonmia0126-lovable/WIT-posture-Coach \
      --public \
      --source=. \
      --remote=github \
      --description "목격자 W.I.T v0.1 — on-device posture coach prototype" \
      --disable-wiki \
      --push
  else
    git push -u github main
  fi
else
  echo "gh 로그인이 없으면 git push만 시도합니다. 저장소가 없으면 GitHub에서 먼저 만드세요."
  git push -u github main
fi

if git rev-parse v0.1 >/dev/null 2>&1; then
  git push github v0.1 || true
fi

echo "게시: $REPO_HTTPS"
