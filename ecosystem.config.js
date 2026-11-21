module.exports = {
  apps: [
    {
      name: "stellar-footprint-service",
      script: "dist/index.js",
      // Use PM2 cluster mode to utilise all available CPU cores.
      instances: "max",
      exec_mode: "cluster",
      kill_timeout: 10000,
      listen_timeout: 8000,
      wait_ready: true,
      max_restarts: 10,
      restart_delay: 3000,
      out_file: "logs/out.log",
      error_file: "logs/error.log",
      log_date_format: "YYYY-MM-DD HH:mm:ss Z",
      // pm2-logrotate handles rotation — configure via:
      // pm2 install pm2-logrotate
      env_production: {
        NODE_ENV: "production",
        PORT: 3000,
      },
      env_staging: {
        NODE_ENV: "staging",
        PORT: 3001,
      },
    },
  ],
};
