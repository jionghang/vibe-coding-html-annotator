@echo off
chcp 936 >nul
setlocal enabledelayedexpansion

set "PROJECT_DIR=%~dp0"
:: 去除末尾反斜杠（用于比较）
set "PROJECT_DIR_CLEAN=%PROJECT_DIR:~0,-1%"
set "PORT_FILE=%PROJECT_DIR%ports.txt"

echo ===== 关闭当前项目的 Node 服务 =====
echo 项目目录: %PROJECT_DIR%
echo.

if not exist "%PORT_FILE%" (
    echo 未找到端口记录文件，可能没有服务在运行。
    pause
    exit /b
)

:: 尝试匹配当前目录（去除末尾反斜杠）
set "found_port="
for /f "usebackq tokens=1,2 delims=#" %%a in ("%PORT_FILE%") do (
    set "record_dir=%%b"
    :: 去除记录末尾的反斜杠（如果有）
    if "!record_dir:~-1!"=="\" set "record_dir=!record_dir:~0,-1!"
    if "!record_dir!"=="%PROJECT_DIR_CLEAN%" (
        set "found_port=%%a"
        goto :found
    )
)
:found

if defined found_port (
    echo 找到端口: %found_port%
    :: 查找占用该端口的 PID
    set "pid="
    for /f "tokens=5" %%a in ('netstat -ano ^| find ":%found_port%" ^| find "LISTENING"') do (
        set "pid=%%a"
    )
    if not defined pid (
        echo 未找到占用端口 %found_port% 的进程（可能已手动关闭）
        echo 正在清理记录...
        findstr /v "#%PROJECT_DIR%" "%PORT_FILE%" > "%PORT_FILE%.tmp"
        move "%PORT_FILE%.tmp" "%PORT_FILE%" 2>nul
        pause
        exit /b
    )
    echo 找到进程 PID: !pid!
    taskkill /PID !pid! /F >nul 2>&1
    if errorlevel 1 (
        echo 关闭失败（进程可能已消失）
    ) else (
        echo 已关闭 PID !pid!
    )
    :: 删除记录（按原始目录匹配，确保删除正确行）
    findstr /v "#%PROJECT_DIR%" "%PORT_FILE%" > "%PORT_FILE%.tmp"
    move "%PORT_FILE%.tmp" "%PORT_FILE%" 2>nul
    pause
    exit /b
)

:: ==== 如果未找到匹配，列出所有记录供选择 ====
echo 未找到当前目录对应的端口记录。
echo 以下是所有运行中的服务：
echo.
set count=0
for /f "usebackq tokens=1,2 delims=#" %%a in ("%PORT_FILE%") do (
    set /a count+=1
    set "port_!count!=%%a"
    set "dir_!count!=%%b"
    echo [!count!] 端口: %%a    目录: %%b
)

if %count% equ 0 (
    echo 没有记录，可能服务都已关闭。
    pause
    exit /b
)

echo.
echo 请输入要关闭的序号 (1-%count%)，或输入 0 关闭所有：
set /p choice="选择: "

if "%choice%"=="0" (
    for /l %%i in (1,1,%count%) do (
        set "pid="
        for /f "tokens=5" %%a in ('netstat -ano ^| find ":!port_%%i!" ^| find "LISTENING"') do (
            set "pid=%%a"
        )
        if defined pid (
            taskkill /PID !pid! /F >nul 2>&1
            echo 已关闭端口 !port_%%i!
        )
    )
    del "%PORT_FILE%" 2>nul
    echo 已全部关闭。
    pause
    exit /b
)

:: 检查输入是否有效
set "found=0"
for /l %%i in (1,1,%count%) do (
    if "%choice%"=="%%i" (
        set "found=1"
        set "sel_port=!port_%%i!"
        set "sel_dir=!dir_%%i!"
        :: 查找 PID
        set "pid="
        for /f "tokens=5" %%a in ('netstat -ano ^| find ":!sel_port!" ^| find "LISTENING"') do (
            set "pid=%%a"
        )
        if defined pid (
            taskkill /PID !pid! /F >nul 2>&1
            echo 已关闭端口 !sel_port!
            :: 删除该记录
            findstr /v "#!sel_dir!" "%PORT_FILE%" > "%PORT_FILE%.tmp"
            move "%PORT_FILE%.tmp" "%PORT_FILE%" 2>nul
        ) else (
            echo 端口 !sel_port! 没有运行中的进程，已清理记录。
            findstr /v "#!sel_dir!" "%PORT_FILE%" > "%PORT_FILE%.tmp"
            move "%PORT_FILE%.tmp" "%PORT_FILE%" 2>nul
        )
        exit /b
    )
)

if %found% equ 0 (
    echo 无效选择。
    pause
)
