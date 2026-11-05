module.exports = {
  apps: [{
    name: "remi-daemon",
    script: "daemon.py",
    interpreter: "python",
    watch: false,
    autorestart: true,
    restart_delay: 3000,
    max_restarts: 10,
    env: {
      NODE_ENV: "production"
    },
    log_file: "./remi.log",
    error_file: "./remi-error.log",
    out_file: "./remi-out.log",
    time: true
  }]
}