#!/bin/bash
# LED STAGE IMAGER の映像を NDI でネットワークに出すブリッジ。
# ダブルクリックで起動。閉じると停止。落ちても自動で再起動します。
#
# 前提: LED STAGE IMAGER を起動し「本番(PLAY)」モードにしておくこと。

BRIDGE="/Users/nomurayuuki/dev/decor-studio/tools/syphon-ndi-bridge/syphon2ndi"
NAME="LED STAGE IMAGER"

echo "======================================================"
echo " NDI 出力ブリッジ"
echo " 送信名: $NAME"
echo " 停止するにはこのウィンドウを閉じてください"
echo "======================================================"
echo ""

if [ ! -x "$BRIDGE" ]; then
  echo "ブリッジ本体が見つかりません: $BRIDGE"
  echo "（開発フォルダから build.sh を実行して作り直してください）"
  read -r _
  exit 1
fi

# 自動再起動ループ。Syphonソースが見つからない/途絶えたら数秒後に再試行。
while true; do
  "$BRIDGE" "$NAME" "$NAME"
  code=$?
  echo ""
  echo "[ラッパー] ブリッジ終了 (code=$code)。3秒後に再接続します… (Ctrl+C または閉じるで停止)"
  sleep 3
done
