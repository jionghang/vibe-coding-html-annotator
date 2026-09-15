@echo off
chcp 936 >nul
cd /d "%~dp0"

set "PROJECT_DIR=%~dp0"
set "PORT_FILE=%PROJECT_DIR%ports.txt"

:: 检查 server.js 是否存在
if not exist "%PROJECT_DIR%server.js" (
    echo 错误：找不到 server.js，请在项目根目录运行本脚本。
    pause
    exit /b
)

:: 首次运行自动安装依赖
if not exist "%PROJECT_DIR%node_modules" (
    echo 首次运行，正在安装依赖（express、cors）...
    call npm install
    if errorlevel 1 (
        echo 依赖安装失败，请检查 npm 是否可用。
        pause
        exit /b
    )
)

:: 从 3000 开始检测可用端口
set "port=3000"
:checkport
netstat -ano | find ":%port%" >nul 2>&1
if errorlevel 1 (
    goto :portfound
) else (
    set /a port+=1
    goto :checkport
)
:portfound

echo 使用端口: %port%

:: 后台启动 Node 服务（工作目录为项目根目录）
powershell -Command "Start-Process -FilePath 'node' -ArgumentList '%PROJECT_DIR%server.js' -WindowStyle Hidden -WorkingDirectory '%PROJECT_DIR%'"

:: 等待服务启动
echo 服务启动中，请稍候...
timeout /t 1 /nobreak >nul

:: 记录端口和目录（使用 # 分隔，避免转义问题）
echo %port%#%PROJECT_DIR% >> "%PORT_FILE%"

:: 打开浏览器
start http://localhost:%port%/example.html
echo 服务已启动，访问 http://localhost:%port%/example.html
echo 停止请运行 stop.bat
pause
