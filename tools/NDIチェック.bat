@echo off
chcp 65001 >nul
title LED STAGE IMAGER / NDI check
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0NDIチェック.ps1"
