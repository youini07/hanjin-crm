@echo off
setlocal
chcp 65001 >nul
cd /d "%~dp0"
title Hanjin CRM - GitHub Deploy

echo ========================================================
echo.
echo    한진택배 고객 배송지 입력기 - GitHub 자동 디플로이
echo.
echo ========================================================
echo.

:: 왜: Git이 설치되지 않았거나 환경변수(PATH)에 등록되지 않은 예외 상황 방어
where git >nul 2>&1
if errorlevel 1 goto :NO_GIT

:: 현재 작업 브랜치 자동 감지 (기본값 master)
set "BRANCH=master"
for /f "delims=" %%b in ('git rev-parse --abbrev-ref HEAD 2^>nul') do set "BRANCH=%%b"

:: 1단계: 배포 전 빌드 검증
:: 왜: 코드 오류가 있는 상태로 GitHub에 푸시하면 운영 서버(Railway) 배포가 깨지므로 사전 차단
echo [1/4] 프론트엔드 빌드 및 코드 오류 검사 중...
call npm run build
if errorlevel 1 goto :BUILD_FAIL
echo       - 빌드 검증 통과!
echo.

:: 2단계: 변경 파일 스테이징 (.gitignore 설정으로 고객 엑셀/DB/인증키는 자동 제외됨)
echo [2/4] 변경된 파일 확인 중...
git status -s
echo.
git add -A

:: 스테이징된 변경 사항 유무 확인
git diff --cached --quiet
if %errorlevel% equ 0 goto :CHECK_UNPUSHED

:: 3단계: 커밋 메시지 입력 (그냥 Enter 입력 시 현재 날짜·시각으로 자동 기록)
set "NOW_STR="
for /f "delims=" %%t in ('powershell -NoProfile -Command "Get-Date -Format \"yyyy-MM-dd HH:mm\""') do set "NOW_STR=%%t"
set "DEFAULT_MSG=deploy: 업데이트 배포 (%NOW_STR%)"

set "COMMIT_MSG="
set /p "COMMIT_MSG=[3/4] 배포 메모 입력 (그냥 Enter 누르면 자동 입력): "
if "%COMMIT_MSG%"=="" set "COMMIT_MSG=%DEFAULT_MSG%"
:: 입력값 내 큰따옴표로 인한 명령어 깨짐 방지
set "COMMIT_MSG=%COMMIT_MSG:"='%"

echo.
echo       커밋 생성 중: "%COMMIT_MSG%"
git commit -m "%COMMIT_MSG%"
if errorlevel 1 goto :COMMIT_FAIL
echo.
goto :DO_PUSH

:CHECK_UNPUSHED
set "UNPUSHED=0"
for /f "delims=" %%c in ('git rev-list --count origin/%BRANCH%..HEAD 2^>nul') do set "UNPUSHED=%%c"
if "%UNPUSHED%"=="0" goto :ALREADY_UP_TO_DATE
echo [3/4] 추가 파일 수정은 없으나 아직 업로드되지 않은 커밋(%UNPUSHED%건)이 있어 푸시를 진행합니다.
echo.

:DO_PUSH
echo [4/4] GitHub 원격 저장소(%BRANCH%)로 업로드 중...
git push origin %BRANCH%
if errorlevel 1 goto :PUSH_FAIL

echo.
echo ========================================================
echo  [완료] GitHub 업로드가 정상적으로 완료되었습니다!
echo  잠시 후 연결된 배포 서버(Railway)에 자동으로 반영됩니다.
echo ========================================================
echo.
pause
exit /b 0

:ALREADY_UP_TO_DATE
echo ========================================================
echo  [안내] 새로 변경된 내용이 없습니다. (이미 최신 상태입니다)
echo ========================================================
echo.
pause
exit /b 0

:NO_GIT
echo ========================================================
echo  [오류] Git이 설치되어 있지 않거나 실행할 수 없습니다.
echo  Git 설치 여부를 확인해주세요.
echo ========================================================
echo.
pause
exit /b 1

:BUILD_FAIL
echo.
echo ========================================================
echo  [오류] 프론트엔드 빌드 검사 중 에러가 발생하여 배포를 중단했습니다.
echo  위 에러 메시지를 확인해 코드를 수정한 뒤 다시 실행해주세요.
echo ========================================================
echo.
pause
exit /b 1

:COMMIT_FAIL
echo.
echo ========================================================
echo  [오류] Git 커밋 생성 중 문제가 발생했습니다.
echo  Git 사용자 설정(user.name / user.email)을 확인해주세요.
echo ========================================================
echo.
pause
exit /b 1

:PUSH_FAIL
echo.
echo ========================================================
echo  [오류] GitHub 업로드(Push)에 실패했습니다.
echo  - 인터넷 연결 또는 GitHub 로그인 권한을 확인해주세요.
echo  - 다른 PC에서 먼저 올린 내역이 있다면 'git pull --rebase origin %BRANCH%' 후 다시 시도하세요.
echo ========================================================
echo.
pause
exit /b 1
