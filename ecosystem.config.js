module.exports = {
  apps: [
    {
      name: "trip-video-queue",
      script: "dist/index.js",
      cwd: "c:/source/trip-video-queue",
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: "500M",
      env: {
        NODE_ENV: "production",
      },
      log_date_format: "YYYY-MM-DD HH:mm:ss",
    }
  ],
};
