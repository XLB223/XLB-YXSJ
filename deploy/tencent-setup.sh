#!/bin/bash
# 在腾讯云服务器上执行（首次部署）
# 用法: bash deploy/tencent-setup.sh

set -e
APP_DIR="/www/wwwroot/kjdsai.cn"
cd "$APP_DIR"

echo "==> 检查 Node.js"
node -v || { echo "请先安装 Node.js 18+"; exit 1; }

echo "==> 安装 PM2"
npm install -g pm2 2>/dev/null || true

if [ ! -f .env ]; then
  echo "==> 创建 .env（请编辑填入 DEEPSEEK_API_KEY 等）"
  cp .env.example .env
fi

mkdir -p data

echo "==> 启动服务"
pm2 delete listing-ai 2>/dev/null || true
pm2 start deploy/ecosystem.config.cjs
pm2 save

echo ""
echo "部署完成。请配置 Nginx 反向代理到 127.0.0.1:5173"
echo "访问: http://www.kjdsai.cn"
echo "健康检查: curl http://127.0.0.1:5173/api/health"
