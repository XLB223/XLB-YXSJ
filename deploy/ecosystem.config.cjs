module.exports = {
  apps: [
    {
      name: "listing-ai",
      script: "server.mjs",
      cwd: "/www/wwwroot/kjdsai.cn",
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: "512M",
      env: {
        NODE_ENV: "production",
        PORT: 5173,
        HOST: "0.0.0.0",
      },
    },
  ],
};
