#!/bin/bash

# ============================================================
# 🚀 AWS EC2 Setup for Cloud Blinkit Monitor (Puppeteer)
# Run this on a fresh Ubuntu 22.04 EC2 instance (t2.micro works)
# Usage: chmod +x aws-deploy.sh && ./aws-deploy.sh
# ============================================================

set -e

echo "🚀 Setting up Cloud Blinkit Monitor on AWS EC2..."
echo "=================================================="

# 1. Update system
echo "📦 Updating system..."
sudo apt update && sudo apt upgrade -y

# 2. Install Node.js 22 (Puppeteer v25 needs it)
echo "📦 Installing Node.js 22..."
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs

# 3. Install Chrome dependencies for Puppeteer
echo "🌐 Installing Chrome dependencies..."
sudo apt install -y \
    ca-certificates \
    fonts-liberation \
    libappindicator3-1 \
    libasound2t64 \
    libatk-bridge2.0-0 \
    libatk1.0-0 \
    libcups2 \
    libdbus-1-3 \
    libdrm2 \
    libgbm1 \
    libgtk-3-0 \
    libnspr4 \
    libnss3 \
    libx11-xcb1 \
    libxcomposite1 \
    libxdamage1 \
    libxrandr2 \
    wget \
    xdg-utils

# 4. Install PM2
echo "⚙️ Installing PM2..."
sudo npm install -g pm2

# 5. Create project directory
echo "📁 Setting up project..."
mkdir -p /home/ubuntu/blinkit-monitor
cd /home/ubuntu/blinkit-monitor

# 6. Install dependencies
echo "📦 Installing Node.js dependencies..."
npm init -y
npm install puppeteer twilio

# 7. Verify installations
echo ""
echo "✅ Installation Complete!"
echo "=================================================="
echo "Node.js: $(node --version)"
echo "NPM:    $(npm --version)"
echo "PM2:    $(pm2 --version)"
echo ""
echo "📋 NEXT STEPS:"
echo "=================================================="
echo ""
echo "1. Upload your monitor script:"
echo "   scp -i your-key.pem cloud-monitor-twilio.js ubuntu@YOUR_EC2_IP:/home/ubuntu/blinkit-monitor/"
echo ""
echo "2. Start the monitor:"
echo "   cd /home/ubuntu/blinkit-monitor"
echo "   pm2 start cloud-monitor-twilio.js --name blinkit-monitor"
echo ""
echo "3. Make it survive reboots:"
echo "   pm2 save"
echo "   pm2 startup   (then run the command it shows)"
echo ""
echo "4. Useful commands:"
echo "   pm2 logs blinkit-monitor    # See live logs"
echo "   pm2 status                  # Check if running"
echo "   pm2 restart blinkit-monitor # Restart"
echo "   pm2 stop blinkit-monitor    # Stop"
echo ""
echo "🎉 Setup complete! Ready to deploy your monitor!"
