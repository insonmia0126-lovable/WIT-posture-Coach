# 버전 이력

이 폴더는 목격자 W.I.T.의 **릴리스 이력**을 모아 둡니다. 현재 실행 코드는 저장소 루트(주로 `app/`)의 `main`이며, 과거 코드는 Git 태그로 되돌릴 수 있습니다.

| 버전 | 날짜 | Git 태그 | 한 줄 요약 | 상세 |
|------|------|----------|------------|------|
| v0.1 | 2026-10-13 | `v0.1` | PC 측면 카메라·모의 입력 연구 프로토타입 | [v0.1.md](./v0.1.md) |
| v0.2 | 2026-10-13 | `v0.2` | 노트북 웹캠 온디바이스 웹앱 시제품 | [v0.2.md](./v0.2.md) |

전체 연표는 [CHANGELOG.md](./CHANGELOG.md)를 봅니다.

세션 결과에서 배운 내용은 버전과 별도로 [`learning/`](../learning/)에 모읍니다.

## 과거 버전 코드 보기

```bash
git fetch --tags
git checkout v0.1    # Python 데스크톱·모의 시연
git checkout v0.2    # 노트북 웹캠 웹앱
git checkout main    # 최신 작업 브랜치로 복귀
```

태그 목록: `git tag -l`

GitHub 릴리스: https://github.com/insonmia0126-lovable/WIT-posture-Coach/releases

## 다음 버전을 남기는 방법

1. `version/_template.md`를 복사해 `version/v0.3.md`처럼 작성합니다.
2. 이 README 표와 `CHANGELOG.md`에 한 줄을 추가합니다.
3. `app/package.json`의 `version`을 맞춥니다.
4. 커밋 후 태그를 붙입니다.

```bash
git tag -a v0.3 -m "목격자 W.I.T v0.3 — (한 줄 요약)"
git push origin v0.3
git push github v0.3
gh release create v0.3 --title "목격자 W.I.T v0.3" --notes-file version/v0.3.md
```

소스 전체를 폴더에 복제하지 않습니다. 용량이 큰 모델·WASM은 태그의 커밋에 있고, 이력 문서는 무엇이 바뀌었는지만 적습니다.
