# 자세 지표 (2D 이미지 좌표)

모델: MediaPipe Pose Landmarker Lite float16 v1  
라이브러리: `@mediapipe/tasks-vision` 1.1.0  
좌표: 정규화 2D (x,y ∈ [0,1], y는 아래 방향). 추정 3D world landmarks는 사용하지 않는다.

랜드마크 (BlazePose): 코 0, 왼눈 2, 오른눈 5, 왼귀 7, 오른귀 8, 왼어깨 11, 오른어깨 12.

## A. 고개 좌우 기울어짐

선: 왼눈–오른눈.  
θ_head = atan2(y_re − y_le, x_re − x_le) × 180/π  
Δ = θ_head − θ_head,baseline

## B. 어깨 좌우 기울어짐

선: 왼어깨–오른어깨.  
θ_sh = atan2(y_rs − y_ls, x_rs − x_ls) × 180/π  
Δ = θ_sh − θ_sh,baseline

## C. 얼굴–어깨 상대 위치 (보조)

얼굴 중심 = 눈 중점, 어깨 중심 = 어깨 중점, 너비 = 어깨 거리.  
torso = ((face − shoulder) / width)  
Δ = hypot(Δx, Δy)

이 값만으로 목 굽힘·거북목을 확정하지 않는다. 정면 웹캠의 전방 머리 자세는 임상 CVA로 표시하지 않는다.

기준은 5초간 유효 프레임의 중앙값이다.
