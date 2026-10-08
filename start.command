#!/bin/bash
# 字间排版 · 一键启动（macOS）
# 双击运行：自动检查 Node.js，没有则从国内镜像下载免安装版，然后安装依赖并启动。
# 不会修改系统环境，下载的 Node 只放在本目录的 .node-runtime 里。

cd "$(dirname "$0")" || exit 1

NODE_VERSION="v22.14.0"
RUNTIME_DIR=".node-runtime"

echo "======================================"
echo "  字间排版 · 一键启动（macOS）"
echo "======================================"

# 系统里已有 Node 18+ 就直接用
MAJOR=$(command -v node >/dev/null 2>&1 && node -v 2>/dev/null | sed -E 's/^v([0-9]+).*/\1/')

if [ -n "$MAJOR" ] && [ "$MAJOR" -ge 18 ]; then
  echo "检测到 Node.js $(node -v)"
elif [ -x "$RUNTIME_DIR/bin/node" ]; then
  echo "使用项目内置 Node.js"
  export PATH="$PWD/$RUNTIME_DIR/bin:$PATH"
else
  echo "未检测到 Node.js，正在从国内镜像下载免安装版（约 40MB）..."
  ARCH="x64"
  [ "$(uname -m)" = "arm64" ] && ARCH="arm64"
  URL="https://registry.npmmirror.com/-/binary/node/${NODE_VERSION}/node-${NODE_VERSION}-darwin-${ARCH}.tar.gz"
  TMP_PKG="/tmp/zijian-node-$$.tar.gz"
  mkdir -p "$RUNTIME_DIR"
  if ! curl -fL --connect-timeout 15 "$URL" -o "$TMP_PKG"; then
    echo ""
    echo "下载失败。请检查网络后重试，或手动安装 Node.js：https://nodejs.org"
    read -r -p "按回车退出..."
    exit 1
  fi
  tar -xzf "$TMP_PKG" -C "$RUNTIME_DIR" --strip-components 1
  rm -f "$TMP_PKG"
  export PATH="$PWD/$RUNTIME_DIR/bin:$PATH"
  echo "Node.js 就绪：$(node -v)"
fi

if [ ! -d node_modules ]; then
  echo "首次运行，正在安装依赖（国内镜像加速）..."
  if ! npm install --registry=https://registry.npmmirror.com; then
    echo ""
    echo "依赖安装失败，请检查网络后重试。"
    read -r -p "按回车退出..."
    exit 1
  fi
fi

if [ "$ZIJIAN_TEST" = "1" ]; then
  echo "测试模式：环境就绪，跳过启动。"
  exit 0
fi

( sleep 3; open "http://localhost:5173" ) &
echo ""
echo "启动中，浏览器稍后自动打开 http://localhost:5173"
echo "若端口被占用，请以下方终端显示的实际地址为准。"
echo "关闭本窗口即停止服务。"
echo ""
npm run dev
