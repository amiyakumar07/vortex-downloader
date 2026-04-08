module.exports = {
  apps: [{
    name: "vortex-downloader",
    script: "./server.js",
    instances: "max",
    exec_mode: "cluster",
    env_production: {
      NODE_ENV: "production",
      PORT: 5000
    },
    max_memory_restart: "512M",
    log_date_format: "YYYY-MM-DD HH:mm:ss Z",
    error_file: "/var/log/vortex-downloader/error.log",
    out_file: "/var/log/vortex-downloader/out.log",
    merge_logs: true,
    kill_timeout: 5000,
    listen_timeout: 10000,
    wait_ready: true,
    watch: false,
    instances: 2,
    exec_mode: "cluster"
  }]
};